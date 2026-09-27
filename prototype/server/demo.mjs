// Original synthetic fixtures. Symbols identify UI rows, never actual company events/prices.
import {instrument,hash} from './providers.mjs';

export function demoResearchSeeds(at=new Date().toISOString()) {
 const groups=[
  ['agent-cpu','虚构演示：计算需求的多因素假设',['AMD.US','INTC.US','ARM.US']],
  ['spotify-access','虚构演示：平台开放与限制',['SPOT.US','AMZN.US']],
  ['memory-global','虚构演示：存储产业跨市场传导',['MU.US','603986.SH','03986.HK','688008.SH']],
 ];
 return groups.map(([id,title,symbols])=>({id,title,type:'cluster',label:'虚构演示',summary:'用于体验证据、反证、公司关联与审批；不是相关公司的真实新闻或投资建议。',status:'active',origin:'synthetic-demo',createdAt:at,updatedAt:at,version:1,
  chain:[{id:'fact',title:'信号变化',question:'线索能否由独立来源核验？'},{id:'mechanism',title:'业务传导',question:'业务敞口与替代解释是什么？'},{id:'earnings',title:'盈利兑现',question:'市场已反映多少？'}],
  companies:symbols.map(symbol=>({symbol,name:instrument(symbol).code,role:'演示关联 · 非事实认定',note:'证券代码仅用于三市场界面演练，不代表存在此事件。',url:''})),
  evidence:[{id:`demo-${id}`,claim:'虚构线索：某类产品使用量上升，商业贡献尚待核验。',sourceName:'本地合成示例',url:'',publishedAt:at,datePrecision:'instant',firstSeen:at,availableAt:at,family:'adoption',step:'fact',originKey:'synthetic-demo',verification:'unverified',stance:'unverified',contentScope:'synthetic'},
   {id:`demo-counter-${id}`,claim:'虚构反证：新增使用可能来自促销，且成本同步上升。',sourceName:'本地合成示例',url:'',publishedAt:at,datePrecision:'instant',firstSeen:at,availableAt:at,family:'constraint',step:'earnings',originKey:'synthetic-demo',verification:'unverified',stance:'against',contentScope:'synthetic'}],
  hypothesis:{logic:'演示假设：使用增加可能传导到收入，但需要排除短期促销和成本变化。',trigger:'补充独立证据与预期差后再评估；此处仅供演练。',invalidation:'增长消退或成本抵消收入。',industryHorizon:'演示窗口：一个季度',holdingHorizon:'演示窗口：30天；非推荐期限',reviewAt:'',action:'observe'},nextEvidence:'补充来源、业务量级、预期差及反证。'}));
}

export function initializeDemoData(store,at=new Date().toISOString()) {
 // Initialize once; reopening must preserve users' demo edits and simulated decisions.
 if(store.db.prepare("SELECT 1 FROM settings WHERE key='demo_initialized'").get())return;
 const publishedAt=at;
 store.ingest([{id:hash('synthetic-demo-news-v1'),title:'虚构演示：产品使用增长传闻，商业兑现尚未核验',url:'https://example.invalid/synthetic-demo',publishedAt,publisher:'本地合成示例',provider:'synthetic-demo'}],at);
 for(const [j,w] of store.watchlist().entries()) {
  const spec=instrument(w.symbol),points=[];
  for(let i=180;i>=1;i--){const d=new Date(at);d.setUTCDate(d.getUTCDate()-i);if([0,6].includes(d.getUTCDay()))continue;const date=d.toISOString().slice(0,10);points.push({date,at:`${date}T00:00:00.000Z`,close:Math.round((50+j*13+(180-i)*.1+Math.sin(i/6+j)*3)*100)/100});}
  store.saveDaily({symbol:w.symbol,name:spec.code,market:spec.market,currency:spec.currency,marketTimezone:spec.marketTimezone,provider:'synthetic-demo',interval:'1d',receivedAt:at,points,actions:[],missing:0,incomplete:0,lastDate:points.at(-1).date,priceBasis:'本地公式生成的虚构价格；未模拟交易所节假日或公司行动',deliveryDelay:'not-applicable'});
 }
 store.db.prepare('INSERT INTO settings VALUES (?,?)').run('demo_initialized',at);
}
