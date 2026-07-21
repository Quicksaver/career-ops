#!/usr/bin/env bash
set -euo pipefail

# career-ops batch runner — standalone orchestrator for headless workers
# Reads batch-input.tsv, delegates each offer to a headless worker,
# tracks state in batch-state.tsv for resumability.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
USER_ID="${CAREER_OPS_USER:-}"
USERS_DIR="${CAREER_OPS_USERS_DIR:-$PROJECT_DIR/users}"
USER_ROOT=""
BATCH_DIR=""
INPUT_FILE=""
STATE_FILE=""
PROMPT_FILE="$SCRIPT_DIR/batch-prompt.md"
CODEX_OUTPUT_SCHEMA="$SCRIPT_DIR/batch-output-schema.json"
LOGS_DIR=""
TRACKER_DIR=""
REPORTS_DIR=""
LOCK_FILE=""
PAUSE_FILE=""
STATE_LOCK_DIR=""
STATE_LOCK_PID_FILE=""
PROFILE_FILE=""
DISCARD_LOG=""
APPLICATIONS_FILE=""
STATE_LOCK_TIMEOUT_SECONDS=30
MAIN_PID="${BASHPID:-$$}"

# Defaults
PARALLEL=""
PARALLEL_EXPLICIT=false
PARALLEL_SOURCE=""
DRY_RUN=false
RETRY_FAILED=false
RESUME_PAUSED=false
START_FROM=0
MAX_RETRIES=2
MIN_SCORE=0
SKIP_PDF=false
MODEL=""  # explicit override; otherwise Claude uses spend_tier and Codex uses global config
REASONING_EFFORT=""  # Codex-only explicit override; otherwise Codex global config applies
CLI="${CAREER_OPS_BATCH_CLI:-claude}"
LIMIT=0
WORKER_TIMEOUT_SECONDS="${CAREER_OPS_WORKER_TIMEOUT_SECONDS:-900}"
RESOLVED_MODEL=""
RESOLVED_SPEND_TIER=""
RATE_LIMIT_SLEEP=300
BATCH_PAUSED=false
STATUS_ONLY=false
WATCH_MODE=false
DEFER_VERIFICATION=false
VERIFICATION_FAILED=false

# Return success for non-negative integer or decimal strings.
is_decimal_number() {
  [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]
}

usage() {
  cat <<'USAGE'
career-ops batch runner — process job offers in batch via headless workers
Supports Claude or Codex workers.
Claude workers use spend_tier from the active user's config/profile.yml unless --model overrides it.

Usage: batch-runner.sh [OPTIONS]

Options:
  --user ID           Required. User folder under users/ID
  --parallel N         Worker-count override (profile batch.parallel, then 1)
  --dry-run            Show what would be processed, don't execute
  --retry-failed       Only retry offers marked as "failed" in state
  --resume-paused      Resume offers paused by a Claude session/rate limit
  --start-from N       Start from offer ID N (skip earlier IDs)
  --max-retries N      Max retry attempts per offer (default: 2)
  --min-score N        Skip PDF/tracker for offers scoring below N (default: 0 = off)
  --cli NAME           Headless CLI to use: claude or codex (default: claude,
                       or CAREER_OPS_BATCH_CLI)
  --limit N            Process at most N pending offers in this run (default: 0 = all)
  --worker-timeout N   Seconds before a worker is killed and artifact recovery
                       is attempted (default: 900, or CAREER_OPS_WORKER_TIMEOUT_SECONDS)
  --skip-pdf           Skip PDF generation entirely (write ❌ in tracker PDF column)
  --rate-limit-sleep N Seconds to wait before retrying a rate-limited worker
                       (default: 300)
  --model NAME         Explicit worker model for the selected CLI. Without it,
                       Claude uses spend_tier and Codex uses its global config.
  --reasoning-effort LEVEL
                       Codex reasoning effort: minimal, low, medium, high, or xhigh
  --status             Show batch progress and a per-job table, then exit
  --watch              Live-refresh progress until the run completes
  --defer-verification Skip the batch-local final verifier because a parent
                       coordinator will run structured verification
  -h, --help           Show this help

Files:
  batch-input.tsv      Input offers (id, url, source, notes)
  batch-state.tsv      Processing state (auto-managed)
  batch-prompt.md      Prompt template for workers
  logs/                Per-offer logs
  tracker-additions/   Tracker lines for post-batch merge

Examples:
  # Dry run to see pending offers
  ./batch-runner.sh --user <username> --dry-run

  # Process all pending
  ./batch-runner.sh --user <username>

  # Retry only failed offers
  ./batch-runner.sh --user <username> --retry-failed

  # Process 2 at a time starting from ID 10
  ./batch-runner.sh --user <username> --parallel 2 --start-from 10
USAGE
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) USER_ID="$2"; shift 2 ;;
    --user=*) USER_ID="${1#--user=}"; shift ;;
    --parallel)
      [[ $# -ge 2 && "$2" != --* ]] || { echo "ERROR: --parallel requires an argument"; exit 1; }
      PARALLEL="$2"
      PARALLEL_EXPLICIT=true
      shift 2
      ;;
    --dry-run) DRY_RUN=true; shift ;;
    --retry-failed) RETRY_FAILED=true; shift ;;
    --resume-paused) RESUME_PAUSED=true; shift ;;
    --start-from) START_FROM="$2"; shift 2 ;;
    --max-retries) MAX_RETRIES="$2"; shift 2 ;;
    --min-score) MIN_SCORE="$2"; shift 2 ;;
    --cli) CLI="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --worker-timeout) WORKER_TIMEOUT_SECONDS="$2"; shift 2 ;;
    --skip-pdf) SKIP_PDF=true; shift ;;
    --rate-limit-sleep)
      [[ $# -ge 2 ]] || { echo "ERROR: --rate-limit-sleep requires an argument"; exit 1; }
      RATE_LIMIT_SLEEP="$2"
      shift 2
      ;;
    --model)
      [[ $# -ge 2 && "$2" != --* ]] || { echo "ERROR: --model requires an argument"; exit 1; }
      MODEL="$2"
      shift 2
      ;;
    --reasoning-effort)
      [[ $# -ge 2 && "$2" != --* ]] || { echo "ERROR: --reasoning-effort requires an argument"; exit 1; }
      REASONING_EFFORT="$2"
      shift 2
      ;;
    --status) STATUS_ONLY=true; shift ;;
    --watch) WATCH_MODE=true; shift ;;
    --defer-verification) DEFER_VERIFICATION=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if [[ -n "$REASONING_EFFORT" ]]; then
  case "$REASONING_EFFORT" in
    minimal|low|medium|high|xhigh) ;;
    *) echo "ERROR: --reasoning-effort must be minimal, low, medium, high, or xhigh"; exit 1 ;;
  esac
  if [[ "$CLI" != "codex" ]]; then
    echo "ERROR: --reasoning-effort is only valid with --cli codex"
    exit 1
  fi
fi

