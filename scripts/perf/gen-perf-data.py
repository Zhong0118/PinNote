# Writes the isolated perf data set to /tmp/pinnote-perf-template (never the real data directory).
import json, os, time
os.makedirs("/tmp/pinnote-perf-template", exist_ok=True)
now = int(time.time()*1000)
def long_body(i):
    parts = [f"# 长便签 {i}\n"]
    for k in range(60):
        parts.append(f"## 小节 {k}\n\n这是第 {k} 段较长的正文，用于测量序列化与解析成本。包含 **加粗**、`代码` 与 [链接](https://example.com)。\n\n- [ ] 待办 {k}-a\n- [x] 待办 {k}-b\n\n```js\nconst value{k} = {k} * 2;\n```\n")
    return "\n".join(parts)
notes = {}
def mk(i, title, content, placement, window):
    nid = f"perf-{i:02d}"
    notes[nid] = {"id":nid,"title":title,"content":content,"placement":placement,"lifecycle":"active","alwaysOnTop":True,
      "opacity":1,"theme":["sky","mint","rose","grape","paper"][i%5],"customColor":"#f59e0b","createdAt":now-100000+i,
      "updatedAt":now-1000+i,"lastFocusedAt":now-1000+i,"revision":1,"reminder":None,"window":window}
for i in range(10):
    long = i % 2 == 1
    body = long_body(i) if long else f"# 短便签 {i}\n\n* [ ] 整理需求\n\n一段简短正文 {i}。\n"
    if i < 7:
        x, y = 160 + (i%4)*200, 140 + (i//4)*80
        w = {"collapsed":True,"edge":None,"width":360,"height":320,"x":x,"y":y,"position":{"x":x,"y":y},"positionSpace":"logical","capsulePosition":{"x":x,"y":y}}
    else:
        w = {"collapsed":True,"edge":{"side":"right","display":"0:0","order":100+i},"width":360,"height":320,"x":600,"y":200,"position":{"x":600,"y":200},"positionSpace":"logical"}
    mk(i, f"{'长' if long else '短'}便签 {i}", body, "desktop", w)
mk(10, "中心便签", "# 中心便签\n\n在中心编辑。\n", "center", {"collapsed":False,"edge":None,"width":360,"height":320})
mk(11, "中心长便签", long_body(11), "center", {"collapsed":False,"edge":None,"width":360,"height":320})
json.dump({"version":2,"notes":notes,"history":[],"tombstones":[],"lastActiveNoteId":"perf-10","lastClosedNoteId":""}, open("/tmp/pinnote-perf-template/notes.json","w"), ensure_ascii=False)
print(len(notes), sum(len(n["content"]) for n in notes.values()))
json.dump({"autoStart":False,"shortcuts":{"toggleWindow":"CmdOrCtrl+Option+N","newNote":"CmdOrCtrl+Option+Shift+N"},"defaultNote":{"alwaysOnTop":True,"opacity":0.96,"theme":"paper","customColor":"#2d7d74"}}, open("/tmp/pinnote-perf-template/settings.json","w"))
