// Run against an isolated debug app: node scripts/verify-mcp-live.mjs <connection file>
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {watch} from 'node:fs';
import assert from 'node:assert/strict';
const file=process.argv[2];if(!file)throw new Error('Pass the isolated app connection file');
if(!dirname(file).includes('pinnote-acceptance'))throw new Error('Only run against the isolated pinnote-acceptance directory');
const configPath=join(dirname(file),'integration.json');
const originalConfig=await readFile(configPath,'utf8');
const child=spawn(process.execPath,['scripts/pinnote-mcp.mjs',file],{stdio:['pipe','pipe','inherit']});
const pending=new Map();let id=0;
createInterface({input:child.stdout}).on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r);pending.delete(r.id);});
function request(method,params){return new Promise(resolve=>{pending.set(++id,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
async function call(name,args){const r=await request('tools/call',{name,arguments:args});if(r.result.isError)throw new Error(r.result.content[0].text);return JSON.parse(r.result.content[0].text);}
try{
  assert.equal((await request('initialize',{})).result.serverInfo.name,'pinnote');
  await writeFile(configPath,JSON.stringify({enabled:false,write:false,scope:'active'}));
  await assert.rejects(call('search_notes',{}),/INTEGRATION_DISABLED/);
  await writeFile(configPath,JSON.stringify({enabled:true,write:false,scope:'active'}));
  await assert.rejects(call('create_note',{content:'must fail'}),/READ_ONLY/);
  await writeFile(configPath,originalConfig);
  const old=await call('read_note',{id:'acceptance-legacy'});
  assert.equal(old.content,'旧便签保留\n\n- [ ] 验收');assert.equal(old.lifecycle,'active');
  const backup=JSON.parse(await readFile(join(dirname(file),'notes.before-v2.json'),'utf8'));assert.equal(backup.version,1);
  let note=await call('create_note',{title:'MCP 实际连接验收',content:'原始记录'});
  assert.equal(note.placement,'center');assert.equal(note.revision,1);
  note=await call('append_note',{id:note.id,content:'\n追加内容',expectedRevision:note.revision});
  assert.equal(note.content,'原始记录\n追加内容');
  await assert.rejects(call('update_note',{id:note.id,content:'过期覆盖',expectedRevision:1}),/VERSION_CONFLICT/);
  note=await call('update_note',{id:note.id,title:'更新标题',expectedRevision:note.revision});
  note=await call('set_reminder',{id:note.id,at:Date.now()+3600000,expectedRevision:note.revision});
  assert.equal(note.reminder.state,'pending');
  note=await call('archive_note',{id:note.id,expectedRevision:note.revision});assert.equal(note.reminder.state,'paused');
  note=await call('restore_note',{id:note.id,expectedRevision:note.revision});assert.equal(note.reminder,null);assert.equal(note.placement,'center');
  note=await call('trash_note',{id:note.id,expectedRevision:note.revision});assert.equal(note.lifecycle,'trash');
  note=await call('restore_note',{id:note.id,expectedRevision:note.revision});assert.equal(note.content,'原始记录\n追加内容');
  assert.ok((await call('search_notes',{query:'追加内容'})).some(n=>n.id===note.id));
  const stored=JSON.parse(await readFile(join(dirname(file),'notes.json'),'utf8'));
  assert.ok(stored.history.some(h=>h.source==='agent'&&h.note.id===note.id&&h.note.content==='原始记录'));
  note=await call('set_reminder',{id:note.id,at:Date.now()+100,expectedRevision:note.revision});
  await new Promise((resolve,reject)=>{
    const watcher=watch(dirname(file),async()=>{
      try{const f=JSON.parse(await readFile(join(dirname(file),'notes.json'),'utf8'));if(f.notes[note.id]?.reminder?.state==='delivered'){clearTimeout(timer);watcher.close();resolve();}}catch{}
    });
    const timer=setTimeout(()=>{watcher.close();reject(new Error('Native reminder scheduler did not claim due reminder'));},25000);
  });
  note=await call('read_note',{id:note.id});assert.equal(note.reminder.state,'delivered');
  note=await call('cancel_reminder',{id:note.id,expectedRevision:note.revision});
  const opened=await call('open_note',{id:note.id});assert.equal(opened.requested,true);
  console.log('PASS: live stdio MCP → native service: disabled/read-only permissions, migration backup, read/search/create/append/update, version conflict, background reminder claim/cancel, archive/trash/restore, recoverable history, explicit open request');
}finally{await writeFile(configPath,originalConfig);child.stdin.end();}
