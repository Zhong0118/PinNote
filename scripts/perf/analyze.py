import json,sys,collections
d=sys.argv[1]
perf=json.load(open(f"{d}/perf.json"))
marks={m["name"]:m["at"] for m in perf["marks"]}
print("marks", {k:(v-marks['idle-start'])/1000 for k,v in marks.items()})
print("backend", json.dumps(perf["backend"],ensure_ascii=False))
agg=collections.defaultdict(lambda:[0,0.0])
for label,c in perf["windows"].items():
    for k,v in c.items(): agg[k][0]+=v["n"]; agg[k][1]+=v["ms"]
print("frontend totals", {k:(v[0],round(v[1],1)) for k,v in sorted(agg.items())})
print("per-window editor creates", {l:c.get("editor.create",{}).get("n",0) for l,c in perf["windows"].items()})
def tsec(s):
    p=s.split(':'); return float(p[0])*60+float(p[1])
rows=collections.defaultdict(dict)
for line in open(f"{d}/samples.txt"):
    t,pid,rss,cpu,cmd=line.split()[:5]
    rows[int(t)][pid]=(int(rss),tsec(cpu),cmd)
times=sorted(rows)
def at(ms):
    t=min(times,key=lambda x:abs(x-ms)); return t,rows[t]
for name in ["idle-start","hover-start","edit-start","switch-start","collapse-start","final-idle-start","done"]:
    if name not in marks: continue
    t,r=at(marks[name]); wc=sum(1 for v in r.values() if 'WebContent' in v[2])
    print(f"{name:18s} procs={len(r)} webcontent={wc} rss_total={sum(v[0] for v in r.values())/1024:.0f}MB")
def cpu_between(a,b):
    ta,ra=at(a); tb,rb=at(b)
    total=sum(rb[p][1]-ra[p][1] for p in rb if p in ra)
    return total/((tb-ta)/1000)*100
print(f"idle cpu (center+10 capsules, 10s): {cpu_between(marks['idle-start']+500,marks['hover-start']-500):.2f}%")
print(f"final idle cpu (20s): {cpu_between(marks['final-idle-start']+5000,marks['done']-500):.2f}%")
fp=[l.split() for l in open(f"{d}/footprint.txt")]
tot=0
for l in fp:
    i=l.index("Footprint:"); v=float(l[i+1]); u=l[i+2]; tot+= v/1024 if u=="KB" else v if u=="MB" else v*1024
print(f"phys footprint total at end: {tot:.0f}MB over {len(fp)} procs")
