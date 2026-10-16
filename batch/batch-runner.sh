#!/usr/bin/env bash
set -euo pipefail

# career-ops batch runner — standalone orchestrator for headless workers
# Reads batch-input.tsv, delegates each offer to a headless worker,
# tracks state in batch-state.tsv for resumability.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) command -v cygpath >/dev/null 2>&1 && PROJECT_DIR="$(cygpath -m "$PROJECT_DIR")" ;;
esac
DATA_ROOT=""
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
RECOVERY_DIR=""
PROFILE_FILE=""
DISCARD_LOG=""
APPLICATIONS_FILE=""

STATE_LOCK_TIMEOUT_SECONDS=30
MAIN_PID="${BASHPID:-$$}"
OWNER_TOKEN=""
WORKER_DIR=""

# Defaults
PARALLEL=""
PARALLEL_EXPLICIT=false
PARALLEL_SOURCE=""

DRY_RUN=false
RETRY_FAILED=false
RESUME_PAUSED=false
INCLUDE_PENDING=false
START_FROM=0
MAX_RETRIES=2
MIN_SCORE=0
SKIP_PDF=false
MODEL=""  # explicit override; otherwise Claude uses spend_tier and Codex uses profile settings or system defaults
REASONING_EFFORT=""  # Codex-only explicit override; otherwise profile settings or system defaults apply
CLI="${CAREER_OPS_BATCH_CLI:-codex}"
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
RECOVER_ARTIFACT_FAILURES=false
ANSWERS_FILE=""
QUEUE_FILE=""
LIVE_INPUTS=""

# Return success for non-negative integer or decimal strings.
is_decimal_number() {
  [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]
}

usage() {
  cat <<'USAGE'
career-ops batch runner — process job offers in batch via headless workers
Supports Claude, Codex, OpenCode, Gemini, or Qwen workers.
Claude workers use spend_tier from the active user's config/profile.yml unless --model overrides it.

Usage: batch-runner.sh [OPTIONS]

Options:
  --answers-file PATH Explicit user-owned exact-URL manual answers (JSON)
  --queue-file PATH   Read-only plain URL list constraining this run
  --live-inputs PATH  Internal run coordinator control file for live answers
  --user ID           Required. User folder under users/ID
  --parallel N         Worker-count override (profile batch.parallel, then 1)

  --dry-run            Show what would be processed, don't execute
  --retry-failed       Select failed offers, allowing one extra attempt at the retry cap
  --resume-paused      Select offers paused by a session/rate limit
  --include-pending    Internal coordinator flag: union recovery selections with normal pending eligibility
  --start-from N       Start from offer ID N (skip earlier IDs)
  --limit N            Max offers: positive integer; omit for no limit
  --max-retries N      Max retry attempts per offer (default: 2)
  --min-score N        Mark completed evaluations below N skipped (default: 0 = off)
  --cli NAME           Headless CLI to use: claude, codex, opencode, gemini, qwen (default: codex,
                       or CAREER_OPS_BATCH_CLI)
  --worker-timeout N   Seconds before a worker is killed and artifact recovery
                       is attempted (default: 900, or CAREER_OPS_WORKER_TIMEOUT_SECONDS)
  --skip-pdf           Skip PDF generation entirely (write ❌ in tracker PDF column)
  --rate-limit-sleep N Maximum adaptive retry delay in seconds; 0 pauses immediately
                       (default: 300; range: 0–2147483647; claude only)

  --model NAME         Explicit worker model for the selected CLI. Without it,
                       Claude uses spend_tier; Codex uses codex profile settings, then system defaults.
  --reasoning-effort LEVEL
                       Codex reasoning effort: minimal, low, medium, high, or xhigh
  --status             Show batch progress and a per-job table, then exit
  --watch              Live-refresh progress until the run completes
  --defer-verification Skip the batch-local final verifier because a parent
                       coordinator will run structured verification
  --recover-artifact-failures
                       Revalidate completed worker artifacts that were falsely
                       marked failed, update their state, and exit without
                       launching workers
  -h, --help           Show this help

Files:
  batch-input.tsv      Input offers (id, url, source, notes)
  batch-state.tsv      Processing state (auto-managed)
  batch-prompt.md      Prompt template for workers
  logs/                Per-offer logs
  tracker-additions/   Tracker lines for post-batch merge

Runtime input, state, logs, tracker additions and artifacts live in the selected
user data root, honoring CAREER_OPS_ROOT, CAREER_OPS_DATA_DIR and the
.career-ops-data marker. System scripts, prompts and schemas stay in the checkout.

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
    --answers-file|--queue-file|--live-inputs)
      [[ $# -ge 2 && "$2" != --* ]] || { echo "ERROR: $1 requires a path"; exit 1; }
      if [[ "$1" == "--answers-file" ]]; then ANSWERS_FILE="$2";
      elif [[ "$1" == "--queue-file" ]]; then QUEUE_FILE="$2"; else LIVE_INPUTS="$2"; fi
      shift 2
      ;;
    --dry-run) DRY_RUN=true; shift ;;
    --retry-failed) RETRY_FAILED=true; shift ;;
    --resume-paused) RESUME_PAUSED=true; shift ;;
    --include-pending) INCLUDE_PENDING=true; shift ;;
    --start-from) START_FROM="$2"; shift 2 ;;
    --limit)
      if [[ $# -lt 2 ]] || ! [[ "$2" =~ ^[0-9]+$ ]] || [[ "$2" =~ ^0+$ ]]; then
        echo "ERROR: --limit must be a positive integer; omit --limit for no limit."
        exit 1
      fi
      # Remove leading zeroes before Bash arithmetic (which otherwise reads octal).
      LIMIT="${2#"${2%%[!0]*}"}"
      # Compare decimal strings before arithmetic can wrap an oversized integer.
      if [[ ${#LIMIT} -gt 19 ]] || { [[ ${#LIMIT} -eq 19 ]] && [[ "$LIMIT" > 9223372036854775807 ]]; }; then
        echo "ERROR: --limit must be at most 9223372036854775807; omit --limit for no limit."
        exit 1
      fi
      shift 2
      ;;
    --max-retries) MAX_RETRIES="$2"; shift 2 ;;
    --min-score) MIN_SCORE="$2"; shift 2 ;;
    --cli) CLI="$2"; shift 2 ;;
    --worker-timeout)
      [[ $# -ge 2 && "$2" != --* ]] || { echo "ERROR: --worker-timeout requires an argument"; exit 1; }
      WORKER_TIMEOUT_SECONDS="$2"; shift 2 ;;
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
    --recover-artifact-failures) RECOVER_ARTIFACT_FAILURES=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

if ! node -e 'const value = process.argv[1]; if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) process.exit(1)' "$WORKER_TIMEOUT_SECONDS"; then
  echo "ERROR: worker timeout must be a finite nonnegative number of seconds (0 disables the timeout)"
  exit 1
fi

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
    /*|[A-Za-z]:[\\/]*) ;;
    *) USERS_DIR="$PROJECT_DIR/$USERS_DIR" ;;
  esac

  USER_ROOT="${CAREER_OPS_ROOT:-${CAREER_OPS_DATA_DIR:-$USERS_DIR/$USER_ID}}"
  if [[ -z "${CAREER_OPS_ROOT:-}" && -z "${CAREER_OPS_DATA_DIR:-}" && -z "${CAREER_OPS_USERS_DIR:-}" && -f "$PROJECT_DIR/.career-ops-data" ]]; then
    local marker_root
    marker_root=$(tr -d '\r\n' < "$PROJECT_DIR/.career-ops-data")
    [[ -z "$marker_root" ]] || USER_ROOT="$marker_root"
  fi
  case "$USER_ROOT" in
    /*|[A-Za-z]:[\\/]*) ;;
    *) USER_ROOT="$PROJECT_DIR/$USER_ROOT" ;;
  esac
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) command -v cygpath >/dev/null 2>&1 && USER_ROOT="$(cygpath -m "$USER_ROOT")" ;;
  esac
  DATA_ROOT="$USER_ROOT"
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
  THROTTLE_FILE="$BATCH_DIR/batch-runner.throttled"
  STATE_LOCK_DIR="$BATCH_DIR/.batch-state.lock"
  STATE_LOCK_PID_FILE="$STATE_LOCK_DIR/pid"
  RECOVERY_DIR="$BATCH_DIR/batch-state-recovery.d"

  export CAREER_OPS_BATCH_STATE="$STATE_FILE"
  export CAREER_OPS_USER="$USER_ID"
  export CAREER_OPS_USERS_DIR="$USERS_DIR"
  export CAREER_OPS_ROOT="$USER_ROOT"
}


if ! [[ "$RATE_LIMIT_SLEEP" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --rate-limit-sleep must be a non-negative integer (seconds)."
  exit 1
fi
# Normalize decimal input before shell arithmetic (08 must not mean octal),
# and bound it before conversion so oversized input cannot wrap around.
RATE_LIMIT_SLEEP=$(printf '%s' "$RATE_LIMIT_SLEEP" | sed 's/^0*//')
RATE_LIMIT_SLEEP=${RATE_LIMIT_SLEEP:-0}
if [[ ${#RATE_LIMIT_SLEEP} -gt 10 ]] || { [[ ${#RATE_LIMIT_SLEEP} -eq 10 ]] && [[ "$RATE_LIMIT_SLEEP" > 2147483647 ]]; }; then
  echo "ERROR: --rate-limit-sleep must not exceed 2147483647 seconds."
  exit 1
fi

if ! is_decimal_number "$MIN_SCORE"; then
  echo "ERROR: --min-score must be a non-negative number."
  exit 1
fi

# Lock file to prevent double execution
acquire_lock() {
  node "$SCRIPT_DIR/worker-process.mjs" guard "$BATCH_DIR" || exit 125
  # Legacy locks use the Bash PID namespace. Never unlink an incumbent here.
  if [[ -f "$LOCK_FILE" && ! -d "$LOCK_FILE.owner.lock" ]]; then
    local old_pid
    old_pid=$(cat "$LOCK_FILE")
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "ERROR: Another batch-runner is already running (PID $old_pid)"
      exit 1
    elif [[ ! "$old_pid" =~ ^[1-9][0-9]*$ ]]; then
      echo "ERROR: Ambiguous legacy batch owner; refusing to remove $LOCK_FILE"
      exit 1
    fi
  fi
  local native_pid="$MAIN_PID"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      native_pid=$(cat "/proc/$MAIN_PID/winpid") || { echo "ERROR: Cannot determine native batch PID"; exit 1; }
      ;;
  esac
  if ! OWNER_TOKEN=$(node "$SCRIPT_DIR/runner-ownership.mjs" acquire "$LOCK_FILE" "$native_pid" "$MAIN_PID"); then
    echo "ERROR: Another batch-runner owns the batch, or ownership cannot be established"
    exit 1
  fi
  WORKER_DIR="$BATCH_DIR/.workers-$OWNER_TOKEN"
  mkdir -p "$WORKER_DIR"
}

release_lock() {
  if [[ "${BASHPID:-$$}" != "$MAIN_PID" ]]; then
    return
  fi
  if [[ -n "$OWNER_TOKEN" ]]; then
    stop_owned_workers || return 1
    node "$SCRIPT_DIR/runner-ownership.mjs" release "$LOCK_FILE" "$OWNER_TOKEN" || true
  fi
}

stop_owned_workers() {
  [[ -n "$WORKER_DIR" && -d "$WORKER_DIR" ]] || return 0
  local registration rc=0
  # The offer jobs exist before Node can register a CLI. Stop their native
  # trees too, including a supervisor paused during module startup.
  local offer_pid native_offer_pid
  for offer_pid in $(jobs -pr); do
    kill -0 "$offer_pid" 2>/dev/null || continue
    native_offer_pid="$offer_pid"
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        if ! native_offer_pid=$(cat "/proc/$offer_pid/winpid" 2>/dev/null); then
          kill -0 "$offer_pid" 2>/dev/null && rc=1
          continue
        fi ;;
    esac
    if node "$SCRIPT_DIR/worker-process.mjs" stop-pid "$native_offer_pid"; then
      wait "$offer_pid" 2>/dev/null || true
    else
      rc=1
    fi
  done
  for registration in "$WORKER_DIR/"*.json; do
    [[ -f "$registration" ]] || continue
    [[ "$registration" != *.job-result.json && "$registration" != *.job-launch.json ]] || continue
    node "$SCRIPT_DIR/worker-process.mjs" stop "$registration" || rc=1
  done
  return "$rc"
}

interrupt_batch() {
  [[ "${BASHPID:-$$}" == "$MAIN_PID" ]] || return
  stop_owned_workers || { echo "ERROR: Worker cleanup failed; preserving batch ownership" >&2; exit 125; }
  local pid
  for pid in ${pids[@]+"${pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  for pid in ${pids[@]+"${pids[@]}"}; do wait "$pid" 2>/dev/null || true; done
  exit 130
}

trap 'release_lock || exit 125' EXIT
trap interrupt_batch INT TERM

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

  # Resolve the binary the configured CLI actually needs. opencode can run
  # natively or fall back to ollama, so check for either.
  local cli_cmd
  case "$CLI" in
    claude|codex) cli_cmd="$CLI" ;;
    opencode) command -v opencode &>/dev/null && cli_cmd="opencode" || cli_cmd="ollama" ;;
    gemini)   cli_cmd="gemini" ;;
    qwen)     cli_cmd="qwen" ;;
    *) echo "ERROR: Unknown --cli '$CLI'. Supported: claude, codex, opencode, gemini, qwen"; exit 1 ;;
  esac

  if ! command -v "$cli_cmd" &>/dev/null; then
    echo "ERROR: '$cli_cmd' not found in PATH (required for --cli $CLI)."
    if [[ "$CLI" == "opencode" ]]; then
      echo "       Install opencode (https://opencode.ai) or Ollama (https://ollama.ai) with an opencode model."
    fi
    exit 1
  fi

  # Parallelism, the rate-limit retry loop, and --strict-mcp-config are
  # claude-only; local models run one at a time.
  if [[ "$CLI" != "claude" && "$CLI" != "codex" && "$PARALLEL" -gt 1 ]]; then
    echo "WARN: --parallel >1 is not supported for --cli $CLI (local models run sequentially). Resetting to 1."
    PARALLEL=1
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

# A lock held longer than this is assumed abandoned, independent of the
# PID-liveness check below. This exists because `kill -0 $pid` is unreliable
# on Git Bash/Windows (MSYS PIDs from $!/$BASHPID don't reliably map to real
# Windows process IDs), so a genuinely-dead lock holder can otherwise never
# be recovered there and every other worker times out waiting for it.
STATE_LOCK_STALE_AGE_SECONDS=15

acquire_state_lock() {
  if [[ "${STATE_LOCK_DISABLED:-0}" -eq 1 ]]; then
    return 0
  fi

  local waited=0
  local max_waits=$((STATE_LOCK_TIMEOUT_SECONDS * 10))

  while true; do
    if mkdir "$STATE_LOCK_DIR" 2>/dev/null; then
      if printf '%s\t%s\n' "${BASHPID:-$$}" "$(date +%s)" > "$STATE_LOCK_PID_FILE"; then
        STATE_LOCK_OWNED=1
        return 0
      fi
      rm -f "$STATE_LOCK_PID_FILE" 2>/dev/null || true
      remove_benign_state_lock_entries
      rmdir "$STATE_LOCK_DIR" 2>/dev/null || true
      echo "ERROR: Failed to initialize state lock metadata at $STATE_LOCK_DIR" >&2
      return 1
    fi

    if [[ ! -d "$STATE_LOCK_DIR" ]]; then
      if (( PARALLEL <= 1 )); then
        echo "WARN: State lock creation failed. Falling back to lock-free operation (single-worker mode)." >&2
        STATE_LOCK_DISABLED=1
        STATE_LOCK_OWNED=0
        return 0
      fi
      echo "ERROR: Failed to create state lock directory $STATE_LOCK_DIR" >&2
      return 1
    fi

    if [[ -f "$STATE_LOCK_PID_FILE" ]]; then
      local lock_pid lock_epoch
      lock_pid=$(cut -f1 "$STATE_LOCK_PID_FILE" 2>/dev/null || true)
      lock_epoch=$(cut -f2 "$STATE_LOCK_PID_FILE" 2>/dev/null || true)
      local stale=false
      local stale_reason=""

      # SAFETY INVARIANT: never treat the lock as stale while kill -0
      # positively confirms the recorded PID is still running — a
      # confirmed-alive owner may still write update_state_unlocked's
      # rewrite of STATE_FILE, and reclaiming under it would let two
      # processes rewrite $STATE_FILE.tmp concurrently (real data loss).
      # The age-based fallback below only ever fires when the PID check
      # could NOT confirm liveness (empty/missing PID, or kill -0 itself
      # reported not-running) — it narrows, but does not replace, the PID
      # check. This intentionally leaves one Windows/Git-Bash edge case
      # unhandled: a `kill -0` FALSE POSITIVE (reports alive for a PID
      # that Windows has actually reused for an unrelated process). That
      # gap is accepted because the alternative — reclaiming while any
      # chance remains the owner is genuinely alive — risks silent
      # concurrent-write corruption, which is worse than this lock
      # occasionally timing out (recoverable via retry) in that rare case.
      local pid_confirmed_alive=false
      if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
        pid_confirmed_alive=true
      fi

      if [[ "$pid_confirmed_alive" == "false" ]]; then
        if [[ -n "$lock_pid" ]]; then
          stale=true
          stale_reason="PID $lock_pid not running"
        elif [[ "$lock_epoch" =~ ^[0-9]+$ ]]; then
          local now age
          now=$(date +%s)
          age=$((now - lock_epoch))
          if (( age >= STATE_LOCK_STALE_AGE_SECONDS )); then
            stale=true
            stale_reason="lock age ${age}s >= ${STATE_LOCK_STALE_AGE_SECONDS}s (no PID recorded to check liveness against)"
          fi
        fi
      fi

      if [[ "$stale" == "true" ]]; then
        rm -f "$STATE_LOCK_PID_FILE"
        remove_benign_state_lock_entries
        if rmdir "$STATE_LOCK_DIR" 2>/dev/null; then
          echo "WARN: Recovered stale state lock ($stale_reason)." >&2
          continue
        fi
      fi
    fi

    if (( waited >= max_waits )); then
      echo "ERROR: Timed out waiting for state lock at $STATE_LOCK_DIR" >&2
      echo "If no batch-runner worker is active, remove the stale lock directory." >&2
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
  local state_line
  while IFS= read -r state_line; do
    IFS=$'\x1f' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries \
      <<< "${state_line//$'\t'/$'\x1f'}"
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
      echo "WARN: Invalid spend_tier \"$raw\" in ${PROFILE_FILE#"$DATA_ROOT/"}; falling back to standard." >&2
      printf '%s\n' "standard"
      ;;
  esac
}

# Tier -> model mapping. Keep in sync with the table in modes/_shared.md.
spend_tier_to_model() {
  case "$1" in
    economy) echo "claude-haiku-4-5" ;;
    premium) echo "claude-opus-5-5" ;;
    standard|*) echo "claude-sonnet-5-5" ;;
  esac
}

