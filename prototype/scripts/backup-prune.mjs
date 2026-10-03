import {readFile,writeFile} from 'node:fs/promises';
import {planBackupPrune,executeBackupPrune} from '../server/backup-prune.mjs';
const [command,...args]=process.argv.slice(2);
try{
 if(command==='plan'&&(args.length===3||args.length===4)){
  const [database,backups,output,policyFile]=args,policy=policyFile?JSON.parse(await readFile(policyFile,'utf8')):{};
  const plan=await planBackupPrune(database,backups,{policy});await writeFile(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({dryRun:true,plan:output,planHash:plan.planHash,candidates:plan.candidates.map(s=>s.directory),candidateBytes:plan.candidateBytes,expiresAt:plan.expiresAt}));
 }else if(command==='apply'&&args.length===3){
  const [path,confirmation,receiptPath]=args,plan=JSON.parse(await readFile(path,'utf8'));const result=await executeBackupPrune(plan,{confirmation,receiptPath});console.log(JSON.stringify({phase:result.phase,receiptPath,removedFileBytes:result.removedFileBytes}));
 }else throw new Error('用法：backup:prune -- plan <数据库> <备份目录> <全新计划JSON> [策略JSON]；或 apply <计划JSON> <确认指纹> <备份目录外全新回执JSON>');
}catch(error){console.error(error.message);process.exitCode=1;}
