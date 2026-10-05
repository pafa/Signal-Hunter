import {mkdtempSync,mkdirSync,chmodSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {restoreBackup} from './backup.mjs';
import {inventoryDatabase,compareInventories,summarizeInventory} from './database-inventory.mjs';
import {openStore} from './store.mjs';
import {createService} from './service.mjs';
import {checkDatabaseFile,assertDatabaseMode} from './runtime.mjs';

// Input is an existing immutable snapshot, never a live research database.
export async function rehearseRecovery(snapshotDirectory,outputRoot,{candidate=null,initialize=createService}={}){
 const snapshot=resolve(snapshotDirectory),manifest=JSON.parse(readFileSync(join(snapshot,'manifest.json'),'utf8'));
 if(manifest.format!==1||manifest.database!=='workbench.sqlite')throw new Error('备份格式无效');
 const source=join(snapshot,'workbench.sqlite'),sha=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
 if(sha()!==manifest.sha256)throw new Error('备份指纹不匹配');
 mkdirSync(outputRoot,{recursive:true,mode:0o700});
 const directory=mkdtempSync(join(resolve(outputRoot),'rehearsal-'));chmodSync(directory,0o700);
 const report={format:1,createdAt:new Date().toISOString(),directory,candidate,backupSha256:manifest.sha256,passed:false,
  scope:'隔离恢复、候选初始化、读取和暂停周期；回退为升级前快照的独立恢复，不含旧程序运行、原库切换或长期验收'};
 let store,service,networkAttempts=0;
 try{
  const original=inventoryDatabase(source),expected=inventoryDatabase(source,{restoreProjection:true});
  report.original=summarizeInventory(original);
  const target=join(directory,'candidate.sqlite');restoreBackup(snapshot,target);
  const restored=inventoryDatabase(target);report.restore=compareInventories(expected,restored);
  // Keep the rollback evidence even when candidate initialization throws.
  const rollback=join(directory,'rollback.sqlite');restoreBackup(snapshot,rollback);
  report.rollback=compareInventories(expected,inventoryDatabase(rollback));
  checkDatabaseFile({dbPath:target,mode:manifest.mode});
  store=openStore(target);assertDatabaseMode(store,manifest.mode);
  service=initialize(store,{mode:manifest.mode,fetcher:()=>{networkAttempts++;throw new Error('恢复演练禁止联网');}});
  const afterStartup=inventoryDatabase(target);report.startup=compareInventories(restored,afterStartup,{allowAdditions:true});
  report.health=service.health();service.snapshot();await service.tick();service.snapshot();
  report.tasksPaused=Object.values(service.operations().tasks).every(t=>t.paused);
  await service.close();service=null;store.close();store=null;
  report.idle=compareInventories(afterStartup,inventoryDatabase(target));
  report.snapshotUnchanged=sha()===manifest.sha256;report.networkAttempts=networkAttempts;
  report.passed=report.restore.passed&&report.startup.passed&&report.idle.passed&&report.rollback.passed&&report.snapshotUnchanged&&report.health.restoreReviewRequired&&report.tasksPaused&&networkAttempts===0;
 }catch(error){report.failure={message:String(error.message).slice(0,300)};}
 finally{
  try{if(service)await service.close();}finally{if(store)store.close();}
  writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 }
 return report;
}
