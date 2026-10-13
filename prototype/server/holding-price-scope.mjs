// Research-price collection is bounded per cycle, not by the visible watchlist.
// Never put account names, quantities or costs in this scope or provider calls.
export function openHoldingPriceScope(store,{holdingSymbols=()=>[],enabled=false,clock=()=>new Date().toISOString()}={}){
 const db=store.db,limit=40;
 db.exec('CREATE TABLE IF NOT EXISTS price_scope_cursors(lane TEXT PRIMARY KEY,after_key TEXT NOT NULL,selected_at TEXT NOT NULL)');
 const legacyTables=['actual_holding_watch_links','research_watch_links'].filter(t=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
 // Legacy links were saved only after a watch was registered. Missing watches
 // therefore preserve the prior manual-removal intent, including across accounts.
 for(const t of legacyTables)db.prepare('INSERT OR IGNORE INTO watch_removals SELECT DISTINCT symbol,? FROM '+t+' WHERE symbol NOT IN (SELECT symbol FROM watches)').run(clock());
 const legacyRemoved=s=>legacyTables.some(t=>db.prepare('SELECT 1 FROM '+t+' WHERE symbol=? LIMIT 1').get(s));
 function scope(){
  const watches=new Set(store.watchlist().map(w=>w.symbol)),held=new Set(enabled?holdingSymbols():[]),removed=new Set();
  for(const s of held)if(!watches.has(s)&&(store.watchRemoved(s)||legacyRemoved(s)))removed.add(s);
  const all=[...new Set([...watches,...[...held].filter(s=>!removed.has(s))])].map(symbol=>({symbol,key:(held.has(symbol)?'0:':'1:')+symbol,holding:held.has(symbol)})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  return {watches,held,removed,all};
 }
 return {
  allows(symbol){return scope().all.some(r=>r.symbol===symbol);},
  states(){const s=scope();return new Map([...new Set([...s.watches,...s.held])].map(symbol=>[symbol,s.watches.has(symbol)?{state:'watching',mode:'watchlist',reason:'已加入行情关注'}:s.removed.has(symbol)?{state:'removed',mode:'disabled',reason:'已手动移出行情关注'}:{state:'watching',mode:'holding',reason:'持仓后台轮流采集；每轮最多40个证券，实际更新以来源时间为准'}]));},
  batch(lane,requested){
   if(!['daily','minutes'].includes(lane))throw Error('未知行情任务');
   if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先完成核对确认');
   if(requested){if(!Array.isArray(requested)||requested.length>limit)throw Error('单轮行情最多40个证券');return [...new Set(requested)].map(symbol=>({symbol}));}
   const {all}=scope();if(!all.length)return [];
   const after=db.prepare('SELECT after_key FROM price_scope_cursors WHERE lane=?').get(lane)?.after_key;
   let start=after?all.findIndex(r=>r.key>after):0;if(start<0)start=0;
   const selected=[...all.slice(start),...all.slice(0,start)].slice(0,limit);
   db.prepare('INSERT INTO price_scope_cursors VALUES(?,?,?) ON CONFLICT(lane) DO UPDATE SET after_key=excluded.after_key,selected_at=excluded.selected_at').run(lane,selected.at(-1).key,clock());
   return selected.map(({symbol})=>({symbol}));
  },
 };
}
