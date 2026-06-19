#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors
#
# One-shot (re-runnable) historical backfill of the v4 RDS Postgres from the v2
# public S3 dump. This is the automated form of the migrate/README.md "REAL-snapshot
# rehearsal" plus the PR-5.0 prod load. Each run:
#
#   1. builds a FRESH v3 DuckDB from the v2 public bucket (the full history),
#   2. proves the EXACT prod load against a throwaway local Postgres -- the
#      self-gate: if `load --replace` + `verify` is not clean locally, it never
#      touches prod, and
#   3. does the atomic full-replace (TRUNCATE + COPY of all six tables in one
#      transaction) into the live v4 RDS as the master `postgres`, then
#      value-verifies the load per `measurement_id`.
#
# RUN THIS ONLY in a quiet window with NO develop merges in flight. The prod load
# TRUNCATEs and reloads all six tables in one transaction, so a concurrent CI
# dual-write would race the TRUNCATE. The post-cutover rows CI already wrote are
# also in the v2 dump, so a fresh snapshot includes them -- nothing is lost.
#
# The prod load is DESTRUCTIVE to v4 but ATOMIC: a mid-load failure rolls back to
# the ORIGINAL data, never to empty. The hard rollback is RDS point-in-time
# recovery (PITR). v4 is not the primary site yet, so a transient v4 state never
# affects users.
#
# Usage:
#   migrate/backfill-v4-prod.sh [--yes] [--reuse-snapshot] [--skip-build]
#                               [--skip-rehearsal] [--rehearse-port N] [-h|--help]
#
#   --yes / FORCE=1     Skip the interactive confirm before the prod TRUNCATE.
#   --reuse-snapshot    Reuse the existing .scratch snapshot instead of re-acquiring.
#   --skip-build        Use the existing release binary instead of rebuilding.
#   --skip-rehearsal    Skip the local self-gate (NOT recommended; needs Docker).
#   --rehearse-port N   Host port for the throwaway Postgres (default: auto, 55432+).
#
# Prerequisites: cargo, docker, psql, aws (profile `bench-prod`), curl, python3.
# The master password is read from Secrets Manager at load time and is never
# printed, logged, or placed on a command line you can see in `ps`.

set -euo pipefail

# --- Verified prod reference values (account 245040174862 / us-east-1). ---------
# These mirror docs/runbooks/emitter-ingest-cutover.md §1. Override via env only if
# the infra moves.
AWS_PROFILE="${AWS_PROFILE:-bench-prod}"
EXPECTED_ACCOUNT="${EXPECTED_ACCOUNT:-245040174862}"
RDS_HOST="${RDS_HOST:-vortex-bench-prod.c4f8qygk4xdp.us-east-1.rds.amazonaws.com}"
RDS_PORT="${RDS_PORT:-5432}"
RDS_DB="${RDS_DB:-vortex_bench}"
SECRET_ID="${SECRET_ID:-rds!db-23f1d9f9-ce44-4dc9-ac97-d3a5afaef690}"
RDS_CA_URL="${RDS_CA_URL:-https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem}"
HEALTH_URL="${HEALTH_URL:-https://benchmarks-website.vercel.app/api/health}"

# The throwaway rehearsal container name is deliberately distinctive so it never
# collides with another operator's or agent's local Postgres.
REHEARSE_CONTAINER="vbm-v4-backfill-rehearsal"

# --- Defaults, overridden by flag parsing below. --------------------------------
FORCE="${FORCE:-0}"
REUSE_SNAPSHOT=0
SKIP_BUILD=0
SKIP_REHEARSAL=0
REHEARSE_PORT=""

# Cleanup state populated as the run progresses; the trap tears it all down.
CA_FILE=""
REHEARSAL_UP=0

