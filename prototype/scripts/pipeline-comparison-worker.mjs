import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {replayPipeline} from '../server/pipeline-replay.mjs';
import {isAbsolute,join} from 'node:path';
import {existsSync} from 'node:fs';
const controller=new AbortController();for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>controller.abort());
try{
 let input='',bytes=0;process.stdin.setEncoding('utf8');for await(const chunk of process.stdin){bytes+=Buffer.byteLength(chunk);if(bytes>13*1024*1024)throw Error();input+=chunk;}
 const p=JSON.parse(input);if(p.action!=='run-pipeline'||!isAbsolute(p.root)||!isAbsolute(p.directory)||existsSync(join(p.directory,'replay.sqlite')))throw Error();
 // The clock and UUID stream are explicit experiment inputs, isolated to this
 // worker. They do not alter the application or invent historical availability.
 const OriginalDate=Date;let at=OriginalDate.parse(p.recipe.startedAt),counter=0;
 globalThis.__signalReplayClock=value=>at=value;
 globalThis.__signalReplayWallNow=()=>OriginalDate.now();
 globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};
 crypto.randomUUID=()=>{const v=crypto.createHash('sha256').update(p.recipe.seed+':'+counter++).digest('hex').slice(0,32).split('');v[12]='4';v[16]='8';const s=v.join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;};syncBuiltinESMExports();
 globalThis.fetch=()=>{throw Error('回放不允许未登记网络请求');};
 const value=await replayPipeline(p.root,p.recipe,{databasePath:join(p.directory,'replay.sqlite'),signal:controller.signal});process.stdout.write(JSON.stringify({ok:true,value}));
}catch{process.stdout.write(JSON.stringify({ok:false,failure:{code:controller.signal.aborted?'cancelled':'pipeline',message:'完整回放未完成；独立数据库及已有执行记录保留'}}));}
