#!/bin/bash
# SignalDesk 일일 배치 래퍼 (launchd/cron에서 호출)
set -euo pipefail

DIR="/Users/wonmanjung/Project/Stock_prediction/batch"
LOG_DIR="$DIR/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/batch-$(date +%Y%m%d).log"

echo "===== $(date '+%Y-%m-%d %H:%M:%S') 배치 시작 =====" >> "$LOG"
"$DIR/.venv/bin/python" "$DIR/run.py" >> "$LOG" 2>&1
CODE=$?
echo "===== $(date '+%Y-%m-%d %H:%M:%S') 종료 (exit=$CODE) =====" >> "$LOG"

# 30일 이상 지난 로그 정리
find "$LOG_DIR" -name 'batch-*.log' -mtime +30 -delete 2>/dev/null || true
exit $CODE
