import {digest,CODEX_PROMPT_VERSION,CODEX_DRAFT_SCHEMA,CODEX_SCHEMA_VERSION} from './codex-research.mjs';
import {READER_VERSION} from './source-reader.mjs';
import {INTAKE_SOURCE_VERSION} from './pipeline-intake-source.mjs';

export const pipelineExecutionBasis=(config,reader=READER_VERSION)=>({model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs??180000,prompt:CODEX_PROMPT_VERSION,schema:CODEX_DRAFT_SCHEMA,schemaVersion:CODEX_SCHEMA_VERSION,reader});
// Only the known reader change is compatible with already-started work. The
// stage owners still revalidate their complete frozen packets and decisions.
export function pipelineReaderContinuation(db,config,key){
 const next=pipelineExecutionBasis(config),nextHash=digest(next);
 const readers=READER_VERSION==='public-article-13'?['public-article-10','public-article-11','public-article-12']:READER_VERSION==='public-article-12'?['public-article-10','public-article-11']:READER_VERSION==='public-article-11'?['public-article-10']:[];
 const saved=db.prepare('SELECT payload FROM research_pipeline_execution_bases WHERE hash=?').get(key);
 let old;
 if(saved){try{old=JSON.parse(saved.payload);}catch{return null;}if(!old||digest(old)!==key)return null;}
 else old=[next,...readers.map(reader=>pipelineExecutionBasis(config,reader))].find(value=>digest(value)===key);
 if(!old||key!==nextHash&&!readers.includes(old.reader)||digest({...old,reader:next.reader})!==nextHash)return null;
 return {version:'reader-continuation/1',fromExecutionHash:key,toExecutionHash:nextHash,fromReader:old.reader,toReader:next.reader,basis:old};
}
const columns='id,news_id,revision,rules_hash,status,topic_id,run_id,payload';
const table=name=>`CREATE TABLE ${name}(id TEXT PRIMARY KEY,news_id TEXT NOT NULL,revision INTEGER NOT NULL,rules_hash TEXT NOT NULL,status TEXT NOT NULL,topic_id TEXT,run_id TEXT,payload TEXT NOT NULL)`;

