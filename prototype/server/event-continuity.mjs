import {readFileSync} from 'node:fs';
import {hash} from './providers.mjs';
import {classifyHeadline} from './triage.mjs';
import {companyIdentity} from '../shared/company-directory.mjs';

export const CONTINUITY_VERSION='event-continuity/0.1.0';
export const CONTINUITY_RULES_HASH=hash(['./event-continuity.mjs','./triage.mjs','./event-routing.mjs','../shared/headline-screening.mjs','../shared/company-directory.mjs','../shared/securities.mjs'].map(path=>readFileSync(new URL(path,import.meta.url),'utf8')).join('\n'));
const ruleKey=`${CONTINUITY_VERSION}@${CONTINUITY_RULES_HASH}`;
const stop=new Set('blocks bill prices rise fall gains losses about today says trading lawmakers unveils unveil court government official officials of at to on in by as is it be an a this that also says reported company companies firm firms news its announces announced the and with from said says after before will would could their for has have was were are had not new report reports reuters company shares stock market billion million plans year announced announces announcement update updates denies denied sources says reportedly acquisition acquire acquires merger deal'.split(' '));
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
const normalized=value=>String(value||'').toLowerCase().replace(/\s*[-–|]\s*reuters\s*$/iu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const terms=value=>[...new Set([...segmenter.segment(normalized(value))].filter(x=>x.isWordLike&&x.segment.length>=2&&!stop.has(x.segment)).map(x=>x.segment))];
const intersects=(a,b)=>a.filter(v=>b.includes(v));
const reversal=/denies|denied|refutes|cancels?|terminates?|withdraws?|否认|辟谣|终止|撤回/iu;

export function originFamily(item){
 const attributed=/\b(Bloomberg|Politico|WSJ|Wall Street Journal|Financial Times|The Information)\b.{0,18}\breports?\b/iu.exec(item.title||'');
 const name=attributed?.[1]||item.publisher||item.sourceName||'';
 const key=/reuters|路透/iu.test(name)?'reuters':/bloomberg/iu.test(name)?'bloomberg':/wall street journal|wsj/iu.test(name)?'wsj':normalized(name)||'unknown';
 return {key,label:name||'来源未知',basis:attributed?'标题转述来源':'来源标签',independence:'unverified',note:'来源家族仅用于避免转载重复计数；是否独立取证仍待核对'};
}

export function describeNews(news){
 const triage=classifyHeadline(news);
 return {id:news.id,revision:news.revision,title:news.title,url:news.url,publishedAt:news.publishedAt,availableAt:news.revisionFirstSeen||news.firstSeen,
  terms:terms(news.title),normalized:normalized(news.title),issuers:[...new Set(triage.companies.map(c=>companyIdentity(c.symbol).issuerKey))],symbols:triage.companies.map(c=>c.symbol),
  categories:triage.matchedRules,stage:triage.stage,messageStatus:triage.messageStatus,bucket:triage.bucket,urgency:triage.screening.urgency,urgencyReason:triage.screening.urgencyReason,
  origin:originFamily(news),materiality:triage.screening,version:CONTINUITY_VERSION,rulesHash:CONTINUITY_RULES_HASH};
}

export function compareReports(a,b){
 const gap=Math.abs(Date.parse(a.publishedAt)-Date.parse(b.publishedAt));
 if(!Number.isFinite(gap)||gap>90*86400000)return null;
 const words=intersects(a.terms,b.terms),issuers=intersects(a.issuers,b.issuers),categories=intersects(a.categories,b.categories);
 const exact=a.normalized.length>=15&&a.normalized===b.normalized;
 const sameStory=a.url&&a.url===b.url;
 const lexical=words.length>=3&&words.length/Math.max(1,new Set([...a.terms,...b.terms]).size)>=.35;
 if(!exact&&!sameStory&&!(issuers.length&&categories.length&&words.length>=2)&&!lexical)return null;
 const changed=a.stage!==b.stage;
 const kind=exact?'repeat':!sameStory&&!issuers.length&&(a.issuers.length||b.issuers.length)?'analogy':changed&&(reversal.test(a.title)||reversal.test(b.title))?'counterevidence':changed?'followup':'related';
 return {kind,reasons:[...(kind==='analogy'?['公司主体没有匹配，只可作行业或历史类比，不能归成同一事件']:[]),...(exact?['标题规范化后相同；可能为转载或重复报道']:[]),...(sameStory?['来源链接相同，需检查修订']:[]),...(issuers.length?['提及同一发行人']:[]),...(categories.length?[`相同事件规则：${categories.join('、')}`]:[]),...(!exact&&words.length?[`共同线索：${words.slice(0,6).join('、')}`]:[]),...(changed?[`阶段表述对照：本条为${a.stage}；历史为${b.stage}`]:[])],rank:exact?100:sameStory?90:issuers.length?70:kind==='analogy'?30:50};
}

export function researchPriority(record,{positions=[],watchlist=[],relatedTopicIds=[],repeat=false}={}){
 const held=positions.filter(p=>record.symbols.includes(p.symbol)||relatedTopicIds.includes(p.topicId)).map(p=>p.symbol);
 const watched=watchlist.filter(w=>record.symbols.includes(w.symbol)).map(w=>w.symbol);
 const urgent=record.urgency==='priority';
 const level=urgent&&held.length?'urgent':urgent||record.bucket==='review'?'high':record.bucket==='clue'||relatedTopicIds.length?'normal':'low';
 return {level,held:[...new Set(held)],watched,reasons:[...(held.length?[`涉及持仓或持仓研究：${[...new Set(held)].join('、')}`]:[]),...(urgent?[record.urgencyReason]:[]),...(relatedTopicIds.length?['有既有研究可比对']:[]),...(repeat?['有重复标题候选；不按报道数量提高优先级']:[]),...(!urgent?[record.bucket==='review'?'事件规则命中，先补相对量级与预期差':'保留线索并复核漏筛']:[])],materiality:'unassessed',tradeSignal:false};
}

export function openContinuity(store,{clock=()=>new Date().toISOString()}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS event_descriptors(news_id TEXT NOT NULL,revision INTEGER NOT NULL,rule_version TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(news_id,revision,rule_version));
 CREATE TABLE IF NOT EXISTS event_link_candidates(id TEXT PRIMARY KEY,pair_key TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS event_candidate_pair ON event_link_candidates(pair_key);
 CREATE TABLE IF NOT EXISTS event_link_decisions(candidate_id TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL,note TEXT NOT NULL,decided_at TEXT NOT NULL,PRIMARY KEY(candidate_id,version));`);
 let memoKey='',currentIds=new Set(),currentPayloads=new Map(),records=[],coverage={};
 const decisions=id=>db.prepare('SELECT version,state,note,decided_at AS at FROM event_link_decisions WHERE candidate_id=? ORDER BY version DESC').all(id);
 const read=id=>{const row=db.prepare('SELECT payload,created_at FROM event_link_candidates WHERE id=?').get(id);if(!row)throw new Error('事件线索不存在');const history=decisions(id);return {...JSON.parse(row.payload),createdAt:row.created_at,state:history[0]?.state||'pending',decisionVersion:history[0]?.version||0,history,current:currentIds.has(id)};};
 function process(topics){
  // Index the newest 2,000 locally received revisions. Older research remains available for recall.
  const rows=db.prepare('SELECT id,revision FROM news ORDER BY rowid DESC LIMIT 2000').all();
  const topicSet=[...topics].sort((a,b)=>(b.updatedAt||b.createdAt||'').localeCompare(a.updatedAt||a.createdAt||'')||a.id.localeCompare(b.id)).slice(0,500);
  const key=hash(JSON.stringify([rows,topicSet.map(t=>[t.id,t.version]),ruleKey]));
  if(key===memoKey)return false;
  const nextIds=new Set(),nextPayloads=new Map(),nextRecords=[];
  const topicIndex=topicSet.map(topic=>({topic,terms:terms([topic.title,...(topic.evidence||[]).map(e=>e.claim)].join(' ')),issuers:[...new Set(topic.companies.map(c=>companyIdentity(c.symbol).issuerKey))]}));
  db.exec('BEGIN IMMEDIATE');try{
   for(const row of rows){let saved=db.prepare('SELECT payload FROM event_descriptors WHERE news_id=? AND revision=? AND rule_version=?').get(row.id,row.revision,ruleKey);
    if(!saved){const payload=JSON.stringify(describeNews(store.newsById(row.id)));db.prepare('INSERT INTO event_descriptors VALUES(?,?,?,?,?)').run(row.id,row.revision,ruleKey,payload,clock());saved={payload};}
    nextRecords.push(JSON.parse(saved.payload));
   }
   const add=value=>{const pairKey=hash(JSON.stringify([value.type,...(value.type==='news'?[value.left.id,value.right.id].sort():[value.left.id,value.right.id])]));const id=hash(JSON.stringify([pairKey,value.left.id,value.left.revision,value.right.id,value.right.revision,value.right.version,ruleKey]));
    const payload={...value,id,pairKey,ruleVersion:CONTINUITY_VERSION,rulesHash:CONTINUITY_RULES_HASH};db.prepare('INSERT OR IGNORE INTO event_link_candidates VALUES(?,?,?,?)').run(id,pairKey,JSON.stringify(payload),clock());nextIds.add(id);nextPayloads.set(id,payload);};
   // Inverted terms bound comparison work; generic company-only mentions are not enough.
   const inverted=new Map();
   for(const current of nextRecords){const neighbors=new Map();for(const term of current.terms)for(const i of inverted.get(term)||[])neighbors.set(i,(neighbors.get(i)||0)+1);
    const candidates=[...neighbors].filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,80).map(([i])=>nextRecords[i]);
    const matches=candidates.map(other=>{const newest=(Date.parse(current.availableAt)-Date.parse(other.availableAt)||Date.parse(current.publishedAt)-Date.parse(other.publishedAt)||current.id.localeCompare(other.id))>=0?current:other,older=newest===current?other:current;const match=compareReports(newest,older);return match?{type:'news',left:newest,right:older,...match}:null;}).filter(Boolean).sort((a,b)=>b.rank-a.rank||a.right.id.localeCompare(b.right.id)).slice(0,5);
    matches.forEach(add);
    const index=nextRecords.indexOf(current);for(const term of current.terms){if(!inverted.has(term))inverted.set(term,[]);inverted.get(term).push(index);}
    const topicMatches=topicIndex.map(({topic,terms:topicTerms,issuers:topicIssuers})=>{const overlap=intersects(current.terms,topicTerms),issuers=intersects(current.issuers,topicIssuers);const source=(topic.evidence||[]).some(e=>e.newsId===current.id||e.url&&e.url===current.url);
     if(!source&&!(overlap.length>=2&&issuers.length)&&!(overlap.length>=3&&overlap.length/Math.max(1,current.terms.length)>=.55))return null;
     return {topic,rank:source?100:issuers.length?70:50,reasons:[...(source?['与研究已有来源相同，检查是否发生修订']:[]),...(issuers.length?['与研究涉及同一发行人']:[]),`共同线索：${overlap.slice(0,6).join('、')||'来源匹配'}`]};
    }).filter(Boolean).sort((a,b)=>b.rank-a.rank||a.topic.id.localeCompare(b.topic.id)).slice(0,5);
    for(const {topic,rank,reasons} of topicMatches)add({type:'topic',left:current,right:{id:topic.id,version:topic.version,title:topic.title,status:topic.status},kind:reversal.test(current.title)?'counterevidence':'related',rank,reasons});
   }
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  records=nextRecords;currentIds=nextIds;currentPayloads=nextPayloads;memoKey=key;
  coverage={newsIndexed:rows.length,newsTotal:db.prepare('SELECT COUNT(*) n FROM news').get().n,topicsIndexed:topicSet.length,topicsTotal:topics.length,newsPairWindowDays:90,neighborLimit:80,newsMatchesPerNews:5,topicMatchesPerNews:5,method:'标题、来源与有限实体目录检索；并非全文语义识别，未命中不代表无关'};
  return true;
 }
 function currentCandidates(){
  const latest=new Map(db.prepare('SELECT d.candidate_id,d.version,d.state FROM event_link_decisions d JOIN (SELECT candidate_id,MAX(version) v FROM event_link_decisions GROUP BY candidate_id) x ON d.candidate_id=x.candidate_id AND d.version=x.v').all().map(d=>[d.candidate_id,d]));
  return [...currentPayloads.values()].map(p=>({...p,state:latest.get(p.id)?.state||'pending',decisionVersion:latest.get(p.id)?.version||0,current:true}));
 }
 function snapshot({positions=[],watchlist=[],state='pending',q='',offset=0,limit=40}={}){
  if(!['pending','linked','dismissed','all'].includes(state)||typeof q!=='string'||q.length>120||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('事件线索筛选参数无效');
  const all=currentCandidates();
  const rank={urgent:0,high:1,normal:2,low:3};
  const enrich=c=>{const first=researchPriority(c.left,{positions,watchlist,relatedTopicIds:c.type==='topic'?[c.right.id]:[],repeat:c.kind==='repeat'}),second=c.type==='news'?researchPriority(c.right,{positions,watchlist,repeat:c.kind==='repeat'}):null;return {...c,priority:second&&rank[second.level]<rank[first.level]?{...second,reasons:['配对报道需要优先复核',...second.reasons]}:first};};
  const items=all.filter(c=>(state==='all'||c.state===state)&&(!q||`${c.left.title} ${c.right.title} ${c.left.symbols.join(' ')}`.toLowerCase().includes(q.toLowerCase()))).map(enrich).sort((a,b)=>rank[a.priority.level]-rank[b.priority.level]||b.rank-a.rank||b.left.availableAt.localeCompare(a.left.availableAt)||a.id.localeCompare(b.id));
  return {items:items.slice(offset,offset+limit),total:items.length,offset,limit,counts:{pending:all.filter(c=>c.state==='pending').length,linked:all.filter(c=>c.state==='linked').length,dismissed:all.filter(c=>c.state==='dismissed').length},coverage,ruleVersion:CONTINUITY_VERSION,rulesHash:CONTINUITY_RULES_HASH,tradeSignal:false};
 }
 return {process,snapshot,
  summary(){const all=currentCandidates();return {counts:{pending:all.filter(c=>c.state==='pending').length,linked:all.filter(c=>c.state==='linked').length,dismissed:all.filter(c=>c.state==='dismissed').length},coverage};},
  detail(id){const item=read(id);const ids=[item.left.id,...(item.type==='news'?[item.right.id]:[])];const previousDecisions=db.prepare('SELECT id FROM event_link_candidates WHERE pair_key=? AND id<>? ORDER BY created_at DESC,rowid DESC LIMIT 30').all(item.pairKey,id).map(r=>read(r.id)).filter(c=>c.history.length).map(c=>({id:c.id,leftRevision:c.left.revision,rightRevision:c.right.revision,topicVersion:c.right.version,history:c.history,current:c.current}));return {...item,previousDecisions,revisions:ids.flatMap(newsId=>{const seen=new Set();return db.prepare('SELECT payload,created_at FROM event_descriptors WHERE news_id=? ORDER BY (rule_version=?) DESC,revision DESC,created_at DESC').all(newsId,ruleKey).map(r=>({...JSON.parse(r.payload),indexedAt:r.created_at})).filter(r=>{if(seen.has(r.revision))return false;seen.add(r.revision);return true;});}),originFamilies:[...new Set([item.left.origin?.key,item.right.origin?.key].filter(Boolean))],independentSourceCount:null};},
  decide(id,data){db.exec('BEGIN IMMEDIATE');try{const item=read(id);if(!item.current||store.newsById(item.left.id)?.revision!==item.left.revision||item.type==='news'&&store.newsById(item.right.id)?.revision!==item.right.revision)throw new Error('输入已有新版本，请重新检索；旧决定仍保留');
   if(item.type==='topic'&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_topics'").get()){const topic=db.prepare('SELECT payload FROM research_topics WHERE id=?').get(item.right.id);if(!topic||JSON.parse(topic.payload).version!==item.right.version)throw new Error('研究输入已有新版本，请重新检索');}
   if(!['linked','dismissed','pending'].includes(data.state)||typeof data.note!=='string'||!data.note.trim()||data.note.trim().length>1200||Object.keys(data).some(k=>!['state','note','version'].includes(k)))throw new Error('选择关系状态并填写 1–1200 字的依据');
   if(data.version!==item.decisionVersion)throw new Error('线索决定已变化，请刷新后重试');
   if(data.state===item.state)throw new Error('线索状态没有变化');
   // One append-only decision changes organization only: no evidence, account or order is rewritten.
   db.prepare('INSERT INTO event_link_decisions VALUES(?,?,?,?,?)').run(id,item.decisionVersion+1,data.state,data.note.trim(),clock());db.exec('COMMIT');return read(id);
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  queue({positions=[],watchlist=[]}={}){const links=currentCandidates().filter(c=>c.state!=='dismissed'),topicsByNews=new Map(),repeated=new Set();
   for(const c of links){if(c.type==='topic'){if(!topicsByNews.has(c.left.id))topicsByNews.set(c.left.id,[]);topicsByNews.get(c.left.id).push(c.right.id);}if(c.kind==='repeat'){repeated.add(c.left.id);repeated.add(c.right.id);}}
   const rank={urgent:0,high:1,normal:2,low:3};return records.map(r=>({...r,priority:researchPriority(r,{positions,watchlist,relatedTopicIds:topicsByNews.get(r.id)||[],repeat:repeated.has(r.id)})})).sort((a,b)=>rank[a.priority.level]-rank[b.priority.level]||b.availableAt.localeCompare(a.availableAt));},
 };
}
