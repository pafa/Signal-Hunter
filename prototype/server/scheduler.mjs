// Each lane is independently single-flight. A slow market provider cannot block news.
export function createScheduler(tasks,{clock=()=>new Date().toISOString()}={}){
 const jobs=new Map(),states={};
 const run=name=>{
  if(jobs.has(name))return jobs.get(name);
  states[name]={...states[name],running:true,startedAt:clock(),error:null};
  const job=Promise.resolve().then(tasks[name]).then(result=>{Object.assign(states[name],summarizeResults(result),{completedAt:clock()});if(states[name].succeeded)states[name].lastSuccessAt=clock();},error=>{Object.assign(states[name],summarizeResults({error:String(error.message).slice(0,160)}),{completedAt:clock()});}).finally(()=>{states[name].running=false;jobs.delete(name);});
  jobs.set(name,job);return job;
 };
 return {run:()=>Promise.all(Object.keys(tasks).map(run)),snapshot:()=>structuredClone(states)};
}
export function summarizeResults(result){
 const values=Array.isArray(result)?result:[result],failed=values.filter(r=>r?.error),skipped=values.filter(r=>r?.skipped).length,succeeded=values.length-failed.length-skipped;
 return {outcome:failed.length?(succeeded?'partial':'error'):succeeded?'ok':'skipped',succeeded,failed:failed.length,skipped,...(skipped?{skipReasons:[...new Set(values.filter(r=>r?.skipped).map(r=>String(r.skipped)))].map(reason=>({reason,count:values.filter(r=>String(r?.skipped)===reason).length}))}:{}),error:failed.length?[...new Set(failed.map(r=>String(r.error)))].join('；').slice(0,160):null};
}
export async function pool(items,concurrency,fn){let cursor=0;const results=new Array(items.length);await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(cursor<items.length){const i=cursor++;try{results[i]=await fn(items[i]);}catch(error){results[i]={error:String(error.message)};}}}));return results;}
