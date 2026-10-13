import {createBackup,restoreBackup} from '../server/backup.mjs';
import {createManagedBackup,maintainBackups,previewManagedBackups,loadBackupPolicy} from '../server/backup-lifecycle.mjs';
const [action,source,target,policyPath,...extra]=process.argv.slice(2);
if(!['create','maintain','status','archive','restore'].includes(action)||!source||!target||extra.length||['archive','restore'].includes(action)&&policyPath)throw new Error('用法：node scripts/backup.mjs create|maintain|status <数据库> <日常备份目录> [策略JSON路径]；archive <数据库> <独立归档目录>；restore <备份目录> <全新数据库路径>');
// Restoring a recovery copy must remain possible even if the daily policy is bad.
const options=['archive','restore'].includes(action)?{}:{policy:await loadBackupPolicy(policyPath||process.env.SIGNAL_BACKUP_POLICY_PATH)};
const actions={create:()=>createManagedBackup(source,target,options),maintain:()=>maintainBackups(source,target,options),status:()=>previewManagedBackups(source,target,{...options,creating:true}),archive:()=>createBackup(source,target),restore:()=>restoreBackup(source,target)};
const result=await actions[action]();console.log(JSON.stringify(result,null,2));
if(action==='maintain'&&result.blocked?.length)process.exitCode=2;
