import {randomUUID} from 'node:crypto';
import {createProviderGate} from './provider-gate.mjs';
import {fetchMinutes,hash} from './providers.mjs';
import {fetchDaily} from './daily.mjs';
import {researchPriceUrls,researchPriceMaterial} from './research-price-material.mjs';

// Reuse the chart providers and parsers. Archive bounded original bytes before
// parsing, including HTTP/JSON failures; never copy a mutable chart cache.
export function openResearchPriceSources(store,{enabled=false,fetcher=fetch,now=Date.now}={}){
 const db=store.db,gated=createProviderGate(store,{fetcher,now});let busy=false;
 db.exec('CREATE TABLE IF NOT EXISTS research_price_responses(id INTEGER PRIMARY KEY,read_id TEXT NOT NULL,symbol TEXT NOT NULL,interval TEXT NOT NULL,url TEXT NOT NULL,received_at TEXT NOT NULL,sha256 TEXT NOT NULL,http_status INTEGER NOT NULL,headers TEXT NOT NULL)');
 const active=context=>{context?.assertActive?.();if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先完成核对确认');};
 return {enabled,async read(symbol,interval,context){
  if(!enabled)throw Error('当前模式未启用公开研究价量');if(busy)throw Error('研究价量正在读取');
  const urls=researchPriceUrls(symbol,interval),readId=randomUUID(),documents=[];busy=true;
  try{
   const capture=async(url,options)=>{
    active(context);if(!urls.includes(url))throw Error('研究价量请求超出固定来源');
    const signal=AbortSignal.any([options.signal,...(context?.signal?[context.signal]:[])]);
    const response=await gated(url,{...options,signal},context),chunks=[];let bytes=0;
    for await(const chunk of response.body||[]){active(context);bytes+=chunk.length;if(bytes>2_000_000)throw Error('研究价量响应超过2MB上限，原件未完整留存');chunks.push(Buffer.from(chunk));}
    const body=Buffer.concat(chunks),receivedAt=new Date(now()).toISOString(),sha256=hash(body),headers=Object.fromEntries(['content-type','date','retry-after','location'].filter(k=>response.headers.has(k)).map(k=>[k,response.headers.get(k)]));
    active(context);db.exec('BEGIN IMMEDIATE');try{active(context);const old=db.prepare('SELECT body FROM research_source_documents WHERE sha256=?').get(sha256);if(old&&hash(old.body)!==sha256)throw Error('研究价量原件归档冲突');db.prepare('INSERT OR IGNORE INTO research_source_documents VALUES(?,?)').run(sha256,body);db.prepare('INSERT INTO research_price_responses(read_id,symbol,interval,url,received_at,sha256,http_status,headers) VALUES(?,?,?,?,?,?,?,?)').run(readId,symbol,interval,url,receivedAt,sha256,response.status,JSON.stringify(headers));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    documents.push({url,receivedAt,body,httpStatus:response.status});
    // Retain only headers consumed by existing parsers; body is already decoded
    // by Fetch, so do not replay Content-Encoding/Content-Length from the wire.
    return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,headers});
   };
   const quote=interval==='1d'?await fetchDaily(symbol,capture,()=>documents.at(-1)?.receivedAt||new Date(now()).toISOString()):await fetchMinutes(symbol,capture);
   active(context);
   const doc=documents.filter(d=>d.httpStatus>=200&&d.httpStatus<300&&(quote.provider==='eastmoney-public'?d.url.includes('eastmoney.com'):d.url.includes('finance.yahoo.com'))).at(-1);
   if(!doc)throw Error('研究价量缺少匹配的来源原件');
   return {...researchPriceMaterial(symbol,interval,doc),marketDocuments:[doc]};
  }finally{busy=false;}
 }};
}
