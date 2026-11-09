# Summarises idle-release.sh output dirs: CPU % over the window, process count, physical footprint.
import sys, re
def secs(t):
    p = [float(x) for x in t.split(':')]; s = 0
    for x in p: s = s*60 + x
    return s
def load(f):
    rows = {}
    for line in open(f):
        parts = line.split(None, 3)
        if len(parts) < 4: continue
        pid, rss, t, cmd = parts
        rows[pid] = (int(rss), secs(t), cmd.strip())
    return rows
for d in sys.argv[1:]:
    t0, t1 = map(float, open(f"{d}/times.txt").read().split())
    a, b = load(f"{d}/t0.txt"), load(f"{d}/t1.txt")
    cpu = sum(b[p][1]-a[p][1] for p in b if p in a) / (t1-t0) * 100
    rss = sum(v[0] for v in b.values()) / 1024
    fp = 0.0
    for line in open(f"{d}/footprint.txt"):
        m = re.search(r'([\d.]+)\s*(KB|MB|GB)', line)
        if m: fp += float(m.group(1)) * {'KB':1/1024,'MB':1,'GB':1024}[m.group(2)]
    procs = ', '.join(sorted(set(re.sub(r'.*/', '', v[2]).split()[0] for v in b.values())))
    print(f"{d}: procs={len(b)} cpu={cpu:.2f}% rss={rss:.0f}MB footprint={fp:.0f}MB window={t1-t0:.0f}s [{procs}]")
