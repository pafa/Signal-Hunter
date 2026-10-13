import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {runStructuredCodex} from '../server/codex-research.mjs';

const moduleUrl=new URL('../server/codex-research.mjs',import.meta.url).href;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function until(check,message){for(let i=0;i<100;i++){if(await check())return;await wait(30);}assert.fail(message);}
async function fixture(mode){
 const dir=await mkdtemp(join(tmpdir(),'codex-owner-test-')),binary=join(dir,'cli.mjs'),receipt=join(dir,'receipt.json');
 const env={PATH:dirname(process.execPath),HOME:dir};
 await writeFile(binary,`#!${process.execPath}
import fs from 'node:fs';import {spawn} from 'node:child_process';
const mode=${JSON.stringify(mode)},receipt=${JSON.stringify(receipt)};
if(process.argv.includes('--version')&&mode!=='version'){console.log('codex-cli 0.159.0-test');process.exit(0);}
const own={pid:process.pid,owner:process.ppid,cwd:process.cwd()};
if(mode==='descendant'){
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
 child.stdout.once('data',()=>{
  fs.writeFileSync(receipt,JSON.stringify({...own,descendant:child.pid}));
  fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],'{"ok":true}');
  console.log(JSON.stringify({type:'turn.completed'}));process.exit(0);
 });
}else{process.on('SIGTERM',()=>{});fs.writeFileSync(receipt,JSON.stringify(own));process.stdin.resume();setInterval(()=>{},1000);}
`,{mode:0o700});
 const task={prompt:'SYNTHETIC isolated process lifecycle',schema:{type:'object'},promptVersion:'fixture',inputHash:'fixture'};
 const config={binary,model:'fixture',timeoutMs:10000,env};
 let saved;
 return {dir,binary,receipt,task,config,async record(){await until(async()=>{try{saved=JSON.parse(await readFile(receipt,'utf8'));return true;}catch{return false;}},'CLI receipt missing');return saved;},async close(){
  if(saved){for(const pid of [saved.pid,saved.descendant])if(pid&&alive(pid))try{process.kill(pid,'SIGKILL');}catch{}if(alive(saved.owner))try{process.kill(saved.owner,'SIGTERM');}catch{}
   if(saved.cwd.startsWith(tmpdir())||saved.cwd.startsWith('/private'+tmpdir()))await rm(saved.cwd,{recursive:true,force:true});}
  await rm(dir,{recursive:true,force:true});
 }};
}
for(const mode of ['version','inference'])test(`application SIGKILL closes owned ${mode} CLI without touching another process`,{skip:process.platform==='win32',timeout:15000},async()=>{
 const f=await fixture(mode),worker=join(f.dir,'worker.mjs');let app;
 const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 try{
  await writeFile(worker,`import {runStructuredCodex} from ${JSON.stringify(moduleUrl)};await runStructuredCodex({...${JSON.stringify(f.task)},validate:x=>x},${JSON.stringify(f.config)});`);
  app=spawn(process.execPath,[worker],{stdio:'ignore'});const exited=new Promise(resolve=>app.once('exit',(code,signal)=>resolve({code,signal})));
  const record=await f.record();assert(alive(record.pid));assert.notEqual(record.owner,app.pid);
  app.kill('SIGKILL');assert.deepEqual(await exited,{code:null,signal:'SIGKILL'});
  await until(()=>!alive(record.pid),'CLI survived owner death');await until(()=>!alive(record.owner),'guard did not exit');assert(alive(unrelated.pid));
 }finally{if(app&&alive(app.pid))app.kill('SIGKILL');unrelated.kill('SIGKILL');await f.close();}
});
test('normal CLI exit cleans its same-group descendant before resolving the candidate',{skip:process.platform==='win32',timeout:15000},async()=>{
 const f=await fixture('descendant');
 try{
  const result=await runStructuredCodex({...f.task,validate:x=>x},f.config),record=await f.record();
  assert.equal(result.ok,true);assert.equal(result.trace.runtime.inference.exitCode,0);
  await until(()=>!alive(record.descendant),'CLI descendant survived');assert(!alive(record.pid));assert(!alive(record.owner));
 }finally{await f.close();}
});
test('cancelled CLI that ignores TERM is killed and cannot keep output pipes open',{skip:process.platform==='win32',timeout:15000},async()=>{
 const f=await fixture('inference'),controller=new AbortController();
 try{
  const result=runStructuredCodex({...f.task,validate:x=>x},{...f.config,signal:controller.signal}).then(x=>({value:x}),error=>({error}));
  const record=await f.record();controller.abort();const {error}=await result;
  assert.equal(error?.code,'cancelled');assert.equal(error.trace.runtime.inference.exitSignal,'SIGKILL');
  await until(()=>!alive(record.pid)&&!alive(record.owner),'cancelled process survived');
 }finally{await f.close();}
});