usage() { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

log()  { printf '[backfill %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
warn() { printf '[backfill %s] WARNING: %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
die()  { printf '[backfill %s] ERROR: %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 2; }

# Returns 0 if a TCP listener answers on host:port. Uses bash /dev/tcp so we do
# not depend on `nc` being installed.
tcp_open() { (exec 3<>"/dev/tcp/$1/$2") >/dev/null 2>&1; }

# Tear down everything this run created. Registered on EXIT so it runs on success,
# failure, and Ctrl-C alike.
cleanup() {
    if [ "$REHEARSAL_UP" = "1" ]; then
        docker rm -f "$REHEARSE_CONTAINER" >/dev/null 2>&1 || true
    fi
    [ -n "$CA_FILE" ] && rm -f "$CA_FILE" 2>/dev/null || true
}
trap cleanup EXIT

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --yes) FORCE=1 ;;
            --reuse-snapshot) REUSE_SNAPSHOT=1 ;;
            --skip-build) SKIP_BUILD=1 ;;
            --skip-rehearsal) SKIP_REHEARSAL=1 ;;
            --rehearse-port) shift; REHEARSE_PORT="${1:?--rehearse-port needs a value}" ;;
            -h|--help) usage 0 ;;
            *) die "unknown argument: $1 (use --help)" ;;
        esac
        shift
    done
}

# Resolve the benchmarks-website checkout from the git toplevel so the script works
# from any directory and survives being moved within the repo.
resolve_repo_root() {
    REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || true)"
    [ -n "$REPO_ROOT" ] || die "not inside a git checkout; run from within benchmarks-website"
    [ -f "$REPO_ROOT/migrate/Cargo.toml" ] && [ -f "$REPO_ROOT/migrations/001_initial_schema.sql" ] \
        || die "git root $REPO_ROOT is not the benchmarks-website repo (missing migrate/ or migrations/)"

    BIN="$REPO_ROOT/target/release/vortex-bench-migrate"
    SNAP_DIR="$REPO_ROOT/.scratch/v3-backfill"
    SNAP="$SNAP_DIR/bench-v3.duckdb"
    SCHEMA_DIR="$REPO_ROOT/migrations"
    mkdir -p "$SNAP_DIR"
}

# Fail loud and early if anything the run needs is missing or pointing at the wrong
# AWS account. None of these checks mutate anything.
preflight() {
    log "pre-flight checks"
    for tool in cargo docker psql aws curl python3; do
        command -v "$tool" >/dev/null 2>&1 || die "missing required tool: $tool"
    done

    docker info >/dev/null 2>&1 || die "docker is not running"

    local account
    account="$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text 2>/dev/null || true)"
    [ -n "$account" ] || die "aws profile '$AWS_PROFILE' is not configured or has no valid credentials"
    [ "$account" = "$EXPECTED_ACCOUNT" ] \
        || die "wrong AWS account: profile '$AWS_PROFILE' resolves to $account, expected $EXPECTED_ACCOUNT"
    log "AWS identity OK (account $account via profile $AWS_PROFILE)"

    # Confirm the master secret exists and is readable WITHOUT fetching its value.
    aws secretsmanager describe-secret --secret-id "$SECRET_ID" --profile "$AWS_PROFILE" \
        --query Name --output text >/dev/null 2>&1 \
        || die "cannot access master secret '$SECRET_ID' with profile '$AWS_PROFILE'"
    log "master secret accessible (value not fetched)"

    tcp_open "$RDS_HOST" "$RDS_PORT" || die "RDS $RDS_HOST:$RDS_PORT is not reachable"
    log "RDS reachable on $RDS_HOST:$RDS_PORT"
}

build_binary() {
    if [ "$SKIP_BUILD" = "1" ]; then
        [ -x "$BIN" ] || die "--skip-build given but $BIN does not exist"
        log "using existing binary (--skip-build)"
        return
    fi
    log "building release binary"
    cargo build --release -p vortex-bench-migrate --manifest-path "$REPO_ROOT/Cargo.toml"
    [ -x "$BIN" ] || die "build did not produce $BIN"
}

