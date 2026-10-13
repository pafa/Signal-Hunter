import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createReadStream,lstatSync,readdirSync,statfsSync,renameSync,unlinkSync,rmdirSync,existsSync,realpathSync} from 'node:fs';
import {mkdir,realpath,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,relative,basename} from 'node:path';
import {backupDataset} from './backup-dataset.mjs';
import {createBackup,inspectBackupDatabase} from './backup.mjs';

export const DEFAULT_BACKUP_POLICY=Object.freeze({keepNewest:3,maxBackups:10,maxAgeDays:7,maxBackupBytes:6*1024**3,minFreeBytes:10*1024**3});
const METADATA_RESERVE=1024*1024,LOCK='.prune-lock';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const inside=(parent,path)=>{const r=relative(parent,path);return !r||r!=='..'&&!r.startsWith('../')&&!r.startsWith('/');};
const fingerprint=s=>({dev:s.dev,ino:s.ino,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs});
const identity=s=>({dev:s.dev,ino:s.ino});
const fail=message=>{throw new Error(message);};
export function backupPolicy(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(DEFAULT_BACKUP_POLICY,k)))fail('备份策略字段无效');
 const policy={...DEFAULT_BACKUP_POLICY,...input};
 for(const value of Object.values(policy))if(!Number.isSafeInteger(value)||value<1)fail('备份策略必须使用正安全整数');
 if(policy.keepNewest<3||policy.maxBackups<=policy.keepNewest)fail('至少保护3份备份，数量上限必须留出新增副本的位置');
 return policy;
}
export async function loadBackupPolicy(path){return backupPolicy(path?JSON.parse(await readFile(path,'utf8')):{});}
export function backupOwnerId(database){
 // A restored/forked database can share the first immutable history row. That
 // alone must never authorize deleting another instance's later history.
 const path=realpathSync(database),s=regular(path);
 return createHash('sha256').update(JSON.stringify([path,s.dev,s.ino])).digest('hex');
}
function regular(path,directory=false){
 const s=lstatSync(path);
 if(s.isSymbolicLink()||!(directory?s.isDirectory():s.isFile())||!directory&&s.nlink!==1)fail('拒绝符号链接、硬链接或非普通文件');
 return s;
}
function measure(root){
 let bytes=0,complete=true,entries=0;const stack=[root];
 while(stack.length){
  if(++entries>10000)fail('备份目录超过10000个条目，停止新增并人工检查');
  const path=stack.pop(),s=lstatSync(path);
  if(s.isSymbolicLink()){complete=false;bytes+=s.size;}
  else if(s.isDirectory())for(const name of readdirSync(path))stack.push(join(path,name));
  else if(s.isFile())bytes+=s.size;
  else complete=false;
 }
 return {bytes,complete};
}
export function backupFreeBytes(root){const s=statfsSync(root);return s.bavail*s.bsize;}
export async function openBackupFiles(root,{signal}={}){
 // A running old instance may still hold a snapshot open. Failure to inspect
 // processes is a reason to stop, never permission to delete those files.
 let stdout;
 try{({stdout}=await promisify(execFile)('lsof',['-nP','-Fn','+D',root],{encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024,signal}));}
 catch(error){if(error.code===1&&!error.stderr?.trim())stdout=error.stdout||'';else throw new Error('无法确认备份是否正在使用；需要可用的 lsof，已停止自动清理',{cause:error});}
 return new Set(stdout.split('\n').filter(s=>s.startsWith('n')).map(s=>s.slice(1)));
}
const inUse=(directory,paths)=>[...paths].some(path=>inside(directory,path));
async function describe(directory,{signal}={}){
 signal?.throwIfAborted();const ds=regular(directory,true);
 if(!same(readdirSync(directory).sort(),['manifest.json','workbench.sqlite']))fail('内容不完整、已固定保留或含未知文件');
 const mp=join(directory,'manifest.json'),file=join(directory,'workbench.sqlite'),ms=regular(mp),fs=regular(file);
 if(ms.size>METADATA_RESERVE)fail('清单过大');
 const raw=await readFile(mp,'utf8'),manifest=JSON.parse(raw);
 if(manifest.format!==1||manifest.database!=='workbench.sqlite'||!/^[a-f0-9]{64}$/.test(manifest.sha256||'')||!Number.isFinite(Date.parse(manifest.createdAt)))fail('清单无效');
 const hash=createHash('sha256');for await(const chunk of createReadStream(file,{signal}))hash.update(chunk);
 if(hash.digest('hex')!==manifest.sha256)fail('指纹不匹配');
 const actual=inspectBackupDatabase(file,{foreignKeys:true}),dataset=backupDataset(file);
 if(!same(actual.counts,manifest.counts)||actual.mode!==manifest.mode||!dataset)fail('清单或数据集身份无法核实');
 if(!same(fingerprint(ms),fingerprint(regular(mp)))||!same(fingerprint(fs),fingerprint(regular(file)))||!same(readdirSync(directory).sort(),['manifest.json','workbench.sqlite']))fail('检查期间备份发生变化');
 return {directory,bytes:ms.size+fs.size,createdAt:manifest.createdAt,dataset,ownerId:manifest.ownerId??null,identity:identity(ds),files:{manifest:fingerprint(ms),database:fingerprint(fs)},sha256:manifest.sha256};
}
function assertSnapshotFiles(snapshot,directory=snapshot.directory){
 if(!same(identity(regular(directory,true)),snapshot.identity)||!same(readdirSync(directory).sort(),['manifest.json','workbench.sqlite'])||!same(fingerprint(regular(join(directory,'manifest.json'))),snapshot.files.manifest)||!same(fingerprint(regular(join(directory,'workbench.sqlite'))),snapshot.files.database))fail('备份文件已变化，停止清理');
}
async function locations(databasePath,backupRoot,{create=false}={}){
 const source=resolve(databasePath);regular(source);
 if(create)await mkdir(backupRoot,{recursive:true,mode:0o700});
 regular(resolve(backupRoot),true);
 const database=await realpath(source),root=await realpath(resolve(backupRoot));
 if(inside(root,database))fail('活动数据库不能位于自动清理目录内');
 return {database,root,rootIdentity:identity(regular(root,true)),databaseIdentity:identity(regular(database)),ownerId:backupOwnerId(database)};
}
function assertLocations(scope){
 if(!same(identity(regular(scope.root,true)),scope.rootIdentity)||!same(identity(regular(scope.database)),scope.databaseIdentity))fail('活动库或备份根目录已变化');
}
async function scan(scope,{signal,probeOpenFiles=openBackupFiles,freeSpace=backupFreeBytes,now=Date.now()}={}){
 signal?.throwIfAborted();assertLocations(scope);
 const usage=measure(scope.root),paths=await probeOpenFiles(scope.root,{signal}),dataset=backupDataset(scope.database),snapshots=[],protectedEntries=[];
 let count=0;
 for(const name of readdirSync(scope.root).sort()){
  if(name===LOCK)continue;
  const directory=join(scope.root,name);
  if(name.startsWith('snapshot-')||name.startsWith('.backup-'))count++;
  try{
   if(!/^snapshot-[a-zA-Z0-9]+$/.test(name))fail('非日常备份条目');
   if(inUse(directory,paths))fail('正在被进程使用');
   const snapshot=await describe(directory,{signal});
   if(Date.parse(snapshot.createdAt)>now)fail('备份时间在未来');
   if(!dataset||!same(snapshot.dataset,dataset))fail('其他数据集或身份未知');
   if(snapshot.ownerId!==scope.ownerId)fail('其他数据库文件或未标明归属的历史备份');
   snapshots.push(snapshot);
  }catch(error){signal?.throwIfAborted();protectedEntries.push({directory,reason:error.message});}
 }
 const freeBytes=freeSpace(scope.root);if(!Number.isSafeInteger(freeBytes)||freeBytes<0)fail('无法读取可用磁盘空间');
 snapshots.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.directory.localeCompare(b.directory));
 return {snapshots,protectedEntries,dataset,bytes:usage.bytes,capacityComplete:usage.complete,count,freeBytes};
}
function select(scan,policy,{now,incomingBytes=0,incomingCount=0}){
 let bytes=scan.bytes+incomingBytes,count=scan.count+incomingCount,freeBytes=scan.freeBytes-incomingBytes;
 const retained=scan.snapshots.slice(0,policy.keepNewest),removed=[];
 for(const s of scan.snapshots.slice(policy.keepNewest).reverse()){
  if(now-Date.parse(s.createdAt)>policy.maxAgeDays*86400000||count>policy.maxBackups||bytes>policy.maxBackupBytes||freeBytes<policy.minFreeBytes){removed.push(s);bytes-=s.bytes;count--;freeBytes+=s.bytes;}
  else retained.push(s);
 }
 const blocked=[];
 if(!scan.capacityComplete)blocked.push('备份目录含无法计量的条目');
 if(count>policy.maxBackups)blocked.push('受保护副本使数量超限');
 if(bytes>policy.maxBackupBytes)blocked.push('受保护副本或新备份使容量超限');
 if(freeBytes<policy.minFreeBytes)blocked.push('磁盘剩余空间低于安全下限');
 return {removed,retained,blocked,projectedBytes:bytes,projectedCount:count};
}
function estimate(database){
 const db=new DatabaseSync(database,{readOnly:true});try{return db.prepare('PRAGMA page_count').get().page_count*db.prepare('PRAGMA page_size').get().page_size+METADATA_RESERVE;}finally{db.close();}
}
export async function previewManagedBackups(databasePath,backupRoot,options={}){
 const scope=await locations(databasePath,backupRoot),policy=backupPolicy(options.policy),now=options.now??Date.now(),usage=await scan(scope,{...options,now});
 if(!Number.isFinite(now))fail('备份检查时间无效');
 const incomingBytes=options.creating?estimate(scope.database):0,plan=select(usage,policy,{now,incomingBytes,incomingCount:Number(!!options.creating)});
 return {dryRun:true,policy,backupRoot:scope.root,usage,candidates:plan.removed,retained:plan.retained,blocked:plan.blocked,incomingBytes,projectedBytes:plan.projectedBytes,projectedCount:plan.projectedCount};
}
async function removeSelected(scope,plan,{signal,assertActive=()=>{},probeOpenFiles=openBackupFiles}={},removed=[]){
 if(!plan.removed.length)return [];
 assertActive();signal?.throwIfAborted();assertLocations(scope);
 // Re-verify all protected recovery copies before touching the oldest files.
 for(const s of plan.retained)if(!same(await describe(s.directory,{signal}),s))fail('保留的恢复副本已变化，停止清理');
 const paths=await probeOpenFiles(scope.root,{signal});
 for(const s of plan.removed){
  assertActive();signal?.throwIfAborted();assertLocations(scope);
  if(inUse(s.directory,paths)||!same(await describe(s.directory,{signal}),s))fail('待清理备份已变化或正在使用');
  const staged=join(scope.root,LOCK,basename(s.directory));let deleted=false;
  renameSync(s.directory,staged);
  try{
   const current=await describe(staged,{signal});
   if(!same({...current,directory:s.directory},s))fail('隔离后的备份已变化');
   const open=await probeOpenFiles(scope.root,{signal});
   if(inUse(staged,open)||inUse(s.directory,open))fail('备份正在使用');
   assertActive();signal?.throwIfAborted();assertLocations(scope);
   if(!same(backupDataset(scope.database),plan.dataset))fail('活动数据集身份已变化，停止清理');
   for(const reserved of plan.retained)assertSnapshotFiles(reserved);
   assertSnapshotFiles(s,staged);
   // Fixed files only; never recursively delete user data or unknown contents.
   unlinkSync(join(staged,'workbench.sqlite'));deleted=true;
   unlinkSync(join(staged,'manifest.json'));rmdirSync(staged);
   removed.push({directory:s.directory,bytes:s.bytes,sha256:s.sha256});
  }catch(error){
   if(!deleted&&!existsSync(s.directory))renameSync(staged,s.directory);
   throw error;
  }
 }
 return removed;
}
async function managed(databasePath,backupRoot,options,creating){
 const policy=backupPolicy(options.policy),now=options.now??Date.now();
 if(!Number.isFinite(now))fail('备份检查时间无效');
 const scope=await locations(databasePath,backupRoot,{create:true}),lock=join(scope.root,LOCK),signal=options.signal;
 signal?.throwIfAborted();options.assertActive?.();
 try{await mkdir(lock,{mode:0o700});}catch(error){if(error.code==='EEXIST')fail('已有备份/清理任务或未完成的隔离目录，停止新增；请检查 .prune-lock');throw error;}
 const removed=[];
 try{
  await writeFile(join(lock,'owner.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
  const usage=await scan(scope,{...options,now}),incomingBytes=creating?estimate(scope.database):0;
  const plan={...select(usage,policy,{now,incomingBytes,incomingCount:Number(creating)}),dataset:usage.dataset};
  if(creating&&plan.blocked.length)fail('已停止新增备份：'+plan.blocked.join('；'));
  await removeSelected(scope,plan,options,removed);
  const result={policy,removed,protectedEntries:usage.protectedEntries,blocked:plan.blocked};
  if(!creating)return {...result,bytes:measure(scope.root).bytes,freeBytes:(options.freeSpace||backupFreeBytes)(scope.root)};
  const freeSpace=options.freeSpace||backupFreeBytes;
  const guard=({totalBytes,remainingBytes,target})=>{
   options.assertActive?.();signal?.throwIfAborted();assertLocations(scope);
   const current=measure(scope.root),written=existsSync(target)?lstatSync(target).size:0;
   if(readdirSync(scope.root).filter(name=>name.startsWith('snapshot-')||name.startsWith('.backup-')).length>policy.maxBackups)fail('备份数量达到上限，已中止新增');
   if(!current.complete||current.bytes+Math.max(0,totalBytes-written)+METADATA_RESERVE>policy.maxBackupBytes)fail('备份容量达到上限，已中止新增');
   if(freeSpace(scope.root)-Math.max(remainingBytes,totalBytes-written)-METADATA_RESERVE<policy.minFreeBytes)fail('磁盘剩余空间低于安全下限，已中止新增');
  };
  const snapshot=await createBackup(scope.database,scope.root,{signal,checkBudget:guard,ownerId:scope.ownerId});
  return {...snapshot,retention:{...result,bytes:measure(scope.root).bytes,freeBytes:freeSpace(scope.root)}};
 }catch(error){
  error.retention={policy,removed,recoveryDirectory:readdirSync(lock).some(name=>name!=='owner.json')?lock:null};
  throw error;
 }finally{
  // A partial deletion or crash leaves a visible lock for manual recovery;
  // no subsequent run may accumulate new backups behind it.
  if(same(readdirSync(lock).sort(),['owner.json'])){unlinkSync(join(lock,'owner.json'));rmdirSync(lock);}
 }
}
export const createManagedBackup=(database,root,options={})=>managed(database,root,options,true);
export const maintainBackups=(database,root,options={})=>managed(database,root,options,false);
