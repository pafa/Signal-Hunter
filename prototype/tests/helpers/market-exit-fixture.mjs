import {randomUUID} from 'node:crypto';
import {openStore} from '../../server/store.mjs';
import {createService} from '../../server/service.mjs';
import {strategyProfiles} from '../../shared/strategy-profiles.mjs';
export function exitFixture(path=':memory:'){
 let at='2026-10-06T14:00:00.000Z',quotes={};
 const store=openStore(path),service=createService(store,{mode:'research',now:()=>Date.parse(at),marketInputs:()=>({quotes,reason:'仅限合成退出候选检查'}),fetcher:()=>{throw Error('No external requests in synthetic fixture');}}),sim=service.marketSimulations.steady;
 for(const name of Object.keys(service.operations().tasks))service.controlOperation(name,'pause');
 let topic=service.research.create({title:'合成事件：持续跟踪与退出候选',summary:'全部输入为合成，不证明真实交易效果'});
 topic=service.research.addCompany(topic.id,{version:topic.version,symbol:'AAPL.US',note:'合成公司关联'});
 const command=data=>({requestId:randomUUID(),version:sim.snapshot().version,...data});
 sim.initialize(command({initialUSD:500000,config:strategyProfiles.steady.suggestedConfig,confirmSimulation:true}));
 const f={store,service,sim,topic,command,at:()=>at,quotes:()=>quotes,setQuotes:q=>quotes=q,setTime:v=>at=v,
  tick(ms=1000){at=new Date(Date.parse(at)+ms).toISOString();},
  quote(price='100',extra={}){const q={id:randomUUID(),symbol:'AAPL.US',kind:'market-simulation-input',verified:true,source:'synthetic-exit-fixture-only',rulesVersion:'fixture-rules/1',issuerId:'fixture-AAPL',currency:'USD',asOf:at,receivedAt:at,validUntil:'2026-10-06T20:00:00Z',bid:price,ask:price,mark:price,fx:{id:'fixture-fx',source:'synthetic-exit-fixture-only',usdPerUnit:'1',asOf:at,receivedAt:at,validUntil:'2026-10-06T20:00:00Z'},tradable:true,halted:false,priceLimitState:'normal',sessionOpen:'2026-10-06T13:30:00Z',sessionClose:'2026-10-06T20:00:00Z',sellableAt:at,settlesAt:at,buyLot:1,sellLot:1,minBuyQty:1,tickSize:'0.01',availableBuy:1000,availableSell:1000,...extra};quotes={'AAPL.US':q};return q;},
  buy(price='100',extra={}){f.quote(price);sim.propose(command({order:{topicId:topic.id,topicVersion:topic.version,symbol:'AAPL.US',side:'buy',qty:100,limitPrice:String(Number(price)+1),budgetUSD:15000,expiresAt:'2026-10-06T14:30:00Z',holdUntil:'2026-10-07T14:00:00Z',thesis:'合成原始判断',trigger:'合成买入条件',invalidation:'合成反证',...extra}}));const o=sim.snapshot().orders.at(-1),r=sim.review(o.id);if(!r.eligible)throw Error(r.reasons.join(';'));sim.decide(o.id,command({action:'approve',note:'合成本人批准',fingerprint:r.fingerprint,confirmSimulation:true}));f.tick();f.quote(price,extra.quote||{});sim.process();return sim.snapshot().lots.at(-1);},
  candidate(){return sim.snapshot().exitCandidates[0];},
  decide(c,action='approve',extra={}){return sim.decideExit(c.id,command({action,fingerprint:c.fingerprint,note:'合成本人最终决定',confirmSimulation:true,...extra}));},
  async close(){await service.close();store.close();}
 };return f;
}