validate_user() {
  if [[ -z "$USER_ID" ]]; then
    echo "ERROR: No career-ops user selected. Specify --user ID or set CAREER_OPS_USER."
    echo "Example: batch/batch-runner.sh --user <username>"
    exit 1
  fi
  if [[ ! "$USER_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
    echo "ERROR: Invalid career-ops user \"$USER_ID\". Use letters, numbers, dots, underscores, or hyphens."
    exit 1
  fi
}

configure_user_paths() {
  case "$USERS_DIR" in
    /*) ;;
    *) USERS_DIR="$PROJECT_DIR/$USERS_DIR" ;;
  esac

  USER_ROOT="$USERS_DIR/$USER_ID"
  BATCH_DIR="$USER_ROOT/batch"
  INPUT_FILE="$BATCH_DIR/batch-input.tsv"
  STATE_FILE="$BATCH_DIR/batch-state.tsv"
  LOGS_DIR="$BATCH_DIR/logs"
  TRACKER_DIR="$BATCH_DIR/tracker-additions"
  REPORTS_DIR="$USER_ROOT/reports"
	PROFILE_FILE="$USER_ROOT/config/profile.yml"
	DISCARD_LOG="$LOGS_DIR/discard.log"
	APPLICATIONS_FILE="$USER_ROOT/data/applications.md"
  LOCK_FILE="$BATCH_DIR/batch-runner.pid"
  PAUSE_FILE="$BATCH_DIR/batch-runner.paused"
  STATE_LOCK_DIR="$BATCH_DIR/.batch-state.lock"
  STATE_LOCK_PID_FILE="$STATE_LOCK_DIR/pid"

  export CAREER_OPS_USER="$USER_ID"
  export CAREER_OPS_USERS_DIR="$USERS_DIR"
}

if ! [[ "$RATE_LIMIT_SLEEP" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --rate-limit-sleep must be a non-negative integer (seconds)."
  exit 1
fi

if ! is_decimal_number "$MIN_SCORE"; then
  echo "ERROR: --min-score must be a non-negative number."
  exit 1
fi

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --limit must be a non-negative integer."
  exit 1
fi

# Lock file to prevent double execution
acquire_lock() {
  if [[ -f "$LOCK_FILE" ]]; then
    local old_pid
    old_pid=$(cat "$LOCK_FILE")
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "ERROR: Another batch-runner is already running (PID $old_pid)"
      echo "If this is stale, remove $LOCK_FILE"
      exit 1
    else
      echo "WARN: Stale lock file found (PID $old_pid not running). Removing."
      rm -f "$LOCK_FILE"
    fi
  fi
  echo "$MAIN_PID" > "$LOCK_FILE"
}

release_lock() {
  if [[ "${BASHPID:-$$}" != "$MAIN_PID" ]]; then
    return
  fi
  rm -f "$LOCK_FILE"
}

trap release_lock EXIT

# Validate prerequisites
check_prerequisites() {
  if [[ ! -f "$INPUT_FILE" ]]; then
    echo "ERROR: $INPUT_FILE not found. Add offers first."
    exit 1
  fi

  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "ERROR: $PROMPT_FILE not found."
    exit 1
  fi

  if [[ "$CLI" == "codex" && ! -f "$CODEX_OUTPUT_SCHEMA" ]]; then
    echo "ERROR: $CODEX_OUTPUT_SCHEMA not found."
    exit 1
  fi

  case "$CLI" in
    claude|codex) ;;
    *) echo "ERROR: Unsupported --cli \"$CLI\". Use claude or codex."; exit 1 ;;
  esac

  if ! command -v "$CLI" &>/dev/null; then
    echo "ERROR: '$CLI' CLI not found in PATH."
    exit 1
  fi

  if [[ ! "$WORKER_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || (( WORKER_TIMEOUT_SECONDS < 1 )); then
    echo "ERROR: --worker-timeout must be a positive integer."
    exit 1
  fi

  mkdir -p "$LOGS_DIR" "$TRACKER_DIR" "$REPORTS_DIR"
}

# Status/watch mode only needs prior batch state, not worker prerequisites.
check_status_prerequisites() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No state file found at $STATE_FILE"
    exit 0
  fi
}

resolve_parallelism() {
  if [[ "$PARALLEL_EXPLICIT" == "true" ]]; then
    if [[ ! "$PARALLEL" =~ ^[0-9]+$ ]] || (( PARALLEL < 1 || PARALLEL > 32 )); then
      echo "ERROR: --parallel must be an integer from 1 to 32" >&2
      exit 1
    fi
    PARALLEL_SOURCE="argument"
    return
  fi

  # Preserve the script's standalone/default behavior in minimal fixtures and
  # partial installations that have no batch configuration to resolve.
  if [[ ! -f "$PROFILE_FILE" ]] ||
      ! awk '/^batch[[:space:]]*:/ { found=1 } END { exit(found ? 0 : 1) }' "$PROFILE_FILE"; then
    PARALLEL=1
    PARALLEL_SOURCE="default"
    return
  fi

  if [[ ! -f "$PROJECT_DIR/resolve-parallel.mjs" ]]; then
    echo "ERROR: $PROJECT_DIR/resolve-parallel.mjs is required when profile batch settings are present." >&2
    exit 1
  fi
  local resolution
  if ! resolution=$(node "$PROJECT_DIR/resolve-parallel.mjs" --profile "$PROFILE_FILE"); then
    echo "ERROR: Could not resolve batch parallelism." >&2
    exit 1
  fi
  IFS=$'\t' read -r PARALLEL PARALLEL_SOURCE <<< "$resolution"
}

# Initialize state file if it doesn't exist
init_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    printf 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n' > "$STATE_FILE"
  fi
}

acquire_state_lock() {
  if [[ "${STATE_LOCK_DISABLED:-0}" -eq 1 ]]; then
    return 0
  fi

  local waited=0
  local max_waits=$((STATE_LOCK_TIMEOUT_SECONDS * 10))

  while true; do
    if mkdir "$STATE_LOCK_DIR" 2>/dev/null; then
      if printf '%s\n' "${BASHPID:-$$}" > "$STATE_LOCK_PID_FILE"; then
        STATE_LOCK_OWNED=1
        return 0
      fi
      rm -f "$STATE_LOCK_PID_FILE" 2>/dev/null || true
      remove_benign_state_lock_entries
      rmdir "$STATE_LOCK_DIR" 2>/dev/null || true
      echo "ERROR: Failed to initialize state lock metadata at $STATE_LOCK_DIR"
      return 1
    fi

    if [[ ! -d "$STATE_LOCK_DIR" ]]; then
      if (( PARALLEL <= 1 )); then
        echo "WARN: State lock creation failed. Falling back to lock-free operation (single-worker mode)." >&2
        STATE_LOCK_DISABLED=1
        STATE_LOCK_OWNED=0
        return 0
      fi
      echo "ERROR: Failed to create state lock directory $STATE_LOCK_DIR"
      return 1
    fi

    if [[ -f "$STATE_LOCK_PID_FILE" ]]; then
      local lock_pid
      lock_pid=$(cat "$STATE_LOCK_PID_FILE" 2>/dev/null || true)
      if [[ -n "$lock_pid" ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
        rm -f "$STATE_LOCK_PID_FILE"
        remove_benign_state_lock_entries
        if rmdir "$STATE_LOCK_DIR" 2>/dev/null; then
          echo "WARN: Recovered stale state lock (PID $lock_pid not running)."
          continue
        fi
      fi
    fi

    if (( waited >= max_waits )); then
      echo "ERROR: Timed out waiting for state lock at $STATE_LOCK_DIR"
      echo "If no batch-runner worker is active, remove the stale lock directory."
      return 1
    fi

    sleep 0.1
    ((waited += 1))
  done
}

remove_benign_state_lock_entries() {
  # Finder may add a zero-length custom-icon file to directories on macOS.
  # It is unrelated to lock ownership but prevents rmdir from releasing or
  # recovering an otherwise empty state-lock directory.
  local finder_icon="$STATE_LOCK_DIR/Icon"$'\r'
  if [[ -f "$finder_icon" && ! -s "$finder_icon" ]]; then
    unlink "$finder_icon" 2>/dev/null || true
  fi
}

release_state_lock() {
  if [[ "${STATE_LOCK_OWNED:-0}" -ne 1 ]]; then
    return
  fi
  rm -f "$STATE_LOCK_PID_FILE" 2>/dev/null || true
  remove_benign_state_lock_entries
  rmdir "$STATE_LOCK_DIR" 2>/dev/null || true
  STATE_LOCK_OWNED=0
}

run_with_state_lock() {
  acquire_state_lock || return $?

  local status=0
  if "$@"; then
    status=0
  else
    status=$?
  fi

  release_state_lock
  return "$status"
}

# Get status of an offer from state file
get_status() {
  local id="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "none"
    return
  fi
  local status
  status=$(awk -F'\t' -v id="$id" '$1 == id { print $3 }' "$STATE_FILE")
  echo "${status:-none}"
}

# Get retry count for an offer
get_retries() {
  local id="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "0"
    return
  fi
  local retries
  retries=$(awk -F'\t' -v id="$id" '$1 == id { print $9 }' "$STATE_FILE")
  echo "${retries:-0}"
}

frontmatter_value() {
  local file="$1" key="$2"
  awk -v key="$key" '
    NR == 1 && $0 == "---" { in_fm = 1; next }
    in_fm && $0 == "---" { exit }
    in_fm && index($0, key ":") == 1 {
      value = $0
      sub(/^[^:]+:[[:space:]]*/, "", value)
      sub(/\r$/, "", value)
      if ((value ~ /^".*"$/) || (value ~ /^'\''.*'\''$/)) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit
    }
  ' "$file"
}

