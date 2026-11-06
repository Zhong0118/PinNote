#!/usr/bin/env node
// stdio MCP adapter. Only reads the connection descriptor; never opens notes.json.
import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
const connectionFile=process.argv[2] ?? process.env.PINNOTE_CONNECTION_FILE ?? join(
  process.platform==='darwin'?join(homedir(),'Library','Application Support'):process.platform==='win32'?(process.env.APPDATA??''):join(homedir(),'.local','share'),
  'com.pinnote.app','mcp-connection.json');
const str={type:'string'}, num={type:'integer'};
const tools=[
  ['search_notes','Search note titles and content',{query:str},[]],
  ['read_note','Read a note including its revision',{id:str},['id']],
  ['create_note','Create in the center; does not open a window',{title:str,content:str},['content']],
  ['append_note','Append text with optimistic version check',{id:str,content:str,expectedRevision:num},['id','content','expectedRevision']],
  ['update_note','Update title or content, preserving a recoverable version',{id:str,title:str,content:str,expectedRevision:num},['id','expectedRevision']],
  ...['archive','trash','restore'].map(op=>[`${op}_note`,`${op} a note with version check`,{id:str,expectedRevision:num},['id','expectedRevision']]),
  ['set_reminder','Set one future reminder, Unix milliseconds',{id:str,at:num,expectedRevision:num},['id','at','expectedRevision']],
  ['cancel_reminder','Cancel reminder',{id:str,expectedRevision:num},['id','expectedRevision']],
  ['open_note','Open on desktop ONLY when explicitly requested by the user',{id:str},['id']],
].map(([name,description,properties,required])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}));
async function native(name,args){
  let descriptor;
  try{descriptor=JSON.parse(await readFile(connectionFile,'utf8'));}catch{throw new Error('PINNOTE_UNAVAILABLE: 请启动 PinNote 并在设置中启用集成；找不到连接文件');}
  return new Promise((resolve,reject)=>{
    const socket=createConnection({host:'127.0.0.1',port:descriptor.port});let buffer='';
    socket.setTimeout(8000,()=>socket.destroy(new Error('PinNote connection timed out')));
    socket.on('error',()=>reject(new Error('PINNOTE_UNAVAILABLE: PinNote 未运行或连接失败，请启动应用并重试')));
    socket.on('connect',()=>socket.write(JSON.stringify({token:descriptor.token,name,arguments:args})+'\n'));
    socket.on('data',data=>{buffer+=data;if(buffer.length>8_000_000){socket.destroy();reject(new Error('Response too large'));return;}if(buffer.includes('\n')){socket.end();try{const reply=JSON.parse(buffer);reply.error?reject(new Error(reply.error)):resolve(reply.result);}catch(e){reject(e);}}});
    socket.on('end',()=>{if(!buffer.includes('\n'))reject(new Error('Incomplete PinNote response'));});
  });
}
async function handle(message){
  if(message.id===undefined)return;
  const reply={jsonrpc:'2.0',id:message.id};
  switch(message.method){
    case 'initialize': reply.result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'pinnote',version:'1.0.0'}};break;
    case 'ping': reply.result={};break;
    case 'tools/list':reply.result={tools};break;
    case 'tools/call':{
      try{
        const tool=tools.find(t=>t.name===message.params?.name);if(!tool)throw new Error('Unknown tool');
        const args=message.params.arguments??{};
        for(const key of tool.inputSchema.required)if(args[key]===undefined)throw new Error(`Missing ${key}`);
        const result=await native(tool.name,args);
        reply.result={content:[{type:'text',text:JSON.stringify(result)}]};
      }catch(error){reply.result={isError:true,content:[{type:'text',text:error.message}]};}
      break;
    }
    default:reply.error={code:-32601,message:'Method not found'};
  }
  process.stdout.write(JSON.stringify(reply)+'\n');
}
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
  try{if(line.length>2_000_000)throw new Error('Request too large');await handle(JSON.parse(line));}
  catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');}
}
