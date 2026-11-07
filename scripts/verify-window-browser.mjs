// Simulates only native IPC; drives real window page drag/dock/locate logic.
const task=await taskSpace('PinNote usability fixes');const p=task.page('p1');const fs=await import('node:fs/promises');
const source=await fs.readFile('/Users/zhongxu/Desktop/0-Inbox/PinNote/tests/browser-fixture.txt','utf8');
const added=await p.cdp('Page.addScriptToEvaluateOnNewDocument',{source});
try{
 await p.goto('http://127.0.0.1:1420/?noteId=a');await p.waitForSelector('.milkdown .editor');
 await p.waitForFunction(()=>!document.querySelector('main').inert);
 await p.evaluate(()=>document.querySelector('.dragbar').dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true})));
 await p.waitForFunction(()=>window.__test.notes.a.window.edge?.side==='left');
 if(!await p.evaluate(()=>window.__test.notes.a.window.collapsed&&window.__test.size.height===80&&window.__test.position.x===0))throw new Error('Native bounds did not collapse and dock');
 const saved=await p.evaluate(()=>window.__test.notes.a.window.position);
 await p.evaluate(()=>window.__test.emit('locate-note-requested',{id:'a'}));
 await p.waitForSelector('.note-window.locating');
 if(!await p.evaluate(()=>!window.__test.notes.a.window.collapsed&&window.__test.size.height===1120))throw new Error('Locate did not expand');
 await p.click('[aria-label="便签菜单"]');await p.click('text="收纳到右侧"');
 await p.waitForFunction(()=>window.__test.notes.a.window.edge?.side==='right'&&window.__test.position.x===2520);
 console.log('PASS: drag → left dock, native geometry queue, locate expands/highlights, menu → right dock; free position',saved);
}finally{await p.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:added.identifier});}
