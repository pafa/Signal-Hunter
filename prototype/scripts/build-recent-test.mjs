import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {hash} from '../server/providers.mjs';
import {localDate,measureEvent,STUDY_VERSION} from '../server/event-study.mjs';
const dir=resolve(process.argv[2]),out=resolve(process.argv[3]||'prototype/public/recent-event-test.html');
const news=JSON.parse(await readFile(dir+'/news.json','utf8')),input=JSON.parse(await readFile(dir+'/cases-input.json','utf8')),prices=JSON.parse(await readFile(dir+'/prices.json','utf8'));
const at=new Date().toISOString(),batchId='recent-test-20260924',escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const findNews=prefix=>{const rows=news.items.filter(n=>n.id.startsWith(prefix));if(rows.length!==1)throw new Error('Ambiguous or missing news '+prefix);return rows[0];};
const studyPrices=prices.prices.map(p=>({...p,bars:p.bars.filter(b=>p.interval==='1d'?b.date>='2026-09-10':b.at>=news.protocol.startAt&&b.at<=news.protocol.endAt)}));
for(const p of studyPrices.filter(p=>p.interval==='1d')){const intraday=studyPrices.find(q=>q.symbol===p.symbol&&q.interval==='5m');p.expectedDates=[...new Set((intraday?.bars||[]).map(b=>b.date))].filter(d=>d>='2026-09-10'&&d<localDate(news.protocol.endAt,p.marketTimezone));p.missingDates=p.expectedDates.filter(d=>!p.bars.some(b=>b.date===d));}
const cases=input.map(c=>{
 const n=findNews(c.news),timeline=[n,...(c.relatedNews||[]).map(findNews)].sort((a,b)=>a.publishedAt.localeCompare(b.publishedAt));
 const knowledgeDate=[...timeline.map(n=>n.publishedAt.slice(0,10)),...c.sources.map(s=>s[3])].sort().at(-1);
 return {...c,id:batchId+'-'+c.key,news:n,timeline,knowledgeDate,analysisBy:'agent-researcher',analysisAt:at,baseline:n.baseline,market:c.companies.map(([symbol,name,role])=>{
  const daily=studyPrices.find(p=>p.symbol===symbol&&p.interval==='1d'),minute=studyPrices.find(p=>p.symbol===symbol&&p.interval==='5m');
  return {symbol,name,role,daily,minute,measurement:daily?measureEvent(daily,knowledgeDate):{anchor:null,outcomes:[],status:'日线获取失败'}};
 })};
});
const topics=cases.map(c=>({id:c.id,batchId,inputHash:hash(JSON.stringify(input.find(x=>x.key===c.key))),origin:'recent-data-test',label:c.type,title:c.title,summary:c.decision,firstSeen:c.news.firstSeen,
 chain:[{id:'fact',title:'事实与阶段',question:c.fact},{id:'impact',title:'公司影响',question:c.logic},{id:'value',title:'预期差与兑现',question:c.next}],
 companies:c.companies.map(([symbol,name,role])=>({symbol,name,role,note:role+'；研究者关联，未证明可交易收益。',url:c.sources[0][1]})),
 evidence:c.sources.map(([sourceName,url,verification,date],i)=>({id:c.id+'-source-'+i,claim:c.fact,sourceName,url,verification,publishedAt:date,datePrecision:'day',firstSeen:at,addedAt:at,originKey:new URL(url).hostname,stance:c.key==='diesel-denial'?'against':'supports',family:'corporate',step:'fact',interpretation:c.stage+'；事实经研究者复核，财务传导与交易方向仍待验证。',retrospective:true,contentScope:'researcher-paraphrase',review:{at,by:'agent-researcher',note:'实际访问资料并保留链接；非用户审批或模型自动识别。'}})),
 hypothesis:{logic:c.logic,trigger:c.decision+'；'+c.next,invalidation:c.invalid,industryHorizon:c.horizon,holdingHorizon:'尚未产生可执行买卖点或持有期',reviewAt:'',action:'observe'},nextEvidence:c.next,
 testMetadata:{baselineBucket:c.baseline.bucket,rulesVersion:news.protocol.rulesVersion,reportUrl:'/recent-event-test.html#'+c.key,decision:c.decision}}));
