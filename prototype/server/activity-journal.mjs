import {automaticRunPredicate} from './research-actor.mjs';
// A transactional read projection. Source records remain authoritative and intact.
export function openActivityJournal(db,{now=Date.now,instance=null,tasks=()=>({})}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS activity_journal(id INTEGER PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,at TEXT NOT NULL,kind TEXT NOT NULL,lane TEXT,action TEXT NOT NULL,entity_id TEXT,topic_id TEXT,news_id TEXT,correlation TEXT,detail TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS activity_journal_topic ON activity_journal(topic_id,id);
 CREATE INDEX IF NOT EXISTS activity_journal_news ON activity_journal(news_id,id);`);
 const definitions=[
  {table:'operation_runs',kind:'operation',lane:'name',action:'outcome',at:'coalesce(completed_at,started_at)',entity:'token',correlation:'token',detail:'summary',update:'outcome'},
  {table:'operation_audit',kind:'control',lane:'name',action:'action',at:'at'},
  {table:'news_intake_runs',kind:'intake',lane:"'news'",action:"json_extract(payload,'$.state')",at:'coalesce(finished_at,started_at)',entity:'id',correlation:"json_extract(payload,'$.runToken')",detail:"json_object('label',json_extract(payload,'$.label'),'added',json_extract(payload,'$.added'),'updated',json_extract(payload,'$.updated'),'duplicates',json_extract(payload,'$.duplicates'),'rejected',json_extract(payload,'$.rejectedCount'),'error',json_extract(payload,'$.error'))",update:'finished_at'},
  {table:'research_pipeline_audit',kind:'pipeline',lane:"'discovery'",action:'action',at:'at',entity:'item_id',detail:'payload'},
  {table:'model_research_runs',kind:'model',lane:"'discovery'",action:'status',at:"coalesce(json_extract(payload,'$.finishedAt'),created_at)",entity:'id',topic:'topic_id',detail:"json_object('model',json_extract(payload,'$.model'),'error',json_extract(payload,'$.failure.message'),'version',json_extract(payload,'$.acceptedVersion'))",update:'status'},
  {table:'observation_receipts',kind:'receipt',lane:"'observations'",action:'action',at:'at',entity:'todo_id',detail:"json_object('revision',revision)"},
 ];
 for(const [table,kind,lane] of [['semantic_runs','semantic-model','semantic'],['material_event_runs','material-model','discovery'],['company_entity_runs','identity-model','discovery']])definitions.push({table,kind,lane:`'${lane}'`,action:'status',at:"coalesce(json_extract(payload,'$.finishedAt'),json_extract(payload,'$.createdAt'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",entity:'id',topic:table==='semantic_runs'?"coalesce(json_extract(payload,'$.packet.input.left.topicId'),json_extract(payload,'$.packet.input.right.topicId'))":'topic_id',detail:"json_object('model',json_extract(payload,'$.model'),'error',json_extract(payload,'$.failure.message'))",update:'status'});
 const prefix=(s,p)=>s.replace(/\b(?:completed_at|started_at|name|outcome|token|summary|action|at|payload|finished_at|item_id|status|created_at|topic_id|todo_id|revision|id)\b(?=(?:[^']*'[^']*')*[^']*$)/g,x=>p+x);
 const cols='event_key,at,kind,lane,action,entity_id,topic_id,news_id,correlation,detail';
 for(const d of definitions){
  const expr=p=>[`'${d.kind}:'||${p}rowid||':'||${prefix(d.action,p)}`,prefix(d.at,p),`'${d.kind}'`,prefix(d.lane||'NULL',p),prefix(d.action,p),prefix(d.entity||'NULL',p),prefix(d.topic||'NULL',p),'NULL',prefix(d.correlation||d.entity||'NULL',p),prefix(d.detail||"'{}'",p)].join(',');
  db.exec(`CREATE TRIGGER IF NOT EXISTS journal_${d.kind.replaceAll('-','_')}_insert AFTER INSERT ON ${d.table} WHEN coalesce((SELECT value FROM settings WHERE key='restore_review_required'),'0')!='1' BEGIN INSERT OR IGNORE INTO activity_journal(${cols}) VALUES(${expr('NEW.')}); END;`);
  if(d.update)db.exec(`CREATE TRIGGER IF NOT EXISTS journal_${d.kind.replaceAll('-','_')}_update AFTER UPDATE OF ${d.update} ON ${d.table} WHEN NEW.${d.update} IS NOT OLD.${d.update} AND coalesce((SELECT value FROM settings WHERE key='restore_review_required'),'0')!='1' BEGIN INSERT OR IGNORE INTO activity_journal(${cols}) VALUES(${expr('NEW.')}); END;`);
 }
 if(!db.prepare("SELECT 1 FROM settings WHERE key='activity_journal_v1'").get()){
  db.exec('BEGIN IMMEDIATE');try{
   db.exec(`INSERT OR IGNORE INTO activity_journal(${cols}) SELECT * FROM (${definitions.map(d=>{
    const values=[`'${d.kind}:'||rowid||':'||${d.action}`,d.at,`'${d.kind}'`,d.lane||'NULL',d.action,d.entity||'NULL',d.topic||'NULL','NULL',d.correlation||d.entity||'NULL',d.detail||"'{}'"];
    return `SELECT ${values.join(',')} FROM ${d.table}`;
   }).join(' UNION ALL ')}) ORDER BY 2,1`);
   db.prepare("INSERT INTO settings(key,value) VALUES('activity_journal_v1','1')").run();db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function readPage(input={}){
  if(Object.keys(input).some(k=>!['after','before','limit','topic','issues'].includes(k)))throw Error('运行日志参数无效');
  const integer=(key,fallback)=>{if(input[key]===undefined)return fallback;if(!/^\d+$/.test(String(input[key]))||!Number.isSafeInteger(Number(input[key])))throw Error('运行日志游标无效');return Number(input[key]);};
  const limit=integer('limit',80);if(limit<1||limit>200||input.after!==undefined&&input.before!==undefined)throw Error('运行日志参数无效');
  const args=[],where=[];
  if(input.topic){if(typeof input.topic!=='string'||input.topic.length>100)throw Error('研究范围无效');where.push("(j.topic_id=? OR j.kind='pipeline' AND EXISTS(SELECT 1 FROM research_pipeline_items p WHERE p.id=j.entity_id AND p.topic_id=?))");args.push(input.topic,input.topic);}
  if(input.issues!==undefined){if(!['0','1'].includes(String(input.issues)))throw Error('日志筛选无效');if(String(input.issues)==='1')where.push("j.action IN ('error','partial','failed','interrupted','candidate','needs-review','invalidated')");}
  // Completed operation records supersede their startup line in history. The raw journal keeps both.
  where.push("NOT(j.kind='operation' AND j.action='running' AND EXISTS(SELECT 1 FROM operation_runs r WHERE r.token=j.entity_id AND r.outcome!='running'))");
  const after=integer('after',null),before=integer('before',null);
  if(after!==null){where.push('j.id>?');args.push(after);}if(before!==null){where.push('j.id<?');args.push(before);}
  const order=after!==null?'ASC':'DESC',rows=db.prepare(`SELECT j.* FROM activity_journal j WHERE ${where.join(' AND ')} ORDER BY j.id ${order} LIMIT ?`).all(...args,limit+1),more=rows.length>limit;
  const items=rows.slice(0,limit);if(order==='DESC')items.reverse();
  const high=db.prepare('SELECT coalesce(max(id),0) n FROM activity_journal').get().n;
  const states=tasks();return {instance,items:items.map(r=>{const p=r.kind==='pipeline'?db.prepare('SELECT topic_id,news_id FROM research_pipeline_items WHERE id=?').get(r.entity_id):null;return {id:r.id,at:r.at,kind:r.kind,lane:r.lane,action:r.action,entityId:r.entity_id,topicId:r.topic_id||p?.topic_id||null,newsId:r.news_id||p?.news_id||null,correlation:r.correlation,detail:{...JSON.parse(r.detail),...((r.kind==='model'||r.kind.endsWith('-model'))&&db.prepare(`SELECT 1 WHERE ${automaticRunPredicate('?')}`).get(r.entity_id)?{automatic:true}:{}),...(r.kind==='pipeline'?{title:db.prepare("SELECT json_extract(payload,'$.title') title FROM research_pipeline_items WHERE id=?").get(r.entity_id)?.title||JSON.parse(r.detail).title}: {})}};}),processing:db.prepare(`SELECT * FROM (${['model_research_runs','material_event_runs','company_entity_runs','semantic_runs'].map(table=>`SELECT id,${table==='semantic_runs'?"NULL":"topic_id"} AS topicId,json_extract(payload,'$.createdAt') AS createdAt,${table==='semantic_runs'?"coalesce(json_extract(payload,'$.packet.input.left.title'),'关联比较')":"coalesce((SELECT json_extract(t.payload,'$.title') FROM research_topics t WHERE t.id=topic_id),json_extract(payload,'$.packet.input.title'),'模型研判')"} AS title FROM ${table} WHERE status='running' AND expires_at>=?`).join(' UNION ALL ')}) ORDER BY createdAt LIMIT 20`).all(now(),now(),now(),now()),cursor:after!==null&&more?items.at(-1).id:high,olderCursor:items[0]?.id??null,hasMore:more,tasks:states,serverTime:new Date(now()).toISOString()};
 }
 function page(input){if(db.isTransaction)return readPage(input);db.exec('BEGIN');try{const result=readPage(input);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 return {page};
}
