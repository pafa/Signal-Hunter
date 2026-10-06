import {readFileSync,statSync} from 'node:fs';import {resolve} from 'node:path';
import {freezeSemanticBenchmark,saveSemanticBenchmark,runSemanticBenchmark,readSemanticBenchmark} from '../server/semantic-benchmark.mjs';
const [action,path,destination,...extra]=process.argv.slice(2),controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
try{
 if(extra.length||!path)throw Error();
 if(action==='freeze'&&destination){if(statSync(path).size>32*1024*1024)throw Error();const plan=freezeSemanticBenchmark(JSON.parse(readFileSync(path,'utf8')));saveSemanticBenchmark(resolve(destination),plan);console.log(JSON.stringify({planHash:plan.hash,calls:plan.cases.length,directory:resolve(destination),executed:false}));}
 else if(['run','report'].includes(action)&&!destination){const r=action==='run'?await runSemanticBenchmark(resolve(path),{signal:controller.signal}):readSemanticBenchmark(resolve(path));console.log(JSON.stringify({planHash:r.plan.hash,summary:r.summary,bySplit:r.bySplit,byLabelOrigin:r.byLabelOrigin,clusters:r.clusters,rows:r.rows.map(({result,...row})=>row),forwardEligible:false},null,2));if(action==='run'&&r.summary.completed!==r.summary.planned)process.exitCode=2;}
 else throw Error();
}catch{console.error('语义评估未完成。用法：semantic:evaluate -- freeze <已标注样本.json> <全新目录>，或 run/report <计划目录>。核对样本、标注、指纹与已有执行记录；不覆盖或自动重试。');process.exitCode=1;}
finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
