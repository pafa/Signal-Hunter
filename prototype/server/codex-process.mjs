import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';

// A separate owner survives an application crash long enough to stop its CLI
// group. IPC ownership avoids scanning process names or trusting persisted PIDs.
export function spawnCodexProcess(binary,args,{cwd,env}){
 if(process.platform==='win32')return spawn(binary,args,{cwd,env,stdio:['pipe','pipe','pipe'],shell:false});
 const guard=spawn(process.execPath,[fileURLToPath(new URL('./codex-process-owner.mjs',import.meta.url))],{cwd,env,stdio:['pipe','pipe','pipe','ipc'],shell:false});
 const child=new EventEmitter();let outcome=null,failed=false;
 Object.assign(child,{stdin:guard.stdin,stdout:guard.stdout,stderr:guard.stderr,pid:undefined});
 child.kill=signal=>{
  if(!guard.connected)return false;
  guard.send({type:'stop',signal:signal==='SIGKILL'?'SIGKILL':'SIGTERM'},()=>{});return true;
 };
 guard.on('message',message=>{
  if(message?.type==='spawned')child.pid=message.pid;
  else if(message?.type==='exit')outcome={code:message.code,signal:message.signal};
  else if(message?.type==='error'){failed=true;child.emit('error',new Error('Model process unavailable'));}
 });
 guard.on('error',()=>{failed=true;child.emit('error',new Error('Model process owner unavailable'));});
 guard.on('close',()=>{
  if(!outcome&&!failed)child.emit('error',new Error('Model process owner interrupted'));
  child.emit('close',outcome?.code??null,outcome?.signal??null);
 });
 guard.send({type:'start',binary,args,cwd,env},error=>{if(error&&!failed){failed=true;child.emit('error',new Error('Model process owner unavailable'));}});
 return child;
}
