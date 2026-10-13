import test from 'node:test';
import assert from 'node:assert/strict';
import {researchVolumeComparison,volumeComparisonNote} from '../server/research-volume-comparison.mjs';
import {researchPriceMaterial,researchPriceUrls} from '../server/research-price-material.mjs';
import {hash,instrument,yahooSymbol} from '../server/providers.mjs';

function pair({symbol='NVDA.US',date='2026-10-09',open='13:30',count=390,dailyVolume=count*100,volumes=null,extra=[],receivedAt=date+'T23:00:00.000Z'}={}){
 const spec=instrument(symbol),first=Date.parse(date+'T'+open+':00Z')/1000,raw=new Map(),materials=[];
 for(const interval of ['1d','1m']){
  const timestamps=interval==='1d'?[first]:[...Array.from({length:count},(_,i)=>first+i*60),...extra.map(e=>e.time)];
  const payload={chart:{result:[{meta:{symbol:yahooSymbol(spec),currency:spec.currency,exchangeTimezoneName:spec.marketTimezone,dataGranularity:interval},timestamp:timestamps,indicators:{quote:[{close:timestamps.map(()=>100),volume:interval==='1d'?[dailyVolume]:[...(volumes||timestamps.slice(0,count).map(()=>100)),...extra.map(e=>e.volume)]}]}}]}};
  const document={url:researchPriceUrls(symbol,interval).at(-1),receivedAt,body:Buffer.from(JSON.stringify(payload))};
  const m={id:interval,revision:1,...researchPriceMaterial(symbol,interval,document)};materials.push(m);raw.set(hash(document.body),document.body);
 }
 const read=sha=>raw.get(sha),run=()=>researchVolumeComparison(symbol,materials,read);
 return {materials,raw,read,run};
}

test('same-day complete session exposes a volume discrepancy without changing raw values or price diagnostics',()=>{
 const p=pair({dailyVolume:10000}),before=structuredClone(p.materials),r=p.run();
 assert.equal(r.status,'different');assert.equal(r.eligibleForVolumeSignal,false);assert.equal(r.units,'unverified');
 assert.deepEqual(r.days[0],{date:'2026-10-09',status:'different',expectedMinutes:390,observedMinutes:390,missingMinutes:0,excludedOutsideSession:0,missingVolumeMinutes:0,minuteVolume:39000,dailyVolume:10000,difference:29000,ratio:3.9,reason:'同日常规分钟合计与日线原始数值不同；原因未核验'});
 assert.match(volumeComparisonNote(r),/3.9000/);assert.match(r.instructions,/不缩放/);assert.deepEqual(p.materials,before);
 assert.deepEqual(r.sources.map(s=>s.source.sha256),p.materials.map(m=>m.marketSource.source.sha256));
});
test('equal or zero raw volume does not certify unit semantics, activity or executable prices',()=>{
 assert.equal(pair().run().status,'equal');
 const r=pair({dailyVolume:0,volumes:Array(390).fill(0)}).run();assert.equal(r.status,'equal');assert.equal(r.days[0].ratio,null);assert.equal(r.eligibleForVolumeSignal,false);
});
test('partial sessions, absent volume and unmatched daily dates stay unknown without filling gaps',()=>{
 const partial=pair({count:389}).run();assert.equal(partial.status,'unknown');assert.equal(partial.days[0].missingMinutes,1);assert.equal(partial.days[0].ratio,null);
 const missing=pair({volumes:[null,...Array(389).fill(100)]}).run();assert.equal(missing.status,'unknown');assert.equal(missing.days[0].minuteVolume,null);assert.equal(missing.days[0].missingVolumeMinutes,1);
 const p=pair();p.materials[0]=pair({date:'2026-10-08'}).materials[0];const old=pair({date:'2026-10-08'});for(const [k,v] of old.raw)p.raw.set(k,v);
 const unmatched=p.run();assert.equal(unmatched.status,'unknown');assert.equal(unmatched.days[0].dailyVolume,null);
 assert.equal(pair({dailyVolume:null}).run().status,'unknown');
});
test('pre/post-market values are excluded; daylight saving and actual half-day calendars determine coverage',()=>{
 const r=pair({extra:[{time:Date.parse('2026-10-09T20:00Z')/1000,volume:99999}]}).run();assert.equal(r.status,'equal');assert.equal(r.days[0].excludedOutsideSession,1);assert.equal(r.days[0].minuteVolume,39000);
 const half=pair({date:'2026-11-27',open:'14:30',count:210}).run();assert.equal(half.status,'equal');assert.equal(half.days[0].expectedMinutes,210);
 const winter=pair({date:'2026-11-30',open:'14:30'}).run();assert.equal(winter.status,'equal');assert.equal(winter.days[0].observedMinutes,390);
});
test('missing pair, wrong security, unsupported market and unverified raw timezone cannot establish consistency',()=>{
 const p=pair();assert.equal(researchVolumeComparison('NVDA.US',[p.materials[0],null],p.read).status,'unknown');
 assert.equal(researchVolumeComparison('AAPL.US',p.materials,p.read).status,'unknown');
 assert.match(pair({symbol:'00700.HK',open:'01:30'}).run().reason,/其他市场/);
 const m=p.materials[1],raw=JSON.parse(p.read(m.marketSource.source.sha256));delete raw.chart.result[0].meta.exchangeTimezoneName;
 const doc={url:m.url,receivedAt:m.marketSource.source.receivedAt,body:Buffer.from(JSON.stringify(raw))};p.materials[1]={id:'no-zone',revision:1,...researchPriceMaterial('NVDA.US','1m',doc)};p.raw.set(hash(doc.body),doc.body);
 assert.match(p.run().reason,/未明确确认/);
});
test('raw corruption, modified derived text and overflowing totals preserve unknown rather than certify input',()=>{
 const p=pair(),m=p.materials[0];p.raw.set(m.marketSource.source.sha256,Buffer.from('{}'));assert.match(p.run().reason,/无法完整核对/);
 const q=pair();q.materials[1].body+=' changed';assert.equal(q.run().status,'unknown');
 const r=pair({volumes:Array(390).fill(Number.MAX_SAFE_INTEGER)}).run();assert.equal(r.status,'unknown');assert.equal(r.days[0].minuteVolume,null);
});
