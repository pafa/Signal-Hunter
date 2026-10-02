import {readFile} from 'node:fs/promises';
import {previewStorageRetention} from '../server/storage-retention.mjs';
const [database,backupRoot,policyFile,...extra]=process.argv.slice(2);
if(!database||!backupRoot||extra.length)throw new Error('用法：node scripts/storage-preview.mjs <数据库> <备份目录> [策略JSON文件]；仅只读预览');
const policy=policyFile?JSON.parse(await readFile(policyFile,'utf8')):{};
console.log(JSON.stringify(await previewStorageRetention(database,backupRoot,{policy}),null,2));
