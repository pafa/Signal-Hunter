import {randomUUID} from 'node:crypto';
import {instrument} from './providers.mjs';
import {evidenceStamp,reviewedVersion} from '../shared/review-state.mjs';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const positive=n=>Number.isFinite(n)&&n>0;
const clean=(v,max=1000)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():null;
const MARKET_PRICES={'AMD.US':200,'INTC.US':35,'ARM.US':150,'SPOT.US':500,'META.US':750,'AMZN.US':220,'MU.US':120,'00700.HK':400,'688981.SH':100,'603986.SH':180,'03986.HK':150,'688008.SH':100,'600825.SH':10};
const LABELS={'AMD.US':'AMD','INTC.US':'Intel','ARM.US':'Arm','SPOT.US':'Spotify','META.US':'Meta','00700.HK':'腾讯控股','688981.SH':'中芯国际','MU.US':'Micron','603986.SH':'兆易创新 A','03986.HK':'兆易创新 H','688008.SH':'澜起科技'};
import {issuer} from '../shared/securities.mjs';
export {issuer} from '../shared/securities.mjs';
export const PAPER_VERSION='structural-paper/0.9.0';
function expireOrders(book,at){
 let count=0;
 for(const o of book.orders)if(o.status==='pending'&&Date.parse(o.expiresAt)<=Date.parse(at)){
  o.status='expired';o.closedAt=at;o.decisionNote='申请到期，自动释放未执行占用；没有成交';count++;
 }
 return count;
}
const fx=(book,symbol)=>book.params.fx[instrument(symbol).currency]; // Native currency units per USD.
const price=(book,symbol)=>book.prices[symbol];
const value=(book,p)=>p.qty*price(book,p.symbol)/fx(book,p.symbol);
function summary(book){
 const positions=book.positions.map(p=>{const amount=value(book,p),unrealized=amount-p.costUSD;return {...p,name:LABELS[p.symbol]||p.symbol,scenarioPrice:price(book,p.symbol),currency:instrument(p.symbol).currency,valueUSD:round(amount),unrealized:round(unrealized),returnPct:p.costUSD?unrealized/p.costUSD*100:0};});
 const marketValue=positions.reduce((s,p)=>s+p.valueUSD,0),nav=round(book.cash+marketValue),pending=book.orders.filter(o=>o.status==='pending'),reserved=pending.filter(o=>o.side==='buy').reduce((s,o)=>s+estimate(book,o).total,0);
 const themes={};for(const p of positions)themes[p.topicId]=(themes[p.topicId]||0)+p.valueUSD;
 return {positions,marketValue:round(marketValue),nav,cash:book.cash,exposurePct:marketValue/nav*100,pnl:round(nav-book.initial),returnPct:(nav/book.initial-1)*100,reserved:round(reserved),available:round(book.cash-reserved),pendingCount:pending.length,themes};
}
function estimate(book,order){
 const reference=order.price,execution=reference*(1+(order.side==='buy'?1:-1)*book.params.slippageBps/10000),gross=order.qty*execution/fx(book,order.symbol),fee=gross*book.params.feeBps/10000;
 return {reference,execution,fx:fx(book,order.symbol),gross:round(gross),fee:round(fee),total:round(order.side==='buy'?gross+fee:gross-fee),currency:instrument(order.symbol).currency};
}
function gate(book,o){
 const s=summary(book),est=estimate(book,o),pending=book.orders.filter(x=>x.status==='pending'&&x.id!==o.id),p=book.positions.find(p=>p.symbol===o.symbol),errors=[];
 if(o.price!==price(book,o.symbol))errors.push('场景参考价与冻结估值价不一致，请按当前场景价重建申请');
 if(o.side==='sell'){
  const reserved=pending.filter(x=>x.side==='sell'&&x.symbol===o.symbol).reduce((sum,x)=>sum+x.qty,0);
  if(!p||o.qty>p.qty-reserved)errors.push('卖出量超过扣除待批申请后的可卖量');
 }else{
  const related=book.positions.filter(x=>x.topicId===o.topicId||issuer(x.symbol)===issuer(o.symbol));
  if(related.some(x=>book.reviews.filter(r=>r.symbol===x.symbol&&r.at>=x.openedAt).at(-1)?.result==='invalidated'))errors.push('相关持仓逻辑已人工判定失效，复核恢复前暂停新增风险');
  const buys=[...pending.filter(x=>x.side==='buy'),o];
  if(pending.some(x=>x.side==='buy'&&x.price!==price(book,x.symbol)))errors.push('存在场景价不一致的旧待批申请，请先拒绝并按冻结价格重建');
  const marked=x=>round(x.qty*price(book,x.symbol)/fx(book,x.symbol));
  const projectedNav=s.nav-buys.reduce((sum,x)=>sum+estimate(book,x).total-marked(x),0);
  const reserved=pending.filter(x=>x.side==='buy').reduce((sum,x)=>sum+estimate(book,x).total,0);
  if(book.cash-reserved-est.total<0)errors.push('可用现金不足');
  if(projectedNav<=0||!Number.isFinite(projectedNav))errors.push('成交后场景净值无效');
  if((book.cash-reserved-est.total)/projectedNav*100<book.params.cashFloorPct)errors.push('低于现金保留比例');
  const existing=s.positions.filter(p=>issuer(p.symbol)===issuer(o.symbol)).reduce((sum,p)=>sum+p.valueUSD,0);
  const same=buys.filter(x=>issuer(x.symbol)===issuer(o.symbol)).reduce((sum,x)=>sum+marked(x),0);
  if((existing+same)/projectedNav*100>book.params.issuerCapPct)errors.push('超过同一发行人上限（含 A/H 合计及待批）');
  const theme=(s.themes[o.topicId]||0)+buys.filter(x=>x.topicId===o.topicId).reduce((sum,x)=>sum+marked(x),0);
  if(theme/projectedNav*100>book.params.themeCapPct)errors.push('超过同一主题预算上限（含待批）');
 }
 if(positive(o.limit)&&(o.side==='buy'?est.execution>o.limit:est.execution<o.limit))errors.push('滑点后的场景成交价不满足限价');
 return {estimate:est,errors};
}
export function openPaper(store,research,{clock=()=>new Date().toISOString(),seed=true}={}){
 const db=store.db;
 db.exec('CREATE TABLE IF NOT EXISTS paper_books(id TEXT PRIMARY KEY,payload TEXT NOT NULL);CREATE TABLE IF NOT EXISTS paper_versions(version INTEGER PRIMARY KEY,payload TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL);');
 const read=()=>JSON.parse(db.prepare("SELECT payload FROM paper_books WHERE id='structural-v5'").get().payload);
 function write(book,reason){book.version++;book.updatedAt=clock();const payload=JSON.stringify(book);db.prepare("INSERT INTO paper_books VALUES('structural-v5',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(payload);db.prepare('INSERT INTO paper_versions VALUES(?,?,?,?)').run(book.version,payload,book.updatedAt,reason);}
 function transact(version,reason,fn){db.exec('BEGIN IMMEDIATE');try{const book=read();if(version!==book.version)throw new Error('模拟组合已变化，请刷新后重新核对');expireOrders(book,clock());const result=fn(book);write(book,reason);db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 if(!db.prepare("SELECT 1 FROM paper_books WHERE id='structural-v5'").get()){
  const at=clock(),book={id:'structural-v5',version:0,engine:PAPER_VERSION,mode:'结构演练',baseCurrency:'USD',initial:1000000,cash:1000000,realized:0,fees:0,createdAt:at,updatedAt:at,prices:{...MARKET_PRICES},params:{cashFloorPct:35,issuerCapPct:12,themeCapPct:25,feeBps:10,slippageBps:5,fx:{USD:1,CNY:7.10,HKD:7.80}},positions:[],orders:[],fills:[],reviews:[]};
  const rows=seed?[['AMD.US',80000,'agent-cpu'],['INTC.US',60000,'agent-cpu'],['SPOT.US',60000,'spotify-access'],['03986.HK',80000,'memory-global'],['688008.SH',70000,'memory-global']]:[];
  for(const [symbol,budget,topicId] of rows){const lot=symbol.endsWith('.US')?1:100,qty=Math.floor(budget*fx(book,symbol)/price(book,symbol)/lot)*lot,cost=round(qty*price(book,symbol)/fx(book,symbol));book.positions.push({symbol,topicId,qty,costUSD:cost,avgNative:price(book,symbol),researchVersion:topicId==='regional-basket'?null:research.get(topicId).version,origin:'结构演练初始化样例',openedAt:at});book.cash=round(book.cash-cost);}
  for(const [symbol,side,qty,topicId,label] of (seed?[['ARM.US','buy',200,'agent-cpu','建仓 3% 演练'],['AMD.US','buy',100,'agent-cpu','增仓 2% 演练'],['SPOT.US','sell',40,'spotify-access','减仓 2% 演练']]:[]))book.orders.push({id:randomUUID(),clientId:'seed-'+symbol,symbol,side,qty,topicId,topicVersion:research.get(topicId).version,price:price(book,symbol),limit:price(book,symbol)*(side==='buy'?1.02:.98),status:'pending',reason:label+'；仅检验结构，不代表研究已证实',origin:'预置演练申请',createdAt:at,expiresAt:new Date(Date.parse(at)+86400000).toISOString(),holdingHorizon:'仅演练；实际期限待证据',invalidation:'原逻辑被推翻时复核，退出仍需人工批准'});
  db.exec('BEGIN IMMEDIATE');try{write(book,'100 万美元结构演练初始化；非真实入金');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }
 function snapshot(){const b=read();expireOrders(b,clock());const s=summary(b);return {...b,...s,engine:PAPER_VERSION,positions:s.positions.map(p=>({...p,currentResearchVersion:research.get(p.topicId).version,reviewedResearchVersion:reviewedVersion(b,p)})),orders:b.orders.map(o=>{let stale=false;try{const t=research.get(o.topicId);stale=t.version!==o.topicVersion||t.status==='archived';}catch{stale=o.topicVersion!==null;}const expired=o.status==='expired';return {...o,...gate(b,o),stale,expired};}),scope:'场景价格、假设汇率、简化整股即时撮合；不代表交易所真实可成交性，现场行情不进入演练净值'};}
 return {snapshot,
  expire(){const b=read();if(!expireOrders(b,clock()))return 0;let count=0;db.exec('BEGIN IMMEDIATE');try{const current=read();count=expireOrders(current,clock());if(count)write(current,'申请到期：释放未执行占用，无成交');db.exec('COMMIT');return count;}catch(e){db.exec('ROLLBACK');throw e;}},
  propose(data){
   return transact(data.version,'新建模拟申请',book=>{
    if(!clean(data.clientId,100))throw new Error('缺少幂等请求标识');
    if(book.orders.some(o=>o.clientId===data.clientId))throw new Error('该申请已保存，请刷新查看');
    if(book.orders.filter(o=>o.status==='pending').length>=20)throw new Error('最多同时待批 20 笔');
    const symbol=instrument(data.symbol).symbol,topic=research.get(data.topicId);
    if(topic.status!=='active'||data.topicVersion!==topic.version)throw new Error('研究已更新或归档，请重新核对');
    if(!topic.companies.some(c=>c.symbol===symbol))throw new Error('公司尚未关联该主题');
    if(!['buy','sell'].includes(data.side)||!Number.isSafeInteger(data.qty)||data.qty<=0||data.qty>10000000||!positive(data.price)||data.price>10000000||!positive(data.limit)||data.limit>10000000)throw new Error('方向、数量或场景价格无效');
    if(!clean(data.reason)||!clean(data.invalidation)||!clean(data.holdingHorizon,200))throw new Error('填写申请依据、失效条件与持有期');
    if(data.side==='buy'&&book.positions.some(p=>p.symbol===symbol&&p.topicId!==topic.id))throw new Error('已有持仓绑定其他主题，请从原主题增仓，避免拆分预算');
    if(book.orders.some(o=>o.status==='pending'&&o.symbol===symbol&&o.side===data.side))throw new Error('同标的同方向已有待批申请');
    if(!book.prices[symbol])book.prices[symbol]=data.price;
    const order={id:randomUUID(),clientId:data.clientId,symbol,side:data.side,qty:data.qty,topicId:topic.id,topicVersion:topic.version,price:data.price,limit:data.limit,status:'pending',origin:'人工研究演练申请',reason:data.reason.trim(),invalidation:data.invalidation.trim(),holdingHorizon:data.holdingHorizon.trim(),createdAt:clock(),expiresAt:new Date(Date.parse(clock())+86400000).toISOString()};
    const {errors}=gate(book,order);if(errors.length)throw new Error(errors.join('；'));book.orders.push(order);
   });
  },
  decide(id,data){
   // An already-decided order is idempotent even when a browser retries an old version.
   if(!['approve','reject'].includes(data.decision))throw new Error('决策无效');
   const known=read().orders.find(o=>o.id===id);if(!known)throw new Error('申请不存在');
   if(known.status==='expired'||known.status==='pending'&&Date.parse(known.expiresAt)<=Date.parse(clock()))throw new Error('申请已过期，占用已释放，请重新建立');
   if(known.status!=='pending'){if((data.decision==='approve')!==(known.status==='filled'))throw new Error('申请已有不同决定，请刷新核对');return;}
   return transact(data.version,'人工'+(data.decision==='approve'?'批准模拟成交':'拒绝申请'),book=>{
    const o=book.orders.find(o=>o.id===id);
    if(data.decision==='reject'){o.status='rejected';o.decidedAt=clock();o.decisionNote=clean(data.note)||'用户拒绝';return;}
    if(data.confirmScenario!==true)throw new Error('需确认此为场景价格结构演练');
    const t=research.get(o.topicId);if(t.version!==o.topicVersion||t.status==='archived')throw new Error('研究版本已变化或归档，拒绝此申请后按新研究重建');
    if(Date.parse(o.expiresAt)<=Date.parse(clock()))throw new Error('申请已过期，请重新建立');
    const {estimate:e,errors}=gate(book,o);if(errors.length)throw new Error(errors.join('；'));
    const p=book.positions.find(p=>p.symbol===o.symbol);
    if(o.side==='buy'){
     book.cash=round(book.cash-e.total);
     if(p){p.avgNative=(p.avgNative*p.qty+e.execution*o.qty)/(p.qty+o.qty);p.qty+=o.qty;p.costUSD=round(p.costUSD+e.total);}else book.positions.push({symbol:o.symbol,topicId:o.topicId,qty:o.qty,costUSD:e.total,avgNative:e.execution,researchVersion:o.topicVersion,origin:'人工批准演练',openedAt:clock()});
    }else{const basis=p.costUSD*o.qty/p.qty;book.cash=round(book.cash+e.total);book.realized=round(book.realized+e.total-basis);p.costUSD=round(p.costUSD-basis);p.qty-=o.qty;book.positions=book.positions.filter(p=>p.qty>0);}
    book.fees=round(book.fees+e.fee);o.status='filled';o.decidedAt=clock();o.decisionNote=clean(data.note)||'确认结构演练';book.fills.push({id:randomUUID(),orderId:id,symbol:o.symbol,side:o.side,qty:o.qty,...e,at:clock(),topicId:o.topicId,topicVersion:o.topicVersion,mode:'scenario'});
   });
  },
  updateParams(data){return transact(data.version,'调整演练参数',book=>{
   const keys=['cashFloorPct','issuerCapPct','themeCapPct','feeBps','slippageBps'];
   for(const k of keys){const v=data[k];if(!Number.isFinite(v)||v<0||v>(k.endsWith('Pct')?100:100))throw new Error('参数范围无效');}
   if(data.issuerCapPct<=0||data.themeCapPct<=0||data.issuerCapPct>data.themeCapPct)throw new Error('发行人上限必须大于 0 且不超过主题上限');
   for(const k of keys)book.params[k]=data[k];
   // Historical FX and cost basis remain frozen; changing FX needs a separately versioned valuation model.
  });},
  review(data){return transact(data.version,'保存持仓临时复核',book=>{
   const p=book.positions.find(p=>p.symbol===data.symbol);if(!p)throw new Error('持仓不存在');
   const topic=research.get(p.topicId);
   if(data.topicVersion!==topic.version)throw new Error('研究版本已变化，请重新核对后复核');
   if(!['intact','weakened','invalidated','verify'].includes(data.result)||!clean(data.note))throw new Error('填写复核结果与依据');
   book.reviews.push({id:randomUUID(),symbol:p.symbol,result:data.result,note:data.note.trim(),at:clock(),topicId:p.topicId,positionQty:p.qty,reviewedResearchVersion:topic.version,reviewedEvidence:topic.evidence.map(evidenceStamp)});
  });},
  history(){return db.prepare('SELECT version,at,reason FROM paper_versions ORDER BY version DESC LIMIT 60').all();}
 };
}