resolve_report_url() {
  local url="$1"

  if [[ "$url" != local:* ]]; then
    printf '%s\n' "$url"
    return
  fi

  local local_path="${url#local:}"
  local source_jd="$USER_ROOT/$local_path"
  if [[ ! -f "$source_jd" ]]; then
    printf '%s\n' "$url"
    return
  fi

  local application_url source_url
  application_url=$(frontmatter_value "$source_jd" "application_url" || true)
  source_url=$(frontmatter_value "$source_jd" "source_url" || true)

  if [[ -n "$application_url" ]]; then
    printf '%s\n' "$application_url"
  elif [[ -n "$source_url" ]]; then
    printf '%s\n' "$source_url"
  else
    printf '%s\n' "$url"
  fi
}

sed_replacement_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//&/\\&}"
  value="${value//|/\\|}"
  printf '%s\n' "$value"
}

mark_stale_processing_unlocked() {
  if [[ ! -f "$STATE_FILE" ]]; then
    return 0
  fi

  local tmp="$STATE_FILE.tmp"
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local found=false

  head -1 "$STATE_FILE" > "$tmp"
  while IFS=$'\t' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries; do
    [[ "$sid" == "id" ]] && continue
    if [[ "$sstatus" == "processing" ]]; then
      local next_retries="${sretries:-0}"
      if [[ "$next_retries" =~ ^[0-9]+$ ]]; then
        next_retries=$((next_retries + 1))
      else
        next_retries=1
      fi
      printf '%s\t%s\tfailed\t%s\t%s\t%s\t%s\tstale-processing-state\t%s\n' \
        "$sid" "$surl" "$sstarted" "$now" "$sreport" "$sscore" "$next_retries" >> "$tmp"
      found=true
    else
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$sid" "$surl" "$sstatus" "$sstarted" "$scompleted" "$sreport" "$sscore" "$serror" "$sretries" >> "$tmp"
    fi
  done < "$STATE_FILE"

  mv "$tmp" "$STATE_FILE"
  if [[ "$found" == "true" ]]; then
    echo "WARN: Recovered stale processing rows from a previous interrupted run."
  fi
}

mark_stale_processing() {
  run_with_state_lock mark_stale_processing_unlocked
}

# Read spend_tier from config/profile.yml. Defaults to "standard" if the key
# is absent or invalid.
read_spend_tier() {
  local raw=""

  if [[ -f "$PROFILE_FILE" ]]; then
    raw=$(
      awk -F: '
        /^[[:space:]]*spend_tier[[:space:]]*:/ {
          value = substr($0, index($0, ":") + 1)
          print value
          exit
        }
      ' "$PROFILE_FILE"
    )
    raw="${raw%%#*}"
    raw="${raw//$'\r'/}"
    raw="${raw#"${raw%%[![:space:]]*}"}"
    raw="${raw%"${raw##*[![:space:]]}"}"
    case "$raw" in
      \"*\") raw="${raw#\"}"; raw="${raw%\"}" ;;
      \'*\') raw="${raw#\'}"; raw="${raw%\'}" ;;
    esac
    raw="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  fi

  case "$raw" in
    economy|standard|premium)
      printf '%s\n' "$raw"
      ;;
    "")
      printf '%s\n' "standard"
      ;;
    *)
      echo "WARN: Invalid spend_tier \"$raw\" in ${PROFILE_FILE#"$PROJECT_DIR/"}; falling back to standard." >&2
      printf '%s\n' "standard"
      ;;
  esac
}

# Tier -> model mapping. Keep in sync with the table in modes/_shared.md.
spend_tier_to_model() {
  case "$1" in
    economy) echo "claude-haiku-4-5" ;;
    premium) echo "claude-opus-4-8" ;;
    standard|*) echo "claude-sonnet-4-6" ;;
  esac
}

# Resolve the worker model. --model always wins.
resolve_worker_model() {
  if [[ -n "$MODEL" ]]; then
    RESOLVED_MODEL="$MODEL"
    RESOLVED_SPEND_TIER="override"
    return 0
  fi

  RESOLVED_SPEND_TIER="$(read_spend_tier)"
  if [[ "$CLI" == "claude" ]]; then
    RESOLVED_MODEL="$(spend_tier_to_model "$RESOLVED_SPEND_TIER")"
  else
    # The project intentionally does not hardcode Codex model names. Let the
    # CLI choose its configured default unless --model was explicit.
    RESOLVED_MODEL=""
  fi
}

