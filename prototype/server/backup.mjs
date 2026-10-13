import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,constants,existsSync,chmodSync,lstatSync,linkSync,rmSync,renameSync,unlinkSync,rmdirSync,createReadStream} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {inventoryDatabase,compareInventories} from './database-inventory.mjs';
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
export function inspectBackupDatabase(path,{foreignKeys=false}={}){
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  db.exec('BEGIN');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('数据库完整性校验失败');
  if(foreignKeys&&db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('数据库外键校验失败');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const counts=Object.fromEntries(tables.map(name=>[name,db.prepare('SELECT COUNT(*) n FROM "'+name.replaceAll('"','""')+'"').get().n]));
  const mode=tables.includes('settings')?db.prepare("SELECT value FROM settings WHERE key='runtime_mode'").get()?.value||'legacy':null;
  if(!tables.includes('news')||!mode)throw new Error('不是工作台数据库');
  return {mode,counts};
 }finally{db.close();}
}
export async function createBackup(sourcePath,destinationRoot,{signal,checkBudget=()=>{},ownerId}={}){
 signal?.throwIfAborted();
 if(ownerId!==undefined&&!/^[a-f0-9]{64}$/.test(ownerId))throw new Error('备份归属标识无效');
 if(!existsSync(sourcePath))throw new Error('源数据库不存在');
 mkdirSync(destinationRoot,{recursive:true,mode:0o700});
 // Incomplete copies are never advertised as restorable snapshots.
 const dir=mkdtempSync(join(resolve(destinationRoot),'.backup-'));chmodSync(dir,0o700);
 const target=join(dir,'workbench.sqlite');let published=false;
 try{
  const source=new DatabaseSync(sourcePath,{readOnly:true});
  try{
   const pageSize=source.prepare('PRAGMA page_size').get().page_size;
   const guard=({totalPages=source.prepare('PRAGMA page_count').get().page_count,remainingPages=0}={})=>{
    signal?.throwIfAborted();checkBudget({totalBytes:totalPages*pageSize,remainingBytes:remainingPages*pageSize,target});return 100;
   };
   guard();await backup(source,target,{rate:100,progress:guard});guard();
  }finally{source.close();}
  // Finalize the standalone snapshot before hashing; read-only inspection of a
  // WAL-mode file otherwise creates sidecars.
  const snapshot=new DatabaseSync(target);try{snapshot.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');}finally{snapshot.close();}
  chmodSync(target,0o600);
  const hash=createHash('sha256');for await(const chunk of createReadStream(target,{signal}))hash.update(chunk);
  const manifest={format:1,createdAt:new Date().toISOString(),database:'workbench.sqlite',sha256:hash.digest('hex'),...inspectBackupDatabase(target),...(ownerId?{ownerId}:{})};
  writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  signal?.throwIfAborted();checkBudget({totalBytes:lstatSync(target).size,remainingBytes:0,target});
  const directory=join(resolve(destinationRoot),'snapshot-'+dir.slice(-6));
  try{lstatSync(directory);throw new Error('备份目标已存在');}catch(error){if(error.code!=='ENOENT')throw error;}
  renameSync(dir,directory);published=true;return {directory,...manifest};
 }finally{
  if(!published){
   // Only files produced by this call. Unknown contents are retained for review.
   for(const name of ['workbench.sqlite','workbench.sqlite-wal','workbench.sqlite-shm','workbench.sqlite-journal','manifest.json'])try{unlinkSync(join(dir,name));}catch(error){if(error.code!=='ENOENT')throw error;}
   rmdirSync(dir);
  }
 }
}
export function restoreBackup(directory,targetPath){
 const dir=resolve(directory),manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
 if(manifest.format!==1||manifest.database!=='workbench.sqlite')throw new Error('备份格式无效');
 const source=join(dir,'workbench.sqlite'),target=resolve(targetPath);
 if(digest(source)!==manifest.sha256)throw new Error('备份指纹不匹配');
 const actual=inspectBackupDatabase(source);
 if(actual.mode!==manifest.mode||JSON.stringify(actual.counts)!==JSON.stringify(manifest.counts))throw new Error('备份内容与清单不一致');
 const occupied=path=>{try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 const assertFresh=()=>{if([target,target+'-wal',target+'-shm',target+'-journal'].some(occupied))throw new Error('恢复目标必须是全新路径，绝不覆盖已有库');};
 assertFresh();mkdirSync(dirname(target),{recursive:true,mode:0o700});
 const staging=mkdtempSync(join(dirname(target),'.restore-'));chmodSync(staging,0o700);
 const staged=join(staging,'workbench.sqlite');
 try{
  copyFileSync(source,staged,constants.COPYFILE_EXCL);chmodSync(staged,0o600);
  if(digest(staged)!==manifest.sha256)throw new Error('复制期间备份指纹改变');
  const expected=inventoryDatabase(staged,{restoreProjection:true});
  const db=new DatabaseSync(staged);
  try{
   db.exec('BEGIN IMMEDIATE');
   db.prepare("INSERT INTO settings(key,value) VALUES('restore_review_required','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
   if(actual.counts.operation_tasks!==undefined)db.exec("UPDATE operation_tasks SET paused=1,token=NULL,lease_until=NULL,state='waiting'");
   if(actual.counts.operation_runs!==undefined)db.exec("UPDATE operation_runs SET outcome='interrupted' WHERE outcome='running'");
   db.exec('COMMIT');
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
  const verification=compareInventories(expected,inventoryDatabase(staged));
  if(!verification.passed)throw new Error('恢复核验失败：除任务暂停与核对标记外，数据必须保持一致');
  assertFresh();
  // Publish only the verified, closed database. linkSync fails if another writer
  // claimed the target meanwhile; no existing destination can be overwritten.
  linkSync(staged,target);
  return {target,mode:actual.mode,reviewRequired:true,verified:true};
 }finally{rmSync(staging,{recursive:true,force:true});}
}
