import {checkRelease} from './release-files.mjs';
try{const manifest=checkRelease();console.log(`发布检查通过：${Object.keys(manifest).length} 文件，${Object.values(manifest).reduce((n,v)=>n+v.bytes,0)} 字节。仅规则扫描；仍需人工内容与权利审阅。`);}catch(error){console.error(error.message);process.exitCode=1;}
