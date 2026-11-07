import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function request(file,messages){
  const child=spawn(process.execPath,['scripts/pinnote-mcp.mjs',file],{stdio:['pipe','pipe','pipe']});
  let out='';let err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  child.stdin.end(messages.map((m,i)=>JSON.stringify({jsonrpc:'2.0',id:i+1,...m})).join('\n')+'\n');
  const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0,err);
  return out.trim().split('\n').map(JSON.parse);
}
test('MCP stdio initializes, lists tools and reports offline app clearly',async()=>{
  const replies=await request('/missing/pinnote-connection.json',[{method:'initialize'},{method:'tools/list'},{method:'tools/call',params:{name:'search_notes',arguments:{query:'test'}}}]);
  assert.equal(replies[0].result.serverInfo.name,'pinnote');
  assert.equal(replies[1].result.tools.length,11);
  assert.equal(replies[2].result.isError,true);
  assert.match(replies[2].result.content[0].text,/PINNOTE_UNAVAILABLE/);
});
test('MCP connects over loopback and propagates version conflicts',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pinnote-mcp-'));
  const received=[];
  const server=createServer(socket=>{socket.once('data',data=>{const req=JSON.parse(data);received.push(req);socket.end(JSON.stringify(req.name==='read_note'?{result:{id:'a',revision:2,content:'最新'}}:{error:'VERSION_CONFLICT'})+'\n');});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const path=join(dir,'connection.json');await writeFile(path,JSON.stringify({port:server.address().port,token:'test-only'}));
    const replies=await request(path,[{method:'tools/call',params:{name:'read_note',arguments:{id:'a'}}},{method:'tools/call',params:{name:'update_note',arguments:{id:'a',content:'旧草稿',expectedRevision:1}}}]);
    assert.equal(JSON.parse(replies[0].result.content[0].text).revision,2);
    assert.equal(replies[1].result.isError,true);assert.match(replies[1].result.content[0].text,/VERSION_CONFLICT/);
    assert.equal(received[0].token,'test-only');assert.equal(received[1].arguments.expectedRevision,1);
  }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true});}
});
test('MCP decodes UTF-8 replies split inside a multi-byte character',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pinnote-mcp-'));
  const server=createServer(socket=>{socket.once('data',()=>{
    const bytes=Buffer.from(JSON.stringify({result:{id:'a',content:'原始记录 📝'}})+'\n','utf8');
    const cut=bytes.indexOf(Buffer.from('原','utf8'))+1;
    socket.write(bytes.subarray(0,cut));setTimeout(()=>socket.end(bytes.subarray(cut)),20);
  });});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const path=join(dir,'connection.json');await writeFile(path,JSON.stringify({port:server.address().port,token:'test-only'}));
    const [reply]=await request(path,[{method:'tools/call',params:{name:'read_note',arguments:{id:'a'}}}]);
    assert.equal(JSON.parse(reply.result.content[0].text).content,'原始记录 📝');
  }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true});}
});
