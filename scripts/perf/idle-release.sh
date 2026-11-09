#!/bin/bash
# Idle cost of one release (no-bundle) binary in a matched state, under a throwaway HOME.
# The binary is copied under a unique name first: WebKit keys its storage by executable name in the
# real ~/Library/WebKit/<name>, so this never touches the app's own or the dev storage.
# State: perf data set (python3 scripts/perf/gen-perf-data.py), center 980×700 pinned, "中心长便签"
# selected with its editor mounted. Samples 60 s of CPU time after a 30 s settle.
# Tools: swiftc -O scripts/perf/winid.swift -o /tmp/pn-tools/winid; same for activate.swift.
# usage: idle-release.sh <binary> <unique-name> <outdir>; afterwards: rm -rf ~/Library/WebKit/<unique-name>
set -e
SRC="$1"; NAME="$2"; OUT="$3"; REAL_HOME="$HOME"; H="/tmp/pn-home-$NAME"; BIN="/tmp/pn-bin/$NAME"
DATA="$H/Library/Application Support/com.pinnote.app"
rm -rf "$H" "$OUT"; mkdir -p "$DATA" "$OUT" /tmp/pn-bin; cp "$SRC" "$BIN"; cp /tmp/pinnote-perf-template/* "$DATA"/
HOME="$H" "$BIN" >"$OUT/first.log" 2>&1 & P=$!; sleep 12; kill $P; sleep 2; kill -9 $P 2>/dev/null || true
DB=$(find "$REAL_HOME/Library/WebKit/$NAME" -name '*.sqlite3' -path '*LocalStorage*' | head -1)
python3 - "$DB" <<'PY'
import sqlite3, sys, json
db = sqlite3.connect(sys.argv[1])
s = {"mode":"window","pinned":True,"window":{"x":180,"y":110,"width":980,"height":700,"scaleFactor":2},"tabs":["perf-11"],"selected":"perf-11"}
db.execute("INSERT OR REPLACE INTO ItemTable(key,value) VALUES (?,?)", ("pinnote.center", json.dumps(s).encode("utf-16-le"))); db.commit()
PY
pgrep -f "com.apple.WebKit" | sort > "$OUT/webkit-before.txt"
HOME="$H" "$BIN" >"$OUT/app.log" 2>&1 & APP=$!
sleep 6; /tmp/pn-tools/activate $APP; sleep 24
pids=$( (echo $APP; pgrep -f "com.apple.WebKit" | sort | comm -13 "$OUT/webkit-before.txt" -) | tr '\n' ',' | sed 's/,$//')
ps -o pid=,rss=,time=,command= -p "$pids" > "$OUT/t0.txt"; date +%s > "$OUT/times.txt"
sleep 60
ps -o pid=,rss=,time=,command= -p "$pids" > "$OUT/t1.txt"; date +%s >> "$OUT/times.txt"
for p in ${pids//,/ }; do footprint -p $p 2>/dev/null | grep -m1 "Footprint" | sed "s/^/$p /" || true; done > "$OUT/footprint.txt"
# Only the center window is captured, to confirm the state; never the screen.
WID=$(/tmp/pn-tools/winid $APP | sort -k4,4nr | awk '$6=="true"{print $1; exit}')
[ -n "$WID" ] && screencapture -x -o -l "$WID" "$OUT/center.png"
kill $APP; sleep 2; kill -9 $APP 2>/dev/null || true
# A run only counts if nobody touched the test window: no native drag, still pinned at the seeded frame.
python3 - "$DB" "$OUT" <<'PY'
import sqlite3, sys, json
db = sqlite3.connect(sys.argv[1]); out = sys.argv[2]
s = json.loads(next(v for k, v in db.execute("select key,value from ItemTable where key='pinnote.center'")).decode("utf-16-le"))
dragged = "Window move" in open(f"{out}/app.log").read()
ok = s.get("pinned") and s.get("window", {}).get("x") == 180 and s.get("window", {}).get("y") == 110 and not dragged
open(f"{out}/valid.txt", "w").write("valid\n" if ok else f"INVALID: pinned={s.get('pinned')} window={s.get('window')} dragged={dragged}\n")
PY
cat "$OUT/valid.txt"
