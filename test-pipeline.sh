#!/usr/bin/env bash
# APEX V2 — AMT Testing Pipeline
# Phase 1: Backtest | Phase 2: Paper Trading | Phase 3: Live

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$PROJECT_DIR/logs"
RESULTS_DIR="$PROJECT_DIR/test-results"

mkdir -p "$LOGS_DIR" "$RESULTS_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log_info()    { echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"; }
log_success() { echo -e "${GREEN}[$(date +'%H:%M:%S')] ✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}[$(date +'%H:%M:%S')] ⚠${NC} $1"; }
log_error()   { echo -e "${RED}[$(date +'%H:%M:%S')] ✗${NC} $1"; }

# ── Defaults (override via env) ──────────────────────────────────────────────
BACKTEST_START_DATE="${BACKTEST_START_DATE:-2024-01-01}"
BACKTEST_END_DATE="${BACKTEST_END_DATE:-2024-12-31}"
MIN_SIGNAL_SCORE="${MIN_SIGNAL_SCORE:-60}"
ACCOUNT_SIZE="${ACCOUNT_SIZE:-10000}"
PAPER_DAYS="${PAPER_DAYS:-14}"

# ── tsx runner (matches project convention: node --import tsx) ───────────────
run_ts() {
  local file="$1"; shift
  BACKTEST_START_DATE="$BACKTEST_START_DATE" \
  BACKTEST_END_DATE="$BACKTEST_END_DATE" \
  MIN_SIGNAL_SCORE="$MIN_SIGNAL_SCORE" \
  ACCOUNT_SIZE="$ACCOUNT_SIZE" \
  PAPER_DAYS="$PAPER_DAYS" \
  RESULTS_DIR="$RESULTS_DIR" \
  TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}" \
  TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}" \
  node --import tsx "$file" "$@"
}

# ────────────────────────────────────────────────────────────────────────────
# PHASE 1: BACKTEST
# ────────────────────────────────────────────────────────────────────────────

backtest() {
  log_info "═════════════════════════════════════════"
  log_info "PHASE 1: BACKTEST"
  log_info "  Period:  $BACKTEST_START_DATE → $BACKTEST_END_DATE"
  log_info "  MinScore: $MIN_SIGNAL_SCORE  |  Account: \$$ACCOUNT_SIZE"
  log_info "═════════════════════════════════════════"

  local LOG="$LOGS_DIR/backtest-$(date +%Y%m%d-%H%M%S).log"
  log_info "Log: $LOG"

  if run_ts "$PROJECT_DIR/src/indices/backtest/run-backtest.ts" 2>&1 | tee "$LOG"; then
    log_success "Backtest PASSED — ready for paper trading."
    log_info "Report: $RESULTS_DIR/backtest-report.json"
  else
    log_error "Backtest FAILED. Review report and tune scoring thresholds."
    log_info "See: src/indices/engine/amt/setupDetector.ts"
    exit 1
  fi
}

# ────────────────────────────────────────────────────────────────────────────
# PHASE 2: PAPER TRADING (14 days)
# ────────────────────────────────────────────────────────────────────────────

paper_trade() {
  log_info "═════════════════════════════════════════"
  log_info "PHASE 2: PAPER TRADING ($PAPER_DAYS days)"
  log_info "  Scan interval: every 4 hours"
  log_info "  Mode: no real money"
  log_info "═════════════════════════════════════════"

  local LOG="$LOGS_DIR/paper-trading-$(date +%Y%m%d-%H%M%S).log"
  log_info "Log: $LOG"

  run_ts "$PROJECT_DIR/src/indices/backtest/run-paper.ts" 2>&1 | tee "$LOG" &
  local PID=$!
  log_success "Paper trading started (PID: $PID)"
  log_info "Tail logs: tail -f $LOG"
  log_info "Stop early: kill $PID"
}

# ────────────────────────────────────────────────────────────────────────────
# PHASE 3: LIVE (Next.js server with AMT cycle)
# ────────────────────────────────────────────────────────────────────────────

