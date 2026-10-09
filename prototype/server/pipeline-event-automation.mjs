import {companyEntitiesPacket} from './company-entities.mjs';
import {SYSTEM_RESEARCH_ACTOR as actor} from './research-actor.mjs';

const terminal=new Set(['completed','no-signal','observing','invalidated','cancelled']);
const system=d=>d?.actor?.kind===actor.kind&&d.actor.policy===actor.policy;
const normalized=v=>v.normalize('NFKC').trim().toLocaleLowerCase('en-US');
// An exact alias must identify one security in the frozen directory, including
// all A/H/ADR alternatives. This is a research association, never listing proof.
export function automaticIdentity(mention,directory){
 if(mention.entityType!=='company'||mention.resolution!=='candidate'||mention.symbols.length!==1)return null;
 const matches=directory.filter(c=>[c.name,...(c.aliases||[])].some(n=>normalized(n)===normalized(mention.name)));
 return matches.length===1&&matches[0].symbol===mention.symbols[0]?matches[0].symbol:null;
}

export function openPipelineEventAutomation({db,store,research,models,extractions,entities,now,guard,transaction,audit,read,runOf,valid,insert,childPlan,relations}){
 const at=()=>new Date(now()).toISOString();
 const save=(row,status,extra,context)=>transaction(()=>{
  context.assertActive();guard();const latest=read(row.id);
  if(latest.payload!==row.payload||latest.status!==row.status||latest.run_id!==row.run_id)throw Error('自动研究队列已变化');
  db.prepare('UPDATE research_pipeline_event_jobs SET status=?,payload=? WHERE id=?').run(status,JSON.stringify({...JSON.parse(row.payload),...extra}),row.id);
  audit(row.item_id,'automatic-event-'+status,{jobId:row.id,kind:row.kind,...extra});
 });
 function advanceToDossier(row,p,context,extra={}){
  const topic=research.get(row.topic_id),plan=childPlan(row,topic,'dossier',p);
  transaction(()=>{
   context.assertActive();guard();const latest=read(row.id);if(latest.payload!==row.payload||latest.status!==row.status)throw Error('自动研究队列已变化');
   valid({...plan,payload:JSON.stringify(plan.payload)});insert(plan,plan.payload);
   db.prepare("UPDATE research_pipeline_event_jobs SET status='completed',payload=? WHERE id=?").run(JSON.stringify({...p,...extra,finishedAt:at()}),row.id);
   audit(row.item_id,'automatic-identity-completed',{jobId:row.id,dossierJobId:plan.id,...extra});
  });
 }
 function identityCurrent(row,p,run){
  // Resume only our own already committed links. A user's edit wins and stops
  // automatic mutation of this topic; unrelated source items continue.
  const decisions=run.reviews.flat().filter(d=>d.action==='link');
  if(decisions.some(d=>!system(d)))throw Error('公司关系已有人工处理');
  const version=p.topicVersion+decisions.length;
  if(research.get(row.topic_id).version!==version||store.newsById(p.newsId)?.revision!==p.newsRevision)throw Error('研究或来源已有新版本');
  const packet=companyEntitiesPacket(store,research,row.topic_id,{...p.request,version});
  if(packet.inputHash!==p.packet.inputHash||run.stale)throw Error('身份依据已变化');
  // Validate configuration and the original packet without treating our own
  // version increments as a user edit.
  valid(row,{identityVersion:version});
 }
 return {
  settle(context){
   const rows=db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE status='running' AND json_extract(payload,'$.automatic')=1 ORDER BY rowid LIMIT 200").all();
   for(const row of rows){
    context.assertActive();guard();const p=JSON.parse(row.payload),run=runOf(row);
    if(!run||run.status==='running')continue;
    if(run.status==='cancelled'){save(row,'cancelled',{reason:'本次调用已取消，保留记录，不自动重启',finishedAt:at()},context);return {ok:true,settled:row.id};}
    if(['failed','interrupted'].includes(run.status)){
     try{valid(row);}catch{save(row,'invalidated',{reason:'来源、研究或配置已变化，保留旧调用',finishedAt:at()},context);return {ok:true,settled:row.id};}
     const attempts=db.prepare('SELECT count(*) n FROM research_pipeline_attempts WHERE item_id=?').get(row.id).n;
     if(attempts<3){
      transaction(()=>{context.assertActive();guard();valid(row);const delay=60000*2**Math.max(0,attempts-1);
       db.prepare("UPDATE research_pipeline_event_jobs SET status='queued',run_id=NULL,payload=? WHERE id=? AND run_id=?").run(JSON.stringify({...p,retryAt:now()+delay,previousRunId:row.run_id,reason:'调用未完成，后台等待限次重试'}),row.id,row.run_id);
       audit(row.item_id,'automatic-event-retry',{jobId:row.id,previousRunId:row.run_id,attempts,nextAt:new Date(now()+delay).toISOString()});
      });
     }else if(row.kind==='identity')advanceToDossier(row,p,context,{reason:'身份识别已达 3 次尝试，保留未知身份并继续事项研判',identityOutcome:'unavailable'});
     else save(row,'observing',{reason:'已达 3 次尝试，保留失败记录与观察状态；其他材料继续',finishedAt:at()},context);
     return {ok:true,settled:row.id};
    }
    if(!['candidate','adopted'].includes(run.status))continue;
    try{
     if(row.kind==='identity')identityCurrent(row,p,run);
     else if(row.kind==='dossier'&&run.status==='adopted'&&system(run)){
      if(store.newsById(p.newsId)?.revision!==p.newsRevision||research.get(row.topic_id).version!==run.acceptedVersion)throw Error('已采纳后来源或研究发生变化');
     }else valid(row);
    }catch{save(row,'invalidated',{reason:'来源、研究、目录或模型依据已变化，旧结果保留，后续新材料单独处理',finishedAt:at()},context);return {ok:true,settled:row.id};}
    if(row.kind==='extract'){
     for(let i=0;i<run.candidate.decomposition.events.length;i++){
      context.assertActive();guard();valid(row);
      const latest=extractions.get(row.topic_id,run.id).reviews[i][0];
      if(latest)continue; // Never replace a user's create/reject or a committed system decision.
      extractions.decide(row.topic_id,run.id,{action:'create',eventIndex:i,version:0,note:'系统按冻结正文识别事项；引用、主体、时间与影响仍待核实'},actor);
     }
     save(row,run.candidate.decomposition.events.length?'completed':'no-signal',{finishedAt:at(),reason:run.candidate.decomposition.events.length?'事项识别完成，后续身份与研判自动继续':'本次正文未识别出具体事项；保留输入、模型结果与遗漏范围'},context);
    }else if(row.kind==='identity'){
     const unresolved=[];
     for(let i=0;i<run.candidate.resolution.mentions.length;i++){
      context.assertActive();guard();const current=entities.get(row.topic_id,run.id);identityCurrent(row,p,current);
      if(current.reviews[i][0])continue;
      const mention=run.candidate.resolution.mentions[i],symbol=automaticIdentity(mention,run.packet.input.directory);
      if(!symbol||research.get(row.topic_id).companies.some(c=>c.symbol===symbol)){unresolved.push({mentionIndex:i,name:mention.name,resolution:mention.resolution,reason:symbol?'已有公司关系，保留现有判断':'身份或交易市场不唯一，保留观察'});continue;}
      entities.decide(row.topic_id,run.id,{action:'link',mentionIndex:i,version:0,topicVersion:research.get(row.topic_id).version,symbol,note:'系统依据原文名称与冻结目录唯一对应，记录待核实公司关联；不表示已上市、可交易或受益'},actor);
     }
     advanceToDossier(row,p,context,{identityOutcome:unresolved.length?'unresolved':'processed',unresolved,reason:unresolved.length?'部分身份不确定，研判继续并保留未知项':'身份处理完成，公司关系仍为待核实'});
    }else{
     if(run.status==='candidate')models.adopt(row.topic_id,run.id,{version:p.topicVersion},actor);
     const adopted=models.get(row.topic_id,run.id),topic=research.get(row.topic_id);
     if(!system(adopted)||topic.version!==adopted.acceptedVersion||topic.dossier?.sourceModelRun?.id!==run.id){save(row,'observing',{reason:'研判已被后续编辑，保留当前内容',finishedAt:at()},context);return {ok:true,settled:row.id};}
     // Relations freeze the adopted version, not the pre-adoption draft.
     const item={id:row.id,news_id:p.newsId,revision:p.newsRevision,automatic:true},plan=relations?.plan(item,topic);
     transaction(()=>{context.assertActive();guard();if(plan)relations.persist(item,plan);
      db.prepare("UPDATE research_pipeline_event_jobs SET status='completed',payload=? WHERE id=?").run(JSON.stringify({...p,finishedAt:at(),reason:'系统研判已保存，事实未获人工确认',adoptedVersion:topic.version,...(plan?{relationCoverage:plan.coverage}:{})}),row.id);
      audit(row.item_id,'automatic-dossier-completed',{jobId:row.id,topicId:topic.id,version:topic.version,runId:run.id});
     });
    }
    return {ok:true,settled:row.id};
   }
   return null;
  },
  refreshSources(context){
   transaction(()=>{context.assertActive();guard();
    for(const source of db.prepare("SELECT * FROM research_pipeline_items WHERE status='processing'").all()){
     const jobs=db.prepare('SELECT * FROM research_pipeline_event_jobs WHERE item_id=?').all(source.id),extract=jobs.find(j=>j.kind==='extract');if(!extract||!terminal.has(extract.status))continue;
     let status=extract.status;
     if(status==='completed'){
      const children=db.prepare("SELECT count(*) n FROM material_event_decisions WHERE run_id=? AND json_extract(payload,'$.action')='create'").get(extract.run_id).n;
      const dossiers=jobs.filter(j=>j.kind==='dossier');
      if(jobs.some(j=>j.kind==='identity'&&['invalidated','cancelled','observing'].includes(j.status)))status='observing';
      else if(dossiers.length!==children||dossiers.some(j=>!terminal.has(j.status)))continue;
      if(status!=='observing')status=dossiers.some(j=>j.status!=='completed')?'observing':'completed';
     }
     db.prepare('UPDATE research_pipeline_items SET status=?,payload=? WHERE id=?').run(status,JSON.stringify({...JSON.parse(source.payload),finishedAt:at(),reason:status==='completed'?'系统研判完成，事件关系比较另行继续':JSON.parse(extract.payload).reason}),source.id);
     audit(source.id,'automatic-source-'+status,{eventJobId:extract.id});
    }
   });
  }
 };
}
