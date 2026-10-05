import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {openSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync} from 'node:fs';
import {lstat,realpath,readFile,readdir,mkdir,rename,unlink,rmdir} from 'node:fs/promises';
import {join,resolve,dirname,basename,relative} from 'node:path';
import {previewStorageRetention,retentionPolicy} from './storage-retention.mjs';
const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const fail=message=>{throw new Error(message);};
const id=s=>({dev:s.dev,ino:s.ino});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const inside=(parent,path)=>{const r=relative(parent,path);return !r||!r.startsWith('..')&&!r.startsWith('/');};
async function regular(path,dir=false){const s=await lstat(path);if(s.isSymbolicLink()||!(dir?s.isDirectory():s.isFile())||!dir&&s.nlink!==1)fail('拒绝符号链接、硬链接或非普通备份');return s;}
function inspect(file){
 const db=new DatabaseSync(file,{readOnly:true});try{
  db.exec('BEGIN');if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)fail('备份数据库完整性无效');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  if(!tables.includes('settings')||!tables.includes('news'))fail('不是工作台数据库');
  let anchor=null;
  if(tables.includes('research_versions')){const r=db.prepare('SELECT topic_id,version,payload FROM research_versions ORDER BY recorded_at,topic_id,version LIMIT 1').get();if(r)anchor={table:'research_versions',topicId:r.topic_id,version:r.version,hash:digest(r.payload)};}
  if(!anchor&&tables.includes('paper_versions')){const r=db.prepare('SELECT version,payload FROM paper_versions ORDER BY version LIMIT 1').get();if(r)anchor={table:'paper_versions',version:r.version,hash:digest(r.payload)};}
  if(!anchor)fail('缺少不可变研究或账本历史身份');
  const counts=Object.fromEntries(tables.map(n=>[n,db.prepare('SELECT COUNT(*) n FROM "'+n.replaceAll('"','""')+'"').get().n]));
  return {mode:db.prepare("SELECT value FROM settings WHERE key='runtime_mode'").get()?.value||'legacy',anchor,counts};
 }finally{db.close();}
}
async function describe(directory){
 const stat=await regular(directory,true),names=(await readdir(directory)).sort();if(!same(names,['manifest.json','workbench.sqlite']))fail('备份包含缺失或未知文件');
 const mp=join(directory,'manifest.json'),dp=join(directory,'workbench.sqlite'),ms=await regular(mp),ds=await regular(dp);if(ms.size>1048576)fail('备份清单过大');
 const raw=await readFile(mp,'utf8'),manifest=JSON.parse(raw),metadata=inspect(dp);
 if(manifest.format!==1||manifest.database!=='workbench.sqlite'||manifest.mode!==metadata.mode||!same(manifest.counts,metadata.counts))fail('备份清单与数据库不符');
 // previewStorageRetention has verified full DB SHA; recheck when staging, too.
 const {createReadStream}=await import('node:fs');const hash=createHash('sha256');for await(const chunk of createReadStream(dp))hash.update(chunk);if(hash.digest('hex')!==manifest.sha256)fail('备份指纹已变化');
 return {directory,identity:id(stat),files:{manifest:id(ms),database:id(ds)},manifestHash:digest(raw),databaseHash:manifest.sha256,bytes:ms.size+ds.size,createdAt:new Date(manifest.createdAt).toISOString(),mode:metadata.mode,anchor:metadata.anchor};
}
export async function planBackupPrune(databasePath,backupRoot,{policy:input={},now=Date.now()}={}){
 if(!Number.isFinite(now))fail('计划时间无效');const policy=retentionPolicy(input),database=await realpath(resolve(databasePath)),root=await realpath(resolve(backupRoot));
 const dbStat=await regular(database),rootStat=await regular(root,true),identity=inspect(database),preview=await previewStorageRetention(database,root,{policy,now});
 const matching=[],protectedSnapshots=[];
 for(const row of preview.snapshots.sort((a,b)=>a.directory.localeCompare(b.directory))){
  if(!row.verified){protectedSnapshots.push({directory:row.directory,reason:row.reason});continue;}
  try{const s=await describe(row.directory);if(inside(row.directory,database)||same(s.files.database,id(dbStat)))fail('活动数据库不能清理');if(s.mode!==identity.mode||!same(s.anchor,identity.anchor))fail('不同数据集或历史身份未知');matching.push(s);}
  catch(error){protectedSnapshots.push({directory:row.directory,reason:error.message});}
 }
 matching.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.directory.localeCompare(b.directory));
 const eligible=matching.filter((s,i)=>i>=policy.keepNewest&&now-Date.parse(s.createdAt)>policy.maxAgeDays*86400000).reverse().slice(0,100),selected=new Set(eligible.map(s=>s.directory));
 const body={format:'backup-prune/1',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+900000).toISOString(),database,databaseIdentity:id(dbStat),dataset:{mode:identity.mode,anchor:identity.anchor},backupRoot:root,rootIdentity:id(rootStat),policy,candidates:eligible,retained:matching.filter(s=>!selected.has(s.directory)),protectedSnapshots};
 return {...body,planHash:digest(body),candidateBytes:eligible.reduce((n,s)=>n+s.bytes,0),automaticDeletion:false};
}
export async function executeBackupPrune(plan,{confirmation,receiptPath,now=Date.now()}={}){
 if(!plan||confirmation!==plan.planHash||plan.format!=='backup-prune/1'||!Number.isFinite(now)||now<Date.parse(plan.createdAt)||now>Date.parse(plan.expiresAt))fail('需确认未过期的准确清理计划指纹');
 const fresh=await planBackupPrune(plan.database,plan.backupRoot,{policy:plan.policy,now:Date.parse(plan.createdAt)});
 if(!same(fresh,plan))fail('计划或备份已变化，请重新预览');if(!plan.candidates.length)fail('没有符合条件的清理候选');
 const receipt=join(await realpath(dirname(resolve(receiptPath||''))),basename(receiptPath||''));if(!receiptPath||inside(plan.backupRoot,receipt)||receipt===plan.database)fail('回执必须是备份目录外的全新文件');
 const lock=join(plan.backupRoot,'.prune-lock'),staged=join(lock,'staged');await mkdir(lock,{mode:0o700});let fd=null,deleted=false,finished=false;
 const state={format:1,planHash:plan.planHash,createdAt:new Date(now).toISOString(),phase:'validating',plan,moved:[],removed:[],removedFileBytes:0};
 const save=()=>{
  const temp=receipt+'.'+randomUUID()+'.tmp';let output=null;
  try{output=openSync(temp,'wx',0o600);writeFileSync(output,JSON.stringify(state,null,2)+'\n','utf8');fsyncSync(output);closeSync(output);output=null;renameSync(temp,receipt);}
  finally{if(output!==null)closeSync(output);try{unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
 };
 try{
  fd=openSync(receipt,'wx',0o600);save();
  const recheck=await planBackupPrune(plan.database,plan.backupRoot,{policy:plan.policy,now:Date.parse(plan.createdAt)});if(!same(recheck,plan))fail('计划或备份已变化，请重新预览');
  await mkdir(staged,{mode:0o700});
  for(const s of plan.candidates){const destination=join(staged,basename(s.directory));await rename(s.directory,destination);state.moved.push({from:s.directory,to:destination});save();}
  state.phase='staged';save();
  for(const [i,s] of plan.candidates.entries()){const actual=await describe(state.moved[i].to);if(!same({...actual,directory:s.directory},s))fail('隔离后的备份与计划不符，停止清理');}
  state.phase='deleting';save();
  for(const [i,s] of plan.candidates.entries()){
   const path=state.moved[i].to,actual=await describe(path);if(!same({...actual,directory:s.directory},s))fail('备份已变化，停止后续清理');
   // Fixed filenames only. Never recursively delete a directory or unknown files.
   await unlink(join(path,'workbench.sqlite'));deleted=true;state.removed.push({directory:s.directory,file:'workbench.sqlite'});save();
   await unlink(join(path,'manifest.json'));state.removed.push({directory:s.directory,file:'manifest.json'});state.removedFileBytes+=s.bytes;save();await rmdir(path);
  }
  await rmdir(staged);await rmdir(lock);state.phase='completed';state.finishedAt=new Date().toISOString();save();finished=true;return state;
 }catch(error){
  state.phase=deleted?'partial-deletion':'failed-before-deletion';state.error=error.message;state.recoveryDirectory=lock;
  if(!deleted){let restored=true;for(const move of [...state.moved].reverse()){try{await lstat(move.from);restored=false;}catch(e){if(e.code==='ENOENT'){try{await rename(move.to,move.from);}catch{restored=false;}}else restored=false;}}
   if(restored){try{await rmdir(staged);}catch(e){if(e.code!=='ENOENT')restored=false;}if(restored){await rmdir(lock);state.recoveryDirectory=null;}}
  }
  if(fd!==null)save();throw Object.assign(new Error('清理未完成；检查回执和隔离目录，禁止直接删除未知残留'),{cause:error,receiptPath:receipt,recoveryDirectory:state.recoveryDirectory});
 }finally{if(fd!==null)closeSync(fd);if(!finished&&fd===null){try{await rmdir(lock);}catch{}}}
}
