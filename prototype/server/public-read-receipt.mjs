import {publicSourceUrl} from './public-source-url.mjs';

// Keep retrieval provenance in the existing attempt log, separate from the
// immutable document. A later redirect must not rewrite an older material.
export function publicReadReceipt(input,requestedUrl){
 const requested=publicSourceUrl(requestedUrl).href,final=publicSourceUrl(input.url).href;
 if(input.requestedUrl!==undefined&&publicSourceUrl(input.requestedUrl).href!==requested)throw Error('公开读取结果与请求地址不符');
 // Legacy/custom readers that omit the request cannot prove a redirect.
 if(final!==requested&&input.requestedUrl===undefined)return null;
 return {schema:'public-source-read/1',requestedUrl:requested,finalUrl:final};
}

export function hasPublicReadReceipt(db,{topicId,intakeId,requestedUrl,materialId,materialRevision,finalUrl}){
 const rows=db.prepare("SELECT payload FROM research_source_attempts WHERE topic_id IN (?,?) AND json_extract(payload,'$.state')='saved' AND json_extract(payload,'$.method')='public-web' AND json_extract(payload,'$.materialId')=?").all(topicId,`intake:${intakeId}`,materialId);
 return rows.some(row=>{
  const p=JSON.parse(row.payload),r=p.readReceipt;
  if(r?.schema!=='public-source-read/1'||r.requestedUrl!==requestedUrl||r.finalUrl!==finalUrl||r.materialId!==materialId||r.materialRevision!==materialRevision)return false;
  try{return publicSourceUrl(r.requestedUrl).href===r.requestedUrl&&publicSourceUrl(r.finalUrl).href===r.finalUrl&&Number.isFinite(Date.parse(p.at));}catch{return false;}
 });
}
