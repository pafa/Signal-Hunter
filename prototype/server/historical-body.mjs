import {historicalProfile,historicalMatch} from './historical-mechanisms.mjs';
import {immutableMaterialSnapshot} from './research-materials.mjs';
import {historyRecallErrors} from '../shared/historical-recall.mjs';
const fail=()=>{throw Error(historyRecallErrors[5]);};
export function historicalMaterials(db){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_materials'").get())return [];
 const where='revision=(SELECT MAX(revision) FROM research_materials newer WHERE newer.document_id=m.document_id)';
 const size=db.prepare(`SELECT count(*) n,coalesce(sum(length(CAST(payload AS BLOB))),0) bytes FROM research_materials m WHERE ${where}`).get();
 if(size.n>2000||size.bytes>8*1024*1024)fail();
 return db.prepare(`SELECT id,revision FROM research_materials m WHERE ${where} ORDER BY rowid`).all().map(ref=>{
  const m=immutableMaterialSnapshot(db,ref);
  const first=db.prepare('SELECT payload FROM research_materials WHERE document_id=? ORDER BY revision LIMIT 1').get(m.documentId);
  return {...m,id:`material:${m.id}`,materialId:m.id,kind:'material',publisher:m.sourceName,firstSeen:JSON.parse(first.payload).availableAt,contentScope:m.scope};
 });
}
// Each span is independently classified. Never manufacture a mechanism by
// joining a drug mentioned in one sentence with approval of a factory elsewhere.
export function historicalBodyProfile(input){
 const title=String(input.title||''),spans=[{field:'title',start:0,end:title.length,text:title}];
 if(input.kind==='material')for(const match of input.body.matchAll(/[^.!?。！？\r\n]+(?:[.!?。！？\r\n]+|$)/gu)){
  for(let offset=0;offset<match[0].length;offset+=1000){
   const text=match[0].slice(offset,offset+1200);if(!text.trim())continue;
   if(spans.length>=2001)fail();
   spans.push({field:'body',start:match.index+offset,end:match.index+offset+text.length,text});
   if(offset+1200>=match[0].length)break;
  }
 }
 return {spans:spans.map(span=>({...span,profile:historicalProfile({title:span.text})})).filter(span=>span.profile.families.length),normalized:historicalProfile({title:input.title}).normalized};
}
export function historicalBodyMatch(anchor,input,a,b,budget={remaining:500000}){
 let best=null,sameMechanism=false,matchingSpans=0;
 for(const left of a.spans)for(const right of b.spans){
  if(--budget.remaining<0)fail();
  const match=historicalMatch(anchor,input,left.profile,right.profile);
  if(match.status!=='no_mechanism')sameMechanism=true;
  if(match.status!=='candidate')continue;
  matchingSpans++;
  if(!best||match.rank>best.rank){
   const quote=(span,record)=>({inputId:record.id,revision:record.revision,field:span.field,start:span.start,end:span.end,text:span.text,contentScope:record.contentScope||'headline-only'});
   best={...match,reasons:match.reasons.map(s=>s.replaceAll('标题','片段')),quotes:{anchor:quote(left,anchor),candidate:quote(right,input)},differences:match.differences.map(s=>s.replaceAll('标题','片段')).concat('仅为同片段机制与领域词共现；段落可能涉及多事项、否定或历史背景，须阅读原材料核对')};
  }
 }
 return best?{...best,matchingSpans}:{status:sameMechanism?'no_context':'no_mechanism'};
}