# Build a fresh v3 DuckDB from the v2 public bucket. `--allow-missing-file-sizes`
# is required: the three `-s3` suites (`tpch-s3`, `tpch-s3-10`, `fineweb-s3`)
# return 403 on the public bucket (the live v2 server reads the same keys, so prod
# never had their file-sizes either, and they dedupe against their `-nvme` twins by
# `measurement_id` -- the load is parity-preserving). The summary's "Uncategorized"
# gate (<5%) and per-source warnings still apply.
acquire_snapshot() {
    if [ "$REUSE_SNAPSHOT" = "1" ]; then
        [ -f "$SNAP" ] || die "--reuse-snapshot given but $SNAP does not exist"
        log "reusing existing snapshot $SNAP ($(du -h "$SNAP" | cut -f1))"
        return
    fi
    log "acquiring fresh v3 snapshot from the v2 public bucket"
    rm -f "$SNAP"
    VORTEX_BENCH_LOG=error "$BIN" run \
        --output "$SNAP" --source public-s3 --allow-missing-file-sizes
    [ -f "$SNAP" ] || die "snapshot was not written to $SNAP"
    log "snapshot ready: $SNAP ($(du -h "$SNAP" | cut -f1))"
}

# Probe upward from a start port until a free TCP port is found.
pick_free_port() {
    local p="${1:-55432}" i
    for i in $(seq 0 20); do
        if ! tcp_open 127.0.0.1 "$p"; then printf '%s' "$p"; return 0; fi
        p=$((p + 1))
    done
    die "could not find a free host port for the rehearsal Postgres near ${1:-55432}"
}

# The self-gate: stand up a throwaway Postgres:16, apply the prod-faithful schema
# (001 base + 006 read-path + 007 covering index -- the schema-shape migrations the
# loader touches; the 002-005 role/grant migrations are RDS-IAM-only and skipped),
# then run the EXACT prod operation (`load --replace`) and `verify`. Any failure
# here aborts the run before prod is touched. The populated-table TRUNCATE
# atomicity is additionally covered by `cargo nextest -p vortex-bench-migrate
# --test postgres_e2e`.
rehearse() {
    if [ "$SKIP_REHEARSAL" = "1" ]; then
        warn "skipping the local self-gate (--skip-rehearsal); the prod load will not be pre-proven"
        return
    fi

    local port; port="${REHEARSE_PORT:-$(pick_free_port 55432)}"
    local ldsn="postgresql://postgres:postgres@localhost:${port}/postgres"
    log "rehearsing the exact prod load against a throwaway Postgres on :$port"

    docker rm -f "$REHEARSE_CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$REHEARSE_CONTAINER" -e POSTGRES_PASSWORD=postgres \
        -p "${port}:5432" postgres:16-alpine >/dev/null
    REHEARSAL_UP=1

    local i
    for i in $(seq 1 60); do
        docker exec "$REHEARSE_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
        sleep 1
        [ "$i" = "60" ] && die "rehearsal Postgres did not become ready in 60s"
    done

    log "applying schema 001 + 006 + 007"
    local m
    for m in 001_initial_schema 006_read_path_perf 007_summary_covering_index; do
        psql "$ldsn" -v ON_ERROR_STOP=1 -q -f "$SCHEMA_DIR/${m}.sql" >/dev/null \
            || die "failed applying $m.sql to the rehearsal DB"
    done

    log "rehearsal: load --replace"
    VORTEX_BENCH_LOG=info "$BIN" load --replace --duckdb "$SNAP" --postgres-target "$ldsn" \
        || die "rehearsal LOAD failed -- not touching prod"

    log "rehearsal: verify (must exit 0)"
    "$BIN" verify --duckdb "$SNAP" --postgres-target "$ldsn" \
        || die "rehearsal VERIFY failed (presence diff or value mismatch) -- not touching prod"

    # Capture the exact per-table counts the snapshot produced; these are what prod
    # will become, shown in the confirm prompt and the final report.
    REHEARSED_COUNTS="$(psql "$ldsn" -At -F'|' -c "
        select 'commits', count(*) from commits
        union all select 'compression_sizes', count(*) from compression_sizes
        union all select 'compression_times', count(*) from compression_times
        union all select 'query_measurements', count(*) from query_measurements
        union all select 'random_access_times', count(*) from random_access_times
        union all select 'vector_search_runs', count(*) from vector_search_runs
        order by 1;")"

    docker rm -f "$REHEARSE_CONTAINER" >/dev/null 2>&1 || true
    REHEARSAL_UP=0
    log "self-gate GREEN: the exact prod load is clean against this snapshot"
}

