// Ignore fenced code so examples never count as actual tasks.
export function checklistProgress(markdown: string) {
  let fence = ''; let total = 0; let done = 0;
  for(const line of markdown.split('\n')) {
    const marker=line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if(marker) { if(!fence) fence=marker[1]; else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length) fence=''; continue; }
    if(fence) continue;
    const task=line.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s/);
    if(task) { total++; if(task[1].toLowerCase()==='x') done++; }
  }
  return {total,done};
}
