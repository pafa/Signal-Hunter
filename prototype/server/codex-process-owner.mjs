import {spawn} from 'node:child_process';

// Internal IPC-only entry point. stdout/stdin/stderr belong to the actual CLI;
// lifecycle messages never share the model's JSON protocol or prompt stream.
if(!process.send||!process.connected)process.exit(1);
let child,stopping=false,killTimer,finished=false,exit=null;
const send=message=>{if(process.connected)process.send(message,()=>{});};
function signalGroup(signal){if(child?.pid)try{process.kill(-child.pid,signal);}catch{}}
function groupAlive(){if(!child?.pid)return false;try{process.kill(-child.pid,0);return true;}catch{return false;}}
function finish(){
 if(finished)return;finished=true;clearTimeout(killTimer);
 const done=()=>process.exit(0);
 if(process.connected)process.send({type:'exit',code:exit?.code??null,signal:exit?.signal??null},done);else done();
}
function stop(signal='SIGTERM'){
 if(finished)return;
 if(!child){stopping=true;finish();return;}
 if(signal==='SIGKILL'){
  stopping=true;signalGroup('SIGKILL');
  // A force-stop can arrive before TERM or after the CLI leader exited.
  killTimer??=setTimeout(()=>{signalGroup('SIGKILL');if(exit)finish();},500);
  return;
 }
 if(stopping)return;stopping=true;signalGroup('SIGTERM');
 // Keep the grace timer even if the CLI exits first: a same-group descendant
 // can ignore TERM and keep pipes/resources open after its parent has exited.
 killTimer=setTimeout(()=>{signalGroup('SIGKILL');if(exit)finish();},500);
}
process.on('disconnect',()=>stop());
for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>stop());
process.on('message',message=>{
 if(message?.type==='stop'){stop(message.signal);return;}
 if(message?.type!=='start'||child||stopping)return;
 const {binary,args,cwd,env}=message;
 if(typeof binary!=='string'||!Array.isArray(args)||!args.every(x=>typeof x==='string')||typeof cwd!=='string'||!env||typeof env!=='object'){send({type:'error'});finish();return;}
 try{
  child=spawn(binary,args,{cwd,env,stdio:[0,1,2],shell:false,detached:true});
  child.on('spawn',()=>send({type:'spawned',pid:child.pid}));
  child.on('error',()=>{send({type:'error'});exit={code:null,signal:null};finish();});
  child.on('exit',(code,signal)=>{
   exit={code,signal};
   if(!groupAlive()){finish();return;}
   stop();
  });
 }catch{send({type:'error'});finish();}
});
