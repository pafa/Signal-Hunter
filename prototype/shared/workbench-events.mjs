// Display groups refer to immutable event membership; research records stay separate.
export function groupEventResearch(topics,overview={}){
 const meta=new Map((overview.events||[]).map(e=>[e.id,e])),memberships=new Map(),historical=new Map(),warnings=new Set(),positions=(overview.accounts||[]).flatMap(a=>a.positions);
 for(const c of overview.eventClusters||[]){
  if(c.status!=='active')continue;
  for(const id of c.topicIds){
   if(!c.health.current){warnings.add(id);continue;}
   const list=memberships.get(id)||[];list.push(c);memberships.set(id,list);
  }
  for(const h of c.history||[]){
   if(!c.health.current){warnings.add(h.topicId);continue;}
   if(!topics.some(t=>t.status==='active'&&c.topicIds.includes(t.id)))continue;
   const list=historical.get(h.topicId)||[];list.push(c);historical.set(h.topicId,list);
  }
 }
 const activeIds=new Set(topics.filter(t=>t.status==='active').map(t=>t.id));
 const available=new Set([...memberships].filter(([id,list])=>activeIds.has(id)&&list.length===1).map(([,list])=>list[0].id));
 const rows=new Map();
 for(const topic of topics){
  const membershipsForTopic=memberships.get(topic.id)||[];
  const old=historical.get(topic.id)||[],isHistorical=!membershipsForTopic.length&&old.length===1&&available.has(old[0].id);
  const cluster=topic.status==='active'&&membershipsForTopic.length===1?membershipsForTopic[0]:isHistorical?old[0]:null;
  const id=cluster?`cluster:${cluster.id}`:`research:${topic.id}`;
  if(!rows.has(id))rows.set(id,{id,cluster,title:cluster?.title||topic.title,topics:[],historicalTopics:[],risk:false,historicalRisk:false,groupStale:false});
  const row=rows.get(id);(cluster&&isHistorical?row.historicalTopics:row.topics).push(topic);row.risk||=!!meta.get(topic.id)?.risk;
  row.historicalRisk||=isHistorical&&!!meta.get(topic.id)?.risk;
  row.groupStale||=warnings.has(topic.id)||membershipsForTopic.length>1||old.length>1||old.length===1&&!available.has(old[0].id);
 }
 // Source correspondence is display lineage, not event-cluster membership.
 // Keep a current owner authoritative and never merge conflicting groups.
 const sourceHistory=overview.sourceHistory||{groups:[],warnings:[]},sourceOwners=new Map();
 for(const h of sourceHistory.groups)for(const id of [h.currentTopicId,...h.history.map(m=>m.topicId)])sourceOwners.set(id,(sourceOwners.get(id)||0)+1);
 for(const row of rows.values()){row.history=[...(row.cluster?.history||[])];row.sourceStale=row.topics.some(t=>sourceHistory.warnings.includes(t.id));}
 for(const h of sourceHistory.groups){
  const ids=[h.currentTopicId,...h.history.map(m=>m.topicId)],owners=new Map();
  for(const row of rows.values())for(const t of [...row.topics,...row.historicalTopics])if(ids.includes(t.id))owners.set(t.id,row);
  const target=owners.get(h.currentTopicId),old=h.history.map(m=>({link:m,row:owners.get(m.topicId)}));
  if(!target||!target.topics.some(t=>t.id===h.currentTopicId&&t.status==='active')||ids.some(id=>sourceOwners.get(id)!==1)||target.groupStale||old.some(({link,row})=>!row||row.groupStale||row.cluster&&row!==target||row===target&&row.topics.some(t=>t.id===link.topicId))){for(const row of owners.values())row.sourceStale=true;continue;}
  for(const {link,row} of old){
   const t=[...row.topics,...row.historicalTopics].find(t=>t.id===link.topicId);
   if(row!==target){rows.delete(row.id);target.historicalTopics.push(t);}
   if(!target.history.some(m=>m.topicId===t.id))target.history.push(link);
   target.risk||=!!meta.get(t.id)?.risk;target.historicalRisk||=!!meta.get(t.id)?.risk;
  }
  target.sourceHistory=h;target.sourceStale=false;
  if(!target.cluster){rows.delete(target.id);target.id=h.id;target.title=h.title;rows.set(target.id,target);}
 }
 const byUpdate=(a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')||a.id.localeCompare(b.id);
 return [...rows.values()].map(row=>{
  row.topics.sort(byUpdate);row.historicalTopics.sort(byUpdate);row.allTopics=[...row.topics,...row.historicalTopics];row.updatedAt=[row.cluster?.updatedAt||'',row.topics[0]?.updatedAt||''].sort().at(-1);
  const ids=new Set(row.allTopics.map(t=>t.id)),symbols=new Set(row.topics.flatMap(t=>t.companies.map(c=>c.symbol)));
  row.companyCount=symbols.size;
  row.positions=positions.filter(p=>ids.has(p.topicId)||symbols.has(p.symbol)).length;
  return row;
 }).sort((a,b)=>Number(b.risk)-Number(a.risk)||byUpdate(a,b));
}
