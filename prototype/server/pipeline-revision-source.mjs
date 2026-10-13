import {digest} from './codex-research.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
const ref=m=>({kind:'event',id:m.id,revision:1});
const terminal=new Set(['completed','no-signal','observing','cancelled','invalidated']);
const pending=message=>Object.assign(new Error(message),{pending:true});
// Current-source eligibility shared by cluster and standalone holding succession.
export function pipelineRevisionSource(store,research,id){
 const db=store.db;
 const assigned=id=>db.prepare('SELECT cluster_id FROM event_cluster_members WHERE member_key=?').get(`event:${id}`)?.cluster_id||null;
  const row=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE id=? AND kind='extract'").get(id),p=row&&JSON.parse(row.payload);
  if(!row||!p.automatic||store.newsById(p.newsId)?.revision!==p.newsRevision)throw Error('修订来源或研究模式已经变化，旧研究保留');
  if(!terminal.has(row.status))throw pending('新版事项识别仍在后台处理');
  if(row.status!=='completed')throw Error(row.status==='no-signal'?'新版正文未识别出具体事项，原事件保留观察':row.status==='cancelled'?'新版事项识别已取消，原事件保留观察':'新版事项识别未能完成或依据已变化，原事件保留观察');
  const run=JSON.parse(db.prepare('SELECT payload FROM material_event_runs WHERE id=?').get(row.run_id)?.payload||'null');
  if(!run||run.status!=='candidate')throw Error('事项拆分不可用');
  const latest=new Map();for(const r of db.prepare('SELECT event_index,payload FROM material_event_decisions WHERE run_id=? ORDER BY version').all(row.run_id))latest.set(r.event_index,JSON.parse(r.payload));
  const topics=[];
  for(let i=0;i<run.candidate.decomposition.events.length;i++){
   const d=latest.get(i);if(d?.action!=='create'||d.actor?.kind!=='system')throw Error('新版事项已有本人决定或未形成系统研究，原决定保留');
   const job=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='dossier' ORDER BY rowid DESC LIMIT 1").get(d.topicId),j=job&&JSON.parse(job.payload),t=research.get(d.topicId);
   if(!job){
    const identity=db.prepare("SELECT status FROM research_pipeline_event_jobs WHERE topic_id=? AND kind='identity'").get(d.topicId);
    if(identity&&terminal.has(identity.status))throw Error('新版事项身份处理已结束但无法继续研判，原研究保留观察');
    throw pending('新版身份与研判仍在后台处理');
   }
   if(!terminal.has(job.status))throw pending('新版研判仍在后台处理');
   if(job.status!=='completed'||!j.automatic||t.status!=='active'||t.version!==j.adoptedVersion||t.dossier?.sourceModelRun?.id!==job.run_id)throw Error('新版研究未完成、已由本人编辑或归档，保留当前内容');
   const m=eventComparisonSnapshot(db,ref(t));
   if(m.documentId!==p.packet.input.material.documentId||m.materialRevision!==p.packet.input.material.revision)throw Error('新版事项来源不匹配');
   topics.push({id:t.id,version:t.version,title:t.title,eventHash:digest(m),assigned:assigned(t.id)});
  }
  return {jobId:row.id,itemId:row.item_id,newsId:p.newsId,newsRevision:p.newsRevision,documentId:p.packet.input.material.documentId,materialRevision:p.packet.input.material.revision,topics};
 }
