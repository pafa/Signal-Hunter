import {financialRecoveryDocument} from './financial-recovery.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {createProviderGate} from './provider-gate.mjs';
import {SEC_TICKERS_URL,secIssuer,secFactsUrl,financialMaterial,financialDigest} from './financial-source-material.mjs';
import {secSubmissionsUrl,filingPlan,financialFilingMaterial,filingExhibitPlan,financialExhibitMaterial} from './financial-filing-material.mjs';

// Fixed official endpoints, one request at a time, shared immutable raw archive.
export function openFinancialSources(store,{enabled=false,fetcher=fetch,now=Date.now}={}){
 const db=store.db,gated=createProviderGate(store,{fetcher,now});let lastRequest=0,busy=false;
 db.exec('CREATE TABLE IF NOT EXISTS financial_source_responses(url TEXT NOT NULL,received_at TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(url,received_at,sha256))');
 const active=context=>{context?.assertActive?.();if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先完成核对确认');};
 async function read(url,context,ttl,html=false){
  active(context);
  const cached=db.prepare('SELECT * FROM financial_source_responses WHERE url=? AND received_at<=? ORDER BY received_at DESC,rowid DESC LIMIT 1').get(url,new Date(now()).toISOString());
  if(cached&&now()-Date.parse(cached.received_at)<ttl){const b=db.prepare('SELECT body FROM research_source_documents WHERE sha256=?').get(cached.sha256)?.body;if(!b||financialDigest(b)!==cached.sha256)throw Error('财务缓存原始响应校验失败');return {url,receivedAt:cached.received_at,body:Buffer.from(b)};}
  const wait=Math.max(0,1000-(Date.now()-lastRequest));if(wait)await delay(wait,undefined,{signal:context?.signal});active(context);lastRequest=Date.now();
  const signal=AbortSignal.any([AbortSignal.timeout(20000),...(context?.signal?[context.signal]:[])]);
  const response=await gated(url,{headers:{'User-Agent':'SignalHunter/0.11 public financial research','Accept':html?'text/html,application/xhtml+xml':'application/json'},redirect:'error',signal},context);
  if(!response.ok){await response.body?.cancel();throw Error('SEC财务来源 HTTP '+response.status);}
  if(html&&!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw Error('SEC申报原件不是HTML响应');}
  const chunks=[];let size=0;for await(const chunk of response.body){active(context);size+=chunk.length;if(size>12*1024*1024)throw Error('SEC财务响应超过12MB读取上限');chunks.push(Buffer.from(chunk));}
  const body=Buffer.concat(chunks),receivedAt=new Date(now()).toISOString(),sha256=financialDigest(body);
  // Malformed responses are kept too; successful HTTP is not successful parsing.
  active(context);db.exec('BEGIN IMMEDIATE');try{active(context);const old=db.prepare('SELECT body FROM research_source_documents WHERE sha256=?').get(sha256);if(old&&financialDigest(old.body)!==sha256)throw Error('财务原始响应归档冲突');db.prepare('INSERT OR IGNORE INTO research_source_documents VALUES(?,?)').run(sha256,body);db.prepare('INSERT OR IGNORE INTO financial_source_responses VALUES(?,?,?)').run(url,receivedAt,sha256);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  return {url,receivedAt,body};
 }
 return {enabled,async read(symbol,context,{allowFilingGaps=false,frozenSources=[]}={}){
  if(!enabled)throw Error('当前模式未启用公开财务来源');if(busy)throw Error('财务来源正在读取');busy=true;
  try{
   if(!Array.isArray(frozenSources)||frozenSources.length>4||new Set(frozenSources.map(x=>x.url)).size!==frozenSources.length)throw Error('财务恢复冻结范围无效');
   const input=(url,...args)=>{active(context);const r=frozenSources.find(x=>x.url===url);if(!r)return read(url,...args);if(Date.parse(r.receivedAt)>now())throw Error('财务恢复响应不能来自未来');return financialRecoveryDocument(db,r);};
   if(!symbol.endsWith('.US'))throw Error('SEC财务补证目前仅覆盖美国证券，其他市场保留缺口');
   const map=await input(SEC_TICKERS_URL,context,86400000),issuer=secIssuer(symbol,map.body),facts=await input(secFactsUrl(issuer.cik),context,6*3600000),material={...financialMaterial(symbol,[map,facts]),financialDocuments:[map,facts]},filingMaterials=[],filingCoverage=[];
   let index,plan;
   try{index=await input(secSubmissionsUrl(issuer.cik),context,6*3600000);plan=filingPlan(issuer,index);}catch(e){active(context);if(!allowFilingGaps)throw e;filingCoverage.push({status:'unavailable',url:secSubmissionsUrl(issuer.cik),reason:String(e.message||e).slice(0,240)});}
   if(plan){
    if(!plan.filings.length)filingCoverage.push({status:'unavailable',url:index.url,reason:'最近申报目录在选择范围内没有适用原件；未读取更早目录'});
    for(const filing of plan.filings){
     let documents;
     try{const document=await input(filing.url,context,86400000,true);documents=[map,index,document];const m=financialFilingMaterial(symbol,documents,filing.accession);active(context);filingMaterials.push({...m,filingDocuments:documents});filingCoverage.push({status:'saved',url:filing.url,accession:filing.accession,form:filing.form,reason:'已留存HTML原件，仅将有界选段交给研判；附件读取范围另记'});}
     catch(e){active(context);if(!allowFilingGaps)throw e;documents=null;filingCoverage.push({status:'unavailable',url:filing.url,accession:filing.accession,form:filing.form,reason:String(e.message||e).slice(0,240)});}
     if(!documents)continue;
     let exhibits;
     try{exhibits=filingExhibitPlan(symbol,documents,filing.accession);filingCoverage.find(x=>x.url===filing.url&&x.status==='saved').exhibits=exhibits.selection;}
     catch(e){active(context);if(!allowFilingGaps)throw e;filingCoverage.push({status:'unavailable',kind:'exhibit-discovery',url:filing.url,accession:filing.accession,reason:String(e.message||e).slice(0,240)});continue;}
     for(const exhibit of exhibits.exhibits){
      try{const document=await input(exhibit.url,context,86400000,true),all=[...documents,document],m=financialExhibitMaterial(symbol,all,filing.accession);active(context);filingMaterials.push({...m,filingDocuments:all});filingCoverage.push({status:'saved',kind:'exhibit',url:exhibit.url,parentUrl:filing.url,accession:filing.accession,reason:'主申报明确链接的附件已留存；选段范围与未读内容另记，不代表事件影响核实'});}
      catch(e){active(context);if(!allowFilingGaps)throw e;filingCoverage.push({status:'unavailable',kind:'exhibit',url:exhibit.url,parentUrl:filing.url,accession:filing.accession,reason:String(e.message||e).slice(0,240)});}
     }
    }
   }
   active(context);return {...material,filingMaterials,filingCoverage};
  }finally{busy=false;}
 }};
}
