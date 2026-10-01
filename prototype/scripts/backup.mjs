import {createBackup,restoreBackup} from '../server/backup.mjs';
const [action,source,target]=process.argv.slice(2);
if(!['create','restore'].includes(action)||!source||!target)throw new Error('用法：node scripts/backup.mjs create <数据库> <备份目录> 或 restore <备份目录> <全新数据库路径>');
console.log(JSON.stringify(action==='create'?await createBackup(source,target):restoreBackup(source,target),null,2));
