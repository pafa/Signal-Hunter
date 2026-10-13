import {randomUUID} from 'node:crypto';
import {openMaterials,immutableMaterialSnapshot} from './research-materials.mjs';
import {readPublicArticle,publicSourceUrl} from './source-reader.mjs';
import {publicReadReceipt} from './public-read-receipt.mjs';

export const INTAKE_SOURCE_VERSION='intake-source/1';
// Reuse the existing reader and immutable material archive before deciding to
// leave a newly scanned headline in observation. No research topic is created.
export function openIntakeSources(store,{now,transaction,audit,setState,eligible,enabled,reader=readPublicArticle}){
 const db=store.db,at=()=>new Date(now()).toISOString(),materials=openMaterials(db,{clock:at});
 const payload=row=>JSON.parse(row.payload),read=id=>db.prepare('SELECT * FROM research_pipeline_items WHERE id=?').get(id);
 const valid=(row,token)=>{const latest=read(row.id),p=latest&&payload(latest),news=store.newsById(row.news_id);return enabled()&&eligible(latest)&&news?.revision===row.revision&&(!token||p.intakeSource?.token===token&&p.intakeSource.leaseUntil>=now())&&p.intakeSourceVersion===INTAKE_SOURCE_VERSION;};
 const api={
  material(row){const s=payload(row).intakeSource;if(s?.status!=='ready')return null;return immutableMaterialSnapshot(db,{id:s.materialId,revision:s.materialRevision});},
  async prepare(rows,context){
   const row=rows.find(r=>{const p=payload(r),s=p.intakeSource;return p.intakeSourceVersion===INTAKE_SOURCE_VERSION&&s?.status!=='ready'&&(!s?.nextRetryAt||s.nextRetryAt<=now())&&!(s?.status==='reading'&&s.leaseUntil>now());});
   if(!row)return null;
   const old=payload(row).intakeSource||{},attempts=old.attempts||[];
   if(!valid(row)){transaction(()=>{context.assertActive();setState(read(row.id),'invalidated',{reason:'入口正文的来源、规则或配置已变化，原记录保留'});});return {ok:true,intakeSourceInvalidated:row.id};}
   if(attempts.length>=3){transaction(()=>{context.assertActive();setState(read(row.id),'observing',{intakeFailure:'source-unavailable',intakeSource:{...old,status:'unresolved',nextRetryAt:null},reason:'入口正文已尝试3次仍未完成，保留未核实缺口；其他材料继续'});});return {ok:true,intakeSourceUnresolved:row.id};}
   const token=randomUUID(),source=store.newsById(row.news_id),state={version:INTAKE_SOURCE_VERSION,status:'reading',token,leaseUntil:now()+30000,requestedUrl:source.url,attempts:[...attempts,{startedAt:at()}],nextRetryAt:null};
   transaction(()=>{context.assertActive();if(!valid(row))throw Error('入口正文依据已变化');setState(read(row.id),'skipped',{intakeSource:state});audit(row.id,'intake-source-started',{title:source.title,attempt:state.attempts.length});});
   try{
    const input=await reader(publicSourceUrl(source.url).href);
    context.assertActive();if(!valid(row,token))return {ok:true,intakeSourceSuperseded:row.id};
    const prepared=materials.prepare(`intake:${row.news_id}`,input,'public-web'),receipt=publicReadReceipt(input,source.url);
    transaction(()=>{context.assertActive();if(!valid(row,token))throw Error('入口正文依据已变化');prepared.persist();materials.attempt(`intake:${row.id}`,{state:'saved',url:source.url,method:'public-web',materialId:prepared.material.id,...(receipt?{readReceipt:{...receipt,materialId:prepared.material.id,materialRevision:prepared.material.revision}}:{})});const next={...state,status:'ready',leaseUntil:null,materialId:prepared.material.id,materialRevision:prepared.material.revision,receivedAt:prepared.material.receivedAt,attempts:state.attempts.map((a,i)=>i===state.attempts.length-1?{...a,finishedAt:at(),status:'saved'}:a)};setState(read(row.id),'skipped',{intakeSource:next});audit(row.id,'intake-source-saved',{title:source.title,materialId:prepared.material.id,characters:prepared.material.body.length});});
    return {ok:true,intakeSourceReady:row.id};
   }catch(error){
    context.assertActive();if(!valid(row,token))return {ok:true,intakeSourceSuperseded:row.id};
    transaction(()=>{context.assertActive();if(!valid(row,token))return;const exhausted=state.attempts.length>=3,next={...state,status:exhausted?'unresolved':'retrying',leaseUntil:null,nextRetryAt:exhausted?null:now()+60000*2**(state.attempts.length-1),attempts:state.attempts.map((a,i)=>i===state.attempts.length-1?{...a,finishedAt:at(),status:'failed'}:a)};materials.attempt(`intake:${row.id}`,{state:'failed',url:source.url,method:'public-web',error:'入口正文读取或归档未完成'});setState(read(row.id),exhausted?'observing':'skipped',{intakeSource:next,...(exhausted?{intakeFailure:'source-unavailable'}:{}),reason:exhausted?'入口正文已尝试3次仍未完成，保留未核实缺口；其他材料继续':'入口正文未完成，后台按退避时间重试；其他材料继续'});audit(row.id,'intake-source-retry',{title:source.title,exhausted});});
    return {ok:true,intakeSourceRetry:row.id};
   }
  },
  snapshot(){const rows=db.prepare("SELECT payload FROM research_pipeline_items WHERE status<>'superseded' AND json_extract(payload,'$.intakeSourceVersion')=?").all(INTAKE_SOURCE_VERSION).map(r=>JSON.parse(r.payload));return {total:rows.length,ready:rows.filter(p=>p.intakeSource?.status==='ready').length,unresolved:rows.filter(p=>['unresolved','invalidated'].includes(p.intakeSource?.status)).length,pending:rows.filter(p=>!p.intakeSource||['reading','retrying'].includes(p.intakeSource.status)).length};}
 };
 return api;
}
