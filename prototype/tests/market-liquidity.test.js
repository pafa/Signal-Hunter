import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';import {executionLiquidity,liquidityIdentity} from '../server/market-liquidity.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const quote=asOf=>({symbol:'TEST.US',source:'synthetic',id:'same-snapshot',asOf,receivedAt:'2026-10-02T14:00:01.000Z',availableBuy:100,availableSell:100,bid:'10',ask:'11',fx:{asOf:'2026-10-02T14:00:01Z',receivedAt:'2026-10-02T14:00:01Z'}});
function setup(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE market_sim_liquidity(key TEXT PRIMARY KEY,payload TEXT);CREATE TABLE market_sim_book_aggressive(id INTEGER PRIMARY KEY,payload TEXT);CREATE TABLE market_sim_book_steady(id INTEGER PRIMARY KEY,payload TEXT)');return db;}
function old(db,q,buy,sell=0){db.prepare('INSERT INTO market_sim_liquidity VALUES(?,?)').run(hash({symbol:q.symbol,source:q.source,asOf:q.asOf}),JSON.stringify({fingerprint:hash(q),buy,sell}));return [...(buy?[{side:'buy',qty:buy,marketSnapshot:q}]:[]),...(sell?[{side:'sell',qty:sell,marketSnapshot:q}]:[])];}
test('legacy raw-time counters are corroborated across pools and combined without changing frozen records',()=>{
 const db=setup();try{const a=quote('2026-10-02T14:00:01Z'),b=quote('2026-10-02T22:00:01+08:00'),book={fills:old(db,a,40,10)},other={fills:old(db,b,30,5)};db.prepare('INSERT INTO market_sim_book_steady VALUES(1,?)').run(JSON.stringify(other));
 const before=db.prepare('SELECT * FROM market_sim_liquidity ORDER BY key').all(),r=executionLiquidity(db,quote('2026-10-02T10:00:01.000-04:00'),{table:'market_sim_book_aggressive',book});assert.equal(r.reason,undefined);assert.equal(r.used.buy,70);assert.equal(r.used.sell,15);assert.deepEqual(db.prepare('SELECT * FROM market_sim_liquidity ORDER BY key').all(),before);
 // New fills are already represented by the v2 cache, not by legacy counters.
 book.fills.push({liquidityVersion:2,side:'buy',qty:20,marketSnapshot:a});assert.equal(executionLiquidity(db,a,{table:'market_sim_book_aggressive',book}).used.buy,70);
 db.prepare('INSERT INTO market_sim_liquidity VALUES(?,?)').run(r.key,JSON.stringify({...r.used,buy:90}));assert.equal(executionLiquidity(db,b,{table:'market_sim_book_aggressive',book}).used.buy,90);
 }finally{db.close();}
});
test('uncorroborated legacy usage and changed quote content fail closed, including damaged books or counters',()=>{
 for(const scenario of ['missing-fill','wrong-counter','wrong-fingerprint','changed-price','bad-book']){const db=setup();try{const q=quote('2026-10-02T14:00:01Z'),book={fills:old(db,q,40)};if(scenario==='missing-fill')book.fills=[];if(scenario==='wrong-counter')db.prepare('UPDATE market_sim_liquidity SET payload=?').run(JSON.stringify({fingerprint:hash(q),buy:41,sell:0}));if(scenario==='wrong-fingerprint')db.prepare('UPDATE market_sim_liquidity SET payload=?').run(JSON.stringify({fingerprint:'wrong',buy:40,sell:0}));if(scenario==='changed-price')q.ask='12';if(scenario==='bad-book')db.prepare('INSERT INTO market_sim_book_steady VALUES(1,?)').run('{');const r=executionLiquidity(db,q,{table:'market_sim_book_aggressive',book});assert(r.reason,scenario);}finally{db.close();}}
});
test('canonical identity keeps distinct instants and sources separate, and cached v2 usage requires valid counters',()=>{
 const q=quote('2026-10-02T14:00:01.000Z'),id=liquidityIdentity(q);assert.deepEqual(liquidityIdentity({...q,asOf:'2026-10-02T22:00:01+08:00'}),id);assert.notEqual(liquidityIdentity({...q,asOf:'2026-10-02T14:00:01.001Z'}).key,id.key);assert.notEqual(liquidityIdentity({...q,source:'other'}).key,id.key);
 const db=setup();try{db.prepare('INSERT INTO market_sim_liquidity VALUES(?,?)').run(id.key,JSON.stringify({version:2,fingerprint:id.fingerprint,buy:-1,sell:0}));assert.match(executionLiquidity(db,q,{table:'market_sim_book_aggressive',book:{fills:[]}}).reason,/历史流动性/);}finally{db.close();}
});
