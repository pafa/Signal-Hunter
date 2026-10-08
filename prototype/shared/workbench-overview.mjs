// A read-only projection. Ledger values stay in integer USD cents and accounts
// remain separate. Missing observations are never promoted to zero or live marks.
export const OVERVIEW_VERSION='workbench-overview/1';
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const toCents=value=>finite(value)===null?null:Math.round(value*100);
const total=values=>values.some(v=>v===null)?null:values.reduce((a,b)=>a+b,0);
const labels={aggressive:'激进市场模拟',steady:'稳健市场模拟',scenario:'结构演练'};
const knownActions={observe:'继续观察',buy:'评估买入',add:'评估增仓',reduce:'评估减仓',exit:'评估退出'};

function positionContext(position,topic){
 const h=topic?.hypothesis||{};
 return {topicId:position.topicId,topicTitle:topic?.title||'原研究不可用',
  openingVersion:position.topicVersion??position.researchVersion??null,currentVersion:topic?.version??null,
  judgement:knownActions[h.action]||'判断待补',invalidation:h.invalidation||null,
  holdingHorizon:h.holdingHorizon||null,reviewAt:position.holdUntil||h.reviewAt||null,
  openedAt:position.openedAt||null,trigger:h.trigger||null};
}

function performance(positions,configured){
 const values=positions.map(p=>finite(p.unrealizedCents)),complete=configured&&values.every(v=>v!==null);
 return {valuedPositions:values.filter(v=>v!==null).length,
  unrealizedCents:complete?total(values):null,
  floatingProfitCents:complete?total(values.filter(v=>v>0)):null,
  floatingLossCents:complete?total(values.filter(v=>v<0)):null,
  dailyPnlCents:null,maxDrawdownPct:null,
  unavailable:{dailyPnl:'尚无可核对的当日净值和现金流基准',maxDrawdown:'尚无完整同口径净值序列'}};
}

