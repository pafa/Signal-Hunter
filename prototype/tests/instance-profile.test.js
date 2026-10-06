import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,renameSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {assertDatabaseMode,checkDatabaseFile,runtimeConfig} from '../server/runtime.mjs';
import {registerInstance,readInstanceProfile,verifyInstanceDatabase} from '../server/instance-profile.mjs';
const script=name=>fileURLToPath(new URL('../scripts/'+name,import.meta.url));
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'signal-instance-')),database=join(dir,'fixture.sqlite'),output=join(dir,'fixture.instance.json');
 const store=openStore(database);assertDatabaseMode(store,'research');const service=createService(store,{mode:'research'});
 const topic=service.research.create({title:'Synthetic saved event',summary:'Preserve original history'});
 await service.close();store.close();return {dir,database,output,topic};
}
test('fixed instance registration is read-only, exclusive and independent of current directory',async()=>{
 const f=await fixture(),before=readFileSync(f.database),p=registerInstance({...f,label:'Synthetic weekly research'});
 assert.deepEqual(readFileSync(f.database),before);assert.equal(statSync(f.output).mode&0o777,0o600);assert.throws(()=>registerInstance({...f,label:'replace'}),/EEXIST/);
 assert.deepEqual(readInstanceProfile(f.output),p);const config=runtimeConfig({SIGNAL_INSTANCE_PROFILE:f.output});checkDatabaseFile(config);
 assert.equal(config.production,true);assert.equal(config.dbPath,realpathSync(f.database));assert.equal(config.instance.fixed,true);assert.equal(config.instance.label,'Synthetic weekly research');
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {runtimeConfig,checkDatabaseFile} from ${JSON.stringify(new URL('../server/runtime.mjs',import.meta.url).href)}; const c=runtimeConfig();checkDatabaseFile(c);console.log(c.instance.id);`],{cwd:tmpdir(),env:{...process.env,SIGNAL_INSTANCE_PROFILE:f.output},encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),p.id);
 for(const env of [{SIGNAL_MODE:'demo'},{SIGNAL_DB_PATH:join(f.dir,'other.sqlite')},{SIGNAL_FRONTEND_PORT:'9999'},{SIGNAL_SERVE_STATIC:'0'}])assert.throws(()=>runtimeConfig({SIGNAL_INSTANCE_PROFILE:f.output,...env}),/冲突/);
});
test('missing or wrong database fails before schema writes; new research versions retain identity',async()=>{
 const f=await fixture(),p=registerInstance({...f,label:'Preserved research'}),config=runtimeConfig({SIGNAL_INSTANCE_PROFILE:f.output});
 renameSync(f.database,f.database+'.saved');assert.throws(()=>checkDatabaseFile(config));assert.equal(existsSync(f.database),false);renameSync(f.database+'.saved',f.database);
 const s=openStore(f.database),service=createService(s,{mode:'research'});service.research.update(f.topic.id,{version:1,nextEvidence:'New revision preserves old anchor'});await service.close();s.close();verifyInstanceDatabase(p);
 const other=await fixture();assert.throws(()=>verifyInstanceDatabase({...p,database:other.database}),/指纹/);
 assert.throws(()=>verifyInstanceDatabase({...p,mode:'demo'}),/模式/);
 const tamper=openStore(f.database);tamper.db.prepare('DELETE FROM research_versions WHERE topic_id=? AND version=1').run(f.topic.id);tamper.close();assert.throws(()=>checkDatabaseFile(config),/指纹/);
});
test('empty initialized research can be registered using paper history; invalid profiles and uninitialized files are rejected',async()=>{
 const f=await fixture(),s=openStore(f.database);s.db.exec('DELETE FROM research_versions');s.close();const p=registerInstance({...f,label:'Empty research'});assert.equal(p.anchor.table,'paper_versions');
 for(const patch of [{database:'relative.sqlite'},{label:'\ninvalid'},{frontendPort:4179},{anchor:{...p.anchor,table:'settings'}}]){writeFileSync(f.output,JSON.stringify({...p,...patch}));assert.throws(()=>readInstanceProfile(f.output));}
 const path=join(f.dir,'new.sqlite');assert.throws(()=>registerInstance({...f,database:path}));assert.equal(existsSync(path),false);
 const blank=openStore(path);blank.close();assert.throws(()=>registerInstance({...f,database:path}),/历史版本/);
});
test('actual CLI creates a profile, rejects overrides on startup, and service template preserves fixed entry',async()=>{
 const f=await fixture(),run=(name,args=[],env={})=>spawnSync(process.execPath,[script(name),...args],{cwd:tmpdir(),env:{...process.env,...env},encoding:'utf8'});
 const made=run('create-instance.mjs',[f.database,f.output,'Synthetic instance','4378','4379']);assert.equal(made.status,0,made.stderr);
 const bad=run('start.mjs',['--instance',f.output],{SIGNAL_MODE:'demo'});assert.notEqual(bad.status,0);assert.match(bad.stderr,/冲突/);
 const modelEnv={SIGNAL_CODEX_BIN:join(f.dir,'fixture-codex'),SIGNAL_CODEX_MODEL:'fixture-model',SIGNAL_CODEX_EFFORT:'medium',SIGNAL_CODEX_TIMEOUT_MS:'123456',SIGNAL_UNRELATED_SECRET:'fixture-only'};
 for(const platform of ['macos','linux']){
  const output=join(f.dir,platform==='macos'?'service.plist':'signal-hunter.service'),generated=run('service-config.mjs',[platform,output],{SIGNAL_INSTANCE_PROFILE:f.output,...modelEnv});assert.equal(generated.status,0,generated.stderr);const text=readFileSync(output,'utf8');assert.match(text,/SIGNAL_INSTANCE_PROFILE/);assert.ok(text.includes(f.output));
  for(const key of ['SIGNAL_CODEX_BIN','SIGNAL_CODEX_MODEL','SIGNAL_CODEX_EFFORT','SIGNAL_CODEX_TIMEOUT_MS']){assert.ok(text.includes(key));assert.ok(text.includes(modelEnv[key]));}
  assert.ok(!text.includes('SIGNAL_UNRELATED_SECRET'));assert.ok(!text.includes(modelEnv.SIGNAL_UNRELATED_SECRET));assert.equal(statSync(output).mode&0o777,0o600);
  if(platform==='macos')assert.match(text,/<string>research<\/string>/);
 }
});
test('HTTP exposes dataset identity and rejects stale reads and writes before touching records',async()=>{
 const store=openStore(':memory:'),instance={id:'fixture-instance',label:'Synthetic saved studies',fixed:true,databaseName:'fixture.sqlite'},service=createService(store,{mode:'research',instance}),handler=createHandler(store,service);
 const call=async(method,url,identity)=>{let status,result;await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json',...(identity?{'x-signal-instance':identity}:{})},async *[Symbol.asyncIterator](){yield JSON.stringify({title:'A new topic',summary:'Temporary only'});}},{writeHead:n=>status=n,end:b=>result=JSON.parse(b)});return {status,result};};
 try{
  assert.deepEqual((await call('GET','/api/health')).result.instance,instance);assert.deepEqual((await call('GET','/api/data')).result.runtime.instance,instance);
  assert.equal((await call('POST','/api/research')).status,409);assert.equal((await call('POST','/api/research','old-instance')).status,409);assert.equal((await call('GET','/api/data','old-instance')).status,409);assert.equal(service.research.list().length,0);
  assert.equal((await call('POST','/api/research',instance.id)).status,200);assert.equal(service.research.list().length,1);
 }finally{await service.close();store.close();}
});
test('browser request helper binds reads and edits to original dataset and requires reload after switch',async()=>{
 const original=globalThis.fetch,seen=[];let id='dataset-a';
 globalThis.fetch=async(path,options)=>{seen.push(options);return Response.json({runtime:{instance:{id}}});};
 try{
  const {request}=await import('../src/major/api.js?instance-regression');await request('/api/data');await request('/api/research','POST',{});assert.equal(seen.at(-1).headers['X-Signal-Instance'],'dataset-a');
  id='dataset-b';await assert.rejects(request('/api/data'),/数据集已切换/);const count=seen.length;await assert.rejects(request('/api/research','POST',{}),/刷新/);assert.equal(seen.length,count);
 }finally{globalThis.fetch=original;}
});
