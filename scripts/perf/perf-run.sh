#!/bin/bash
# Runs one debug build against a copy of the isolated perf data and samples its processes.
# Build first: pnpm tauri build --debug --no-bundle; data first: python3 scripts/perf/gen-perf-data.py
# usage: perf-run.sh <binary> <outdir>
BIN="$1"; OUT="$2"; DATA=/tmp/pinnote-perf-data
rm -rf "$DATA" "$OUT"; mkdir -p "$DATA" "$OUT"; cp /tmp/pinnote-perf-template/* "$DATA"/
pgrep -f "com.apple.WebKit" | sort > "$OUT/webkit-before.txt"
PINNOTE_TEST_DATA_DIR="$DATA" PINNOTE_PERF=1 PINNOTE_PERF_SCENARIO=1 "$BIN" > "$OUT/app.log" 2>&1 &
APP=$!
start=$(date +%s)
while true; do
  now=$(python3 -c 'import time;print(int(time.time()*1000))')
  pids=$( (echo $APP; pgrep -f "com.apple.WebKit" | sort | comm -13 "$OUT/webkit-before.txt" -) | tr '\n' ',' | sed 's/,$//')
  ps -o pid=,rss=,time=,command= -p "$pids" 2>/dev/null | awk -v t=$now '{printf "%s %s %s %s %s\n", t,$1,$2,$3,$4}' >> "$OUT/samples.txt"
  if grep -q '"done"' "$DATA/perf.json" 2>/dev/null; then break; fi
  if (( $(date +%s) - start > 400 )); then echo timeout >> "$OUT/app.log"; break; fi
  sleep 1
done
# phys footprint at the end (after final idle)
for p in ${pids//,/ }; do footprint -p $p 2>/dev/null | grep -m1 "Footprint" | sed "s/^/$p /" ; done > "$OUT/footprint.txt"
cp "$DATA/perf.json" "$OUT/"
kill $APP; sleep 2; kill -9 $APP 2>/dev/null
echo finished