const annotations={
 '22775db4cb':['background','针对个人的制裁，标题没有上市公司业务敞口。'],
 '1d6cb90f60':['background','外交游说与拟议解除制裁，缺直接股票影响。'],
 '588ad3b41e':['background','2050 年排放模型预测，不是 Exxon 盈利指引。'],
 '0d5ebf33ca':['background','国家 GDP 预测，不是公司经营指引。'],
 '513318ba33':['review','产量与出口预期改变，需复核能源供需与公司暴露。'],
 '9351800542':['background','制裁政治争议，缺可量化公司传导。'],
 '6ed488dd3a':['background','宏观机构增长预测，不是公司盈利指引。'],
 '109f4943ea':['clue','试验功能线索；尚无规模或商业结果。'],
 '114ab23cc2':['review','罢工准备涉及供给风险，应优先核验工厂和产能比重。'],
 '32bde3b01e':['clue','市场分析报道，需拆解成独立可核事实。'],
 '366e4d98d8':['review','重大跨境制造合作谈判，优先核实，不能写成签约。'],
 'a2527813fe':['background','市场晨报评论，不作为独立基本面证据。'],
 '002427fbcf':['review','电厂排放规则变化，需确认生效和覆盖范围。'],
 '033bc71fe7':['review','并购监管让步与重大投资义务，应优先核验。'],
 '047c36c0f9':['review','未成年人准入提案，先核阶段与平台敞口。'],
 '0507dbb5ce':['review','出口禁令计划值得优先核验，并必须连接否认更新。'],
 '05d43e83ba':['review','贸易协议初步达成，核生效阶段及行业暴露。'],
 '050b35acaf':['unresolved','需确定船厂、责任主体及上市公司关系，不能从伤亡直接推导卖出。'],
 '067e837c19':['unresolved','破产线索未命中；主体非本股票池直接标的，需查上市公司敞口。'],
 '008bbddb8a':['invalid','仅 Reuters 的聚合页标题，不是有效事件。']
};
const audits=news.auditIds.map(id=>{const n=news.items.find(n=>n.id===id),a=annotations[id.slice(0,10)]||['background','本轮标题复核未见明确的上市公司结构性变化；保留原始标题，可后续上调。'];return {id,title:n.title,date:n.publishedAt,bucket:n.baseline.bucket,verdict:a[0],note:a[1],url:n.url};});
const summary={batchId,builtAt:at,version:STUDY_VERSION,protocol:news.protocol,total:news.items.length,buckets:news.buckets,queries:news.queries,cases:cases.length,types:new Set(cases.map(c=>c.type)).size,symbols:new Set(cases.flatMap(c=>c.companies.map(x=>x[0]))).size,failedPrices:prices.checks.filter(c=>c.error),auditCount:audits.length,quietSample:audits.filter(a=>a.bucket==='quiet').length,quietPromotions:audits.filter(a=>a.bucket==='quiet'&&a.verdict==='review').length,titleDuplicates:news.items.length-new Set(news.items.map(n=>n.title.toLowerCase().replace(/\s+/g,' ').trim())).size,genericTitles:news.items.filter(n=>n.title==='Reuters').length,roundedTimestamps:news.items.filter(n=>n.publishedAt.endsWith('T07:00:00.000Z')).length,dailyGaps:studyPrices.filter(p=>p.missingDates?.length).map(p=>({symbol:p.symbol,dates:p.missingDates}))};
await writeFile(dir+'/research-topics.json',JSON.stringify(topics,null,2));
await writeFile(dir+'/result.json',JSON.stringify({summary,cases,audits},null,2));
const payload=JSON.stringify({summary,cases,news:news.items.map(n=>({id:n.id,title:n.title,date:n.publishedAt,bucket:n.baseline.bucket,url:n.url})),audits}).replace(/</g,'\\u003c');
const template=await readFile(new URL('./recent-test-template.html',import.meta.url),'utf8');
await writeFile(out,template.replace('__PAYLOAD__',payload));
console.log(JSON.stringify(summary,null,2));