go_live() {
  log_info "═════════════════════════════════════════"
  log_info "PHASE 3: LIVE TRADING"
  log_info "═════════════════════════════════════════"

  log_warning "LIVE MODE — real money at risk."
  log_warning "Ensure:"
  log_warning "  ✓ Backtest passed (WR > 50%, Sharpe > 1.0)"
  log_warning "  ✓ Paper trading passed (14 days)"
  log_warning "  ✓ Telegram alerts configured"
  log_warning "  ✓ Risk per trade: 0.5–1%"
  echo ""
  log_info "10 seconds to cancel (Ctrl+C)..."
  sleep 10

  local LOG="$LOGS_DIR/live-trading-$(date +%Y%m%d-%H%M%S).log"

  log_info "Starting Next.js server + AMT cycle..."
  log_info "Dashboard: http://localhost:3000/indices-v2"
  log_info "AMT API:   POST http://localhost:3000/api/indices/amt/cycle"
  log_info "Log: $LOG"

  npm run dev 2>&1 | tee "$LOG" &
  local PID=$!
  log_success "Server started (PID: $PID)"
  log_info "Trigger first scan: curl -X POST http://localhost:3000/api/indices/amt/cycle"
}

# ────────────────────────────────────────────────────────────────────────────
# VIEW REPORT
# ────────────────────────────────────────────────────────────────────────────

view_report() {
  local REPORT="$RESULTS_DIR/backtest-report.json"
  if [ ! -f "$REPORT" ]; then
    log_warning "No backtest report found. Run backtest first (option 1)."
    return
  fi

  log_info "Backtest Report ($REPORT):"
  if command -v jq &>/dev/null; then
    jq '{
      period: .config.startDate + " → " .config.endDate,
      totalSignals,
      totalTrades,
      winRate: (.winRate * 100 | round | tostring) + "%",
      avgRR,
      sharpeRatio,
      maxDrawdownPct: (.maxDrawdown * 100 | round | tostring) + "%",
      totalPnL,
      passed: .passedCriteria
    }' "$REPORT"
  else
    cat "$REPORT" | grep -E '"totalSignals|totalTrades|winRate|avgRR|sharpeRatio|totalPnL|passedCriteria"'
  fi
}

# ────────────────────────────────────────────────────────────────────────────
# MENU
# ────────────────────────────────────────────────────────────────────────────

menu() {
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║   APEX V2 — AMT TESTING PIPELINE            ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
  echo "  1) Run Backtest (${BACKTEST_START_DATE} → ${BACKTEST_END_DATE})"
  echo "  2) Start Paper Trading (${PAPER_DAYS} days)"
  echo "  3) Go Live"
  echo "  4) View Backtest Report"
  echo "  5) Tail latest log"
  echo "  6) Exit"
  echo ""
  printf "Select (1–6): "
  read -r choice

  case "$choice" in
    1) backtest; menu ;;
    2) paper_trade; menu ;;
    3) go_live ;;
    4) view_report; menu ;;
    5)
      local LATEST
      LATEST=$(ls -t "$LOGS_DIR"/*.log 2>/dev/null | head -1)
      if [ -n "$LATEST" ]; then
        log_info "Tailing: $LATEST"
        tail -f "$LATEST"
      else
        log_warning "No logs found in $LOGS_DIR"
        menu
      fi
      ;;
    6) log_info "Exiting."; exit 0 ;;
    *) log_error "Invalid option."; menu ;;
  esac
}

# ────────────────────────────────────────────────────────────────────────────
# ENTRYPOINT — support both interactive and direct flags
# ────────────────────────────────────────────────────────────────────────────

if [ $# -gt 0 ]; then
  case "$1" in
    backtest)     backtest ;;
    paper)        paper_trade ;;
    live)         go_live ;;
    report)       view_report ;;
    *) echo "Usage: $0 [backtest|paper|live|report]"; exit 1 ;;
  esac
else
  # Interactive mode
  if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    log_warning "TELEGRAM_BOT_TOKEN not set — Telegram alerts disabled."
  fi
  menu
fi
