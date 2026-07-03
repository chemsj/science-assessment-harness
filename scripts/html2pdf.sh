#!/bin/bash
# HTML 산출물 → A4 PDF 변환 (Chrome/Edge headless)
# 사용법: bash scripts/html2pdf.sh <a.html> <b.html> ...
#        인자 없으면 assessments 하위 모든 .html 변환
# Chrome/Edge가 없으면 브라우저에서 인쇄(⌘/Ctrl+P → A4 → PDF 저장)하세요.

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || CHROME="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
[ -x "$CHROME" ] || { echo "Chrome/Edge를 찾을 수 없습니다. 브라우저 인쇄(A4→PDF)로 출력하세요."; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ $# -eq 0 ]; then
  IFS=$'\n'; set -- $(find "$ROOT/assessments" -name '*.html'); unset IFS
fi
TIMEOUT=60   # 초 — Chrome headless가 PDF를 쓴 뒤에도 종료되지 않는 경우가 있어 감시 필수
for html in "$@"; do
  [ -f "$html" ] || { echo "건너뜀(없음): $html"; continue; }
  pdf="${html%.html}.pdf"
  uri=$(python3 -c "import pathlib,sys;print(pathlib.Path(sys.argv[1]).resolve().as_uri())" "$html")
  tmp=$(mktemp -d)   # 변환마다 별도 프로필 → Chrome 프로필 잠금 충돌 방지
  "$CHROME" --headless=new --disable-gpu --no-sandbox --user-data-dir="$tmp" \
    --virtual-time-budget=10000 --no-pdf-header-footer --print-to-pdf="$pdf" "$uri" >/dev/null 2>&1 &
  cpid=$!
  # 감시: PDF가 생성되고 안정되면(또는 제한 시간 초과) Chrome을 정리하고 다음 파일로
  waited=0
  while kill -0 "$cpid" 2>/dev/null && [ "$waited" -lt "$TIMEOUT" ]; do
    sleep 2; waited=$((waited + 2))
    [ -s "$pdf" ] && { sleep 2; kill "$cpid" 2>/dev/null; break; }
  done
  kill -9 "$cpid" 2>/dev/null; wait "$cpid" 2>/dev/null
  rm -rf "$tmp"
  [ -s "$pdf" ] && echo "✓ $pdf" || echo "✗ 변환 실패: $html"
done
