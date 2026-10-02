import {withMarketObservationPeaks} from './market-observations.mjs';
import {strategyRisk,entryIssues} from './strategy-risk.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {instrument} from '../shared/securities.mjs';
import {amount,cents,decimal,fee,sum,validateConfig,quoteIssues,valuation,assessOrder,working,marketFail as fail,isInstant} from './market-sim-risk.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const text=(v,n=1200)=>typeof v==='string'&&!!v.trim()&&v.length<=n;
const active=o=>o.status==='pending'||working(o);
const orderIn=(b,id)=>{const o=b.orders.find(o=>o.id===id);if(!o)fail(7);return o;};
const usd=n=>n/100;
function priceWithSlippage(price,bps,tick,side){
 const raw=decimal(price)*(10000000000n+(side==='buy'?1n:-1n)*decimal(bps)),denominator=10000000000n,unit=decimal(tick);
 const units=side==='buy'?(raw+denominator*unit-1n)/(denominator*unit):raw/(denominator*unit),micro=units*unit;
 return `${micro/1000000n}.${String(micro%1000000n).padStart(6,'0')}`;
}
// Input adapter is a server dependency, never a request body. Research close caches are ineligible.
export function openMarketSimulation(store,research,{accountId='main',profile=null,enabled=true,clock=()=>new Date().toISOString(),getInputs=()=>({quotes:{},reason:'尚未接入经核验的执行报价、数量、FX和结算适配器'})}={}){
 const db=store.db;if(!['main','aggressive','steady'].includes(accountId))fail(3);
 const sql=s=>accountId==='main'?s:s.replaceAll('market_sim_book',`market_sim_book_${accountId}`).replaceAll('market_sim_events',`market_sim_events_${accountId}`).replaceAll('market_sim_commands',`market_sim_commands_${accountId}`);
 const query=s=>db.prepare(sql(s));
 db.exec(sql(`CREATE TABLE IF NOT EXISTS market_sim_book(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS market_sim_events(version INTEGER PRIMARY KEY,at TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS market_sim_commands(id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,version INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS market_sim_liquidity(key TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS market_observation_peaks(id TEXT PRIMARY KEY,payload TEXT NOT NULL);`));
 const read=()=>{const row=query('SELECT payload FROM market_sim_book WHERE id=1').get();return row?JSON.parse(row.payload):null;};
 const inputs=()=>{try{const x=getInputs();if(!x||typeof x!=='object'||!x.quotes||typeof x.quotes!=='object'||Array.isArray(x.quotes))throw 0;return structuredClone(x);}catch{return {quotes:{},reason:'执行适配器不可用；不能使用场景价替代'};}};
 const preview=(book,order,market,at)=>{
  const riskBook=withMarketObservationPeaks(db,book,accountId),review=assessOrder(book,order,market.quotes,at),topic=research.get(order.topicId),risk=strategyRisk(riskBook,market.quotes,at);
  review.reasons.push(...entryIssues(book,order,market.quotes[order.symbol]));
  if(order.side==='buy'){
   if(book.riskPaused||risk.alerts.some(a=>a.kind==='pool-stop'))review.reasons.push('策略池达到回撤暂停线；暂停新买入，需本人复核恢复');
   if(risk.alerts.some(a=>a.blocksBuy&&a.symbol===order.symbol))review.reasons.push('该证券已触发退出或到期复核，暂停增加仓位');
  }
  review.eligible=review.reasons.length===0;review.strategyRisk=risk;
  if(topic.status==='archived'||topic.version!==order.topicVersion){review.eligible=false;review.reasons.push('研究版本已变化或归档');}
  const relevant=[...new Set([order.symbol,...book.lots.map(l=>l.symbol),...book.orders.filter(working).map(o=>o.symbol)])].sort();
  const evidence={bookVersion:book.version,orderId:order.id,topicVersion:topic.version,config:book.config,profile:book.profile,riskBasis:{highWaterCents:riskBook.highWaterCents,lots:riskBook.lots.map(l=>({id:l.id,peakPrice:l.peakPrice}))},quotes:Object.fromEntries(relevant.map(s=>[s,market.quotes[s]||null]))};
  return {...review,fingerprint:hash(evidence),evidence,checkedAt:at,sourceNote:market.reason||null};
 };
 function persist(book,kind,detail,at,request=null){
  const previous=query('SELECT hash FROM market_sim_events ORDER BY version DESC LIMIT 1').get()?.hash||null;
  book.version++;book.updatedAt=at;
  const event={version:book.version,at,kind,detail,previousHash:previous,state:book},digest=hash(event);
  query('INSERT INTO market_sim_events VALUES(?,?,?,?,?)').run(book.version,at,kind,JSON.stringify(event),digest);
  query('INSERT INTO market_sim_book VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(book));
  if(request)query('INSERT INTO market_sim_commands VALUES(?,?,?)').run(request.id,request.hash,book.version);
 }
 function command(kind,data,change){
  if(!enabled)fail(13);if(query("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')fail(15);if(!data||!text(data.requestId,80)||!/^[A-Za-z0-9_-]{8,80}$/.test(data.requestId))fail(4);
  const request={id:data.requestId,hash:hash({kind,data})};let version;
  db.exec('BEGIN IMMEDIATE');try{
   const prior=query('SELECT * FROM market_sim_commands WHERE id=?').get(request.id);
   if(prior){if(prior.input_hash!==request.hash)fail(4);version=prior.version;}
   else{
    let book=read();if(data.version!==(book?.version||0))fail(2);
    const at=clock(),result=change(book,at);book=result.book;persist(book,kind,result.detail,at,request);version=book.version;
   }
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {...api.snapshot(),appliedVersion:version};
 }
 const api={
  snapshot(){const b=read(),market=inputs(),at=clock();if(!b)return {accountId,profile,enabled,configured:false,version:0,sourceNote:market.reason||null};const value=valuation(b,market.quotes,at);return {accountId,profile,enabled,configured:true,...b,strategyRisk:strategyRisk(withMarketObservationPeaks(db,b,accountId),market.quotes,at),liquidity:undefined,...value,baseCurrency:'USD',sourceNote:market.reason||null,performanceVerified:false};},
  observationSnapshot(at=clock()){
   const book=read();if(!book)return {accountId,book:null};
   const market=inputs();return {accountId,book,at,quotes:market.quotes,sourceNote:market.reason||null,valuation:valuation(book,market.quotes,at),risk:strategyRisk(withMarketObservationPeaks(db,book,accountId),market.quotes,at)};
  },
  history(){return query('SELECT version,at,kind,hash FROM market_sim_events ORDER BY version DESC LIMIT 100').all();},
  event(version){const row=query('SELECT payload,hash FROM market_sim_events WHERE version=?').get(version);if(!row)fail(7);return {...JSON.parse(row.payload),hash:row.hash};},
  initialize(data){return command('initialize',data,(book,at)=>{
   if(book)fail(1);if(data.confirmSimulation!==true)fail(11);
   if(!Number.isFinite(data.initialUSD)||data.initialUSD<0.01||data.initialUSD>1000000000||decimal(data.initialUSD)%10000n!==0n||profile&&data.initialUSD!==profile.allocationUSD)fail(3);
   const config=validateConfig(data.config),initial=cents(data.initialUSD);
   return {book:{version:0,accountId,profile,highWaterCents:initial,riskPaused:false,riskObservations:[],createdAt:at,initialCents:initial,cashCents:initial,config,configVersion:1,lots:[],orders:[],fills:[],unsettled:[],liquidity:{},realizedCents:0,feesCents:0},detail:{initialCents:initial,config}};
  });},
  configure(data){return command('configure',data,(b)=>{
   if(!b)fail(0);if(!text(data.note))fail(3);const config=validateConfig(data.config);
   b.config=config;b.configVersion++;const invalidated=[];for(const o of b.orders.filter(active)){o.status='invalidated';o.reason='风险或费用配置已修改，需重新申请与批准';invalidated.push(o.id);}
   return {book:b,detail:{note:data.note,config,invalidated}};
  });},
  propose(data){return command('propose',data,(b,at)=>{
   if(!b)fail(0);const d=data.order;
   if(!d||!text(d.topicId,100)||!['buy','sell'].includes(d.side)||!Number.isSafeInteger(d.qty)||d.qty<=0||d.qty>100000000||!isInstant(d.expiresAt)||Date.parse(d.expiresAt)<=Date.parse(at)||Date.parse(d.expiresAt)-Date.parse(at)>b.config.maxOrderMinutes*60000||!['thesis','trigger','invalidation'].every(k=>text(d[k])))fail(5);
   const symbol=instrument(d.symbol).symbol,t=research.get(d.topicId);
   if(t.status==='archived'||d.topicVersion!==t.version||!t.companies.some(c=>c.symbol===symbol))fail(6);
   if(decimal(d.limitPrice)<=0n)fail(5);
   if(d.side==='buy'&&(!isInstant(d.holdUntil)||Date.parse(d.holdUntil)<=Date.parse(d.expiresAt)||Date.parse(d.holdUntil)-Date.parse(at)>b.config.maxHoldDays*86400000||!Number.isFinite(d.budgetUSD)||d.budgetUSD<=0||decimal(d.budgetUSD)%10000n!==0n||d.budgetUSD>usd(b.initialCents)))fail(5);
   const order={id:randomUUID(),topicId:t.id,topicVersion:t.version,researchSnapshot:t,configVersion:b.configVersion,symbol,currency:instrument(symbol).currency,side:d.side,qty:d.qty,limitPrice:String(d.limitPrice),expiresAt:d.expiresAt,holdUntil:d.side==='buy'?d.holdUntil:null,budgetCents:d.side==='buy'?cents(d.budgetUSD):0,filledQty:0,spentCents:0,status:'pending',createdAt:at,thesis:d.thesis.trim(),trigger:d.trigger.trim(),invalidation:d.invalidation.trim()};
   b.orders.push(order);return {book:b,detail:{orderId:order.id}};
  });},
  review(id){const b=read();if(!b)fail(0);return preview(b,orderIn(b,id),inputs(),clock());},
  decide(id,data){return command('decision:'+id,data,(b,at)=>{
   if(!b)fail(0);const o=orderIn(b,id);if(!text(data.note)||!['approve','reject','cancel'].includes(data.action))fail(8);
   if(data.action==='approve'){
    if(o.status!=='pending')fail(8);if(data.confirmSimulation!==true)fail(11);
    const review=preview(b,o,inputs(),at);if(data.fingerprint!==review.fingerprint)fail(9);if(!review.eligible)fail(10);
    o.status='approved';o.approvedAt=at;o.approval={note:data.note,at,fingerprint:review.fingerprint,evidence:review.evidence};
   }else{if(data.action==='reject'?o.status!=='pending':!active(o))fail(8);o.status=data.action==='reject'?'rejected':'cancelled';}
   o.decisionNote=data.note.trim();return {book:b,detail:{orderId:id,action:data.action,note:data.note}};
  });},
  resume(data){return command('resume-risk',data,(b,at)=>{if(!b)fail(0);if(!text(data.note)||!b.riskPaused)fail(8);const risk=strategyRisk(withMarketObservationPeaks(db,b,accountId),inputs().quotes,at);if(risk.navCents===null||risk.alerts.some(a=>a.kind==='pool-stop'))fail(10);b.riskPaused=false;return {book:b,detail:{note:data.note,risk}};});},
  process(){
   if(!enabled)return api.snapshot();if(query("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')fail(15);const market=inputs(),at=clock();let changed=false;const updates=[];
   db.exec('BEGIN IMMEDIATE');try{
    const b=read();if(!b){db.exec('COMMIT');return api.snapshot();}
    for(const settlement of b.unsettled.filter(x=>Date.parse(x.at)<=Date.parse(at))){b.cashCents=sum([b.cashCents,settlement.amountCents]);updates.push({kind:'cash-settlement',...settlement});changed=true;}
    b.unsettled=b.unsettled.filter(x=>Date.parse(x.at)>Date.parse(at));
    const risk=strategyRisk(withMarketObservationPeaks(db,b,accountId),market.quotes,at);
    if(risk.peakCents>b.highWaterCents){b.highWaterCents=risk.peakCents;changed=true;}
    for(const lot of b.lots){const q=market.quotes[lot.symbol];if(!quoteIssues(lot.symbol,q,b.config,at).length&&decimal(q.mark)>decimal(lot.peakPrice||lot.entryPrice||q.mark)){lot.peakPrice=String(q.mark);changed=true;}}
    if(hash(risk.alerts)!==hash(b.riskObservations)){b.riskObservations=risk.alerts;updates.push({kind:'risk-observation',...risk});changed=true;}
    if(risk.alerts.some(a=>a.kind==='pool-stop')&&!b.riskPaused){b.riskPaused=true;changed=true;}
    for(const o of b.orders.filter(active)){
     const topic=research.get(o.topicId);
     if(Date.parse(o.expiresAt)<=Date.parse(at)||topic.status==='archived'||topic.version!==o.topicVersion||o.configVersion!==b.configVersion){o.status=Date.parse(o.expiresAt)<=Date.parse(at)?'expired':'invalidated';o.reason=o.status==='expired'?'订单到期，剩余数量未成交':'研究或配置版本变化，剩余数量需重新申请';updates.push({orderId:o.id,status:o.status});changed=true;continue;}
     if(!working(o))continue;
     const check=preview(b,o,market,at),q=market.quotes[o.symbol],remaining=o.qty-o.filledQty;
     const wait=reason=>{if(o.waitReason!==reason){o.waitReason=reason;updates.push({orderId:o.id,waiting:reason});changed=true;}};
     if(!check.eligible){wait(check.reasons.join('；'));continue;}
     if(Date.parse(q.asOf)<=Date.parse(o.approvedAt)){wait('等待批准之后的新报价，不能回用审批前价格成交');continue;}
     const liquidityKey=hash({symbol:o.symbol,source:q.source,asOf:q.asOf}),fingerprint=hash(q),liquidityRow=query('SELECT payload FROM market_sim_liquidity WHERE key=?').get(liquidityKey),used=liquidityRow?JSON.parse(liquidityRow.payload):null;
     if(used&&used.fingerprint!==fingerprint){wait('同一报价时点内容发生变化，等待新的稳定快照');continue;}
     const side=o.side==='buy'?'availableBuy':'availableSell',lot=o.side==='buy'?q.buyLot:q.sellLot;
     const available=q[side]-(used?.[o.side]||0);let qty=Math.floor(Math.min(remaining,available)/lot)*lot;
     if(qty<=0){wait('当前可用数量不足，保留未成交余量');continue;}
     const execution=o.side==='buy'&&b.profile?.entry==='cn-main-board-limit-up'?String(q.limitUpPrice):priceWithSlippage(o.side==='buy'?q.ask:q.bid,b.config.slippageBps,q.tickSize,o.side),px=decimal(execution),limit=decimal(o.limitPrice);
     if(px<=0n||(o.side==='buy'?px>limit:px<limit)){wait('不利滑点后的价格未满足限价');continue;}
     const gross=amount(qty,execution,q.fx.usdPerUnit),charge=fee(gross,b.config.feeBps),net=o.side==='buy'?gross+charge:gross-charge;
     if(net<0){wait('费用超过卖出金额');continue;}
     if(o.side==='buy'&&(net>o.budgetCents-o.spentCents||net>b.cashCents)){wait('成交费用或汇率变化超出预算');continue;}
     const fill={id:randomUUID(),orderId:o.id,topicId:o.topicId,topicVersion:o.topicVersion,symbol:o.symbol,side:o.side,qty,price:execution,fx:q.fx,grossCents:gross,feeCents:charge,netCents:net,at,marketSnapshot:q,approvalFingerprint:o.approval.fingerprint};
     if(o.side==='buy'){
      b.cashCents-=net;o.spentCents+=net;b.lots.push({id:fill.id,symbol:o.symbol,topicId:o.topicId,topicVersion:o.topicVersion,issuerId:q.issuerId,qty,costCents:net,openedAt:at,entryPrice:execution,peakPrice:execution,sellableAt:q.sellableAt,holdUntil:o.holdUntil});
     }else{
      let needed=qty,basis=0;const allocations=[];
      for(const l of b.lots.filter(l=>l.symbol===o.symbol&&l.topicId===o.topicId&&Date.parse(l.sellableAt)<=Date.parse(at))){
       const n=Math.min(needed,l.qty);if(!n)continue;const cost=n===l.qty?l.costCents:Number((BigInt(l.costCents)*BigInt(n)+BigInt(l.qty)/2n)/BigInt(l.qty));l.qty-=n;l.costCents-=cost;needed-=n;basis+=cost;allocations.push({lotId:l.id,qty:n,costCents:cost});
      }
      if(needed)throw new Error('市场模拟内部可卖量不一致');b.lots=b.lots.filter(l=>l.qty>0);fill.costCents=basis;fill.realizedCents=net-basis;fill.allocations=allocations;b.realizedCents+=net-basis;
      if(Date.parse(q.settlesAt)<=Date.parse(at))b.cashCents=sum([b.cashCents,net]);else b.unsettled.push({fillId:fill.id,amountCents:net,at:q.settlesAt,rulesVersion:q.rulesVersion});
     }
     b.feesCents+=charge;b.fills.push(fill);o.filledQty+=qty;o.status=o.filledQty===o.qty?'filled':'partial';o.waitReason=null;
     b.liquidity[liquidityKey]={fingerprint,buy:used?.buy||0,sell:used?.sell||0};b.liquidity[liquidityKey][o.side]+=qty;
     query('INSERT INTO market_sim_liquidity VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload').run(liquidityKey,JSON.stringify(b.liquidity[liquidityKey]));
     updates.push({kind:'fill',fillId:fill.id,orderId:o.id,qty,status:o.status});changed=true;
    }
    if(changed)persist(b,'execution-cycle',{updates,inputHash:hash(market)},at);db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return api.snapshot();
  }
 };
 return api;
}
