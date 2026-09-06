#!/bin/bash
# SignalDesk 일일 배치 래퍼 (launchd/cron에서 호출)
#   run_daily.sh --kr     평일 18:30 국내 증분 수집
#   run_daily.sh --us     평일 07:00 해외 증분 수집
#   run_daily.sh --full   토요일 09:00 전량 재적재
set -uo pipefail

DIR="/Users/wonmanjung/Project/Stock_prediction/batch"
LOG_DIR="$DIR/logs"
mkdir -p "$LOG_DIR"

if [[ " $* " == *" --full "* ]]; then
  MODE="full"
elif [[ " $* " == *" --kr "* ]]; then
  MODE="incr-kr"
elif [[ " $* " == *" --us "* ]]; then
  MODE="incr-us"
else
  MODE="incr"
fi
LOG="$LOG_DIR/batch-$MODE-$(date +%Y%m%d).log"

echo "===== $(date '+%Y-%m-%d %H:%M:%S') 배치 시작 (mode=$MODE) =====" >> "$LOG"
CODE=0
# -u: 파이썬이 파일로 리다이렉트될 때 블록 버퍼링을 해서 진행 상황이 실시간으로
# 안 남습니다. 긴 배치를 도중에 들여다볼 수 있도록 버퍼링을 끕니다.
"$DIR/.venv/bin/python" -u "$DIR/run.py" "$@" >> "$LOG" 2>&1 || CODE=$?
echo "===== $(date '+%Y-%m-%d %H:%M:%S') 종료 (exit=$CODE) =====" >> "$LOG"

# 30일 이상 지난 로그 정리
find "$LOG_DIR" -name 'batch-*.log' -mtime +30 -delete 2>/dev/null || true
exit $CODE
