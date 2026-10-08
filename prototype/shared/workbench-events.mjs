// Display groups refer to immutable event membership; research records stay separate.
export function groupEventResearch(topics,overview={}){
 const meta=new Map((overview.events||[]).map(e=>[e.id,e])),memberships=new Map(),warnings=new Set(),positions=(overview.accounts||[]).flatMap(a=>a.positions);
 for(const c of overview.eventClusters||[]){
  if(c.status!=='active')continue;
  for(const id of c.topicIds){
   if(!c.health.current){warnings.add(id);continue;}
   const list=memberships.get(id)||[];list.push(c);memberships.set(id,list);
  }
 }
 const rows=new Map();
 for(const topic of topics){
  const membershipsForTopic=memberships.get(topic.id)||[];
  const cluster=topic.status==='active'&&membershipsForTopic.length===1?membershipsForTopic[0]:null;
  const id=cluster?`cluster:${cluster.id}`:`research:${topic.id}`;
  if(!rows.has(id))rows.set(id,{id,cluster,title:cluster?.title||topic.title,topics:[],risk:false,groupStale:false});
  const row=rows.get(id);row.topics.push(topic);row.risk||=!!meta.get(topic.id)?.risk;
  row.groupStale||=warnings.has(topic.id)||membershipsForTopic.length>1;
 }
 const byUpdate=(a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')||a.id.localeCompare(b.id);
 return [...rows.values()].map(row=>{
  row.topics.sort(byUpdate);row.updatedAt=[row.cluster?.updatedAt||'',row.topics[0].updatedAt||''].sort().at(-1);
  const ids=new Set(row.topics.map(t=>t.id)),symbols=new Set(row.topics.flatMap(t=>t.companies.map(c=>c.symbol)));
  row.companyCount=symbols.size;
  row.positions=positions.filter(p=>ids.has(p.topicId)||symbols.has(p.symbol)).length;
  return row;
 }).sort((a,b)=>Number(b.risk)-Number(a.risk)||byUpdate(a,b));
}
