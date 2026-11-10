// ego-browser nodejs < scripts/verify-review-browser.mjs
// Real DOM with simulated IPC; native mouse/IME acceptance is recorded separately.
const task=await taskSpace('PinNote November acceptance');const p=task.page('p1');
const fs=await import('node:fs/promises');
const root='/Users/zhongxu/Desktop/0-Inbox/PinNote';
await p.cdp('Page.addScriptToEvaluateOnNewDocument',{source:await fs.readFile(`${root}/tests/browser-fixture.txt`,'utf8')});
await p.goto('http://127.0.0.1:1420/center');
await p.waitForSelector('button.note-row');await p.click('button.note-row');
await p.waitForSelector('.editor[contenteditable="true"]');
for (const title of ['计划 B','计划 C']) {
 await p.click('[aria-label="新建便签"]');await p.fill('[aria-label="便签标题"]',title);
 await p.waitForFunction(t=>Object.values(window.__test.notes).some(n=>n.title===t),title);
}
const result=await p.evaluate(()=>{
 const names=()=>[...document.querySelectorAll('.tab-title')].map(e=>e.textContent);
 const before=names();const tabs=document.querySelectorAll('.tab');
 const data=new DataTransfer();tabs[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
 tabs[0].dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));
 const other=new DataTransfer();other.setData('text/pinnote','a');
 tabs[2].dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:other}));
 return new Promise(resolve=>requestAnimationFrame(()=>resolve({before,after:names()})));
});
if(JSON.stringify(result.before)!==JSON.stringify(result.after))throw Error('Cancelled drag moved an old tab');
await p.dragAndDrop('.tab >> nth=0','.tab >> nth=2');
await p.waitForFunction(()=>document.querySelector('.tab-title').textContent==='计划 B');
console.log('PASS: cancelled drag cannot move an old tab; actual browser tab drag reorders');
console.log(await p.snapshot());