export function initializePipelineSourceGenerations(db){
 // Preserve the eight-column layout and rowids used by existing queue history.
 // Only our original three-column UNIQUE constraint is replaced. User indexes
 // and triggers are recreated verbatim inside the same atomic migration.
 const legacy=db.prepare("SELECT name FROM pragma_index_list('research_pipeline_items') WHERE origin='u'").all().some(i=>db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(i.name).map(c=>c.name).join(',')==='news_id,revision,rules_hash');
 db.exec('SAVEPOINT pipeline_source_generations');
 try{
  if(legacy){
   if(db.prepare("SELECT name FROM pragma_table_xinfo('research_pipeline_items') ORDER BY cid").all().map(c=>c.name).join(',')!==columns)throw Error('自动研究队列表存在额外字段，保留原结构');
   for(const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all())if(db.prepare('SELECT 1 FROM pragma_foreign_key_list(?) WHERE "table"=?').get(row.name,'research_pipeline_items'))throw Error('自动研究队列表存在额外外键，保留原结构');
   const extras=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='research_pipeline_items' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name").all();
   db.exec(table('research_pipeline_items_generations'));
   db.exec(`INSERT INTO research_pipeline_items_generations(rowid,${columns}) SELECT rowid,${columns} FROM research_pipeline_items ORDER BY rowid`);
   db.exec('DROP TABLE research_pipeline_items; ALTER TABLE research_pipeline_items_generations RENAME TO research_pipeline_items');
   for(const row of extras)db.exec(row.sql);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS research_pipeline_current_source ON research_pipeline_items(news_id,revision,rules_hash) WHERE status<>'superseded'; CREATE TABLE IF NOT EXISTS research_pipeline_execution_bases(hash TEXT PRIMARY KEY,payload TEXT NOT NULL)");
  db.exec('RELEASE pipeline_source_generations');
 }catch(error){db.exec('ROLLBACK TO pipeline_source_generations; RELEASE pipeline_source_generations');throw error;}
}

export function openPipelineSourceUpgrades(store,research,{config,settings,now,transaction,audit}){
 const db=store.db,basis=()=>pipelineExecutionBasis(config),hash=()=>digest(basis());
 const sameModel=(a,b)=>['model','binary','effort','timeoutMs'].every(k=>a[k]===b[k]);
 const capture=()=>{const value=basis(),key=digest(value),row=db.prepare('SELECT payload FROM research_pipeline_execution_bases WHERE hash=?').get(key);if(row){if(digest(JSON.parse(row.payload))!==key)throw Error('自动研究执行依据损坏');}else db.prepare('INSERT INTO research_pipeline_execution_bases VALUES(?,?)').run(key,JSON.stringify(value));return {value,key};};
 return {
  hash,capture,
  compatible:key=>!!pipelineReaderContinuation(db,config,key),
  recordContinuations(context){
   if(!settings().automatic||db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return null;
   const rows=db.prepare("SELECT DISTINCT json_extract(payload,'$.executionHash') hash FROM research_pipeline_items WHERE json_extract(payload,'$.configuration.automatic')=1 AND status NOT IN ('superseded','cancelled','invalidated')").all();
   const proofs=rows.map(r=>pipelineReaderContinuation(db,config,r.hash)).filter(p=>p&&p.fromExecutionHash!==p.toExecutionHash&&!db.prepare("SELECT 1 FROM research_pipeline_audit WHERE action='automatic-reader-continuation' AND json_extract(payload,'$.fromExecutionHash')=? AND json_extract(payload,'$.toExecutionHash')=?").get(p.fromExecutionHash,p.toExecutionHash));
   if(!proofs.length)return null;
   return transaction(()=>{context.assertActive();capture();for(const {basis:old,...proof} of proofs){db.prepare('INSERT OR IGNORE INTO research_pipeline_execution_bases VALUES(?,?)').run(proof.fromExecutionHash,JSON.stringify(old));audit(null,'automatic-reader-continuation',proof);}return {ok:true,readerContinuations:proofs.length};});
  },
  step(context){
   const current=settings();if(!current.automatic||db.prepare('SELECT 1 FROM model_job_lease WHERE expires_at>=?').get(now()))return null;
   const next=basis(),nextHash=digest(next),allowed=new Map();
   for(const row of db.prepare('SELECT * FROM research_pipeline_execution_bases').all()){
    let old;try{old=JSON.parse(row.payload);}catch{continue;}if(!old||digest(old)!==row.hash)continue;
    if(row.hash!==nextHash&&sameModel(old,next))allowed.set(row.hash,old);
   }
   // Known pre-registry bridge: reconstruct the exact old hash with the SAME
   // model, settings, prompt and schema. An unknown old hash is never guessed.
   for(const reader of READER_VERSION==='public-article-13'?['public-article-10','public-article-11','public-article-12']:READER_VERSION==='public-article-12'?['public-article-10','public-article-11']:READER_VERSION==='public-article-11'?['public-article-10']:[]){
    const old=pipelineExecutionBasis(config,reader),key=digest(old),saved=db.prepare('SELECT payload FROM research_pipeline_execution_bases WHERE hash=?').get(key);
    if(!saved)allowed.set(key,old);
   }
   if(!allowed.size)return null;
   // Filter protected history before the batch limit so it cannot hide later
   // eligible work. Read source identities directly, without projecting every
   // dossier and revalidating its archived materials on each idle tick.
   const candidates=db.prepare(`SELECT p.* FROM research_pipeline_items p JOIN news n ON n.id=p.news_id AND n.revision=p.revision
    WHERE p.status IN ('queued','skipped') AND p.topic_id IS NULL AND p.run_id IS NULL AND p.rules_hash=?
    AND json_extract(p.payload,'$.configuration.automatic')=1
    AND json_extract(p.payload,'$.executionHash') IN (SELECT value FROM json_each(?))
    AND coalesce(json_extract(n.payload,'$.provider'),'')<>'linked-public-source'
    AND NOT coalesce(json_extract(p.payload,'$.prepareAttempts'),0)
    AND coalesce(json_extract(p.payload,'$.preparationFailure'),'')=''
    AND coalesce(json_extract(p.payload,'$.intakeFailure'),'')=''
    AND coalesce(json_extract(p.payload,'$.eventJobId'),'')=''
    AND (json_extract(p.payload,'$.intakeSource') IS NULL OR json_extract(p.payload,'$.intakeSource.status')='ready')
    AND (p.status='queued' OR (? AND json_extract(p.payload,'$.configuration.screenUnselected')=1 AND json_extract(p.payload,'$.intakeScreening') IS NULL))
    AND NOT EXISTS(SELECT 1 FROM research_pipeline_attempts a WHERE a.item_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM research_pipeline_event_jobs e WHERE e.item_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM intake_screening_members m JOIN intake_screening_batches b ON b.id=m.batch_id WHERE m.item_id=p.id AND b.status<>'completed')
    AND NOT EXISTS(SELECT 1 FROM research_topics t WHERE json_extract(t.payload,'$.sourceNewsId')=p.news_id AND json_extract(t.payload,'$.sourceNewsRevision')=p.revision)
    ORDER BY p.rowid LIMIT 200`).all(research.screenings.rulesHash,JSON.stringify([...allowed.keys()]),Number(current.screenUnselected));
   if(!candidates.length)return null;
   return transaction(()=>{
    context.assertActive();capture();let count=0;
    for(const row of candidates){
     const p=JSON.parse(row.payload),news=store.newsById(row.news_id);
     if(!news||news.revision!==row.revision||news.provider==='linked-public-source'||p.prepareAttempts||p.preparationFailure||p.intakeFailure||p.eventJobId)continue;
     if(p.intakeSource&&!['ready'].includes(p.intakeSource.status))continue;
     if(row.status==='skipped'&&(p.intakeScreening||p.configuration.screenUnselected!==true||!current.screenUnselected))continue;
     if(db.prepare('SELECT 1 FROM research_pipeline_attempts WHERE item_id=?').get(row.id)||db.prepare('SELECT 1 FROM research_pipeline_event_jobs WHERE item_id=?').get(row.id))continue;
     if(db.prepare("SELECT 1 FROM intake_screening_members m JOIN intake_screening_batches b ON b.id=m.batch_id WHERE m.item_id=? AND b.status<>'completed'").get(row.id))continue;
     const latest=db.prepare('SELECT * FROM research_pipeline_items WHERE id=?').get(row.id);if(latest.payload!==row.payload||latest.status!==row.status)continue;
     const at=new Date(now()).toISOString(),id=digest({news:row.news_id,revision:row.revision,rules:row.rules_hash,executionHash:nextHash,predecessor:row.id});
     db.prepare('INSERT OR IGNORE INTO research_pipeline_execution_bases VALUES(?,?)').run(p.executionHash,JSON.stringify(allowed.get(p.executionHash)));
     const upgrade={version:'automatic-source-upgrade/1',successorId:id,fromExecutionHash:p.executionHash,toExecutionHash:nextHash,at};
     db.prepare("UPDATE research_pipeline_items SET status='superseded',payload=? WHERE id=?").run(JSON.stringify({...p,executionUpgrade:upgrade}),row.id);
     const payload={title:p.title,createdAt:at,screening:p.screening,configuration:current,executionHash:nextHash,selectionReason:row.status==='queued'?'source-execution-successor':'screening',executionPredecessor:{id:row.id,executionHash:p.executionHash},...(row.status==='skipped'?{intakeSourceVersion:INTAKE_SOURCE_VERSION}:{}),reason:'程序升级后由新版自动任务接续；旧输入与判断保留，重新读取来源正文'};
     db.prepare(`INSERT INTO research_pipeline_items(${columns}) VALUES(?,?,?,?,?,NULL,NULL,?)`).run(id,row.news_id,row.revision,row.rules_hash,row.status,JSON.stringify(payload));
     audit(row.id,'automatic-source-upgraded',upgrade);audit(id,'automatic-source-successor',{predecessorId:row.id,executionHash:nextHash});count++;
    }
    return count?{ok:true,sourceUpgrades:count}:null;
   });
  }
 };
}
