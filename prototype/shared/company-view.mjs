import {savedCompanyAssessment} from './company-assessment.mjs';
import {companyIdentity} from './company-directory.mjs';

export function companyResearch(symbol,topics,book={}){
 const identity=companyIdentity(symbol);
 const research=topics.filter(t=>t.companies.some(c=>c.symbol===identity.symbol)).map(t=>{
  const relation=t.companies.find(c=>c.symbol===identity.symbol),ids=new Set(relation.evidenceIds||[]);
  return {topicId:t.id,title:t.title,version:t.version,status:t.status,updatedAt:t.updatedAt,relation,modelAssessment:savedCompanyAssessment(t,identity.symbol),
   evidence:t.evidence.filter(e=>ids.has(e.id)),contextEvidence:t.evidence.filter(e=>!ids.has(e.id)),
   hypothesis:t.hypothesis,changeSummary:t.changeSummary,nextEvidence:t.nextEvidence};
 }).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
 const known=[...new Set(topics.flatMap(t=>t.companies.map(c=>c.symbol)))];
 return {identity,research,relatedListings:known.filter(s=>s!==identity.symbol&&companyIdentity(s).issuerKey===identity.issuerKey).map(companyIdentity),
  positions:(book.positions||[]).filter(p=>p.symbol===identity.symbol),orders:(book.orders||[]).filter(o=>o.symbol===identity.symbol),
 };
}

export function watchResearchRows(watch,topics,book={}){
 return watch.map(w=>{
  const dossier=companyResearch(w.symbol,topics,book),active=dossier.research.filter(t=>t.status==='active');
  const reviewAt=active.map(t=>t.hypothesis?.reviewAt).filter(Boolean).sort()[0]||null;
  return {...w,name:active[0]?.relation.name||dossier.identity.name,reason:active.map(t=>t.title).join('；')||'手动关注 / 当前无在研关联',
   latestChange:active[0]?.changeSummary?.items.join('；')||'尚无关联研究增量',updatedAt:active[0]?.updatedAt||null,reviewAt,
   positionQty:dossier.positions.reduce((n,p)=>n+p.qty,0),pending:dossier.orders.filter(o=>o.status==='pending').length,
   topicIds:active.map(t=>t.topicId)};
 });
}
