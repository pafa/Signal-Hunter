import {digest} from './codex-research.mjs';
import {materialInput} from './research-materials.mjs';
import {semanticErrors} from '../shared/semantic-labels.mjs';
const fail=()=>{throw new Error(semanticErrors[8]);};
const exists=db=>!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='research_materials'").get();
export const comparisonSummary=record=>{const {body,...summary}=record;return summary;};
export function materialComparisonSnapshot(db,ref){
 if(!exists(db))fail();
 const row=db.prepare('SELECT payload,document_id,revision FROM research_materials WHERE id=?').get(ref.id);
 if(!row)fail();
 try{
  const m=JSON.parse(row.payload),clean=materialInput(m,m.availableAt),latest=db.prepare('SELECT MAX(revision) n FROM research_materials WHERE document_id=?').get(row.document_id).n;
  if(m.id!==ref.id||m.documentId!==row.document_id||m.revision!==ref.revision||row.revision!==ref.revision||latest!==ref.revision||!Number.isFinite(Date.parse(m.availableAt))||Object.keys(clean).some(k=>clean[k]!==m[k])||digest(clean)!==m.contentHash||digest(`${m.documentId}:${m.contentHash}`)!==m.id)fail();
  return {kind:'material',id:m.id,documentId:m.documentId,revision:m.revision,title:m.title,url:m.url,publisher:m.sourceName,publishedAt:m.publishedAt,datePrecision:m.datePrecision,availableAt:m.availableAt,receivedAt:m.receivedAt,contentScope:m.scope,contentHash:m.contentHash,body:m.body,method:m.method,readerVersion:m.readerVersion,verification:m.verification};
 }catch{fail();}
}
export function comparisonMaterials(db,params={}){
 if(Object.keys(params).some(k=>!['q','offset','limit'].includes(k)))throw new Error(semanticErrors[7]);
 const q=params.q??'',offset=Number(params.offset??0),limit=Number(params.limit??20);
 if(typeof q!=='string'||q.length>200||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new Error(semanticErrors[7]);
 if(!exists(db))return {items:[],total:0,offset,limit};
 const where="m.revision=(SELECT MAX(revision) FROM research_materials WHERE document_id=m.document_id) AND instr(lower(json_extract(m.payload,'$.title')||' '||json_extract(m.payload,'$.sourceName')||' '||json_extract(m.payload,'$.url')),lower(?))>0";
 const total=db.prepare(`SELECT count(*) n FROM research_materials m WHERE ${where}`).get(q.trim()).n;
 const rows=db.prepare(`SELECT m.id,m.revision FROM research_materials m WHERE ${where} ORDER BY m.rowid DESC LIMIT ? OFFSET ?`).all(q.trim(),limit,offset);
 return {items:rows.map(ref=>comparisonSummary(materialComparisonSnapshot(db,ref))),total,offset,limit};
}
