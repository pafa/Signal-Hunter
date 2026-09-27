import {mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,isAbsolute} from 'node:path';
import {checkRelease,releaseRoot} from './release-files.mjs';
const input=process.argv[2];
if(!input||!isAbsolute(input))throw new Error('请提供一个尚不存在的绝对输出目录；不会覆盖或清理任何现有目录。');
const target=resolve(input),manifest=checkRelease();
mkdirSync(target); // EEXIST is deliberate, including when the output is a symlink.
for(const path of Object.keys(manifest)){const dest=resolve(target,path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(resolve(releaseRoot,path),dest);}
writeFileSync(resolve(target,'RELEASE-MANIFEST.json'),JSON.stringify({schema:1,files:manifest},null,2)+'\n');
console.log(`本地候选已导出：${target}（${Object.keys(manifest).length} 文件）。未暂存、提交、上传或发布。`);