export function buildWorkbenchOverview({topics=[],paper=null,workflow=[],marketAccounts=[],operations={},checks={},offline=false,at}){
 if(!Number.isFinite(Date.parse(at)))throw Error('看板时间无效');
 const byTopic=new Map(topics.map(t=>[t.id,t])),byWorkflow=new Map(workflow.map(w=>[w.topicId,w]));
 const risks=[],decisions=[];
 const addOrders=(orders,account,configVersion)=>{
  for(const order of orders||[]){
   const topic=byTopic.get(order.topicId);
   // Expired/stale requests remain in the ledger, but are not new decisions.
   if(order.status!=='pending'||order.stale||!Number.isFinite(Date.parse(order.expiresAt))||Date.parse(order.expiresAt)<=Date.parse(at)||!topic||topic.status==='archived'||topic.version!==order.topicVersion||configVersion!=null&&order.configVersion!==configVersion)continue;
   decisions.push({id:`${account}:${order.id}`,orderId:order.id,account,topicId:order.topicId,symbol:order.symbol,side:order.side,
    qty:order.qty,expiresAt:order.expiresAt,topicVersion:order.topicVersion,label:'待本人核对方案',createdAt:order.createdAt});
  }
 };
 const accounts=marketAccounts.map(state=>{
  const {accountId,book,valuation={},risk={},quotes={},sourceNote}=state;
  const positions=(valuation.positions||[]).map(p=>{
   const topic=byTopic.get(p.topicId),context=positionContext(p,topic),quote=quotes[p.symbol];
   const alerts=(risk.alerts||[]).filter(a=>a.lotId===p.id||!a.lotId&&a.symbol===p.symbol).map(a=>a.message);
   if(!topic||topic.status==='archived'||p.topicVersion!==topic.version)alerts.push('建仓研究与当前版本不同，需复核');
   if(finite(p.unrealizedCents)===null)alerts.push('估值输入缺失或过期，无法判断盈亏');
   return {id:`${accountId}:${p.id}`,lotId:p.id,account:accountId,symbol:p.symbol,name:topic?.companies?.find(c=>c.symbol===p.symbol)?.name||p.symbol,
    ...context,qty:p.qty,currency:quote?.currency||null,costCents:p.costCents,valueCents:p.valueCents,
    unrealizedCents:finite(p.unrealizedCents),returnPct:finite(p.unrealizedCents)===null||!p.costCents?null:p.unrealizedCents/p.costCents*100,
    price:finite(p.valueCents)===null?null:finite(quote?.mark),priceAt:quote?.asOf||null,priceSource:quote?.source||null,
    priceBasis:'执行输入估值',sellableAt:p.sellableAt||null,risks:[...new Set(alerts)]};
  });
  for(const p of positions)for(const [i,message] of p.risks.entries())risks.push({id:`${p.id}:risk:${i}`,account:accountId,positionId:p.id,topicId:p.topicId,symbol:p.symbol,message});
  for(const alert of risk.alerts||[])if(!alert.symbol)risks.push({id:`${accountId}:${alert.key}`,account:accountId,message:alert.message});
  addOrders(book?.orders,accountId,book?.configVersion);
  return {id:accountId,label:labels[accountId]||accountId,kind:'market-simulation',configured:!!book,version:book?.version??0,
   updatedAt:book?.updatedAt||null,sourceNote:sourceNote||null,positions,
   navCents:finite(valuation.navCents),realizedCents:finite(valuation.realizedCents),feesCents:finite(valuation.feesCents),
   currentDrawdownPct:finite(risk.drawdownPct),drawdownBasis:'相对已记录净值高点；不推断盘中高点',
   ...performance(positions,!!book)};
 });
 if(paper){
  const positions=(paper.positions||[]).map(p=>{
   const topic=byTopic.get(p.topicId),w=byWorkflow.get(p.topicId),messages=[];
   if(w?.priorityRank<=4)messages.push(w.priorityReason);
   return {id:`scenario:${p.lifecycleId||p.symbol}`,account:'scenario',symbol:p.symbol,name:p.name||p.symbol,...positionContext(p,topic),
    qty:p.qty,currency:p.currency,costCents:toCents(p.costUSD),valueCents:toCents(p.valueUSD),unrealizedCents:toCents(p.unrealized),
    returnPct:finite(p.returnPct),price:finite(p.scenarioPrice),priceAt:paper.updatedAt||null,priceSource:'场景价格 + 固定 FX',priceBasis:'场景估值',risks:messages};
  });
  for(const p of positions)for(const [i,message] of p.risks.entries())risks.push({id:`${p.id}:risk:${i}`,account:'scenario',positionId:p.id,topicId:p.topicId,symbol:p.symbol,message});
  addOrders(paper.orders,'scenario');
  accounts.push({id:'scenario',label:labels.scenario,kind:'scenario',configured:true,version:paper.version,updatedAt:paper.updatedAt,
   navCents:toCents(paper.nav),realizedCents:toCents(paper.realized),feesCents:toCents(paper.fees),currentDrawdownPct:null,
   drawdownBasis:'结构演练未建立完整回撤序列',sourceNote:'场景价格与固定汇率，不是市场成交或实际账户收益',positions,...performance(positions,true)});
 }
 const allPositions=accounts.flatMap(a=>a.positions),riskTopics=new Set(risks.map(r=>r.topicId));
 const events=topics.map(t=>({id:t.id,version:t.version,updatedAt:t.updatedAt,status:t.status,
  positions:allPositions.filter(p=>p.topicId===t.id||t.companies?.some(c=>c.symbol===p.symbol)).length,
  risk:riskTopics.has(t.id),hasResearch:!!t.dossier,label:t.dossier?'已形成研判':'研究记录，重大性待核'}))
  .sort((a,b)=>Number(b.risk)-Number(a.risk)||(b.updatedAt||'').localeCompare(a.updatedAt||'')||a.id.localeCompare(b.id));
 decisions.sort((a,b)=>Number(b.side==='sell')-Number(a.side==='sell')||(b.createdAt||'').localeCompare(a.createdAt||'')||a.id.localeCompare(b.id));
 const tasks=Object.entries(operations),running=tasks.filter(([,s])=>s.running).map(([name])=>name),blocked=tasks.filter(([,s])=>s.blocked).map(([name])=>name);
 const activeTasks=tasks.filter(([,s])=>!s.paused);
 const latest=tasks.filter(([,s])=>s.lastSuccessAt).sort((a,b)=>b[1].lastSuccessAt.localeCompare(a[1].lastSuccessAt))[0];
 return {schema:OVERVIEW_VERSION,at,defaultAccount:offline?'scenario':'aggressive',accounts,risks,decisions,events,
  monitoring:allPositions.map(p=>({id:p.id,account:p.account,topicId:p.topicId,symbol:p.symbol,reviewAt:p.reviewAt,holdingHorizon:p.holdingHorizon,risks:p.risks})).sort((a,b)=>(a.reviewAt||'~').localeCompare(b.reviewAt||'~')),
  activity:{state:offline?'offline':running.length?'running':blocked.length?'degraded':activeTasks.length?'waiting':'paused',running,blocked,
   latestEffectiveAt:latest?.[1].lastSuccessAt||null,latestTask:latest?.[0]||null,newsAt:checks.news?.receivedAt||null,
   nextRunAt:activeTasks.filter(([,s])=>!s.blocked&&s.nextRunAt).map(([,s])=>s.nextRunAt).sort()[0]||null}};
}