# Resolve the worker model. --model always wins.
resolve_worker_model() {
  if [[ "$CLI" == "codex" && -f "$PROJECT_DIR/resolve-codex-config.mjs" ]]; then
    local -a resolver_args=(--user "$USER_ID" --shell)
    [[ -z "$MODEL" ]] || resolver_args+=(--codex-model "$MODEL")
    [[ -z "$REASONING_EFFORT" ]] || resolver_args+=(--codex-reasoning-effort "$REASONING_EFFORT")
    local resolution
    resolution=$(node "$PROJECT_DIR/resolve-codex-config.mjs" "${resolver_args[@]}") || return 1
    # Trusted local resolver emits only fixed-key, safely quoted assignments.
    eval "$resolution"
    RESOLVED_MODEL="$CODEX_MODEL"
    REASONING_EFFORT="$CODEX_REASONING_EFFORT"
    RESOLVED_SPEND_TIER="codex-config"
    return 0
  fi
  if [[ "$CLI" == "codex" ]]; then
    RESOLVED_MODEL="${MODEL:-gpt-6.1-sol}"
    REASONING_EFFORT="${REASONING_EFFORT:-medium}"
    RESOLVED_SPEND_TIER="default"
    return 0
  fi
  if [[ -n "$MODEL" ]]; then
    RESOLVED_MODEL="$MODEL"
    RESOLVED_SPEND_TIER="override"
    return 0
  fi

  if [[ "$CLI" != "claude" ]]; then
    RESOLVED_MODEL=""
    RESOLVED_SPEND_TIER="cli-default"
    return 0
  fi

  RESOLVED_SPEND_TIER="$(read_spend_tier)"
  RESOLVED_MODEL="$(spend_tier_to_model "$RESOLVED_SPEND_TIER")"
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


# Update or insert state for an offer.
# Caller must hold STATE_LOCK_DIR while this runs.
update_state_unlocked() {
  local id="$1" url="$2" status="$3" started="$4" completed="$5" report_num="$6" score="$7" error="$8" retries="$9"

  # batch-state.tsv is tab-separated with one row per line -- a literal tab,
  # newline, or carriage return inside $error (e.g. from a worker's raw error
  # text, or JSON.parse unescaping \n/\r/\t in a caller upstream) would split
  # into extra columns or extra rows and corrupt every row after it. Collapse
  # them to spaces centrally here so every caller is protected, not just the
  # one that happened to trigger this.
  error=${error//$'\r'/ }
  error=${error//$'\n'/ }
  error=${error//$'\t'/ }

  if [[ ! -f "$STATE_FILE" ]]; then
    init_state
  fi

  local tmp="$STATE_FILE.tmp"
  local found=false

  # Write header
  head -1 "$STATE_FILE" > "$tmp"

  # Process existing lines
  local state_line
  while IFS= read -r state_line; do
    IFS=$'\x1f' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries \
      <<< "${state_line//$'\t'/$'\x1f'}"
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

# Durable last-resort records of state transitions that could NOT be written
# into $STATE_FILE (state-lock exhausted its retries). ONE FILE PER RECORD:
# each failed transition gets its own uniquely-named file via mktemp
# (O_CREAT|O_EXCL — atomic creation, guaranteed-unique name), so no two
# workers ever write to the same file and no shared-file truncate/append
# race can exist on any platform. That matters here because recovery writes
# are CORRELATED, not independent: they fire exactly when the state lock is
# jammed, which makes all parallel workers fail (and try to record) at the
# same moment — a shared recovery file is racing precisely when it is
# needed most (PR #2417 review). This mechanism must also never depend on
# the state lock that just failed, and it doesn't: creation is the only
# synchronization. reconcile_recovery_records() (start of the next run,
# single-threaded, before any worker spawns) merges each record into
# $STATE_FILE and deletes its file only on success — there is no
# rewrite-and-rename step, so nothing here needs cross-filesystem atomicity.
append_recovery_record() {
  local id="$1" url="$2" status="$3" started="$4" completed="$5" report_num="$6" score="$7" error="$8" retries="$9"
  # Same rationale as update_state_unlocked: a literal tab/newline/CR in
  # $error would split this single-line record into extra fields or rows,
  # corrupting the record and the state row it later reconciles into.
  error=${error//$'\r'/ }
  error=${error//$'\n'/ }
  error=${error//$'\t'/ }
  # \x1f is used as the in-memory delimiter when this record is read back
  # (see reconcile_recovery_records); strip it here too so a stray unit
  # separator in $error can't inject a field boundary on the read side.
  error=${error//$'\x1f'/ }
  mkdir -p "$RECOVERY_DIR" || return 1
  local rec
  rec=$(mktemp "$RECOVERY_DIR/rec-XXXXXX") || return 1
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$id" "$url" "$status" "$started" "$completed" "$report_num" "$score" "$error" "$retries" > "$rec"
}

# A recovery record is ALWAYS older than whatever $STATE_FILE holds for the
# same id: the record is only written when the lock was unreachable, so any
# row present for that id now was written afterwards by a path that did reach
# the lock. Merging it blindly therefore rolls a finished offer backwards --
# the score and completed_at are overwritten, and since rate_limited and
# failed are NOT terminal, the offer re-enters pending selection in main()
# and gets evaluated a second time. Cost: one lost evaluation plus one
# duplicate run, on a path that by construction only fires when something
# already went wrong.
#
# Completed and human-held states must not be rolled back by stale records.
# Keep these protected states in sync with the pending-selection guard.
recovery_record_is_superseded() {
  local current="$1"
  [[ "$current" == "completed" || "$current" == "skipped" || "$current" == "needs_confirmation" ]]
}

# Merge one recovery record, but only into a row that has not already reached
# a completed or human-held state. The status read happens INSIDE the lock: a
# check-then-write gap would let a worker finish between the two and
# reintroduce the same rollback. get_status is a lock-free reader (plain awk
# over $STATE_FILE), so calling it here does not re-enter the non-reentrant
# mkdir lock.
#
# Exit codes: 0 merged · 3 superseded (record is stale, caller should drop
# it) · anything else is a real failure. 3 avoids colliding with the 1 that
# acquire_state_lock returns when the lock itself is unreachable.
reconcile_one_unlocked() {
  local id="$1"
  local current
  current=$(get_status "$id")
  if recovery_record_is_superseded "$current"; then
    echo "    Superseded: offer id=$id already '$current' in state — discarding stale recovery record (would have rolled it back to '$3')."
    return 3
  fi
  update_state_unlocked "$@"
}

reconcile_one() {
  run_with_state_lock reconcile_one_unlocked "$@"
}

# Merge any recovery records left by a prior run into $STATE_FILE. Runs
# single-threaded at the very start of main(), before any worker is spawned,
# so there is no lock contention here — this is the one place these records
# are guaranteed a clean shot at the lock. Each record file is deleted only
# after its transition lands in $STATE_FILE (or is found to be superseded);
# genuine failures leave the file in place for the run after that.
reconcile_recovery_records() {
  [[ -d "$RECOVERY_DIR" ]] || return 0

  local -a rec_files=()
  local f
  for f in "$RECOVERY_DIR"/rec-*; do
    [[ -f "$f" ]] || continue
    rec_files+=("$f")
  done
  if (( ${#rec_files[@]} == 0 )); then
    rmdir "$RECOVERY_DIR" 2>/dev/null || true
    return 0
  fi

  echo "=== Reconciling ${#rec_files[@]} recovery record(s) from a prior interrupted run ==="
  local merged=0 superseded=0 still_failed=0
  local rid rurl rstatus rstarted rcompleted rreport rscore rerror rretries
  local rline
  local rc
  for f in "${rec_files[@]}"; do
    rline=""
    # Don't split with `IFS=$'\t' read`: tab is IFS *whitespace*, so a run of
    # tabs around an empty interior field (e.g. an empty completed_at on a
    # non-terminal record) collapses to one delimiter and every later field
    # shifts left, corrupting the merge. Read the line raw, then split on \x1f
    # (a non-whitespace unit separator that preserves empty fields) after
    # translating the on-disk tabs to it. Same rationale as process_offer.
    IFS= read -r rline < "$f" || true
    IFS=$'\x1f' read -r rid rurl rstatus rstarted rcompleted rreport rscore rerror rretries <<< "${rline//$'\t'/$'\x1f'}"
    if [[ -z "$rid" ]]; then
      echo "    WARN: discarding unreadable recovery record $f" >&2
      rm -f "$f"
      continue
    fi
    rc=0
    reconcile_one "$rid" "$rurl" "$rstatus" "$rstarted" "$rcompleted" "$rreport" "$rscore" "$rerror" "$rretries" || rc=$?
    if (( rc == 0 )); then
      rm -f "$f"
      merged=$((merged + 1))
    elif (( rc == 3 )); then
      # Stale by definition, not a failure — the row it targets already
      # finished. Dropping the file is correct; keeping it would retry the
      # same rollback on every subsequent run.
      rm -f "$f"
      superseded=$((superseded + 1))
    else
      still_failed=$((still_failed + 1))
    fi
  done

  echo "    Merged: $merged | Superseded: $superseded | Still unrecovered: $still_failed"
  if (( still_failed > 0 )); then
    echo "    WARN: $still_failed record(s) could not be merged even single-threaded — check $STATE_LOCK_DIR for a genuinely stuck lock. Unmerged records remain in $RECOVERY_DIR." >&2
  else
    rmdir "$RECOVERY_DIR" 2>/dev/null || true
  fi
}

# Retry wrapper around update_state. Bare `update_state ...` calls under
# `set -e` will silently kill the entire background worker subshell if a
# single lock-timeout failure propagates — this wrapper retries a few times
# and, if it still fails, falls back to append_recovery_record so the
# transition is never actually lost (only delayed until the next run's
# reconcile step), then logs a clear warning and returns non-zero so the
# CALLER can still decide whether to skip side effects that assumed success.
# Return 1 means the transition is durable in recovery; 2 means neither write
# succeeded, so a human gate must stop and surface the persistence failure
# (found under --parallel 5 on Git Bash/Windows: ~47 of 50 jobs silently
# dropped in one run from exactly this before the retry+recovery-log fix).
update_state_retrying() {
  local attempt=0
  local max_attempts=3
  while (( attempt < max_attempts )); do
    if update_state "$@"; then
      return 0
    fi
    attempt=$((attempt + 1))
    if (( attempt < max_attempts )); then
      echo "    ⚠️  State update failed (attempt $attempt/$max_attempts), retrying in 2s..." >&2
      sleep 2
    fi
  done
  if append_recovery_record "$@"; then
    echo "    ⚠️  State update failed after $max_attempts attempts — offer id=$1 status=$3 recorded to $RECOVERY_DIR for reconciliation on next run." >&2
  else
    echo "    ❌ State update failed after $max_attempts attempts AND recovery-record write also failed — offer id=$1 status=$3 was NOT recorded anywhere. It will be retried as pending next run." >&2
    return 2
  fi
  return 1
}

is_rate_limit_log() {
  is_provider_limit_log "$1" rate
}

is_session_limit_log() {
  is_provider_limit_log "$1" session
}

# Read only provider error envelopes or anchored CLI diagnostics. Worker JSON,
# report paths and quoted JD data are not HTTP status/error signals.
is_provider_limit_log() {
  node - "$1" "$2" <<'NODE'
const fs = require('node:fs');
const [file, kind] = process.argv.slice(2);
const rateCodes = new Set(['rate_limit_error', 'rate_limit_exceeded', 'insufficient_quota', 'quota_exceeded', 'usage_limit_reached']);
const sessionCodes = new Set(['session_limit', 'session_limit_reached', 'usage_limit_reached']);
const codes = kind === 'rate' ? rateCodes : sessionCodes;
function diagnostic(text) {
  const line = String(text).replace(/\x1b\[[0-9;]*m/g, '').trim();
  const message = line.replace(/^(?:API error|error|codex error|claude error):\s*/i, '').replace(/^stream disconnected before completion:\s*/i, '');
  if (kind === 'rate') {
    return /^API error:\s*429(?:\s|:|$)/i.test(line)
      || /^(?:HTTP(?:\/\S+)?\s+429(?:\s|:|$)|unexpected (?:HTTP )?status 429\s+Too Many Requests\b|429\s+Too Many Requests\b|too many requests\b|rate[ _-]limit(?: exceeded| reached| error|:|$)|quota exceeded\b|you exceeded your current quota\b|insufficient_quota(?:\b|$)|usage_limit_reached(?:\b|$))/i.test(message);
  }
  return /^(?:(?:you(?:'ve| have)|you have) (?:hit|reached) your (?:usage |session )?limit\b|usage limit (?:reached|exceeded)\b|session limit(?: reached| exceeded|$)|usage_limit_reached(?:\b|$))/i.test(message);
}
const matched = fs.readFileSync(file, 'utf8').split(/\r?\n/).some(line => {
  let event;
  try { event = JSON.parse(line); } catch { return diagnostic(line); }
  // Application final JSON and agent_message items can contain arbitrary data.
  if (!event || typeof event !== 'object' || event.status !== undefined) return false;
  if (!['error', 'turn.failed', undefined].includes(event.type)) return false;
  const error = event.error;
  if (error && typeof error === 'object' && (codes.has(error.code) || codes.has(error.type))) return true;
  if (event.type === 'error' || event.type === 'turn.failed') return diagnostic(error?.message ?? event.message ?? '');
  return false;
});
process.exitCode = matched ? 0 : 1;
NODE
}

# Print a delay or "pause". Only standalone delta-seconds headers are trusted;
# never feed worker text into shell arithmetic. awk compares before formatting,
# so even an arbitrarily long integer header safely requests a pause.
rate_limit_delay() {
  local log_file="$1" retry="$2" base delay hint step
  if (( RATE_LIMIT_SLEEP == 0 )); then
    echo pause
    return
  fi
  base=30
  (( base <= RATE_LIMIT_SLEEP )) || base=$RATE_LIMIT_SLEEP
  # A log that exists and is empty has no header to find, and awk would print
  # nothing for it: skip the two processes. A missing log still reaches awk.
  hint=""
  [[ -e "$log_file" && ! -s "$log_file" ]] || hint=$(LC_ALL=C awk -v cap="$RATE_LIMIT_SLEEP" '
    tolower($0) ~ /^[[:space:]]*retry-after:[[:space:]]*[0-9]+[[:space:]]*$/ {
      value=$0
      sub(/^[^:]*:[[:space:]]*/, "", value)
      if (value + 0 > cap) over=1
      if (value + 0 > largest) largest=value + 0
      found=1
    }
    END {
      if (over) print "pause"
      else if (found) printf "%.0f\n", largest
    }
  ' "$log_file")
  if [[ "$hint" == pause ]]; then
    echo pause
    return
  fi
  delay=$base
  if [[ -n "$hint" ]]; then
    (( hint <= delay )) || delay=$hint
  else
    # Saturate before doubling, avoiding exponentiation/overflow even on resume.
    for (( step=0; step<retry && delay<RATE_LIMIT_SLEEP; step++ )); do
      if (( delay > RATE_LIMIT_SLEEP / 2 )); then
        delay=$RATE_LIMIT_SLEEP
      else
        delay=$((delay * 2))
      fi
    done
  fi
  # Upward-only jitter never undercuts Retry-After or the base delay.
  delay=$((delay + delay * (RANDOM % 21) / 100))
  (( delay <= RATE_LIMIT_SLEEP )) || delay=$RATE_LIMIT_SLEEP
  echo "$delay"
}

mark_paused_rate_limit() {
  local id="$1" url="$2" started_at="$3" report_num="$4" retries="$5" log_file="$6"
  local completed_at
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local error_msg
  error_msg=$(tail -5 "$log_file" 2>/dev/null | tr '\n' ' ' | cut -c1-200 || echo "session/rate limit reached")
  update_state_retrying "$id" "$url" "paused_rate_limit" "$started_at" "$completed_at" "$report_num" "-" "$error_msg" "$retries" || true
  printf '%s\t%s\t%s\n' "$id" "$report_num" "$error_msg" > "$PAUSE_FILE"
  BATCH_PAUSED=true
}

reserve_report_num_unlocked() {
  local id="$1" url="$2" started="$3" retries="$4"

  # Use the shared, cross-process-atomic reservation system (O_CREAT|O_EXCL
  # sentinel files in reserve-report-num.mjs) instead of the old bash-native
  # max(existing report files, batch-state.tsv numbers)+1 scan. The bash-native
  # version had zero visibility into reservations made by any OTHER process
  # calling `node reserve-report-num.mjs` directly -- e.g. an interactively
  # dispatched Agent evaluating one offer with a browser tool while a batch
  # run is in flight. Both could independently compute the same "next" number
  # and collide on disk. Found 2026-07-30: two separate collisions (report
  # 049, report 051) in one batch run for exactly this reason -- routing every
  # caller through the same node script means they all share one real lock.
  local report_num=""
  report_num=$(node "$PROJECT_DIR/reserve-report-num.mjs" --user "$USER_ID" 2>/dev/null | tr -d '[:space:]') || report_num=""
  # No number means the allocator failed (lock timeout, unwritable reports/,
  # exhausted retries). Returning success with an empty number let the caller
  # launch a paid worker with a blank "Report number:" and write an empty
  # report_num cell into batch-state.tsv; the retry wrapper below is what
  # handles a failed reservation, so fail here and let it.
  if [[ ! "$report_num" =~ ^[0-9]+$ ]]; then
    echo "    ❌ reserve-report-num.mjs returned no report number for offer id=$id" >&2
    return 1
  fi
  update_state_unlocked "$id" "$url" "processing" "$started" "-" "$report_num" "-" "-" "$retries"

  printf '%s\n' "$report_num"
}

# Release a report-number reservation via the shared atomic system. Safe to
# call even if the number was never actually reserved this way (e.g. a
# resumed/paused offer) -- the underlying script no-ops on a missing sentinel.
release_report_num() {
  local report_num="$1"
  [[ -n "$report_num" && "$report_num" != "-" ]] || return 0
  node "$PROJECT_DIR/reserve-report-num.mjs" --user "$USER_ID" --release "$report_num" >/dev/null 2>&1 || true
}

reserve_report_num() {
  run_with_state_lock reserve_report_num_unlocked "$@"
}

# Retry wrapper — same rationale as update_state_retrying above. A bare
# `x=$(reserve_report_num ...)` under `set -e` kills the worker subshell
# silently on a single lock-timeout; this retries and logs instead.
reserve_report_num_retrying() {
  local attempt=0
  local max_attempts=3
  local result=""
  while (( attempt < max_attempts )); do
    if result=$(reserve_report_num "$@"); then
      printf '%s\n' "$result"
      return 0
    fi
    attempt=$((attempt + 1))
    if (( attempt < max_attempts )); then
      echo "    ⚠️  Report-number reservation failed (attempt $attempt/$max_attempts), retrying in 2s..." >&2
      sleep 2
    fi
  done
  echo "    ❌ Report-number reservation failed after $max_attempts attempts for offer id=$1 — leaving it pending for next run." >&2
  return 1
}

find_report_for_num() {
  local report_num="$1"
  local report_file=""
  local candidate_count=0
  local candidate=""

  # A report-number reservation is represented by NNN-RESERVED.md in the same
  # directory as real reports. Never let that sentinel enter artifact
  # validation: it contains reservation metadata, not a Machine Summary.
  while IFS= read -r -d '' candidate; do
    report_file="$candidate"
    candidate_count=$((candidate_count + 1))
  done < <(find "$REPORTS_DIR" -maxdepth 1 -type f \
    -name "${report_num}-*.md" ! -name "${report_num}-RESERVED.md" -print0 2>/dev/null)

  if (( candidate_count == 1 )); then
    printf '%s\n' "$report_file"
  elif (( candidate_count > 1 )); then
    echo "WARN: Report $report_num is ambiguous: found $candidate_count non-reservation report files." >&2
  fi
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
  ["completed", "failed", "needs_confirmation"].includes(payload.status) &&
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
  if [[ "$final_json_valid" == "true" && "$final_json_status" != "completed" ]]; then
    reasons+=("worker-status-${final_json_status:-unknown}")
  elif [[ "$CLI" == "codex" ]]; then
    if [[ ! -f "$final_file" ]]; then
      reasons+=("missing-final-json")
    elif [[ "$final_json_valid" != "true" ]]; then
      reasons+=("invalid-final-json")
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
    score=$(sed -nE 's|^[*]*Score:[*]*[[:space:]]*([0-9.]+)/5.*|\1|p; s|^score:[[:space:]]*"?([0-9.]+)"?.*|\1|p' "$report_file" 2>/dev/null | head -1 || true)
  fi
  if [[ -z "$score" || "$score" == "-" ]] && [[ -n "$tracker_file" && -f "$tracker_file" ]]; then
    score=$(awk -F'\t' 'NR == 1 { for (i=1;i<=NF;i++) if (tolower($i)=="score") { col=i; next } col=6 } { value=$col; sub(/\/5$/, "", value); print value; exit }' "$tracker_file" 2>/dev/null | head -1 || true)
  fi

  printf '%s\n' "${score:-"-"}"
}

# Recover false artifact-validation failures without rerunning model workers.
# Recovery is deliberately narrow: the persisted state must carry the exact
# historical sentinel-selection symptom, the worker must have returned a valid
# completed final JSON, and the real report + tracker addition must pass the
# same cross-artifact validator used by normal completion.
recover_artifact_failures() {
  local recovered=0
  local unresolved=0
  local inspected=0

  local state_line
  while IFS= read -r state_line; do
    IFS=$'\x1f' read -r id url status started completed report_num score error retries \
      <<< "${state_line//$'\t'/$'\x1f'}"
    [[ "$id" == "id" ]] && continue
    [[ "$status" == "failed" ]] || continue
    [[ "$error" == *"artifact-validation: report is missing a YAML Machine Summary"* ]] || continue
    inspected=$((inspected + 1))

    local report_file tracker_file final_file
    report_file=$(find_report_for_num "$report_num")
    tracker_file=$(find_tracker_for_id "$id")
    final_file="$LOGS_DIR/${report_num}-${id}.final.json"

    if [[ -z "$report_file" || -z "$tracker_file" ]] || ! validate_worker_json "$final_file" || \
       [[ "$(worker_json_field "$final_file" status)" != "completed" ]] || \
       [[ "$(worker_json_field "$final_file" id)" != "$id" ]] || \
       [[ "$(worker_json_field "$final_file" report_num)" != "$report_num" ]]; then
      unresolved=$((unresolved + 1))
      echo "    ⚠️  Not recoverable: #$id (report $report_num) is missing a completed artifact set"
      continue
    fi

    local validation_error=""
    local -a recovery_validation_args=(--report "$report_file" --tracker "$tracker_file" --final "$final_file" --repair --strict-workflow --user-root "$USER_ROOT" --report-num "$report_num" --expected-url "$url" --user "$USER_ID")
    if [[ -n "$ANSWERS_FILE" ]]; then recovery_validation_args+=(--answers-file "$ANSWERS_FILE"); fi
    if ! validation_error=$(node "$SCRIPT_DIR/validate-worker-artifacts.mjs" "${recovery_validation_args[@]}" 2>&1); then
      unresolved=$((unresolved + 1))
      validation_error=$(printf '%s' "$validation_error" | tr '\r\n\t' ' ' | cut -c1-500)
      echo "    ⚠️  Not recoverable: #$id (report $report_num): $validation_error"
      continue
    fi

    score=$(extract_score_from_artifacts "$final_file" "$report_file" "$tracker_file" "$LOGS_DIR/${report_num}-${id}.log")
    if ! is_decimal_number "$score"; then
      unresolved=$((unresolved + 1))
      echo "    ⚠️  Not recoverable: #$id (report $report_num) has no validated score"
      continue
    fi

    update_state "$id" "$url" "completed" "$started" "$completed" "$report_num" "$score" "-" "$retries"
    release_report_num "$report_num"
    recovered=$((recovered + 1))
    echo "    ✅ Recovered #$id (score: $score, report: $report_num)"
  done < "$STATE_FILE"

  echo "Recovered artifact failures: inspected=$inspected completed=$recovered unresolved=$unresolved"
  (( unresolved == 0 ))
}

# Process a single offer
process_offer() {
  local id="$1" url="$2" source="$3" notes="$4"
  local remaining="$5"

  if [[ "$url" == local:* && -f "$SCRIPT_DIR/manual-inputs.mjs" ]]; then
    node "$SCRIPT_DIR/manual-inputs.mjs" local "$USER_ID" "" "" "$url" "$id" "$USER_ROOT" || { echo "ERROR: unsafe local JD reference" >&2; return 2; }
  fi
  local started_at
  started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local retries
  retries=$(get_retries "$id")
  # A deliberate skip closes the posting without an evaluation,
  # network call, report reservation or paid worker. The batch owner alone
  # writes terminal state, including when the answer arrived through live input.
  if [[ -n "$ANSWERS_FILE" && -f "$SCRIPT_DIR/manual-inputs.mjs" ]]; then
    local skip_reason
    skip_reason=$(node "$SCRIPT_DIR/manual-inputs.mjs" skip "$USER_ID" "$ANSWERS_FILE" "$QUEUE_FILE" "$url") || return 2
    if [[ -n "$skip_reason" ]]; then
      # An interrupted/failed worker may have left an unmerged addition. Retain
      # it as evidence, outside the merger's input, rather than letting a skip
      # accidentally publish that worker's partial result.
      if [[ -f "$TRACKER_DIR/$id.tsv" ]]; then
        mkdir -p "$LOGS_DIR/quarantine" || return 2
        local skip_quarantine
        skip_quarantine=$(mktemp -d "$LOGS_DIR/quarantine/skipped-$id.XXXXXX") || return 2
        mv "$TRACKER_DIR/$id.tsv" "$skip_quarantine/$id.tsv" || return 2
      fi
      update_state_retrying "$id" "$url" skipped "$started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "-" "-" "$skip_reason" "$retries" || return 2
      if [[ "$skip_reason" == "user-skipped-jd-unavailable" ]]; then
        echo "    Skipped: $url — user cannot supply the missing JD."
      else
        echo "    Skipped: $url — user discarded the failed job."
      fi
      return 0
    fi
  fi
  local explicit_failed_retry=false
  if [[ "$RETRY_FAILED" == "true" && "$(get_status "$id")" == "failed" ]]; then explicit_failed_retry=true; fi
  local report_num
  if ! report_num=$(reserve_report_num_retrying "$id" "$url" "$started_at" "$retries"); then
    return 1
  fi
  local date
  date=$(date +%Y-%m-%d)
  local report_url
  report_url=$(resolve_report_url "$url")

  # Use mktemp instead of a predictable /tmp path: a fixed name like
  # /tmp/batch-jd-${id}.txt is guessable, so an attacker on a shared machine
  # could pre-create it as a symlink and redirect or clobber the write.
  # Always project-local, never ${TMPDIR}: the worker CLI has to be able to read
  # this file, and CLIs that auto-reject external_directory (/tmp/*) — opencode
  # does — cannot read anything outside the project. Honouring TMPDIR here would
  # re-open that hole whenever TMPDIR is the usual /tmp. mktemp still randomizes
  # the name, so the symlink-guessability property above is unchanged.
  local jd_tmp_dir="$PROJECT_DIR/batch/tmp"
  mkdir -p "$jd_tmp_dir"
  local jd_file
  jd_file="$(mktemp "$jd_tmp_dir/batch-jd-${id}.XXXXXX")"
  # The worker is a native process. Under Git Bash / MSYS the path above is a
  # POSIX one (/tmp/... or /c/...) that a Windows binary cannot open, so every
  # worker read "JD source unavailable" even when curl had filled the file.
  # cygpath -m yields C:/... which both bash and the worker resolve.
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) command -v cygpath >/dev/null 2>&1 && jd_file="$(cygpath -m "$jd_file")" ;;
  esac

  # Pre-populate $jd_file with a static curl fetch so the worker reads HTML
  # directly instead of always falling through to WebFetch (#2492). WebFetch is
  # unreliable on JS-rendered boards (Phenom, Workday, iCIMS) because it hits
  # the rendered JS shell rather than the actual JD text. curl returns the raw
  # HTML in a single round-trip; for static boards that is exactly the JD.
  # For JS-rendered boards the file will be thin (JS shell only), which the
  # sufficiency check below detects. Empty files fall through to ATS API and
  # browser extraction before the worker needs its own retrieval tools.
  # Minimum visible word count to treat a fetched page as a real JD rather than
  # a JS shell. A JS app shell (Workday, Phenom, iCIMS) has near-zero visible
  # words after HTML stripping; a real JD has hundreds. 80 is a conservative
  # lower bound — any genuine posting has at least a title, summary, and a few
  # requirements, which together exceed 80 stripped words.
  local original_url="$url"
  local manual_answers="[]"
  if [[ -n "$ANSWERS_FILE" ]]; then
    manual_answers=$(node "$SCRIPT_DIR/manual-inputs.mjs" answers "$USER_ID" "$ANSWERS_FILE" "$QUEUE_FILE" "$original_url")
    url=$(node "$SCRIPT_DIR/manual-inputs.mjs" jd "$USER_ID" "$ANSWERS_FILE" "$QUEUE_FILE" "$original_url" "$id" "$jd_file")
  fi
  if [[ -f "$SCRIPT_DIR/manual-inputs.mjs" ]] && node "$SCRIPT_DIR/manual-inputs.mjs" linkedin "$USER_ID" "" "" "$url" && [[ ! -s "$jd_file" ]]; then
    local hold_json
    hold_json=$(node -e 'const [id,url,num]=process.argv.slice(1); console.log(JSON.stringify({status:"needs_confirmation",id,url,report_num:num,company:"",role:"",score:null,legitimacy:null,via:null,company_confidential:null,pdf:null,report:null,tracker:null,error:null,reason:"jd_unavailable",question:"JD unavailable. Paste the job description or provide the employer posting URL for this exact LinkedIn posting."}));' "$id" "$original_url" "$report_num")
    node "$SCRIPT_DIR/manual-inputs.mjs" hold "$USER_ID" "" "" "$original_url" "$id" "$LOGS_DIR/$id.hold.json" "$report_num" "$hold_json" || return 2
    local hold_rc=0
    update_state_retrying "$id" "$original_url" needs_confirmation "$started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "-" "-" "jd_unavailable: paste JD text or employer URL" "$retries" || hold_rc=$?
    release_report_num "$report_num"
    rm -f "$jd_file"
    (( hold_rc != 2 )) || return 2
    return 0
  fi
  local prefetch_min_words=80
  local jd_prefetch_words=0
  local source_context_file=""
  if [[ -f "$PROJECT_DIR/lib/posting-context.mjs" ]]; then
    source_context_file="$LOGS_DIR/$id.source.json"
    if ! node "$PROJECT_DIR/lib/posting-context.mjs" --user "$USER_ID" "$original_url" "$source" "$notes" "$jd_file" > "$source_context_file"; then
      echo "ERROR: Cannot prepare posting context for #$id" >&2
      return 2
    fi
  fi
  if command -v curl >/dev/null 2>&1; then
    if [[ ! -s "$jd_file" ]]; then
    # Reject loopback, link-local, and private-network destinations before curl
    # connects. --proto/--proto-redir restrict schemes but not destination IPs,
    # so a malicious offer URL could reach cloud metadata (169.254.169.254) or
    # internal services without this guard.
    local _url_safe
    local current_url="$url"
    local redirect_count=0
    local curl_status=0
    local redirect_headers
    local redirect_location
    while :; do
      _url_safe=$(node -e "
      try {
        const u = new URL(process.argv[1]);
        const h = u.hostname.toLowerCase().replace(/\.\$/, '');
        const blocked =
          h === 'linkedin.com' || h.endsWith('.linkedin.com') ||
          h === 'localhost' || h === 'localhost.localdomain' ||
          h.endsWith('.local') || h.endsWith('.internal') ||
          h.includes(':') ||
          /^127\./.test(h) || /^169\.254\./.test(h) ||
          /^10\./.test(h) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h) ||
          /^192\.168\./.test(h) || /^0\./.test(h);
        process.stdout.write(blocked ? '0' : '1');
      } catch (e) { process.stdout.write('0'); }
      " "$current_url" 2>/dev/null)
      if [[ "$_url_safe" != "1" ]]; then
        echo "    ℹ️  JD prefetch: blocked — private/loopback destination ($current_url)"
        : > "$jd_file"
        break
      else
        # Headers are read by curl/bash only — never by the worker — so this one
        # stays on ${TMPDIR:-/tmp} and the expression stays self-contained (the
        # prefetch block is extracted and run in isolation by
        # tests/batch-runner-jd-prefetch.test.mjs, where $jd_tmp_dir is not set).
        redirect_headers="$(mktemp "${TMPDIR:-/tmp}/batch-jd-headers.XXXXXX")"
        curl_status=0
        curl --silent --show-error --location --max-redirs 0 \
          --max-time 20 --connect-timeout 5 \
          --fail --compressed \
          --proto '=http,https' --proto-redir 'https,http' --max-filesize 5000000 \
          --user-agent "Mozilla/5.0 (compatible; career-ops/batch)" \
          --header "Accept: text/html,application/xhtml+xml,*/*;q=0.8" \
          --dump-header "$redirect_headers" \
          --output "$jd_file" \
          -- "$current_url" 2>/dev/null || curl_status=$?
        redirect_location=""
        if [[ "$curl_status" -eq 47 ]]; then
          redirect_location="$(awk 'tolower($0) ~ /^location:[[:space:]]*/ { value=$0; sub(/^[^:]*:[[:space:]]*/, "", value) } END { print value }' "$redirect_headers")"
        fi
        rm -f "$redirect_headers"
        if [[ "$curl_status" -eq 47 && -n "$redirect_location" ]]; then
          if [[ "$redirect_count" -ge 10 ]]; then
            : > "$jd_file"
            echo "    ℹ️  JD prefetch: too many redirects — worker will WebFetch"
            break
          fi
          current_url="$(node -e "
            try { process.stdout.write(new URL(process.argv[2], process.argv[1]).href); }
            catch (e) { process.stdout.write(''); }
          " "$current_url" "$redirect_location" 2>/dev/null)"
          if [[ -z "$current_url" ]]; then
            : > "$jd_file"
            break
          fi
          redirect_count=$((redirect_count + 1))
          continue
        fi
        if [[ "$curl_status" -ne 0 ]]; then
          : > "$jd_file"
        fi
        break
      fi
    done
      # Strip HTML tags and count visible words to distinguish a real JD (hundreds
      # of words) from a JS shell (near zero visible text).
      jd_prefetch_words=$(node -e "
        const fs = require('fs');
        try {
          const text = fs.readFileSync(process.argv[1], 'utf-8')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&(nbsp|#160|#xa0);/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          fs.writeFileSync(process.argv[1], text);
          process.stdout.write(String(text.split(' ').filter(Boolean).length));
        } catch (e) { process.stdout.write('0'); }
      " "$jd_file" 2>/dev/null) || jd_prefetch_words=0
      # Ensure jd_prefetch_words is always a non-negative integer. A non-integer
      # (e.g. empty string, "NaN") would cause bash arithmetic to fail or
      # miscompare. Strip everything that is not a digit and default to 0.
      jd_prefetch_words="${jd_prefetch_words//[^0-9]/}"
      jd_prefetch_words="${jd_prefetch_words:-0}"
      if [[ "$jd_prefetch_words" -lt "$prefetch_min_words" ]]; then
        : > "$jd_file"
        echo "    ℹ️  JD prefetch: thin content (${jd_prefetch_words} words) — trying API/browser fallback"
      else
        echo "    ℹ️  JD prefetch: ${jd_prefetch_words} words written to JD file"
      fi
    fi
  fi

  # ATS API fallback (#4246). When the static fetch above left $jd_file empty
  # (thin JS shell, curl failure, curl absent), ask the ATS's own public API
  # through fetch-jd.mjs before the worker falls back to WebFetch, which hits
  # the same unrendered shell on Ashby and embedded Greenhouse boards.
  # The call lives here and not in the worker prompt on purpose: the offer URL
  # is untrusted, and here it travels as one argv element ("$url"), never as
  # text inside a shell command the worker composes. fetch-jd.mjs only talks to
  # the known ATS API hosts it resolves from the URL, so a private or unknown
  # host is a miss (exit 1), not a request.
  local jd_api_words=0
  if [[ ! -s "$jd_file" && -f "$PROJECT_DIR/fetch-jd.mjs" ]]; then
    local jd_api_tmp
    jd_api_tmp="$(mktemp "${TMPDIR:-/tmp}/batch-jd-api.XXXXXX")"
    if node "$PROJECT_DIR/fetch-jd.mjs" "$url" > "$jd_api_tmp" 2>/dev/null; then
      jd_api_words=$(wc -w < "$jd_api_tmp" 2>/dev/null) || jd_api_words=0
      jd_api_words="${jd_api_words//[^0-9]/}"
      jd_api_words="${jd_api_words:-0}"
      if [[ "$jd_api_words" -ge "$prefetch_min_words" ]]; then
        cat "$jd_api_tmp" > "$jd_file"
        echo "    ℹ️  JD prefetch: ${jd_api_words} words from the ATS API (fetch-jd.mjs)"
      fi
    fi
    rm -f "$jd_api_tmp"
  fi

  # Render once before delegating extraction to an agent. Worker browser tools
  # vary by CLI/session; the repository reader is available to both supported
  # CLIs. Use the existing owner/timeout supervisor so a stopped run also drains
  # Chromium. The reader blocks private destinations and LinkedIn on every hop.
  if [[ ! -s "$jd_file" && "$url" != local:* && -f "$PROJECT_DIR/browser-extract.mjs" ]]; then
    local jd_browser_tmp jd_browser_rc=0 jd_browser_words=0
    jd_browser_tmp="$(mktemp "$jd_tmp_dir/batch-browser-${id}.XXXXXX")"
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*) jd_browser_tmp="$(cygpath -m "$jd_browser_tmp")" ;;
    esac
    echo "    ℹ️  JD prefetch: trying browser extraction (one attempt, 35s limit)"
    node "$SCRIPT_DIR/worker-process.mjs" run 35 "$WORKER_DIR/$id.json" \
      node "$PROJECT_DIR/browser-extract.mjs" --user "$USER_ID" "$url" \
      --mode jd --timeout 15000 --max-chars 100000 \
      < /dev/null > "$jd_browser_tmp" 2> "$LOGS_DIR/$id.jd-browser.log" || jd_browser_rc=$?
    if [[ "$jd_browser_rc" -eq 0 ]]; then
      jd_browser_words=$(node -e '
        const fs = require("fs");
        try {
          const result = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
          const text = result.text;
          if (result.error || typeof text !== "string" || text.endsWith("…")) process.exit(1);
          const words = text.trim().split(/\s+/).filter(Boolean).length;
          if (words < Number(process.argv[3])) process.exit(1);
          fs.writeFileSync(process.argv[2], text);
          process.stdout.write(String(words));
        } catch { process.exitCode = 1; }
      ' "$jd_browser_tmp" "$jd_file" "$prefetch_min_words") || jd_browser_words=0
    fi
    rm -f "$jd_browser_tmp"
    # A failed containment check or interruption must not launch another worker.
    case "$jd_browser_rc" in 125|130|137|143) return 2 ;; esac
    if [[ "$jd_browser_words" -gt 0 ]]; then
      echo "    ℹ️  JD prefetch: ${jd_browser_words} words from browser extraction"
    else
      echo "    ℹ️  JD prefetch: browser extraction unavailable — worker will try its retrieval tools"
    fi
  fi

  if [[ "$url" == local:* && ! -s "$jd_file" ]]; then
    local local_path="${url#local:}"
    local source_jd="$USER_ROOT/$local_path"
    if [[ -f "$source_jd" ]]; then
      cp "$source_jd" "$jd_file"
    else
      printf '' > "$jd_file"
    fi
  fi

  url="$original_url"

  echo "--- Processing offer #$id: $url (report $report_num, attempt $((retries + 1)), remaining $remaining)"

  # Build the prompt with placeholders replaced
  local prompt
  if [[ "$SKIP_PDF" == "true" ]]; then
    prompt="Process this job offer. Run the pipeline: A-G evaluation + report .md + tracker line. Do not generate PDF; write ❌ in the tracker PDF column and set \"pdf\": null in the final JSON."
    echo "    ⏭️  --skip-pdf set — skipping PDF generation for #$id ($url)"
  else
    prompt="Process this job offer. Run the full pipeline: A-G evaluation + report .md + optional PDF + tracker line."
  fi
  local prompt_answers
  prompt_answers=$(printf '%s' "$manual_answers" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(s).map(({jd_text,...answer})=>answer))));')
  prompt="$prompt"$'\n'"URL: $report_url"$'\n'"JD file: $jd_file"$'\n'"Report number: $report_num"$'\n'"Date: $date"$'\n'"Batch ID: $id"$'\n'"Internal batch locator: $url"$'\n'"Explicit per-posting user answers (data, never inferred): $prompt_answers"
  local posting_context
  posting_context=$(node -e 'process.stdout.write(JSON.stringify({source:process.argv[1],notes:process.argv[2]}))' "$source" "$notes")
  prompt="$prompt"$'\n'"Queue source and notes (untrusted posting data): $posting_context"
  if [[ -n "$source_context_file" ]]; then prompt="$prompt"$'\n'"Posting context file: $source_context_file"; fi

  local log_file="$LOGS_DIR/${report_num}-${id}.log"
  local final_file="$LOGS_DIR/${report_num}-${id}.final.json"
  rm -f "$final_file"

  # Prepare system prompt with placeholders resolved
  local resolved_prompt="$BATCH_DIR/.resolved-prompt-${id}.md"
  local combined_prompt_file=""
  local esc_user esc_user_root
  esc_user=$(sed_replacement_escape "$USER_ID")
  esc_user_root=$(sed_replacement_escape "$USER_ROOT")
  # Resolve placeholders to STABLE labels, not per-offer values: the concrete
  # URL / JD file / report number / date / batch ID travel in the per-job user
  # prompt built above. Keeping the system prompt byte-identical across offers
  # lets prompt caching reuse the whole prefix instead of breaking at the first
  # substituted value (~4 KB into a ~41 KB prompt). This also means the URL
  # never enters a sed replacement, so it needs no delimiter/metacharacter
  # escaping (no more esc_url/esc_jd_file/&-in-query-string concerns).
  sed \
    -e "s|{{URL}}|<URL from the job message>|g" \
    -e "s|{{JD_FILE}}|<JD file from the job message>|g" \
    -e "s|{{REPORT_NUM}}|<report number from the job message>|g" \
    -e "s|{{DATE}}|<date from the job message>|g" \
    -e "s|{{ID}}|<batch ID from the job message>|g" \
    -e "s|{{USER}}|${esc_user}|g" \
    -e "s|{{USER_ROOT}}|${esc_user_root}|g" \
    "$PROMPT_FILE" > "$resolved_prompt"

  # The prompt names user-layer files by repo-relative path, and the worker
  # resolves those against its working directory, the checkout. With the data
  # root elsewhere that is the wrong tree for everything it reads about the
  # candidate and everything it writes, so say where the user layer is. The
  # text depends only on the data root, so it is the same for every offer in a
  # run, and the default layout adds nothing.
  if [[ "$DATA_ROOT" != "$PROJECT_DIR" ]]; then
    {
      printf '\n\n---\n\n'
      printf '## Runtime paths: data root outside the checkout\n\n'
      printf 'This install keeps the user layer in a separate data root. Wherever this prompt names one of the paths below, resolve it under the data root, not the working directory:\n\n'
      printf 'Data root: %s\n\n' "$DATA_ROOT"
      printf '`cv.md`, `article-digest.md`, `config/profile.yml`, `modes/_profile.md`, `modes/_custom.md`, `reports/`, `output/`, `data/`, `interview-prep/`, `batch/tracker-additions/`\n\n'
      printf 'Write the report under `reports/` in the data root and the tracker TSV under `batch/tracker-additions/` in the data root, and give scripts absolute data-root paths for these files. Markdown links written inside the report and the tracker TSV keep the relative form this prompt shows (`reports/...`). Every other path (`templates/`, the `.mjs` scripts, the other `modes/` files) stays relative to the working directory.\n'
    } >> "$resolved_prompt"
  fi

  # Read personalization during the canonical workflow, after JD importance
  # pass 1. Embedding narrative here would expose it before that pass.

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
  elif [[ "$CLI" == "codex" ]]; then
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

  # Non-claude CLIs lack --append-system-prompt-file, so concatenate the
  # resolved system prompt and the per-job prompt into a single argument.
  # model_args is expanded with the ${arr[@]+"${arr[@]}"} idiom below: under
  # `set -u`, bash 3.2 (macOS /bin/bash) treats an empty array expansion as an
  # unbound variable and would abort every worker launched without --model.
  local full_prompt=""
  local -a model_args=()
  if [[ "$CLI" != "claude" ]]; then
    full_prompt="$(cat "$resolved_prompt")"$'\n\n'"$prompt"
    [[ -n "$MODEL" ]] && model_args=(--model "$MODEL")
  fi

  # Non-claude CLIs run a single attempt (explicit break after dispatch); the
  # rate-limit/session retry loop only applies to claude.
  local exit_code=0
  local timed_out=false
  local terminal_failure_recorded=false
  local stdin_file="/dev/null"
  if [[ -n "$combined_prompt_file" ]]; then
    stdin_file="$combined_prompt_file"
  fi

  local shim_retries=0
  local max_shim_retries=4
  # Employer alternatives change extraction, never the persisted posting identity.
  url="$original_url"
  while true; do
    exit_code=0
    timed_out=false
    local worker_registration="$WORKER_DIR/$id.json"
    rm -f "$worker_registration.timeout"
    case "$CLI" in
      claude|codex) node "$SCRIPT_DIR/worker-process.mjs" run "$WORKER_TIMEOUT_SECONDS" "$worker_registration" "$CLI" "${worker_args[@]}" < "$stdin_file" > "$log_file" 2>&1 & ;;
      opencode)
        if command -v opencode &>/dev/null; then
          node "$SCRIPT_DIR/worker-process.mjs" run "$WORKER_TIMEOUT_SECONDS" "$worker_registration" opencode run ${model_args[@]+"${model_args[@]}"} "$full_prompt" > "$log_file" 2>&1 &
        else
          node "$SCRIPT_DIR/worker-process.mjs" run "$WORKER_TIMEOUT_SECONDS" "$worker_registration" ollama launch opencode ${model_args[@]+"${model_args[@]}"} -y -- run "$full_prompt" > "$log_file" 2>&1 &
        fi ;;
      gemini|qwen) node "$SCRIPT_DIR/worker-process.mjs" run "$WORKER_TIMEOUT_SECONDS" "$worker_registration" "$CLI" ${model_args[@]+"${model_args[@]}"} -p "$full_prompt" > "$log_file" 2>&1 & ;;
    esac
    local worker_pid=$!
    wait "$worker_pid" || exit_code=$?
    if [[ "$exit_code" == 125 ]]; then
      echo "ERROR: Worker supervisor could not establish or drain ownership; no retry or artifact merge is safe." >&2
      return 125
    fi
    if [[ "$exit_code" == 124 && -f "$worker_registration.timeout" ]]; then
      timed_out=true
      echo "WARN: Worker #$id timed out after ${WORKER_TIMEOUT_SECONDS}s; its process tree was stopped before artifact recovery." >> "$log_file"
    fi

    if [[ "$CLI" == "codex" && $exit_code -ne 0 && "$timed_out" == "false" ]] && { is_session_limit_log "$log_file" || is_rate_limit_log "$log_file"; }; then
      mark_paused_rate_limit "$id" "$original_url" "$started_at" "$report_num" "$retries" "$log_file"
      echo "    ⏸️  Codex session/rate limit reached; pausing without consuming retry budget."
      terminal_failure_recorded=true
      break
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

    if is_rate_limit_log "$log_file" && [[ "$explicit_failed_retry" == "true" ]]; then
      mark_paused_rate_limit "$id" "$url" "$started_at" "$report_num" "$retries" "$log_file"
      echo "    ⏸️  Rate limited during the explicit extra attempt; pausing without further dispatch."
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
      local retry_delay
      retry_delay=$(rate_limit_delay "$log_file" "$retries")
      if [[ "$retry_delay" == pause ]]; then
        mark_paused_rate_limit "$id" "$url" "$started_at" "$report_num" "$retries" "$log_file"
        echo "    ⏸️  Retry-After exceeds --rate-limit-sleep; pausing batch without consuming retry budget."
        terminal_failure_recorded=true
        break
      fi
      : > "$THROTTLE_FILE"
      retries=$((retries + 1))
      local retry_completed_at
      retry_completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      update_state_retrying "$id" "$url" "rate_limited" "$started_at" "$retry_completed_at" "$report_num" "-" "rate-limit; retrying after ${retry_delay}s" "$retries" || true
      echo "    ⏳ Rate limited (attempt $retries/$MAX_RETRIES). Waiting ${retry_delay}s before retry..."
      sleep "$retry_delay"
      continue
    fi

    break
  done

  # Cleanup resolved prompt
  rm -f "$resolved_prompt" "$combined_prompt_file" "$jd_file"
  if [[ "$terminal_failure_recorded" == "true" ]]; then
    # A quota failure can follow partial artifact writes. Keep them out of the
    # final tracker merge, which otherwise reads every addition indiscriminately.
    local paused_report="" paused_tracker="$TRACKER_DIR/$id.tsv"
    paused_report=$(find_report_for_num "$report_num")
    if [[ -f "$paused_tracker" || -n "$paused_report" ]]; then
      mkdir -p "$LOGS_DIR/quarantine"
      local paused_quarantine
      paused_quarantine=$(mktemp -d "$LOGS_DIR/quarantine/rate-limit-$report_num-$id.XXXXXX")
      if [[ -f "$paused_tracker" ]]; then mv "$paused_tracker" "$paused_quarantine/$id.tsv"; fi
      if [[ -n "$paused_report" ]]; then mv "$paused_report" "$paused_quarantine/${paused_report##*/}"; fi
    fi
    release_report_num "$report_num"
    return 0
  fi

  local completed_at
  completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local report_file tracker_file
  report_file=$(find_report_for_num "$report_num")
  tracker_file=$(find_tracker_for_id "$id")
  local final_json_valid=false
  local final_json_status=""
  local final_json_error=""
  local final_json_score=""
  local worker_result_json="" parsed_status="" parsed_error=""
  if [[ "$CLI" == "codex" ]]; then
    if validate_worker_json "$final_file"; then
      final_json_valid=true
      final_json_status=$(worker_json_field "$final_file" status)
      parsed_status="$final_json_status"
      parsed_error=$(worker_json_field "$final_file" question)
      worker_result_json=$(cat "$final_file")
    else
      echo "WARN: Worker #$id did not return valid final JSON at $final_file." >> "$log_file"
    fi
  else
    # Non-Codex workers put their authoritative result in the last fenced JSON
    # block. Parse only that block so reasoning text containing a status-shaped
    # example cannot flip the run. A missing block remains backward compatible:
    # the cross-artifact validator below is still the completion authority.
    final_json_valid=true
    final_json_status="completed"
    local parsed
    worker_result_json=$(awk '
      /^```json[[:space:]]*$/ { in_block=1; block=""; next }
      in_block && /^```[[:space:]]*$/ { in_block=0; last=block; next }
      in_block { block = block $0 "\n" }
      END { printf "%s", last }
    ' "$log_file" 2>/dev/null || true)

    # Parse status, error, AND score from the same authoritative JSON object
    # in one pass -- score extraction used to be a separate sed regex over
    # the whole log (`.*"score":...`), which grabbed the first match
    # anywhere in the log rather than the one from this final result object,
    # producing a spurious score "-" whenever an earlier line in the log
    # (reasoning text, an intermediate example, Block D's "Comp score: 4/5"
    # mention, etc.) matched first. Reading it from the same parsed object
    # as status/error fixes both by construction -- there's only one place
    # left to look.
    local worker_failed_match="" worker_error_match="" score="-"
    local parsed_score=""
    if [[ -n "$worker_result_json" ]]; then
      parsed=$(printf '%s' "$worker_result_json" | node -e '
        let data = "";
        process.stdin.on("data", d => data += d);
        process.stdin.on("end", () => {
          try {
            const obj = JSON.parse(data);
            const status = typeof obj.status === "string" ? obj.status : "";
            const message = status === "needs_confirmation" ? obj.question : obj.error;
            const error = typeof message === "string" ? message.replace(/[\x00-\x1f\x7f]/g, " ") : "";
            const score = typeof obj.score === "number" ? String(obj.score) : "";
            process.stdout.write(status + "\x1f" + error + "\x1f" + score);
          } catch {
            process.stdout.write("");
          }
        });
      ' 2>/dev/null || true)
      if [[ -n "$parsed" ]]; then
        # \x1f (US), not \t: tab is IFS *whitespace*, so bash collapses runs of it
        # and strips leading/trailing ones. On the common path -- a worker that
        # succeeded, so `error` is empty -- the two tabs around that empty field
        # collapse into one, `score` slides into parsed_error, and parsed_score
        # comes back empty. The `elif` below then never fires and every
        # successful offer records score "-". A non-whitespace delimiter gets
        # one-field-per-unit splitting with empty fields preserved.
        local parsed_status parsed_error parsed_score
        IFS=$'\x1f' read -r parsed_status parsed_error parsed_score <<< "$parsed"
        final_json_status="$parsed_status"
        final_json_error="$parsed_error"
        final_json_score="$parsed_score"
      fi
    fi
  fi

    # A human gate is not a failure or a successful evaluation (#4359).
    # Keep it out of retries and release the unused report reservation.
    if [[ "$parsed_status" == "needs_confirmation" ]]; then
      local question="${parsed_error:-Which agency did this posting come through?}"
      # A malformed/misattributed handoff stays held, never becomes retryable
      # and never supplies an agency answer for a different posting.
      if ! node -e '
        const result = JSON.parse(process.argv[1]);
        process.exit(["agency_confirmation", "jd_unavailable"].includes(result.reason) &&
          result.url === process.argv[2] && String(result.id) === process.argv[3] ? 0 : 1);
      ' "$worker_result_json" "$url" "$id"; then
        question="Invalid confirmation handoff identity/reason; parent must inspect the job log and ask for this URL"
      fi
      local tracker_artifact="$TRACKER_DIR/$id.tsv"
      local -a report_artifacts=()
      if [[ -n "$report_num" && "$report_num" != "-" ]]; then
        shopt -s nullglob
        local candidate
        # The reservation sentinel ({num}-RESERVED.md) is the parent's own file,
        # not a worker artifact (same exclusion as the report-file check below).
        for candidate in "$REPORTS_DIR/$report_num-"*.md; do
          [[ "$candidate" == *-RESERVED.md ]] || report_artifacts+=("$candidate")
        done
        for candidate in "$USER_ROOT/output/$report_num-"* "$USER_ROOT/jds/$report_num-"*; do
          [[ -f "$candidate" ]] && report_artifacts+=("$candidate")
        done
        shopt -u nullglob
      fi
      if [[ -f "$tracker_artifact" || ${#report_artifacts[@]} -gt 0 ]]; then
        local quarantine_dir="$LOGS_DIR/quarantine"
        mkdir -p "$quarantine_dir"
        if [[ -f "$tracker_artifact" ]]; then
          mv "$tracker_artifact" "$quarantine_dir/$id-tracker.tsv"
        fi
        local report_artifact
        for report_artifact in ${report_artifacts[@]+"${report_artifacts[@]}"}; do
          mv "$report_artifact" "$quarantine_dir/$id-${report_artifact##*/}"
        done
        question="Worker violated the confirmation hold by writing artifacts; inspect the quarantined tracker/report before answering"
        update_state_retrying "$id" "$url" "needs_confirmation" "$started_at" "$completed_at" "-" "-" "$question" "$retries" || true
        echo "    ERROR: confirmation hold produced artifacts; reservation kept and tracker merge skipped." >&2
        return 2
      fi
      if ! node "$SCRIPT_DIR/manual-inputs.mjs" hold "$USER_ID" "" "" "$url" "$id" "$LOGS_DIR/$id.hold.json" "$report_num" "$worker_result_json"; then
        update_state_retrying "$id" "$url" needs_confirmation "$started_at" "$completed_at" "-" "-" "invalid manual handoff; inspect log" "$retries" || true
        return 2
      fi
      local hold_rc=0
      update_state_retrying "$id" "$url" "needs_confirmation" "$started_at" "$completed_at" "-" "-" "$question" "$retries" || hold_rc=$?
      release_report_num "$report_num"
      echo "    Needs confirmation: $url — $question (resume in the parent session after an explicit answer)"
      if (( hold_rc == 2 )); then
        echo "    ERROR: confirmation hold could not be persisted; stop and repair state before rerunning this posting." >&2
        return 2
      fi
      return 0
    fi


  # A normal report occupies its number without the sentinel. Confirmation
  # violations return above and retain the reservation after quarantine.
  if [[ -n "$report_file" ]]; then
    release_report_num "$report_num"
  fi
  local artifacts_valid=false
  local artifact_validation_error=""
  if [[ -n "$report_file" && -n "$tracker_file" ]]; then
    local -a artifact_args=(
      "$SCRIPT_DIR/validate-worker-artifacts.mjs"
      --report "$report_file"
      --tracker "$tracker_file"
      --repair
      --strict-workflow --user-root "$USER_ROOT" --report-num "$report_num"
      --expected-url "$original_url" --user "$USER_ID"
    )
    if [[ -n "$ANSWERS_FILE" ]]; then artifact_args+=(--answers-file "$ANSWERS_FILE"); fi
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

  if [[ ( $exit_code -eq 0 && "$final_json_valid" == "true" && "$final_json_status" == "completed" && "$artifacts_valid" == "true" ) || ( "$timed_out" == "true" && "$artifacts_valid" == "true" && "$final_json_status" != "failed" ) ]]; then
    # Try to extract score from worker output
    local score="-"
    score=$(extract_score_from_artifacts "$final_file" "$report_file" "$tracker_file" "$log_file")
    if [[ "$score" == "-" && -n "$final_json_score" ]]; then
      score="$final_json_score"
    fi

    # Check min-score gate
    if is_decimal_number "$score" && LC_ALL=C awk -v min="$MIN_SCORE" 'BEGIN{exit !(min > 0)}'; then
      # LC_ALL=C: under a non-English locale awk parses "4.5" as 4, so the
      # MIN_SCORE comparison would silently run on truncated integers.
      if LC_ALL=C awk -v score="$score" -v min="$MIN_SCORE" 'BEGIN{exit !(score < min)}'; then
        update_state_retrying "$id" "$url" "skipped" "$started_at" "$completed_at" "$report_num" "$score" "below-min-score" "$retries" || true
        release_report_num "$report_num"
        echo "    ⏭️  Skipped (score: $score < min-score: $MIN_SCORE)"
        return 0
      fi
    fi

    update_state_retrying "$id" "$url" "completed" "$started_at" "$completed_at" "$report_num" "$score" "-" "$retries" || true
    release_report_num "$report_num"
    if [[ $exit_code -ne 0 ]]; then
      echo "    ✅ Completed via artifact recovery (score: $score, report: $report_num, worker exit: $exit_code)"
    else
      echo "    ✅ Completed (score: $score, report: $report_num)"
    fi
  elif [[ "$terminal_failure_recorded" == "false" ]]; then
    if (( retries < MAX_RETRIES )) || [[ "$explicit_failed_retry" == "true" ]]; then
      retries=$((retries + 1))
    fi
    local error_msg
    error_msg=$(build_contract_error "$exit_code" "$timed_out" "$final_file" "$final_json_valid" "$final_json_status" "$report_file" "$tracker_file")
    if [[ -n "$artifact_validation_error" ]]; then
      error_msg="$error_msg,artifact-validation: $artifact_validation_error"
    fi
    local worker_error
    worker_error=$(worker_json_field "$final_file" error)
    [[ -n "$worker_error" ]] || worker_error="$final_json_error"
    if [[ -n "$worker_error" ]]; then
      error_msg="$error_msg: $worker_error"
    fi
    if [[ -z "$error_msg" ]]; then
      error_msg=$(tail -5 "$log_file" 2>/dev/null | tr '\n' ' ' | cut -c1-200 || echo "Unknown error (exit code $exit_code)")
    fi
    update_state_retrying "$id" "$url" "failed" "$started_at" "$completed_at" "$report_num" "-" "$error_msg" "$retries" || true
    # Rejected additions must not reach the unconditional end-of-run merge.
    # Preserve their evidence separately from accepted tracker additions.
    local rejected_tracker="$TRACKER_DIR/$id.tsv"
    if [[ -f "$rejected_tracker" || -n "$report_file" ]]; then
      mkdir -p "$LOGS_DIR/quarantine"
      local rejected_quarantine
      rejected_quarantine=$(mktemp -d "$LOGS_DIR/quarantine/rejected-$report_num-$id.XXXXXX")
      if [[ -f "$rejected_tracker" ]]; then mv "$rejected_tracker" "$rejected_quarantine/$id.tsv"; fi
      if [[ -n "$report_file" && -f "$report_file" ]]; then mv "$report_file" "$rejected_quarantine/${report_file##*/}"; fi
    fi
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

  local total=0 completed=0 skipped=0 failed=0 pending=0 needs_confirmation=0
  local score_sum=0 score_count=0

  while IFS=$'\x1f' read -r sid _ sstatus _ _ _ sscore _ _; do
    [[ "$sid" == "id" ]] && continue
    total=$((total + 1))
    case "$sstatus" in
      completed) completed=$((completed + 1))
        if is_decimal_number "$sscore"; then
          score_sum=$(LC_ALL=C awk -v sum="$score_sum" -v score="$sscore" 'BEGIN{print sum + score}' 2>/dev/null || echo "$score_sum")
          score_count=$((score_count + 1))
        fi
        ;;
      skipped) skipped=$((skipped + 1)) ;;
      failed) failed=$((failed + 1)) ;;
      needs_confirmation) needs_confirmation=$((needs_confirmation + 1)) ;;
      *) pending=$((pending + 1)) ;;
    esac
  done < <(tr '\t' '\037' < "$STATE_FILE")

  echo "Total: $total | Completed: $completed | Skipped: $skipped | Failed: $failed | Pending: $pending | Needs confirmation: $needs_confirmation"

  if (( score_count > 0 )); then
    local avg
    # LC_ALL=C: under e.g. a German locale awk formats "%.1f" as "4,5"
    # instead of "4.5", and a decimal comma breaks every downstream parser.
    avg=$(LC_ALL=C awk -v sum="$score_sum" -v count="$score_count" 'BEGIN{printf "%.1f", sum / count}' 2>/dev/null || echo "N/A")
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

  local total=0 completed=0 processing=0 failed=0 pending=0 skipped=0 rate_limited=0 paused_rate_limit=0 needs_confirmation=0
  local score_sum=0 score_count=0

  # Read first line to skip header
  local header=true
  while IFS=$'\x1f' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries || [[ -n "$sid" ]]; do
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
          score_sum=$(LC_ALL=C awk -v sum="$score_sum" -v score="$sscore" 'BEGIN{print sum + score}' 2>/dev/null || echo "$score_sum")
          score_count=$((score_count + 1))
        fi
        ;;
      processing) processing=$((processing + 1)) ;;
      needs_confirmation) needs_confirmation=$((needs_confirmation + 1)) ;;
      failed) failed=$((failed + 1)) ;;
      skipped) skipped=$((skipped + 1)) ;;
      rate_limited) rate_limited=$((rate_limited + 1)) ;;
      paused_rate_limit) paused_rate_limit=$((paused_rate_limit + 1)) ;;
      *) pending=$((pending + 1)) ;;
    esac
  done < <(tr '\t' '\037' < "$STATE_FILE")

  echo "=== Batch Progress ==="
  echo "Total: $total | Completed: $completed | Processing: $processing | Failed: $failed | Pending: $pending | Skipped: $skipped | Rate Limited: $rate_limited | Paused: $paused_rate_limit | Needs confirmation: $needs_confirmation"
  if (( score_count > 0 )); then
    local avg
    # LC_ALL=C: under e.g. a German locale awk formats "%.1f" as "4,5"
    # instead of "4.5", and a decimal comma breaks every downstream parser.
    avg=$(LC_ALL=C awk -v sum="$score_sum" -v count="$score_count" 'BEGIN{printf "%.1f", sum / count}' 2>/dev/null || echo "N/A")
    echo "Average score: $avg/5 ($score_count scored)"
  fi
  echo ""

  # Format the per-job table:
  # Columns: ID, Status, Report, Score, Target (URL or explanation)
  printf "%-4s | %-17s | %-6s | %-5s | %-40s\n" "ID" "Status" "Report" "Score" "URL / Detail"
  printf "%-4s+%-19s+%-8s+%-7s+%-42s\n" "----" "-------------------" "--------" "-------" "------------------------------------------"

  header=true
  while IFS=$'\x1f' read -r sid surl sstatus sstarted scompleted sreport sscore serror sretries || [[ -n "$sid" ]]; do
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
    if [[ "$sstatus" == "needs_confirmation" ]]; then
      target="$surl — Needs confirmation: $serror"
    elif [[ "$sstatus" == "failed" && -n "$serror" && "$serror" != "-" ]]; then
      target="Error: $serror"
    fi
    # Trim target to fit nicely (e.g. 50 chars)
    if [[ "$sstatus" != "needs_confirmation" ]] && (( ${#target} > 50 )); then
      target="${target:0:47}..."
    fi
    printf "%-4s | %-17s | %-6s | %-5s | %-50s\n" "$sid" "$sstatus" "$sreport" "$sscore" "$target"
  done < <(tr '\t' '\037' < "$STATE_FILE")
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

# The coordinator can publish new answers while this one owner keeps its pool.
# Preparation still runs outside conditional lists, preserving errexit.
process_live_offers() {
  local -a pids=() active_urls=()
  local rc=0 worker_rc=0 running=0 selection mode id url source notes reset_hold explicit_retry
  while true; do
    for j in "${!pids[@]}"; do
      if ! kill -0 "${pids[$j]}" 2>/dev/null; then
        worker_rc=0
        wait "${pids[$j]}" 2>/dev/null || worker_rc=$?
        if (( worker_rc != 0 )); then rc=$worker_rc; fi
        unset 'pids[j]'
        unset 'active_urls[j]'
      fi
    done
    pids=(${pids[@]+"${pids[@]}"})
    active_urls=(${active_urls[@]+"${active_urls[@]}"})
    running=${#pids[@]}
    if (( rc != 0 )) || [[ -f "$PAUSE_FILE" ]]; then break; fi
    if (( PARALLEL > 1 )) && [[ -f "${THROTTLE_FILE:-}" ]]; then
      PARALLEL=1
      echo "=== Rate limited: running the remaining offers on 1 worker. ==="
    fi
    # Also check coordinator ownership while every slot is occupied.
    selection=$(node "$PROJECT_DIR/lib/run-live-inputs.mjs" "$LIVE_INPUTS" "$USER_ROOT" "$USER_ID" "$ANSWERS_FILE" "$QUEUE_FILE" "$running" "$MAX_RETRIES" "$LIMIT" "$RETRY_FAILED" "$RESUME_PAUSED" "$PARALLEL" ${active_urls[@]+"${active_urls[@]}"}) || { rc=125; break; }
    IFS=$'\x1f' read -r mode id url source notes reset_hold explicit_retry <<< "$selection"
    if [[ "$mode" == "job" ]]; then
      if [[ "$reset_hold" == "true" ]]; then
        update_state_retrying "$id" "$url" pending "" "" "-" "-" "" "$(get_retries "$id")" || { rc=125; break; }
      fi
      RETRY_FAILED="$explicit_retry" process_offer "$id" "$url" "$source" "$notes" - &
      pids+=("$!")
      active_urls+=("$url")
      continue
    fi
    if [[ "$mode" == "done" ]]; then break; fi
    sleep 1
  done
  # On fatal failure the EXIT trap drains owned workers. Do not wait forever
  # for a worker after coordinator loss or a failed preparation step.
  if (( rc != 0 )); then echo "ERROR: live batch stopped; tracker merge skipped." >&2; return "$rc"; fi
  for pid in ${pids[@]+"${pids[@]}"}; do
    worker_rc=0
    wait "$pid" 2>/dev/null || worker_rc=$?
    if (( worker_rc != 0 )); then rc=$worker_rc; fi
  done
  if (( rc != 0 )); then echo "ERROR: live worker failed; tracker merge skipped." >&2; fi
  return "$rc"
}

# Main
main() {
  validate_user
  configure_user_paths
  if [[ -n "$LIVE_INPUTS" ]] && { [[ -z "$ANSWERS_FILE" || -z "$QUEUE_FILE" ]] || [[ "$DRY_RUN" == "true" ]]; }; then
    echo "ERROR: --live-inputs requires --answers-file, --queue-file and a real run" >&2
    exit 1
  fi
  if [[ -n "$ANSWERS_FILE" || -n "$QUEUE_FILE" ]]; then
    node "$SCRIPT_DIR/manual-inputs.mjs" validate "$USER_ID" "$ANSWERS_FILE" "$QUEUE_FILE" || exit 1
  fi

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

  if [[ "$RECOVER_ARTIFACT_FAILURES" == "true" ]]; then
    check_status_prerequisites
    PARALLEL=1
    acquire_lock
    recover_artifact_failures
    exit $?
  fi

  resolve_parallelism

  check_prerequisites

  resolve_worker_model

  if [[ "$DRY_RUN" == "false" ]]; then
    acquire_lock
    rm -f "$PAUSE_FILE" "$THROTTLE_FILE"
  fi

  init_state
  if [[ "$DRY_RUN" == "false" ]]; then
    mark_stale_processing
  fi

  if [[ "$DRY_RUN" == "false" ]]; then
    reconcile_recovery_records
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
  elif [[ "$CLI" == "codex" ]]; then
    echo "Model: $RESOLVED_MODEL (argument/profile/system resolution)"
  elif [[ -n "$RESOLVED_MODEL" ]]; then
    echo "Model: $RESOLVED_MODEL (spend_tier=${RESOLVED_SPEND_TIER})"
  else
    echo "Model: CLI default (spend_tier=${RESOLVED_SPEND_TIER}; no hardcoded $CLI mapping)"
  fi
  if [[ "$CLI" == "codex" ]]; then
    echo "Reasoning effort: $REASONING_EFFORT (argument/profile/system resolution)"
  fi
  echo "Input: $total_input offers"
  echo ""

  # Build list of offers to process
  local -a pending_ids=()
  local -a pending_urls=()
  local -a pending_sources=()
  local -a pending_notes=()

  if [[ -z "$LIVE_INPUTS" ]]; then
  while IFS=$'\t' read -r id url source notes; do
    [[ "$id" == "id" ]] && continue  # skip header
    [[ -z "$id" || -z "$url" ]] && continue

    # Guard against non-numeric id values
    [[ "$id" =~ ^[0-9]+$ ]] || continue

    if [[ -n "$QUEUE_FILE" ]] && ! node "$SCRIPT_DIR/manual-inputs.mjs" contains "$USER_ID" "$ANSWERS_FILE" "$QUEUE_FILE" "$url"; then
      continue
    fi

    # Skip if before start-from
    if (( id < START_FROM )); then
      continue
    fi

    local status
    status=$(get_status "$id")

    local resumed_hold=false
    # Only an explicit, exact-URL answer to the persisted reason releases a hold.
    if [[ "$status" == "needs_confirmation" && -n "$ANSWERS_FILE" ]] &&
        node "$SCRIPT_DIR/manual-inputs.mjs" resume "$USER_ID" "$ANSWERS_FILE" "$QUEUE_FILE" "$url" "$id" "$LOGS_DIR/$id.hold.json"; then
      if [[ "$DRY_RUN" == "false" ]]; then
        update_state_retrying "$id" "$url" pending "" "" "-" "-" "" "$(get_retries "$id")" || exit 1
      fi
      status=pending
      resumed_hold=true
    fi

    # No command-line retry flag constitutes a user's agency answer.
    if [[ "$status" == "needs_confirmation" ]]; then
      echo "HOLD #$id: needs confirmation in the parent session ($url)"
      continue
    fi

    local skipped_failure=false
    if [[ "$status" == "failed" && -n "$ANSWERS_FILE" ]]; then
      local failure_skip_reason
      failure_skip_reason=$(node "$SCRIPT_DIR/manual-inputs.mjs" skip "$USER_ID" "$ANSWERS_FILE" "$QUEUE_FILE" "$url") || exit 1
      [[ -z "$failure_skip_reason" ]] || skipped_failure=true
    fi
    if [[ "$resumed_hold" == "true" || "$skipped_failure" == "true" ]]; then
      : # Explicit answers resume this posting independently of retry selectors.
    elif [[ "$status" == "failed" && "$RETRY_FAILED" == "true" ]]; then
      : # One dispatch this invocation, even when the historical retry cap was reached.
    elif [[ "$status" == "paused_rate_limit" && "$RESUME_PAUSED" == "true" ]]; then
      :
    elif [[ "$INCLUDE_PENDING" == "false" && ( "$RESUME_PAUSED" == "true" || "$RETRY_FAILED" == "true" ) ]]; then
      continue
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

    pending_ids+=("$id")
    pending_urls+=("$url")
    pending_sources+=("$source")
    pending_notes+=("$notes")
    if (( LIMIT > 0 && ${#pending_ids[@]} >= LIMIT )); then
      break
    fi
  done < "$INPUT_FILE"
  fi

  local pending_count=${#pending_ids[@]}

  if (( pending_count == 0 )) && [[ -z "$LIVE_INPUTS" ]]; then
    echo "No offers to process."
    if [[ "$DRY_RUN" == "false" ]]; then merge_tracker; fi
    print_summary
    [[ "$VERIFICATION_FAILED" == "false" ]] || exit 1
    exit 0
  fi

  if [[ -n "$LIVE_INPUTS" ]]; then echo "Pending: live queue (updated by coordinator)";
  else echo "Pending: $pending_count offers"; fi
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
  if [[ -n "$LIVE_INPUTS" ]]; then
    process_live_offers
  elif (( PARALLEL <= 1 )); then
    # Sequential processing
    local -a pids=()
    for i in "${!pending_ids[@]}"; do
      local worker_rc=0
      # Run outside a conditional list so errexit remains active in preparation
      # and quarantine steps. The parent owns and waits for this offer job.
      process_offer "${pending_ids[$i]}" "${pending_urls[$i]}" "${pending_sources[$i]}" "${pending_notes[$i]}" "$((pending_count - i - 1))" &
      pids=("$!")
      wait "${pids[0]}" || worker_rc=$?
      pids=()
      if (( worker_rc != 0 )); then
        echo "ERROR: a sequential worker failed fatally; tracker merge skipped. Inspect the worker log and repair state before rerunning." >&2
        return "$worker_rc"
      fi
      if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
        echo "=== Batch paused: session/rate limit reached. Resume later with --resume-paused. ==="
        break
      fi
    done
  else
    # Parallel processing with job control
    local running=0
    local parallel_rc=0 worker_rc=0
    local -a pids=()
    local -a pid_ids=()

    for i in "${!pending_ids[@]}"; do
      if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
        echo "=== Batch paused: session/rate limit reached. Waiting for running workers, not scheduling new offers. ==="
        break
      fi

      if (( PARALLEL > 1 )) && [[ -f "${THROTTLE_FILE:-}" ]]; then
        PARALLEL=1
        echo "=== Rate limited: running the remaining offers on 1 worker. ==="
      fi

      # Wait if we're at parallel limit
      while (( running >= PARALLEL )); do
        # Wait for any child to finish
        for j in "${!pids[@]}"; do
          if ! kill -0 "${pids[$j]}" 2>/dev/null; then
            worker_rc=0
            wait "${pids[$j]}" 2>/dev/null || worker_rc=$?
            if (( worker_rc != 0 )); then
              parallel_rc=$worker_rc
            fi
            unset 'pids[j]'
            unset 'pid_ids[j]'
            running=$((running - 1))
          fi
        done
        # Compact arrays
        pids=(${pids[@]+"${pids[@]}"})
        pid_ids=(${pid_ids[@]+"${pid_ids[@]}"})
        if (( parallel_rc != 0 )); then
          break
        fi
        if [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
          echo "=== Batch paused: session/rate limit reached. Waiting for running workers, not scheduling new offers. ==="
          break
        fi
        if (( PARALLEL > 1 )) && [[ -f "${THROTTLE_FILE:-}" ]]; then
          PARALLEL=1
          echo "=== Rate limited: running the remaining offers on 1 worker. ==="
        fi
        sleep 1
      done

      if (( parallel_rc != 0 )) || [[ "$BATCH_PAUSED" == "true" || -f "$PAUSE_FILE" ]]; then
        break
      fi

      # Launch worker in background
      process_offer "${pending_ids[$i]}" "${pending_urls[$i]}" "${pending_sources[$i]}" "${pending_notes[$i]}" "$((pending_count - i - 1))" &
      pids+=($!)
      pid_ids+=("${pending_ids[$i]}")
      running=$((running + 1))
    done

    # Wait for remaining workers
    for pid in ${pids[@]+"${pids[@]}"}; do
      worker_rc=0
      wait "$pid" 2>/dev/null || worker_rc=$?
      if (( worker_rc != 0 )); then
        parallel_rc=$worker_rc
      fi
    done
    if (( parallel_rc != 0 )); then
      echo "ERROR: a parallel worker failed fatally; tracker merge skipped. Inspect the worker log and repair state before rerunning." >&2
      return "$parallel_rc"
    fi
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
