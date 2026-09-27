// Re-run the frozen development batch; this is not an out-of-sample evaluation.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {classifyHeadline,RULES_VERSION} from '../server/triage.mjs';
const directory=resolve(process.argv[2]||'data/private/recent-events-20260924-network');
const {classifyHeadline:baseline}=await import(pathToFileURL(resolve(directory,'baseline-triage.mjs')));
const news=JSON.parse(await readFile(resolve(directory,'news.json'),'utf8'));
const study=JSON.parse(await readFile(resolve(directory,'result.json'),'utf8'));
const results=news.items.map(n=>({id:n.id,title:n.title,before:baseline(n).bucket,after:classifyHeadline(n)}));
const counts=field=>Object.fromEntries(['review','clue','quiet'].map(k=>[k,results.filter(r=>(field==='before'?r.before:r.after.bucket)===k).length]));
const audits=study.audits.map(a=>({...a,after:results.find(r=>r.id===a.id)?.after.bucket||'missing'}));
const cases=study.cases.map(c=>({title:c.news.title,before:baseline(c.news).bucket,after:classifyHeadline(c.news).bucket}));
const report={at:new Date().toISOString(),rulesVersion:RULES_VERSION,scope:'Existing frozen development batch; labels were seen during changes. Not unbiased recall, validation or trading returns.',count:results.length,before:counts('before'),after:counts('after'),audits:audits.map(({title,bucket,verdict,note,after})=>({title,bucket,verdict,note,after})),cases,newReview:results.filter(r=>r.before!=='review'&&r.after.bucket==='review').map(r=>({title:r.title,category:r.after.category,stage:r.after.stage}))};
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,audits:undefined,cases:undefined,newReview:undefined,fixedAudit:{size:audits.length,priority:audits.filter(a=>a.verdict==='review').length,capturedBefore:audits.filter(a=>a.verdict==='review'&&a.bucket==='review').length,capturedAfter:audits.filter(a=>a.verdict==='review'&&a.after==='review').length,nonPriorityAfter:audits.filter(a=>a.verdict!=='review'&&a.after==='review').length},diagnosticCases:cases.filter(c=>c.after==='review').length,newReviewCount:report.newReview.length},null,2));