# Append a one-line, auditable record of a pre-screen-gate discard to
# batch/logs/discard.log (see modes/batch.md — Pre-screen gate). Format:
# {ISO8601 timestamp}\t{job id}\t{url}\t{reason}
log_discard() {
  local id="$1" url="$2" reason="$3"
  local logs_dir="${LOGS_DIR:-$SCRIPT_DIR/logs}"
  local discard_log="${DISCARD_LOG:-$logs_dir/discard.log}"
  mkdir -p "$logs_dir"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\t%s\t%s\t%s\n' "$ts" "$id" "$url" "$reason" >> "$discard_log"
}

# Calculate next report number.
# Caller must hold STATE_LOCK_DIR while this runs.
next_report_num_unlocked() {
  local max_num=0
  if [[ -d "$REPORTS_DIR" ]]; then
    for f in "$REPORTS_DIR"/*.md; do
      [[ -f "$f" ]] || continue
      local basename
      basename="${f##*/}"
      local num="${basename%%-*}"
      num=$((10#$num)) # Remove leading zeros for arithmetic
      if (( num > max_num )); then
        max_num=$num
      fi
    done
  fi
  # Also check state file for assigned report numbers
  if [[ -f "$STATE_FILE" ]]; then
    while IFS=$'\t' read -r _ _ _ _ _ rnum _ _ _; do
      [[ "$rnum" == "report_num" || "$rnum" == "-" || -z "$rnum" ]] && continue
      local n=$((10#$rnum))
      if (( n > max_num )); then
        max_num=$n
      fi
    done < "$STATE_FILE"
  fi
  printf '%03d' $((max_num + 1))
}

# Update or insert state for an offer.
# Caller must hold STATE_LOCK_DIR while this runs.
update_state_unlocked() {
  local id="$1" url="$2" status="$3" started="$4" completed="$5" report_num="$6" score="$7" error="$8" retries="$9"

  if [[ ! -f "$STATE_FILE" ]]; then
    init_state
  fi

  local tmp="$STATE_FILE.tmp"
  local found=false

  # Write header
  head -1 "$STATE_FILE" > "$tmp"

  # Process existing lines
  while IFS=$'\t' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries; do
    [[ "$sid" == "id" ]] && continue  # skip header
    if [[ "$sid" == "$id" ]]; then
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$id" "$url" "$status" "$started" "$completed" "$report_num" "$score" "$error" "$retries" >> "$tmp"
      found=true
    else
      printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
        "$sid" "$surl" "$sstatus" "$sstarted" "$scompleted" "$sreport" "$sscore" "$serror" "$sretries" >> "$tmp"
    fi
  done < "$STATE_FILE"

  if [[ "$found" == "false" ]]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$id" "$url" "$status" "$started" "$completed" "$report_num" "$score" "$error" "$retries" >> "$tmp"
  fi

  mv "$tmp" "$STATE_FILE"
}

update_state() {
  run_with_state_lock update_state_unlocked "$@"
}

is_rate_limit_log() {
  local log_file="$1"
  grep -Eiq '(rate limit|rate_limit|too many requests|429|quota exceeded|try again later|temporarily unavailable)' "$log_file"
}

is_session_limit_log() {
  local log_file="$1"
  grep -Eiq '(session limit|resets [0-9:]+[ap]m|usage limit|limit[[:space:]]+reached)' "$log_file"
}

mark_paused_rate_limit() {
  local id="$1" url="$2" started_at="$3" report_num="$4" retries="$5" log_file="$6"
  local completed_at
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local error_msg
  error_msg=$(tail -5 "$log_file" 2>/dev/null | tr '\n' ' ' | cut -c1-200 || echo "session/rate limit reached")
  update_state "$id" "$url" "paused_rate_limit" "$started_at" "$completed_at" "$report_num" "-" "$error_msg" "$retries"
  printf '%s\t%s\t%s\n' "$id" "$report_num" "$error_msg" > "$PAUSE_FILE"
  BATCH_PAUSED=true
}

reserve_report_num_unlocked() {
  local id="$1" url="$2" started="$3" retries="$4"

  local report_num=""
  if report_num=$(next_report_num_unlocked); then
    update_state_unlocked "$id" "$url" "processing" "$started" "-" "$report_num" "-" "-" "$retries"
  fi

  printf '%s\n' "$report_num"
}

reserve_report_num() {
  run_with_state_lock reserve_report_num_unlocked "$@"
}

find_report_for_num() {
  local report_num="$1"
  find "$REPORTS_DIR" -maxdepth 1 -type f -name "${report_num}-*.md" -print -quit 2>/dev/null || true
}

find_tracker_for_id() {
  local id="$1"
  find "$TRACKER_DIR" -maxdepth 1 -type f -name "${id}.tsv" -print -quit 2>/dev/null || true
}

validate_worker_json() {
  local final_file="$1"
  [[ -f "$final_file" ]] || return 1

  node -e '
const fs = require("fs");
const path = process.argv[1];
let payload;
try {
  payload = JSON.parse(fs.readFileSync(path, "utf8"));
} catch {
  process.exit(1);
}
const ok =
  payload &&
  (payload.status === "completed" || payload.status === "failed") &&
  typeof payload.id === "string" &&
  typeof payload.report_num === "string" &&
  typeof payload.company === "string" &&
  typeof payload.role === "string" &&
    (typeof payload.score === "number" || payload.score === null) &&
    (typeof payload.legitimacy === "string" || payload.legitimacy === null) &&
    (typeof payload.via === "string" || payload.via === null) &&
    (typeof payload.company_confidential === "boolean" || payload.company_confidential === null) &&
    (typeof payload.pdf === "string" || payload.pdf === null) &&
    (typeof payload.report === "string" || payload.report === null) &&
    (typeof payload.tracker === "string" || payload.tracker === null) &&
    (typeof payload.error === "string" || payload.error === null);
process.exit(ok ? 0 : 1);
' "$final_file"
}

worker_json_field() {
  local final_file="$1" field="$2"
  [[ -f "$final_file" ]] || return 0
  node -e '
const fs = require("fs");
const [path, field] = process.argv.slice(1);
try {
  const value = JSON.parse(fs.readFileSync(path, "utf8"))[field];
  if (value !== null && value !== undefined) process.stdout.write(String(value));
} catch {}
' "$final_file" "$field"
}

build_contract_error() {
  local exit_code="$1" timed_out="$2" final_file="$3" final_json_valid="$4" final_json_status="$5" report_file="$6" tracker_file="$7"
  local -a reasons=()

  if [[ "$timed_out" == "true" ]]; then
    reasons+=("worker-timeout")
  elif [[ "$exit_code" -ne 0 ]]; then
    reasons+=("worker-exit-$exit_code")
  fi
  if [[ "$CLI" == "codex" ]]; then
    if [[ ! -f "$final_file" ]]; then
      reasons+=("missing-final-json")
    elif [[ "$final_json_valid" != "true" ]]; then
      reasons+=("invalid-final-json")
    elif [[ "$final_json_status" != "completed" ]]; then
      reasons+=("worker-status-${final_json_status:-unknown}")
    fi
  fi
  [[ -n "$report_file" ]] || reasons+=("missing-report")
  [[ -n "$tracker_file" ]] || reasons+=("missing-tracker")

  local IFS=","
  printf '%s\n' "${reasons[*]:-unknown-worker-contract-failure}"
}

extract_score_from_artifacts() {
  local final_file="$1" report_file="$2" tracker_file="$3" log_file="$4"
  local score="-"

  if [[ -n "$final_file" && -f "$final_file" ]]; then
    score=$(worker_json_field "$final_file" score)
  fi
  if [[ -z "$score" || "$score" == "-" ]] && [[ -n "$log_file" && -f "$log_file" ]]; then
    score=$(sed -nE 's/.*"score":[[:space:]]*([0-9.]+).*/\1/p' "$log_file" 2>/dev/null | head -1 || true)
  fi
  if [[ -z "$score" || "$score" == "-" ]] && [[ -n "$report_file" && -f "$report_file" ]]; then
    score=$(sed -nE 's/^[*]*Score:[*]*[[:space:]]*([0-9.]+)\\/5.*/\1/p; s/^score:[[:space:]]*"?([0-9.]+)"?.*/\1/p' "$report_file" 2>/dev/null | head -1 || true)
  fi
  if [[ -z "$score" || "$score" == "-" ]] && [[ -n "$tracker_file" && -f "$tracker_file" ]]; then
    score=$(awk -F'\t' 'NR == 1 { sub(/\/5$/, "", $6); print $6 }' "$tracker_file" 2>/dev/null | head -1 || true)
  fi

  printf '%s\n' "${score:-"-"}"
}

# Process a single offer
process_offer() {
  local id="$1" url="$2" source="$3" notes="$4"

  local started_at
  started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local retries
  retries=$(get_retries "$id")
  local report_num
  report_num=$(reserve_report_num "$id" "$url" "$started_at" "$retries")
  local date
  date=$(date +%Y-%m-%d)
  local report_url
  report_url=$(resolve_report_url "$url")

  # Use mktemp instead of a predictable /tmp path: a fixed name like
  # /tmp/batch-jd-${id}.txt is guessable, so an attacker on a shared machine
  # could pre-create it as a symlink and redirect or clobber the write.
  local jd_file
  jd_file="$(mktemp "${TMPDIR:-/tmp}/batch-jd-${id}.XXXXXX")"

  if [[ "$url" == local:* ]]; then
    local local_path="${url#local:}"
    local source_jd="$USER_ROOT/$local_path"
    if [[ -f "$source_jd" ]]; then
      cp "$source_jd" "$jd_file"
    else
      printf '' > "$jd_file"
    fi
  else
    printf '' > "$jd_file"
  fi

  echo "--- Processing offer #$id: $url (report $report_num, attempt $((retries + 1)))"

  # Build the prompt with placeholders replaced
  local prompt
  if [[ "$SKIP_PDF" == "true" ]]; then
    prompt="Process this job offer. Run the pipeline: A-G evaluation + report .md + tracker line. Do not generate PDF; write ❌ in the tracker PDF column and set \"pdf\": null in the final JSON."
    echo "    ⏭️  --skip-pdf set — skipping PDF generation for #$id ($url)"
  else
    prompt="Process this job offer. Run the full pipeline: A-G evaluation + report .md + optional PDF + tracker line."
  fi
  prompt="$prompt URL: $report_url."
  prompt="$prompt JD file: $jd_file."
  prompt="$prompt Report number: $report_num."
  prompt="$prompt Date: $date."
  prompt="$prompt Batch ID: $id."
  prompt="$prompt Internal batch locator: $url."

  local log_file="$LOGS_DIR/${report_num}-${id}.log"
  local final_file="$LOGS_DIR/${report_num}-${id}.final.json"
  rm -f "$final_file"

  # Prepare system prompt with placeholders resolved
  local resolved_prompt="$BATCH_DIR/.resolved-prompt-${id}.md"
  local combined_prompt_file=""
  # Escape sed delimiter characters in variables to prevent substitution breakage
  local esc_url esc_jd_file esc_report_num esc_date esc_id esc_user esc_user_root
  esc_url=$(sed_replacement_escape "$report_url")
  esc_jd_file=$(sed_replacement_escape "$jd_file")
  esc_report_num=$(sed_replacement_escape "$report_num")
  esc_date=$(sed_replacement_escape "$date")
  esc_id=$(sed_replacement_escape "$id")
  esc_user=$(sed_replacement_escape "$USER_ID")
  esc_user_root=$(sed_replacement_escape "$USER_ROOT")
  sed \
    -e "s|{{URL}}|${esc_url}|g" \
    -e "s|{{JD_FILE}}|${esc_jd_file}|g" \
    -e "s|{{REPORT_NUM}}|${esc_report_num}|g" \
    -e "s|{{DATE}}|${esc_date}|g" \
    -e "s|{{ID}}|${esc_id}|g" \
    -e "s|{{USER}}|${esc_user}|g" \
    -e "s|{{USER_ROOT}}|${esc_user_root}|g" \
    "$PROMPT_FILE" > "$resolved_prompt"

  # Inject user-layer personalization into the temporary worker prompt.
  # The resolved prompt is gitignored runtime state, so user profile data stays
  # out of the system layer while batch scoring matches interactive scoring.
  for context_file in "$USER_ROOT/modes/_profile.md" "$USER_ROOT/config/profile.yml" "$USER_ROOT/modes/_custom.md"; do
    if [[ -f "$context_file" ]]; then
      {
        printf '\n\n---\n\n'
        printf '## Runtime personalization: %s\n\n' "${context_file#"$USER_ROOT/"}"
        sed 's/^/    /' "$context_file"
        printf '\n'
      } >> "$resolved_prompt"
    fi
  done

  # Launch worker. Building the command in an array keeps quoting safe
  # regardless of URL/title contents.
  local -a worker_args=()
  if [[ "$CLI" == "claude" ]]; then
    # --strict-mcp-config (with no --mcp-config) starts workers with no MCP
    # servers, avoiding parallel workers deadlocking over shared MCP resources.
    worker_args=(-p --dangerously-skip-permissions --strict-mcp-config)
    if [[ -n "$RESOLVED_MODEL" ]]; then
      worker_args+=(--model "$RESOLVED_MODEL")
    fi
    worker_args+=(--append-system-prompt-file "$resolved_prompt" "$prompt")
  else
    combined_prompt_file="$BATCH_DIR/.combined-prompt-${id}.md"
    {
      cat "$resolved_prompt"
      printf '\n%s\n' "$prompt"
    } > "$combined_prompt_file"

    worker_args=(
      exec
      --dangerously-bypass-approvals-and-sandbox
      -C "$PROJECT_DIR"
      --output-schema "$CODEX_OUTPUT_SCHEMA"
      --output-last-message "$final_file"
    )
    if [[ -n "$RESOLVED_MODEL" ]]; then
      worker_args+=(--model "$RESOLVED_MODEL")
    fi
    if [[ -n "$REASONING_EFFORT" ]]; then
      worker_args+=(-c "model_reasoning_effort=\"$REASONING_EFFORT\"")
    fi
    worker_args+=(-)
  fi

  local exit_code=0
  local timed_out=false
  local terminal_failure_recorded=false
  local stdin_file="/dev/null"
  if [[ -n "$combined_prompt_file" ]]; then
    stdin_file="$combined_prompt_file"
  fi

  local shim_retries=0
  local max_shim_retries=4
  while true; do
    exit_code=0
    timed_out=false
    "$CLI" "${worker_args[@]}" < "$stdin_file" > "$log_file" 2>&1 &
    local worker_pid=$!
    local elapsed=0

    while kill -0 "$worker_pid" 2>/dev/null; do
      if (( elapsed >= WORKER_TIMEOUT_SECONDS )); then
        timed_out=true
        echo "WARN: Worker #$id timed out after ${WORKER_TIMEOUT_SECONDS}s; attempting artifact recovery." >> "$log_file"
        kill "$worker_pid" 2>/dev/null || true
        sleep 2
        if kill -0 "$worker_pid" 2>/dev/null; then
          kill -9 "$worker_pid" 2>/dev/null || true
        fi
        break
      fi
      sleep 1
      elapsed=$((elapsed + 1))
    done

    if [[ "$timed_out" == "true" ]]; then
      wait "$worker_pid" 2>/dev/null || true
      exit_code=124
    else
      wait "$worker_pid" || exit_code=$?
    fi

    if [[ $exit_code -eq 0 || "$CLI" != "claude" ]]; then
      break
    fi

    # Check for Claude Code npm shim swap (exit code 127 + command not found)
    if [[ $exit_code -eq 127 ]] && grep -qE "(claude: command not found|claude:.*not found|cannot find.*claude)" "$log_file" && (( shim_retries < max_shim_retries )); then
      shim_retries=$((shim_retries + 1))
      echo "    ⏳ Claude command not found (shim swap detected). Retrying in 30s (attempt $shim_retries/$max_shim_retries)..."
      sleep 30
      continue
    fi

    if is_session_limit_log "$log_file"; then
      mark_paused_rate_limit "$id" "$url" "$started_at" "$report_num" "$retries" "$log_file"
      echo "    ⏸️  Session/rate limit reached; pausing batch without consuming retry budget."
      terminal_failure_recorded=true
      break
    fi

    if is_rate_limit_log "$log_file" && (( retries < MAX_RETRIES )); then
      if (( RATE_LIMIT_SLEEP <= 0 )); then
        mark_paused_rate_limit "$id" "$url" "$started_at" "$report_num" "$retries" "$log_file"
        echo "    ⏸️  Rate limited and --rate-limit-sleep is 0; pausing batch without consuming retry budget."
        terminal_failure_recorded=true
        break
      fi
      retries=$((retries + 1))
      local retry_completed_at
      retry_completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      update_state "$id" "$url" "rate_limited" "$started_at" "$retry_completed_at" "$report_num" "-" "rate-limit; retrying after ${RATE_LIMIT_SLEEP}s" "$retries"
      echo "    ⏳ Rate limited (attempt $retries/$MAX_RETRIES). Waiting ${RATE_LIMIT_SLEEP}s before retry..."
      sleep "$RATE_LIMIT_SLEEP"
      continue
    fi

    break
  done

  # Cleanup resolved prompt
  rm -f "$resolved_prompt" "$combined_prompt_file" "$jd_file"

  local completed_at
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local report_file tracker_file
  report_file=$(find_report_for_num "$report_num")
  tracker_file=$(find_tracker_for_id "$id")
  local final_json_valid=false
  local final_json_status=""
  if [[ "$CLI" == "codex" ]]; then
    if validate_worker_json "$final_file"; then
      final_json_valid=true
      final_json_status=$(worker_json_field "$final_file" status)
    else
      echo "WARN: Worker #$id did not return valid final JSON at $final_file." >> "$log_file"
    fi
  else
    final_json_valid=true
    final_json_status="completed"
  fi

  local artifacts_valid=false
  local artifact_validation_error=""
  if [[ -n "$report_file" && -n "$tracker_file" ]]; then
    local -a artifact_args=(
      "$SCRIPT_DIR/validate-worker-artifacts.mjs"
      --report "$report_file"
      --tracker "$tracker_file"
      --repair
    )
    if [[ "$final_json_valid" == "true" && -f "$final_file" ]]; then
      artifact_args+=(--final "$final_file")
    fi
    if artifact_validation_error=$(node "${artifact_args[@]}" 2>&1); then
      artifacts_valid=true
      artifact_validation_error=""
    else
      artifact_validation_error=$(printf '%s' "$artifact_validation_error" | tr '\r\n\t' ' ' | cut -c1-500)
      echo "WARN: Worker #$id artifact validation failed: $artifact_validation_error" >> "$log_file"
    fi
  fi

  if [[ ( $exit_code -eq 0 && "$final_json_valid" == "true" && "$final_json_status" == "completed" && "$artifacts_valid" == "true" ) || ( "$timed_out" == "true" && "$artifacts_valid" == "true" ) ]]; then
    # Try to extract score from worker output
    local score="-"
    score=$(extract_score_from_artifacts "$final_file" "$report_file" "$tracker_file" "$log_file")

    # Check min-score gate
    if is_decimal_number "$score" && awk -v min="$MIN_SCORE" 'BEGIN{exit !(min > 0)}'; then
      if awk -v score="$score" -v min="$MIN_SCORE" 'BEGIN{exit !(score < min)}'; then
        update_state "$id" "$url" "skipped" "$started_at" "$completed_at" "$report_num" "$score" "below-min-score" "$retries"
        echo "    ⏭️  Skipped (score: $score < min-score: $MIN_SCORE)"
        return 0
      fi
    fi

    update_state "$id" "$url" "completed" "$started_at" "$completed_at" "$report_num" "$score" "-" "$retries"
    if [[ $exit_code -ne 0 ]]; then
      echo "    ✅ Completed via artifact recovery (score: $score, report: $report_num, worker exit: $exit_code)"
    else
      echo "    ✅ Completed (score: $score, report: $report_num)"
    fi
  elif [[ "$terminal_failure_recorded" == "false" ]]; then
    if (( retries < MAX_RETRIES )); then
      retries=$((retries + 1))
    fi
    local error_msg
    error_msg=$(build_contract_error "$exit_code" "$timed_out" "$final_file" "$final_json_valid" "$final_json_status" "$report_file" "$tracker_file")
    if [[ -n "$artifact_validation_error" ]]; then
      error_msg="$error_msg,artifact-validation: $artifact_validation_error"
    fi
    local worker_error
    worker_error=$(worker_json_field "$final_file" error)
    if [[ -n "$worker_error" ]]; then
      error_msg="$error_msg: $worker_error"
    fi
    if [[ -z "$error_msg" ]]; then
      error_msg=$(tail -5 "$log_file" 2>/dev/null | tr '\n' ' ' | cut -c1-200 || echo "Unknown error (exit code $exit_code)")
    fi
    update_state "$id" "$url" "failed" "$started_at" "$completed_at" "$report_num" "-" "$error_msg" "$retries"
    echo "WARN: Worker #$id contract failure: $error_msg" >> "$log_file"
    echo "    ❌ Failed (attempt $retries, exit code $exit_code, $error_msg)"
  fi

  return 0
}

# Merge tracker additions into applications.md
merge_tracker() {
  echo ""
  echo "=== Merging tracker additions ==="
  node "$PROJECT_DIR/merge-tracker.mjs" --user "$USER_ID"
  echo ""
  echo "=== Reconciling pipeline.md ==="
  node "$PROJECT_DIR/reconcile-pipeline.mjs" --user "$USER_ID" || echo "⚠️  Pipeline reconcile had issues (see above)"
  echo ""
  echo "=== Verifying pipeline integrity ==="
  if [[ "$DEFER_VERIFICATION" == "true" ]]; then
    echo "Deferred to parent coordinator."
  elif ! node "$PROJECT_DIR/verify-pipeline.mjs" --user "$USER_ID"; then
    VERIFICATION_FAILED=true
    echo "❌ Verification found blocking integrity errors."
  fi
}

# Print summary
print_summary() {
  echo ""
  echo "=== Batch Summary ==="

  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No state file found."
    return
  fi

  local total=0 completed=0 skipped=0 failed=0 pending=0
  local score_sum=0 score_count=0

  while IFS=$'\t' read -r sid _ sstatus _ _ _ sscore _ _; do
    [[ "$sid" == "id" ]] && continue
    total=$((total + 1))
    case "$sstatus" in
      completed) completed=$((completed + 1))
        if is_decimal_number "$sscore"; then
          score_sum=$(awk -v sum="$score_sum" -v score="$sscore" 'BEGIN{print sum + score}' 2>/dev/null || echo "$score_sum")
          score_count=$((score_count + 1))
        fi
        ;;
      skipped) skipped=$((skipped + 1)) ;;
      failed) failed=$((failed + 1)) ;;
      *) pending=$((pending + 1)) ;;
    esac
  done < "$STATE_FILE"

  echo "Total: $total | Completed: $completed | Skipped: $skipped | Failed: $failed | Pending: $pending"

  if (( score_count > 0 )); then
    local avg
    avg=$(awk -v sum="$score_sum" -v count="$score_count" 'BEGIN{printf "%.1f", sum / count}' 2>/dev/null || echo "N/A")
    echo "Average score: $avg/5 ($score_count scored)"
  fi

  if [[ -f "$PROJECT_DIR/batch/aggregate-tokens.mjs" ]]; then
    if ! node "$PROJECT_DIR/batch/aggregate-tokens.mjs" --user "$USER_ID"; then
      echo "Warning: token aggregation failed." >&2
    fi
  fi
}

