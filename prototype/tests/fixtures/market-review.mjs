import {randomUUID} from 'node:crypto';
import {openStore} from '../../server/store.mjs';
import {createService} from '../../server/service.mjs';
import {strategyProfiles} from '../../shared/strategy-profiles.mjs';
// Synthetic execution adapter, used only by isolated tests. No network or real orders.
export function marketReviewFixture(path=':memory:'){
 let at='2026-10-02T14:00:00.000Z',price='100',missing=false;
 const store=openStore(path),symbols={aggressive:'600519.SH',steady:'AAPL.US'};
 const quotes=()=>Object.fromEntries(Object.values(symbols).map(symbol=>[symbol,{id:`synthetic:${symbol}:${at}`,symbol,currency:symbol.endsWith('.SH')?'CNY':'USD',kind:'market-simulation-input',verified:true,source:'synthetic-only',rulesVersion:'fixture-only',issuerId:symbol,asOf:at,receivedAt:at,validUntil:new Date(Date.parse(at)+60000).toISOString(),bid:price,ask:price,mark:price,fx:{id:'synthetic-fx',source:'synthetic-only',usdPerUnit:'1',asOf:at,receivedAt:at,validUntil:new Date(Date.parse(at)+60000).toISOString()},tradable:true,halted:false,priceLimitState:symbol.endsWith('.SH')?'limit-up':'normal',board:'CN_MAIN',securityType:'common-stock',riskWarning:false,listingStage:'regular',dailyLimitPct:10,limitUpPrice:price,queueVerified:true,liquidityBasis:'after-queue',sessionOpen:'2026-10-02T13:00:00Z',sessionClose:'2026-10-02T20:00:00Z',sellableAt:at,settlesAt:at,buyLot:1,sellLot:1,minBuyQty:1,tickSize:'0.01',availableBuy:100,availableSell:100}]));
 const service=createService(store,{mode:'research',now:()=>Date.parse(at),fetcher:async()=>{throw Error('Synthetic fixture forbids network');},marketInputs:()=>({quotes:missing?{}:quotes()})});
 for(const name of Object.keys(service.operations().tasks).filter(n=>n!=='observations'))service.controlOperation(name,'pause');
 let topic=service.research.list()[0];
 if(!topic){topic=service.research.create({title:'双策略合成持仓巡检',summary:'Synthetic only; no market effect'});for(const symbol of Object.values(symbols))topic=service.research.addCompany(topic.id,{version:topic.version,symbol,note:'Synthetic holding association'});}
 const command=(sim,extra)=>({requestId:randomUUID(),version:sim.snapshot().version,...extra});
 for(const [id,sim] of Object.entries(service.marketSimulations))if(!sim.snapshot().configured){
  sim.initialize(command(sim,{initialUSD:500000,config:strategyProfiles[id].suggestedConfig,confirmSimulation:true}));
  sim.propose(command(sim,{order:{topicId:topic.id,topicVersion:topic.version,symbol:symbols[id],side:'buy',qty:100,limitPrice:id==='aggressive'?'100':'101',budgetUSD:10200,expiresAt:'2026-10-02T14:10:00Z',holdUntil:'2026-10-03T14:00:00Z',thesis:'Synthetic only',trigger:'Fixture',invalidation:'Fixture'}}));
  const order=sim.snapshot().orders.at(-1),review=sim.review(order.id);if(!review.eligible)throw Error(review.reasons.join(';'));
  sim.decide(order.id,command(sim,{action:'approve',note:'Synthetic fixture approval',confirmSimulation:true,fingerprint:review.fingerprint}));
  at=new Date(Date.parse(at)+1000).toISOString();const result=sim.process();if(result.lots.length!==1)throw Error('Synthetic fixture did not fill one lot');
 }
 return {store,service,topic,get at(){return at;},set(value){if(value.at)at=value.at;if(value.price)price=value.price;if(value.missing!==undefined)missing=value.missing;},async close(){await service.close();store.close();}};
}
