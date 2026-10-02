import {lstat,readdir,readFile,statfs} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
export const DEFAULT_RETENTION_POLICY=Object.freeze({keepNewest:10,maxAgeDays:30,maxBackupBytes:1024**3,minFreeBytes:1024**3,automaticDeletion:false});
export function retentionPolicy(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('保留策略必须是对象');
 if(Object.keys(input).some(key=>!Object.hasOwn(DEFAULT_RETENTION_POLICY,key)))throw new Error('未知保留策略字段');
 const policy={...DEFAULT_RETENTION_POLICY,...input};
 if(policy.automaticDeletion!==false)throw new Error('本版本仅支持只读预览，自动删除必须关闭');
 for(const key of ['keepNewest','maxAgeDays','maxBackupBytes','minFreeBytes'])if(!Number.isSafeInteger(policy[key])||policy[key]<1)throw new Error('保留策略数值必须是正安全整数');
 return policy;
}
async function regular(path){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('不是普通文件');return stat;}
async function fingerprint(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function previewStorageRetention(databasePath,backupRoot,{policy:input={},now=Date.now()}={}){
 const policy=retentionPolicy(input);if(!Number.isFinite(now))throw new Error('预览时间无效');
 const database=resolve(databasePath),root=resolve(backupRoot),dbStat=await regular(database),warnings=[],snapshots=[];
 let databaseBytes=dbStat.size;
 for(const suffix of ['-wal','-shm'])try{databaseBytes+=(await regular(database+suffix)).size;}catch(error){if(error.code!=='ENOENT')warnings.push({kind:'database-sidecar-unreadable',file:database+suffix});}
 let freeBytes=null;try{const fs=await statfs(dirname(database));freeBytes=fs.bavail*fs.bsize;}catch{warnings.push({kind:'free-space-unavailable'});}
 let entries=[];try{const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('备份根路径必须是普通目录');entries=await readdir(root,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;warnings.push({kind:'backup-root-missing'});}
 let observedBackupBytes=0,unmeasuredEntries=0;
 for(const entry of entries){
  const directory=join(root,entry.name);
  if(!entry.isDirectory()||entry.isSymbolicLink()||!entry.name.startsWith('snapshot-')){unmeasuredEntries++;continue;}
  const record={directory,bytes:0,createdAt:null,verified:false,candidate:false,reason:'unverified'};
  try{
   const names=await readdir(directory);if(names.some(name=>!['manifest.json','workbench.sqlite'].includes(name)))throw new Error('备份目录含未知文件');
   const manifestPath=join(directory,'manifest.json'),file=join(directory,'workbench.sqlite');const manifestStat=await regular(manifestPath);if(manifestStat.size>1024*1024)throw new Error('清单过大');const fileStat=await regular(file);
   record.bytes=manifestStat.size+fileStat.size;observedBackupBytes+=record.bytes;
   const manifest=JSON.parse(await readFile(manifestPath,'utf8')),created=Date.parse(manifest.createdAt);
   if(manifest.format!==1||manifest.database!=='workbench.sqlite'||!Number.isFinite(created)||created>now||!/^[a-f0-9]{64}$/.test(manifest.sha256??''))throw new Error('清单或时间无效');
   if(await fingerprint(file)!==manifest.sha256)throw new Error('备份指纹不匹配');
   record.createdAt=new Date(created).toISOString();record.verified=true;record.reason='retained';
  }catch(error){record.reason=error.message;unmeasuredEntries++;}
  snapshots.push(record);
 }
 const verified=snapshots.filter(s=>s.verified).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.directory.localeCompare(b.directory));
 verified.forEach((snapshot,index)=>{snapshot.candidate=index>=policy.keepNewest&&now-Date.parse(snapshot.createdAt)>policy.maxAgeDays*86400000;snapshot.reason=snapshot.candidate?'older-than-age-and-newest-reserve':index<policy.keepNewest?'newest-reserve':'within-age';});
 if(unmeasuredEntries)warnings.push({kind:'partial-capacity-measurement',entries:unmeasuredEntries});
 if(observedBackupBytes>policy.maxBackupBytes)warnings.push({kind:'backup-capacity-exceeded'});
 if(freeBytes!==null&&freeBytes<policy.minFreeBytes)warnings.push({kind:'low-free-space'});
 return {dryRun:true,automaticDeletion:false,policy,database,databaseBytes,backupRoot:root,observedBackupBytes,capacityComplete:unmeasuredEntries===0,freeBytes,snapshots,candidateBytes:verified.filter(s=>s.candidate).reduce((sum,s)=>sum+s.bytes,0),warnings,limitations:['Preview performs no deletion or migration. Unknown or invalid entries are always retained.','SHA verification does not replace database integrity and restore verification.','Capacity counts only measured files and may change during concurrent backup activity.']};
}