print_status_table() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No state file found at $STATE_FILE"
    return
  fi

  local total=0 completed=0 processing=0 failed=0 pending=0 skipped=0 rate_limited=0 paused_rate_limit=0
  local score_sum=0 score_count=0

  # Read first line to skip header
  local header=true
  while IFS=$'\t' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries || [[ -n "$sid" ]]; do
    if [[ "$header" == "true" ]]; then
      header=false
      continue
    fi
    [[ -z "$sid" ]] && continue
    sstatus="${sstatus%$'\r'}"
    sscore="${sscore%$'\r'}"
    serror="${serror%$'\r'}"
    sreport="${sreport%$'\r'}"
    total=$((total + 1))
    case "$sstatus" in
      completed)
        completed=$((completed + 1))
        if is_decimal_number "$sscore"; then
          score_sum=$(awk -v sum="$score_sum" -v score="$sscore" 'BEGIN{print sum + score}' 2>/dev/null || echo "$score_sum")
          score_count=$((score_count + 1))
        fi
        ;;
      processing) processing=$((processing + 1)) ;;
      failed) failed=$((failed + 1)) ;;
      skipped) skipped=$((skipped + 1)) ;;
      rate_limited) rate_limited=$((rate_limited + 1)) ;;
      paused_rate_limit) paused_rate_limit=$((paused_rate_limit + 1)) ;;
      *) pending=$((pending + 1)) ;;
    esac
  done < "$STATE_FILE"

  echo "=== Batch Progress ==="
  echo "Total: $total | Completed: $completed | Processing: $processing | Failed: $failed | Pending: $pending | Skipped: $skipped | Rate Limited: $rate_limited | Paused: $paused_rate_limit"
  if (( score_count > 0 )); then
    local avg
    avg=$(awk -v sum="$score_sum" -v count="$score_count" 'BEGIN{printf "%.1f", sum / count}' 2>/dev/null || echo "N/A")
    echo "Average score: $avg/5 ($score_count scored)"
  fi
  echo ""

  # Format the per-job table:
  # Columns: ID, Status, Report, Score, Target (URL or Error Message)
  printf "%-4s | %-17s | %-6s | %-5s | %-40s\n" "ID" "Status" "Report" "Score" "URL / Error"
  printf "%-4s+%-19s+%-8s+%-7s+%-42s\n" "----" "-------------------" "--------" "-------" "------------------------------------------"

  header=true
  while IFS=$'\t' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries || [[ -n "$sid" ]]; do
    if [[ "$header" == "true" ]]; then
      header=false
      continue
    fi
    [[ -z "$sid" ]] && continue
    sstatus="${sstatus%$'\r'}"
    sscore="${sscore%$'\r'}"
    serror="${serror%$'\r'}"
    sreport="${sreport%$'\r'}"
    local target="$surl"
    if [[ "$sstatus" == "failed" && -n "$serror" && "$serror" != "-" ]]; then
      target="Error: $serror"
    fi
    # Trim target to fit nicely (e.g. 50 chars)
    if (( ${#target} > 50 )); then
      target="${target:0:47}..."
    fi
    printf "%-4s | %-17s | %-6s | %-5s | %-50s\n" "$sid" "$sstatus" "$sreport" "$sscore" "$target"
  done < "$STATE_FILE"
}

watch_status() {
  local active_pid=""
  if [[ -f "$LOCK_FILE" ]]; then
    active_pid=$(cat "$LOCK_FILE" 2>/dev/null || true)
  fi

  if [[ -n "$active_pid" ]] && kill -0 "$active_pid" 2>/dev/null; then
    echo "Watching batch-runner (PID $active_pid)... Press Ctrl+C to stop."
    while kill -0 "$active_pid" 2>/dev/null; do
      clear || printf "\033[c"
      echo "=== Watching Batch Progress (PID $active_pid) ==="
      print_status_table
      sleep 2
    done
    echo ""
    echo "=== Batch runner process (PID $active_pid) has finished ==="
  else
    echo "No active batch-runner detected."
  fi

  echo "Showing final status:"
  print_status_table

  # Chain verify-pipeline.mjs
  if [[ -f "$PROJECT_DIR/verify-pipeline.mjs" ]]; then
    echo ""
    echo "=== Running pipeline verification ==="
    node "$PROJECT_DIR/verify-pipeline.mjs" --user "$USER_ID" || echo "⚠️  Verification found issues"
  fi
}

# Main
main() {
  validate_user
  configure_user_paths

  if [[ "$STATUS_ONLY" == "true" ]]; then
    check_status_prerequisites
    print_status_table
    exit 0
  fi

  if [[ "$WATCH_MODE" == "true" ]]; then
    check_status_prerequisites
    watch_status
    exit 0
  fi

  check_prerequisites

  resolve_parallelism

  resolve_worker_model

  if [[ "$DRY_RUN" == "false" ]]; then
    acquire_lock
    rm -f "$PAUSE_FILE"
  fi

  init_state
  if [[ "$DRY_RUN" == "false" ]]; then
    mark_stale_processing
  fi

  # Count input offers (skip header, ignore blank lines)
  local total_input
  total_input=$(tail -n +2 "$INPUT_FILE" | grep -c '[^[:space:]]' 2>/dev/null || true)
  total_input="${total_input:-0}"

  if (( total_input == 0 )); then
    echo "No offers in $INPUT_FILE. Add offers first."
    exit 0
  fi

  echo "=== career-ops batch runner ==="
  echo "User: $USER_ID"
  if (( LIMIT > 0 )); then
    echo "Parallel: $PARALLEL ($PARALLEL_SOURCE) | Max retries: $MAX_RETRIES | Limit: $LIMIT"
  else
    echo "Parallel: $PARALLEL ($PARALLEL_SOURCE) | Max retries: $MAX_RETRIES"
  fi
  echo "CLI: $CLI | Worker timeout: ${WORKER_TIMEOUT_SECONDS}s"
  if [[ "$RESOLVED_SPEND_TIER" == "override" ]]; then
    echo "Model: $RESOLVED_MODEL (explicit --model override)"
  elif [[ -n "$RESOLVED_MODEL" ]]; then
    echo "Model: $RESOLVED_MODEL (spend_tier=${RESOLVED_SPEND_TIER})"
  else
    echo "Model: CLI default (spend_tier=${RESOLVED_SPEND_TIER}; no hardcoded $CLI mapping)"
  fi
  if [[ "$CLI" == "codex" ]]; then
    if [[ -n "$REASONING_EFFORT" ]]; then
      echo "Reasoning effort: $REASONING_EFFORT (explicit override)"
    else
      echo "Reasoning effort: Codex global default"
    fi
  fi
  echo "Input: $total_input offers"
  echo ""

  # Build list of offers to process
  local -a pending_ids=()
  local -a pending_urls=()
  local -a pending_sources=()
  local -a pending_notes=()

  while IFS=$'\t' read -r id url source notes; do
    [[ "$id" == "id" ]] && continue  # skip header
    [[ -z "$id" || -z "$url" ]] && continue

    # Guard against non-numeric id values
    [[ "$id" =~ ^[0-9]+$ ]] || continue

    # Skip if before start-from
    if (( id < START_FROM )); then
      continue
    fi

    local status
    status=$(get_status "$id")

    if [[ "$RESUME_PAUSED" == "true" ]]; then
      if [[ "$status" != "paused_rate_limit" ]]; then
        continue
      fi
    elif [[ "$RETRY_FAILED" == "true" ]]; then
      # Only process failed offers
      if [[ "$status" != "failed" ]]; then
        continue
      fi
      # Check retry limit
      local retries
      retries=$(get_retries "$id")
      if (( retries >= MAX_RETRIES )); then
        echo "SKIP #$id: max retries ($MAX_RETRIES) reached"
        continue
      fi
    else
      # Skip terminal offers
      if [[ "$status" == "completed" || "$status" == "skipped" ]]; then
        continue
      fi
      # Paused rate-limit offers resume explicitly with --resume-paused.
      if [[ "$status" == "paused_rate_limit" ]]; then
        continue
      fi
      # Skip failed offers that hit retry limit (unless --retry-failed)
      if [[ "$status" == "failed" ]]; then
        local retries
        retries=$(get_retries "$id")
        if (( retries >= MAX_RETRIES )); then
          echo "SKIP #$id: failed and max retries reached (use --retry-failed to force)"
          continue
        fi
      fi
    fi

    if (( LIMIT > 0 )) && (( ${#pending_ids[@]} >= LIMIT )); then
      break
    fi

    pending_ids+=("$id")
    pending_urls+=("$url")
    pending_sources+=("$source")
    pending_notes+=("$notes")
    if (( LIMIT > 0 && ${#pending_ids[@]} >= LIMIT )); then
      break
    fi
  done < "$INPUT_FILE"

  local pending_count=${#pending_ids[@]}

  if (( pending_count == 0 )); then
    echo "No offers to process."
    print_summary
    exit 0
  fi

  echo "Pending: $pending_count offers"
  echo ""

  # Dry run: just list
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== DRY RUN (no processing) ==="
    for i in "${!pending_ids[@]}"; do
      local status
      status=$(get_status "${pending_ids[$i]}")
      echo "  #${pending_ids[$i]}: ${pending_urls[$i]} [${pending_sources[$i]}] (status: $status)"
    done
    echo ""
    echo "Would process $pending_count offers"
    exit 0
  fi

  # Process offers
  if (( PARALLEL <= 1 )); then
    # Sequential processing
    for i in "${!pending_ids[@]}"; do
      process_offer "${pending_ids[$i]}" "${pending_urls[$i]}" "${pending_sources[$i]}" "${pending_notes[$i]}"
      if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
        echo "=== Batch paused: session/rate limit reached. Resume later with --resume-paused. ==="
        break
      fi
    done
  else
    # Parallel processing with job control
    local running=0
    local -a pids=()
    local -a pid_ids=()

    for i in "${!pending_ids[@]}"; do
      if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
        echo "=== Batch paused: session/rate limit reached. Waiting for running workers, not scheduling new offers. ==="
        break
      fi

      # Wait if we're at parallel limit
      while (( running >= PARALLEL )); do
        # Wait for any child to finish
        for j in "${!pids[@]}"; do
          if ! kill -0 "${pids[$j]}" 2>/dev/null; then
            wait "${pids[$j]}" 2>/dev/null || true
            unset 'pids[j]'
            unset 'pid_ids[j]'
            running=$((running - 1))
          fi
        done
        # Compact arrays
        pids=("${pids[@]}")
        pid_ids=("${pid_ids[@]}")
        if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
          echo "=== Batch paused: session/rate limit reached. Waiting for running workers, not scheduling new offers. ==="
          break
        fi
        sleep 1
      done

      if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
        break
      fi

      # Launch worker in background
      process_offer "${pending_ids[$i]}" "${pending_urls[$i]}" "${pending_sources[$i]}" "${pending_notes[$i]}" &
      pids+=($!)
      pid_ids+=("${pending_ids[$i]}")
      running=$((running + 1))
    done

    # Wait for remaining workers
    for pid in "${pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi

  # Merge tracker additions
  merge_tracker

  # Print summary
  print_summary

  if [[ "$VERIFICATION_FAILED" == "true" ]]; then
    exit 1
  fi
  exit 0
}

main "$@"
