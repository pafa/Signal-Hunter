import {hash} from './providers.mjs';
import {claimsOf} from '../shared/claims.mjs';
import {evidenceStamp,pendingCounterevidence,reviewedVersion} from '../shared/review-state.mjs';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export function observationHits(topics,book,today){
 if(!validDate(today))throw new Error('观察检查日期无效');
 const hits=[];
 for(const t of topics.filter(t=>t.status==='active')){
  const positions=(book.positions||[]).filter(p=>p.topicId===t.id||t.companies.some(c=>c.symbol===p.symbol));
  const add=(kind,reason,input)=>{const snapshot={ruleVersion:'observation/1',topicId:t.id,topicVersion:t.version,kind,input};hits.push({id:hash(JSON.stringify(snapshot)),topicId:t.id,topicVersion:t.version,title:t.title,kind,reason,symbols:positions.map(p=>p.symbol),input:snapshot});};
  const dates=[t.hypothesis?.reviewAt,...claimsOf(t).filter(c=>['open','unresolved'].includes(c.outcome)).map(c=>c.resolveBy)].filter(v=>validDate(v)&&v<=today);
  if(dates.length)add('due','观察或主张复核已到期',[...new Set(dates)].sort());
  const changed=positions.filter(p=>p.topicId===t.id&&reviewedVersion(book,p)!==t.version);
  if(changed.length)add('version','持仓关联研究已有新版本',changed.map(p=>[p.symbol,p.openedAt,reviewedVersion(book,p)]));
  const against=pendingCounterevidence(t,book,positions);
  if(against.length)add('counterevidence','持仓出现新的反向线索',against.map(evidenceStamp).sort());
 }
 return hits;
}
export function openObservationInbox(store,{clock=()=>new Date().toISOString()}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS observation_todos(id TEXT PRIMARY KEY,payload TEXT NOT NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS observation_receipts(id INTEGER PRIMARY KEY,todo_id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL,note TEXT NOT NULL,at TEXT NOT NULL);`);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 return {
  process(topics,book){const today=new Date(clock()).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),hits=observationHits(topics,book,today);return transaction(()=>{let added=0;for(const hit of hits)added+=Number(db.prepare("INSERT OR IGNORE INTO observation_todos VALUES(?,?,'pending',1,?,?)").run(hit.id,JSON.stringify(hit),clock(),clock()).changes);return {ok:true,added};});},
  snapshot(){const items=db.prepare('SELECT * FROM observation_todos ORDER BY created_at DESC,id').all().map(r=>({...JSON.parse(r.payload),state:r.state,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at}));return {items,pending:items.filter(i=>i.state!=='completed').length,policy:'已读仍待处理；回执不改变研究、风险或订单'};},
  receipts(id){return db.prepare('SELECT * FROM observation_receipts WHERE todo_id=? ORDER BY id').all(id);},
  respond(id,{revision,action,note}){if(!['read','complete','reopen'].includes(action)||typeof note!=='string'||!note.trim()||note.length>1000)throw new Error('回执动作或说明无效');return transaction(()=>{const old=db.prepare('SELECT * FROM observation_todos WHERE id=?').get(id);if(!old||old.revision!==revision)throw new Error('待办已更新，请重新打开');if(old.state==='completed'&&action!=='reopen')throw new Error('已完成待办需先重新打开');const state={read:'read',complete:'completed',reopen:'pending'}[action];db.prepare('UPDATE observation_todos SET state=?,revision=revision+1,updated_at=? WHERE id=?').run(state,clock(),id);db.prepare('INSERT INTO observation_receipts(todo_id,revision,action,note,at) VALUES(?,?,?,?,?)').run(id,revision,action,note.trim(),clock());return {id,state,revision:revision+1};});}
 };
}
