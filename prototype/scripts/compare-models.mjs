import {readFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {freezeModelComparison,saveModelComparison,runModelComparison,readModelComparison,readComparisonArtifact} from '../server/model-comparison.mjs';
import {freezeSourceComparison,saveSourceComparison,runSourceComparison,readSourceComparison} from '../server/source-comparison.mjs';
const [action,path,destination,...extra]=process.argv.slice(2),controller=new AbortController(),cancel=()=>controller.abort();
process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
try{
 if(extra.length||!path)throw Error();
 if(action==='freeze'&&destination){if(statSync(path).size>12*1024*1024)throw Error();const spec=JSON.parse(readFileSync(path,'utf8')),source=Object.hasOwn(spec,'sources'),plan=source?await freezeSourceComparison(spec,{signal:controller.signal}):freezeModelComparison(spec);(source?saveSourceComparison:saveModelComparison)(resolve(destination),plan);console.log(JSON.stringify({planHash:plan.hash,inputs:plan.inputs.length,calls:plan.slots.length,arms:plan.arms,directory:resolve(destination),executed:false}));}
 else if(['run','report'].includes(action)&&!destination){const source=readComparisonArtifact(join(resolve(path),'plan.json')).format==='source-comparison/1',run=source?runSourceComparison:runModelComparison,read=source?readSourceComparison:readModelComparison,report=action==='run'?await run(resolve(path),{signal:controller.signal}):read(resolve(path));console.log(JSON.stringify({planHash:report.plan.hash,summary:report.summary,pairs:report.pairs,comparison:report.comparison,forwardEligible:false},null,2));if(action==='run'&&report.summary.successful!==report.summary.planned)process.exitCode=2;}
 else throw Error();
}catch{console.error('模型对照未完成。用法：research:compare -- freeze <配置与材料.json> <全新目录>，或 run/report <计划目录>。核对配置、指纹、权限及已有执行记录；不会覆盖或自动重试。');process.exitCode=1;}
finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