# Print the row_counts and latest_commit_timestamp from a /api/health JSON body.
# Uses %-formatting (not f-strings) so it works on any Python 3, not just >=3.12.
print_health() {
    printf '%s' "$1" | python3 -c '
import sys, json
d = json.load(sys.stdin)
rc = d.get("row_counts", {})
for k in sorted(rc):
    print("    %-22s %s" % (k, rc[k]))
print("    %-22s %s" % ("latest_commit_timestamp", d.get("latest_commit_timestamp")))
'
}

fetch_health() { curl -fsS "$HEALTH_URL"; }

# Pause for an explicit typed confirmation before the irreversible TRUNCATE, unless
# the operator passed --yes / FORCE=1. The prompt is read from the real terminal so
# it works even when stdout is being tee'd to a log.
confirm_or_die() {
    if [ "$FORCE" = "1" ]; then
        log "confirm skipped (--yes/FORCE=1)"
        return
    fi
    printf '\n' > /dev/tty
    printf 'About to TRUNCATE and reload the LIVE v4 (%s db %s).\n' "$RDS_HOST" "$RDS_DB" > /dev/tty
    printf 'This is atomic (mid-load failure -> original data) but irreversible once committed.\n' > /dev/tty
    printf 'Type REPLACE to proceed: ' > /dev/tty
    local reply; read -r reply < /dev/tty
    [ "$reply" = "REPLACE" ] || die "not confirmed (got '${reply}') -- prod untouched"
}

# The irreversible step: read the master password (never printed), build the DSN,
# `load --replace` over host-verifying TLS, then `verify` per measurement_id.
prod_load() {
    log "fetching the RDS CA bundle"
    CA_FILE="$(mktemp -t rds-us-east-1.XXXXXX.pem)"
    curl -fsSL "$RDS_CA_URL" -o "$CA_FILE" || die "failed downloading RDS CA bundle"

    log "reading the master password from Secrets Manager (not printed)"
    local pw
    pw="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --profile "$AWS_PROFILE" \
            --query SecretString --output text \
          | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')"
    [ -n "$pw" ] || die "could not read the master password from the secret"

    # The DSN carries the password; never echo it or enable `set -x` around it.
    local dsn="postgresql://postgres:${pw}@${RDS_HOST}:${RDS_PORT}/${RDS_DB}?sslmode=require"
    pw=""

    log "PROD load --replace (atomic TRUNCATE + COPY of all six tables)"
    if ! VORTEX_BENCH_LOG=info "$BIN" load --replace \
            --duckdb "$SNAP" --postgres-target "$dsn" --ca-cert "$CA_FILE"; then
        dsn=""
        die "PROD LOAD FAILED. --replace is atomic: v4 rolled back to its ORIGINAL data. Investigate and re-run; hard rollback is RDS PITR."
    fi

    log "PROD verify (per measurement_id; must exit 0)"
    if ! "$BIN" verify --duckdb "$SNAP" --postgres-target "$dsn" --ca-cert "$CA_FILE"; then
        dsn=""
        die "PROD VERIFY FAILED: the load committed but does not match the snapshot. Investigate immediately; consider RDS PITR."
    fi
    dsn=""
    log "PROD load + verify GREEN"
}

main() {
    parse_args "$@"
    resolve_repo_root
    preflight
    build_binary
    acquire_snapshot
    rehearse

    log "capturing BEFORE state (live v4 /api/health)"
    local before; before="$(fetch_health)" || die "could not fetch $HEALTH_URL"
    printf '\n--- v4 row_counts BEFORE ---\n'; print_health "$before"
    if [ -n "${REHEARSED_COUNTS:-}" ]; then
        printf '\n--- snapshot counts the load will write ---\n'
        printf '%s\n' "$REHEARSED_COUNTS" | sed 's/^/    /; s/|/  /'
    fi

    confirm_or_die
    prod_load

    log "capturing AFTER state (live v4 /api/health)"
    local after; after="$(fetch_health)" || die "could not fetch $HEALTH_URL after load"
    printf '\n--- v4 row_counts AFTER ---\n'; print_health "$after"

    printf '\n'
    log "BACKFILL COMPLETE. v4 verified per measurement_id against the fresh snapshot."
    log "You can resume develop merges now."
}

main "$@"
