import {hash,instrument} from './providers.mjs';
import {evidenceStamp,positionReference} from '../shared/review-state.mjs';
import {CALENDAR_VERSION} from '../shared/market-clock.mjs';
import {diagnoseMarketData} from './market-diagnostics.mjs';
const ENGINE='observation-conditions/1';
const failure=message=>{throw new Error(message);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
export function observationInstant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const [date,time]=value.split('T'),[year,month,day]=date.split('-').map(Number);
 if(new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10)!==date||Number(time.slice(0,2))>23||Number(time.slice(3,5))>59||Number(time.slice(6,8))>59)return null;
 const stamp=Date.parse(value);return Number.isFinite(stamp)?stamp:null;
}
export function validateObservationDefinition(input,topic){
 if(!exact(input,['label','join','conditions'])||typeof input.label!=='string'||!input.label.trim()||input.label.length>100||!['all','any'].includes(input.join)||!Array.isArray(input.conditions)||input.conditions.length<1||input.conditions.length>8)failure('观察条件需要名称、组合方式和 1–8 项规则');
 const conditions=input.conditions.map(c=>{
  if(c?.type==='at'&&exact(c,['type','at'])&&observationInstant(c.at)!==null)return {type:c.type,at:new Date(observationInstant(c.at)).toISOString()};
  if(['research-change','counterevidence'].includes(c?.type)&&exact(c,['type']))return {type:c.type};
  if(c?.type==='price'&&exact(c,['type','symbol','interval','operator','value'])&&['1d','1m'].includes(c.interval)&&['gte','lte'].includes(c.operator)&&typeof c.value==='number'&&Number.isFinite(c.value)&&c.value>0&&c.value<=1e12&&topic.companies.some(x=>x.symbol===c.symbol)){
   const spec=instrument(c.symbol);return {type:c.type,symbol:spec.symbol,currency:spec.currency,interval:c.interval,operator:c.operator,value:c.value};
  }
  failure('观察规则无效；价格条件必须选择本研究关联证券并填写正数阈值');
 });
 return {label:input.label.trim(),join:input.join,conditions};
}
const outcome=(state,reason,input={})=>({state,reason,input});
export function evaluateObservation(rule,topic,{at,quote,check,offline=false}={}){
 const now=observationInstant(at);if(now===null)failure('观察检查时间无效');
 if(!topic||topic.status!=='active')return {state:'unknown',reason:'研究不存在或已归档',results:[]};
 const results=rule.definition.conditions.map(c=>{
  if(c.type==='at')return outcome(now>=Date.parse(c.at)?'true':'false','指定复核时间',{at:c.at});
  if(c.type==='research-change')return outcome(topic.version>rule.binding.topicVersion?'true':'false','研究版本变化',{baselineVersion:rule.binding.topicVersion,currentVersion:topic.version});
  if(c.type==='counterevidence'){
   const added=(topic.evidence||[]).filter(e=>e.stance==='against'&&!rule.binding.counterevidence.includes(evidenceStamp(e))).map(e=>({id:e.id,stamp:evidenceStamp(e),claim:e.claim,verification:e.verification}));
   return outcome(added.length?'true':'false','新增或修订的反向线索',{evidence:added});
  }
  const comparison={symbol:c.symbol,currency:c.currency,interval:c.interval,operator:c.operator,threshold:c.value};
  if(!topic.companies.some(x=>x.symbol===c.symbol))return outcome('unknown','证券已不在本研究关联公司中',comparison);
  const q=quote(c.symbol,c.interval),status=check(c.symbol,c.interval),received=observationInstant(q?.receivedAt);
  if(!q||q.symbol!==c.symbol||q.currency!==c.currency||received===null||received>now)return outcome('unknown','缺少证券、币种或接收时间一致的行情',comparison);
  const d=diagnoseMarketData(c.symbol,q,status,at,{interval:c.interval,offline});
  const provenance={symbol:c.symbol,currency:c.currency,interval:c.interval,provider:q.provider,receivedAt:q.receivedAt,dataAt:d.dataAt,dataState:d.dataState,sourceState:d.sourceState,rawProviderTime:d.rawProviderTime,quoteHash:hash(JSON.stringify(q)),calendarVersion:CALENDAR_VERSION,operator:c.operator,threshold:c.value,priceBasis:q.priceBasis||d.quoteKind,synthetic:offline,executable:false};
  // Offline examples remain visibly synthetic; online checks never infer a price from missing/stale caches.
  if(!offline&&(!d.configuredSources.includes(q.provider)||c.interval==='1m'&&Date.parse(d.dataAt)>now||d.sourceState!=='last-attempt-succeeded'||!(c.interval==='1d'?['aligned']:['recent-unverified','closed-session-cache']).includes(d.dataState)))return outcome('unknown','行情缺失、过期、来源失败或时间未核验',provenance);
  const point=c.interval==='1d'?q.points?.findLast(p=>p.date===q.lastDate&&Number.isFinite(p.close)&&p.close>0):q.points?.findLast(p=>p.time===q.providerTime&&Number.isFinite(p.close)&&p.close>0);
  if(!point)return outcome('unknown','行情时点与价格不一致',provenance);
  const matches=c.operator==='gte'?point.close>=c.value:point.close<=c.value;
  return outcome(matches?'true':'false','缓存收盘价与阈值比较',{...provenance,price:point.close,operator:c.operator,threshold:c.value});
 });
 const state=rule.definition.join==='all'?(results.some(r=>r.state==='false')?'false':results.every(r=>r.state==='true')?'true':'unknown'):(results.some(r=>r.state==='true')?'true':results.every(r=>r.state==='false')?'false':'unknown');
 return {state,reason:{true:'配置条件命中',false:'尚未满足配置条件',unknown:'部分条件无法判断'}[state],results};
}
export function openObservationRules(store,{clock=()=>new Date().toISOString(),getTopic,offline=false}={}){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS observation_rules(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS observation_rule_versions(rule_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(rule_id,version));
 CREATE TABLE IF NOT EXISTS observation_rule_checks(rule_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(rule_id,version));`);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const get=id=>{const r=db.prepare('SELECT payload FROM observation_rules WHERE id=?').get(id);if(!r)failure('观察配置不存在');return JSON.parse(r.payload);};
 const topicFor=(id,version)=>{const topic=getTopic?.(id);if(!topic||topic.status!=='active'||topic.version!==version)failure('研究已更新或归档，请刷新后再配置观察');return topic;};
 const bind=topic=>({topicVersion:topic.version,counterevidence:(topic.evidence||[]).filter(e=>e.stance==='against').map(evidenceStamp).sort()});
 const persist=r=>{db.prepare('INSERT INTO observation_rules VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,payload=excluded.payload').run(r.id,r.topicId,r.version,JSON.stringify(r));db.prepare('INSERT INTO observation_rule_versions VALUES(?,?,?)').run(r.id,r.version,JSON.stringify(r));return r;};
 return {
  get,
  list(){return db.prepare('SELECT payload FROM observation_rules ORDER BY rowid DESC').all().map(row=>{const rule=JSON.parse(row.payload),check=db.prepare('SELECT payload FROM observation_rule_checks WHERE rule_id=? AND version=?').get(rule.id,rule.version);return {...rule,check:check?JSON.parse(check.payload):null};});},
  history(id){get(id);return db.prepare('SELECT payload FROM observation_rule_versions WHERE rule_id=? ORDER BY version DESC').all(id).map(r=>JSON.parse(r.payload));},
  create(topicId,{topicVersion,clientId,...definition}){return transaction(()=>{
   if(typeof clientId!=='string'||!/^[-a-zA-Z0-9]{8,80}$/.test(clientId))failure('观察配置请求标识无效');
   const requestHash=hash(JSON.stringify({topicId,topicVersion,...definition}));
   const prior=db.prepare('SELECT payload FROM observation_rule_versions WHERE rule_id=? AND version=1').get(clientId);
   if(prior){if(JSON.parse(prior.payload).requestHash!==requestHash)failure('观察配置请求标识已用于其他内容');return get(clientId);}
   if(db.prepare('SELECT COUNT(*) n FROM observation_rules').get().n>=500)failure('观察配置已达 500 项，请复用现有配置');
   const topic=topicFor(topicId,topicVersion),at=clock();
   return persist({id:clientId,topicId,version:1,active:true,definition:validateObservationDefinition(definition,topic),binding:bind(topic),requestHash,engine:ENGINE,createdAt:at,updatedAt:at,reason:'创建观察'});
  });},
  update(id,{version,topicVersion,action,note,...definition}){return transaction(()=>{
   const old=get(id);if(old.version!==version)failure('观察配置已更新，请刷新后再保存');
   if(!['edit','pause','resume','rearm'].includes(action)||typeof note!=='string'||!note.trim()||note.length>500)failure('观察配置操作或变更说明无效');
   if(action==='pause'){
    if(!old.active||Object.keys(definition).length)failure('观察配置操作或变更说明无效');
    return persist({...old,version:old.version+1,active:false,updatedAt:clock(),reason:note.trim()});
   }
   const topic=topicFor(old.topicId,topicVersion);
   if(action!=='edit'&&Object.keys(definition).length||action==='resume'&&old.active||action==='rearm'&&!old.active)failure('观察配置操作或变更说明无效');
   // Revalidate securities on rearm/resume; old versions remain immutable if a company was removed.
   const proposed=action==='edit'?definition:{...old.definition,conditions:old.definition.conditions.map(({currency,...condition})=>condition)};
   return persist({...old,version:old.version+1,active:action==='edit'?old.active:true,definition:validateObservationDefinition(proposed,topic),binding:bind(topic),updatedAt:clock(),reason:note.trim()});
  });},
  evaluate(topics,book){
   const at=clock(),hits=[],checks=store.checks(),quotes=new Map(),byTopic=new Map(topics.map(t=>[t.id,t]));
   const quote=(symbol,interval)=>{const key=interval+symbol;if(!quotes.has(key))quotes.set(key,interval==='1d'?store.daily(symbol):store.quote(symbol));return quotes.get(key);};
   for(const row of db.prepare('SELECT payload FROM observation_rules').all()){
    const rule=JSON.parse(row.payload);if(!rule.active)continue;
    const topic=byTopic.get(rule.topicId),result=evaluateObservation(rule,topic,{at,offline,quote,check:(s,i)=>checks[(i==='1d'?'daily:':'')+s]});
    const prior=db.prepare('SELECT payload FROM observation_rule_checks WHERE rule_id=? AND version=?').get(rule.id,rule.version);
    const checked={...result,checkedAt:at,firstMatchedAt:prior?JSON.parse(prior.payload).firstMatchedAt:null};
    if(result.state==='true'){
     checked.firstMatchedAt||=at;
     const affectedPositions=(book.positions||[]).filter(p=>p.topicId===topic.id||topic.companies.some(c=>c.symbol===p.symbol)).map(positionReference).sort((a,b)=>a.lifecycleId.localeCompare(b.lifecycleId));
     const symbols=[...new Set([...rule.definition.conditions.filter(c=>c.type==='price').map(c=>c.symbol),...affectedPositions.map(p=>p.symbol)])];
     hits.push({id:hash(JSON.stringify([ENGINE,rule.id,rule.version])),topicId:topic.id,topicVersion:topic.version,title:topic.title,kind:'configured',reason:rule.definition.label,symbols,affectedPositions,input:{ruleVersion:ENGINE,definition:rule,binding:rule.binding,topicVersion:topic.version,evaluatedAt:at,results:result.results}});
    }
    db.prepare('INSERT INTO observation_rule_checks VALUES(?,?,?) ON CONFLICT(rule_id,version) DO UPDATE SET payload=excluded.payload').run(rule.id,rule.version,JSON.stringify(checked));
   }
   return hits;
  }
 };
}
