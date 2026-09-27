export const RELATION_KINDS={followup:'后续进展',counterevidence:'反向变化',contributor:'聚合因素',analogy:'历史类比',related:'相关线索'};
const stop=new Set('the and that this with from said says after before into over under will would could their its for has have was were are had not new report reports reuters company companies shares stock stocks market markets news more about billion million quarter growth deal plans year china chinese'.split(' '));
const segmenter=new Intl.Segmenter('zh',{granularity:'word'});
function words(title){return new Set([...segmenter.segment(title.toLowerCase())].filter(x=>x.isWordLike).map(x=>x.segment).filter(x=>!stop.has(x)&&(!/^[a-z]+$/.test(x)?/\p{Script=Han}/u.test(x)&&x.length>=2:x.length>=4)));}
function sourceWords(topic){return words([topic.title,...(topic.evidence||[]).flatMap(e=>{let path='';try{path=new URL(e.url).pathname.replace(/[-_/]/g,' ');}catch{}return [e.claim,path];})].join(' '));}
// Transparent retrieval only. This score orders candidates; it is not event truth or impact probability.
export function relatedCandidates(record,topics,{limit=5}={}){
 const terms=words(record.title||''),companies=record.companies||record.triage?.companies||[],symbols=new Set(companies.map(c=>c.symbol));
 const urls=new Set([record.url,...(record.evidence||[]).map(e=>e.url)].filter(Boolean));
 return topics.filter(t=>t.id!==record.id).map(t=>{
  const sharedSymbols=t.companies.filter(c=>symbols.has(c.symbol)).map(c=>c.symbol),sharedWords=[...sourceWords(t)].filter(t=>terms.has(t)),sameSource=t.evidence.some(e=>urls.has(e.url));
  const reasons=[...(sameSource?['出现相同来源链接']:[]),...(sharedSymbols.length?[`相同证券：${sharedSymbols.join('、')}`]:[]),...(sharedWords.length>=2?[`标题或来源词重合：${sharedWords.slice(0,5).join('、')}`]:[])];
  return {topicId:t.id,title:t.title,version:t.version,status:t.status,reasons,rank:(sameSource?10:0)+sharedSymbols.length*3+sharedWords.length};
 }).filter(t=>t.reasons.length).sort((a,b)=>b.rank-a.rank||a.topicId.localeCompare(b.topicId)).slice(0,limit).map(({rank,...t})=>t);
}
