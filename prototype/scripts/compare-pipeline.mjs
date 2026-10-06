import {readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {freezePipelineComparison,savePipelineComparison,runPipelineComparison,readPipelineComparison} from '../server/pipeline-comparison.mjs';
const [action,path,destination,...extra]=process.argv.slice(2),controller=new AbortController(),cancel=()=>controller.abort();
process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
try{
 if(extra.length||!path)throw Error();
 if(action==='freeze'&&destination){if(statSync(path).size>12*1024*1024)throw Error();const p=freezePipelineComparison(JSON.parse(readFileSync(path,'utf8')));savePipelineComparison(resolve(destination),p);console.log(JSON.stringify({planHash:p.hash,steps:p.recipe.steps.length,modelMode:p.recipe.model.mode,executed:false}));}
 else if(['run','report'].includes(action)&&!destination){const r=action==='run'?await runPipelineComparison(resolve(path),{signal:controller.signal}):readPipelineComparison(resolve(path));console.log(JSON.stringify({planHash:r.plan.hash,summary:r.summary,coverage:r.coverage,models:r.rows.map(row=>({role:row.role,...row.modelSummary})),intake:r.rows.map(row=>({role:row.role,summary:row.intakeSummary,runs:row.intake})),steps:r.steps,tables:r.tables,comparison:r.comparison,forwardEligible:false},null,2));if(action==='run'&&(r.summary.completed!==2||r.rows.some(row=>row.intakeSummary.partial||row.intakeSummary.error||row.intakeSummary.cancelled||row.intakeSummary.interrupted||row.intakeSummary.running||row.result?.value&&(row.result.value.summary.failed||row.result.value.summary.rejected||row.result.value.summary.notStarted||row.modelSummary.failed||row.modelSummary.unfinished))))process.exitCode=2;}
 else throw Error();
}catch{console.error('全流程对照未完成。用法：pipeline:compare -- freeze <冻结配方.json> <全新目录>，或 run/report <计划目录>。不覆盖、补批或自动重试。');process.exitCode=1;}
finally{process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
