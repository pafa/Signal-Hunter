import {randomUUID} from 'node:crypto';

const DAY=86400000,markets=['US','CN','HK'];
// Reuse immutable directory receipts as the durable retry ledger. No GET starts
// a request, and no directory failure becomes a mandatory human queue item.
export function openPipelineDirectories(store,directory,{now=Date.now,guard,settings,audit}){
 const db=store.db;
 const attempts=market=>db.prepare("SELECT payload FROM security_directory_attempts WHERE id LIKE ? ORDER BY rowid DESC LIMIT 3").all(`auto-directory-${market}-%`).map(r=>JSON.parse(r.payload));
 const state=market=>{
  const s=directory.status({market}),history=attempts(market),recent=history.filter(a=>Date.parse(a.startedAt)>now()-DAY),last=history[0]||null;
  const success=s.attempts.find(a=>a.status==='complete'&&a.snapshotId===s.active?.id);
  const checkedAt=success?.finishedAt||s.active?.receivedAt||null;
  const fresh=!!s.active&&!!checkedAt&&now()-Date.parse(checkedAt)<DAY;
  const running=last?.status==='running'&&last.expiresAt>=now();
  const retryAt=recent.length>=3?Date.parse(recent.at(-1).startedAt)+DAY:last?Date.parse(last.finishedAt||new Date(last.expiresAt).toISOString())+60000*2**Math.min(1,recent.length-1):0;
  const enabled=settings().automatic&&settings().directoryMarkets.includes(market);
  return {market,enabled,status:!enabled?'disabled':fresh?'ready':running?'running':s.current?.futureDated?'future-dated':recent.length>=3?'observing':last?'retrying':'waiting',snapshotId:s.active?.id||null,receivedAt:s.active?.receivedAt||null,checkedAt,sourceDates:s.active?.sources.map(x=>({id:x.id,date:x.sourceDate||null}))||[],eligible:s.active?.counts.eligible||0,excludedSnapshot:s.current?.futureDated?{id:s.current.id,reason:'future-source-date',sourceDates:s.current.sources.map(x=>({id:x.id,date:x.sourceDate||null})),eligible:s.current.counts.eligible}:null,attemptsInLast24Hours:recent.length,lastAttempt:last?{id:last.id,status:last.status==='running'&&!running?'interrupted':last.status,startedAt:last.startedAt,finishedAt:last.finishedAt||null}:null,nextAttemptAt:enabled&&!fresh&&!running?new Date(Math.max(now(),retryAt)).toISOString():null,
   initialReady:!enabled||!!s.active||!!last&&!running,coverage:s.coverage[market]};
 };
 return {
  freezeBasis:()=>directory.freezeBasis(),
  ready:()=>markets.every(m=>state(m).initialReady),
  snapshot:()=>({policy:'official-directory-preparation/1',items:markets.map(state),limitation:'首次逐市场准备后继续研究；失败保留缺口，后台限次重试。旧身份判断保留原快照；相关目录依据变化时，未知身份自动追加核对，有新增公司关联再更新研判。目录不证明上市历史或当前可交易性。'}),
  async step(context){
   if(!settings().automatic)return null;
   context.assertActive();guard();
   if(directory.status().running)return null;
   const candidate=markets.map(state).find(s=>s.enabled&&!['ready','running'].includes(s.status)&&Date.parse(s.nextAttemptAt)<=now());
   if(!candidate)return null;
   const version=settings().version,requestId=`auto-directory-${candidate.market}-${randomUUID()}`;
   const valid=()=>{context.assertActive();guard();if(!settings().automatic||settings().version!==version||!settings().directoryMarkets.includes(candidate.market))throw Error('证券目录自动准备配置已变化');};
   valid();directory.refresh({market:candidate.market,requestId},{beforeCommit:valid});
   audit(null,'directory-preparation-started',{market:candidate.market,requestId,settingsVersion:version});
   await directory.wait();
   // A paused attempt still retains its failed receipt; scheduling stops until resumed.
   const result=attempts(candidate.market).find(a=>a.id===requestId);
   audit(null,'directory-preparation-finished',{market:candidate.market,requestId,status:result.status,snapshotId:result.snapshotId||null});
   return {ok:true,directoryMarket:candidate.market,directoryStatus:result.status};
  }
 };
}
