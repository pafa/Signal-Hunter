import {digest} from './codex-research.mjs';
import {financialDigest,financialMaterial,secIssuer,secFactsUrl,SEC_TICKERS_URL} from './financial-source-material.mjs';
import {financialFilingMaterial,secSubmissionsUrl} from './financial-filing-material.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';

export const FINANCIAL_RECOVERY_VERSION='financial-capability-recovery/1';
const NAME_ERROR='SEC发行人名称不一致；仅接受相同主体名称的CORP/CORPORATION后缀差异';
const TABLE_ERROR='网页表格结构无效或超过读取上限，请核对原表并补充必要摘录';
const parse=r=>r&&JSON.parse(r.payload),caches=new WeakMap();
const core=x=>{const {at,method,materialId,materialRevision,recovery,...r}=x;return {...r,...(r.filings?{filings:r.filings.map(f=>{const {materialId,materialRevision,...v}=f;return v;})}:{})};};
const receipt=d=>({url:d.url,receivedAt:d.receivedAt,sha256:financialDigest(d.body),bytes:d.body.length});
export function financialRecoveryDocument(db,r){
 if(!r||typeof r.url!=='string'||!Number.isSafeInteger(r.bytes)||r.bytes<1||r.bytes>12*1024*1024||!db.prepare('SELECT 1 FROM financial_source_responses WHERE url=? AND received_at=? AND sha256=?').get(r.url,r.receivedAt,r.sha256))throw Error('财务恢复原始响应记录不符');
 const b=db.prepare('SELECT body FROM research_source_documents WHERE sha256=?').get(r.sha256)?.body;
 if(!b||b.length!==r.bytes||financialDigest(b)!==r.sha256)throw Error('财务恢复原始响应指纹不符');
 return {url:r.url,receivedAt:r.receivedAt,body:Buffer.from(b)};
}
function latest(db,url,at){
 const r=db.prepare('SELECT f.received_at,f.sha256,length(d.body) bytes FROM financial_source_responses f JOIN research_source_documents d ON d.sha256=f.sha256 WHERE f.url=? AND f.received_at<=? ORDER BY f.received_at DESC,f.rowid DESC LIMIT 1').get(url,at);
 if(!r)throw Error('旧失败没有可核验的原始响应');return financialRecoveryDocument(db,{url,receivedAt:r.received_at,sha256:r.sha256,bytes:r.bytes});
}

// Prove a specific old parser failure can now be read. A version bump or a
// generic network error alone cannot grant another preparation/model budget.
export function financialRecoveryCandidate(db,topic,symbol){
 const previous=topic.financialSources?.find(x=>x.symbol===symbol);
 if(!previous||previous.recovery||previous.method!=='system-official-financial'||!symbol.endsWith('.US')||previous.attempt!==3)return null;
 const name=previous.status==='unavailable'&&previous.reason===`官方财务补证三次未完成：${NAME_ERROR}；保留缺口，继续研究`;
 const failed=previous.status==='saved'&&previous.filings?.find(f=>f.status==='unavailable'&&!f.kind&&f.reason===TABLE_ERROR);
 if(!name&&!failed)return null;
 const rows=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' AND status IN ('completed','observing') ORDER BY rowid").all(topic.id);
 const origin=rows.find(row=>{const p=parse(row),result=p.financial?.results?.find(x=>x.symbol===symbol),a=p.financial?.attempts?.filter(x=>x.symbol===symbol)||[],started=a.filter(x=>x.state==='started'),errors=a.filter(x=>x.state==='failed');return p.automatic&&!p.financialFollowup&&result&&digest(core(result))===digest(core(previous))&&started.length===3&&started.every((x,i)=>x.attempt===i+1&&!x.generation)&&errors.length===2&&errors.every((x,i)=>x.attempt===i+1&&x.reason===(name?NAME_ERROR:TABLE_ERROR));});
 if(!origin)return null;
 const p=parse(origin),result=p.financial.results.find(x=>x.symbol===symbol),attempts=p.financial.attempts.filter(x=>x.symbol===symbol),documents=[];
 try{
  const map=latest(db,SEC_TICKERS_URL,result.at),issuer=secIssuer(symbol,map.body);documents.push(map);
  if(name)documents.push(latest(db,secFactsUrl(issuer.cik),result.at));
  else{
   const old=immutableMaterialSnapshot(db,{id:previous.materialId,revision:previous.materialRevision});
   if(old.financialSource?.issuer.symbol!==symbol)return null;
   documents.splice(0,1,...old.financialSource.sources.map(r=>financialRecoveryDocument(db,r)));
   documents.push(latest(db,secSubmissionsUrl(old.financialSource.issuer.cik),result.at),latest(db,failed.url,result.at));
  }
  const sources=documents.map(receipt);if(new Set(sources.map(x=>x.url)).size!==sources.length)return null;
  const basis={schema:FINANCIAL_RECOVERY_VERSION,capability:name?'sec-issuer-ascii-case/1':'sec-filing-cell-budget/2',symbol,originJobId:origin.id,priorResultHash:digest(previous),attemptsHash:digest(attempts),resultHash:digest(result),sources,...(failed?{filingUrl:failed.url,accession:failed.accession}:{})},key=digest(basis);
  let cache=caches.get(db);if(!cache){cache=new Map();caches.set(db,cache);}
  // Raw bytes above are checked on every use, even when parsing is cached.
  if(cache.has(key))return structuredClone(cache.get(key));
  let candidate=null;
  if(name){const m=financialMaterial(symbol,documents);if(m.financialSource.issuerName?.schema==='sec-issuer-name/2')candidate={...basis,scopeHash:key};}
  else{
   const filing=[documents[0],documents[2],documents[3]];let oldError;
   try{financialFilingMaterial(symbol,filing,failed.accession,{generation:1});}catch(e){oldError=e.message;}
   if(oldError===TABLE_ERROR){financialFilingMaterial(symbol,filing,failed.accession);candidate={...basis,scopeHash:key};}
  }
  cache.set(key,candidate);if(cache.size>24)cache.delete(cache.keys().next().value);return structuredClone(candidate);
 }catch{return null;}
}
