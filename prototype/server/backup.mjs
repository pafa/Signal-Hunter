import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,copyFileSync,constants,existsSync,chmodSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
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
 if([target,target+'-wal',target+'-shm'].some(existsSync))throw new Error('恢复目标必须是全新路径，绝不覆盖已有库');
 mkdirSync(dirname(target),{recursive:true,mode:0o700});
 copyFileSync(source,target,constants.COPYFILE_EXCL);chmodSync(target,0o600);
 // A restored worker must never immediately resume acquisition or future execution.
 const db=new DatabaseSync(target);
 try{
  if(actual.counts.operation_tasks!==undefined){
   db.exec("UPDATE operation_tasks SET paused=1,token=NULL,lease_until=NULL,state='waiting'; UPDATE operation_runs SET outcome='interrupted' WHERE outcome='running'");
  }
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('restore_review_required','1')").run();
 }finally{db.close();}
 return {target,mode:actual.mode,reviewRequired:true};
}
