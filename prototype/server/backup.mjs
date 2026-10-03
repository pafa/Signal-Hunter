import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,constants,existsSync,chmodSync,lstatSync,linkSync,rmSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {inventoryDatabase,compareInventories} from './database-inventory.mjs';
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function inspect(path){
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('数据库完整性校验失败');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const counts=Object.fromEntries(tables.map(name=>[name,db.prepare('SELECT COUNT(*) n FROM "'+name.replaceAll('"','""')+'"').get().n]));
  const mode=tables.includes('settings')?db.prepare("SELECT value FROM settings WHERE key='runtime_mode'").get()?.value||'legacy':null;
  if(!tables.includes('news')||!mode)throw new Error('不是工作台数据库');
  return {mode,counts};
 }finally{db.close();}
}
export async function createBackup(sourcePath,destinationRoot){
 if(!existsSync(sourcePath))throw new Error('源数据库不存在');
 mkdirSync(destinationRoot,{recursive:true,mode:0o700});
 const dir=mkdtempSync(join(resolve(destinationRoot),'snapshot-'));chmodSync(dir,0o700);
 const target=join(dir,'workbench.sqlite'),source=new DatabaseSync(sourcePath,{readOnly:true});
 try{await backup(source,target);}finally{source.close();}
 // Finalize the newly created standalone snapshot before hashing it.
 // Read-only inspection of a WAL-mode database otherwise creates sidecars.
 const snapshot=new DatabaseSync(target);try{snapshot.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');}finally{snapshot.close();}
 chmodSync(target,0o600);
 const manifest={format:1,createdAt:new Date().toISOString(),database:'workbench.sqlite',sha256:digest(target),...inspect(target)};
 writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
 return {directory:dir,...manifest};
}
export function restoreBackup(directory,targetPath){
 const dir=resolve(directory),manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
 if(manifest.format!==1||manifest.database!=='workbench.sqlite')throw new Error('备份格式无效');
 const source=join(dir,'workbench.sqlite'),target=resolve(targetPath);
 if(digest(source)!==manifest.sha256)throw new Error('备份指纹不匹配');
 const actual=inspect(source);
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
   if(actual.counts.operation_tasks!==undefined)db.exec("UPDATE operation_tasks SET paused=1,token=NULL,lease_until=NULL,state='waiting'");
   if(actual.counts.operation_runs!==undefined)db.exec("UPDATE operation_runs SET outcome='interrupted' WHERE outcome='running'");
   db.prepare("INSERT INTO settings(key,value) VALUES('restore_review_required','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
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
