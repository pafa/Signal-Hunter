import {randomUUID} from 'node:crypto';
import {openStore} from '../../server/store.mjs';
import {createService} from '../../server/service.mjs';
import {strategyProfiles} from '../../shared/strategy-profiles.mjs';
// Deliberately synthetic sessions, prices, queue and FX; never a public-source adapter.
export function scheduledMarketFixture(path=':memory:',{initialize=true}={}){
 let at='2026-10-02T14:00:00.000Z',availableBuy=100,missing=false,hook=null,settlement=null;
 const store=openStore(path),symbols={aggressive:'600519.SH',steady:'AAPL.US'};
 const quotes=()=>Object.fromEntries(Object.values(symbols).map(symbol=>[symbol,{id:`synthetic:${symbol}:${at}`,symbol,currency:symbol.endsWith('.SH')?'CNY':'USD',kind:'market-simulation-input',verified:true,source:'synthetic-only',rulesVersion:'fixture-only',issuerId:symbol,asOf:at,receivedAt:at,validUntil:new Date(Date.parse(at)+60000).toISOString(),bid:'100',ask:'100',mark:'100',fx:{id:'synthetic-fx',source:'synthetic-only',usdPerUnit:'1',asOf:at,receivedAt:at,validUntil:new Date(Date.parse(at)+60000).toISOString()},tradable:true,halted:false,priceLimitState:symbol.endsWith('.SH')?'limit-up':'normal',board:'CN_MAIN',securityType:'common-stock',riskWarning:false,listingStage:'regular',dailyLimitPct:10,limitUpPrice:'100',queueVerified:true,liquidityBasis:'after-queue',sessionOpen:'2026-10-02T13:00:00Z',sessionClose:'2026-10-02T20:00:00Z',sellableAt:at,settlesAt:settlement||at,buyLot:1,sellLot:1,minBuyQty:1,tickSize:'0.01',availableBuy,availableSell:100}]));
 const service=createService(store,{mode:'research',now:()=>Date.parse(at),fetcher:async()=>{throw Error('Synthetic fixture forbids network');},marketInputs:id=>{hook?.(id);return {quotes:missing?{}:quotes()};}});
 for(const name of Object.keys(service.operations().tasks).filter(n=>n!=='execution'))service.controlOperation(name,'pause');
 let topic=service.research.list()[0];
 if(!topic){topic=service.research.create({title:'双策略合成定时执行',summary:'Synthetic only; no live market effect'});for(const symbol of Object.values(symbols))topic=service.research.addCompany(topic.id,{version:topic.version,symbol,note:'Synthetic execution association'});}
 const command=(sim,extra)=>({requestId:randomUUID(),version:sim.snapshot().version,...extra});
 if(initialize)for(const [id,sim]of Object.entries(service.marketSimulations))if(!sim.executionState().configured)sim.initialize(command(sim,{initialUSD:500000,config:strategyProfiles[id].suggestedConfig,confirmSimulation:true}));
 return {store,service,topic,quotes,command,get at(){return at;},set(value){if(value.at)at=value.at;if(value.availableBuy!==undefined)availableBuy=value.availableBuy;if(value.missing!==undefined)missing=value.missing;if(value.hook!==undefined)hook=value.hook;if(value.settlement!==undefined)settlement=value.settlement;},
 propose(id,{approve=true,...extra}={}){const sim=service.marketSimulations[id];sim.propose(command(sim,{order:{topicId:topic.id,topicVersion:topic.version,symbol:symbols[id],side:'buy',qty:100,limitPrice:id==='aggressive'?'100':'101',budgetUSD:10200,expiresAt:'2026-10-02T14:10:00Z',holdUntil:'2026-10-03T14:00:00Z',thesis:'Synthetic only',trigger:'Fixture',invalidation:'Fixture',...extra}}));const order=sim.snapshot().orders.at(-1);if(approve){const review=sim.review(order.id);if(!review.eligible)throw Error(review.reasons.join(';'));sim.decide(order.id,command(sim,{action:'approve',note:'Synthetic fixture approval',confirmSimulation:true,fingerprint:review.fingerprint}));}return order;},
 async close(){await service.close();store.close();}};
}
