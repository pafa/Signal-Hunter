import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {openStore} from '../server/store.mjs';
import {openActualHoldings,projectActualAccounts} from '../server/actual-holdings.mjs';
import {ACTUAL_COLUMNS,actualAmount,actualTemplate,normalizeActualRow,parseActualCsv} from '../shared/actual-holdings.mjs';
import {buildWorkbenchOverview} from '../shared/workbench-overview.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';

const at='2026-10-09T12:00:00.000Z';
const row=(extra={})=>({account:'Synthetic A',symbol:'AAPL.US',quantity:'1.5',unitCost:'100',price:'110',asOf:'2026-10-09T10:00:00Z',source:'Synthetic broker snapshot',feeBasis:'included',...extra});
function fixture(run){const store=openStore(':memory:');let now=at,topic={id:'synthetic',version:1,status:'active',companies:[{symbol:'AAPL.US'}]};const h=openActualHoldings(store,{enabled:true,clock:()=>now,getTopic:()=>topic});const save=r=>{const p=h.preview({rows:Array.isArray(r)?r:[r]});return h.apply({id:p.id,hash:p.hash});};try{return run({store,h,save,clock:x=>now=x,topic:x=>topic=x});}finally{store.close();}}
test('actual snapshots use exact decimal cents, accept fractional quantities and reject unsafe or ambiguous amounts',()=>{
 assert.equal(actualAmount('1.234567','123.456789'),15242);assert.equal(actualAmount('0.5','0.01'),1);assert.equal(actualAmount('10',null),null);assert.equal(actualAmount('3','0'),0);
 for(const value of ['-1','1e3','NaN',' 1','01','1.0000001',1])assert.throws(()=>actualAmount(value,'2'),/数量/);
 assert.throws(()=>actualAmount('99999999999','99999999999'),/数量/);
});
test('explicit dates, fee basis and security identity are validated without inferring account facts',()=>{
 const r=normalizeActualRow(row({symbol:'700.hk',unitCost:'',price:'',asOf:'2026-10-09T12:00:00+08:00'}),at);
 assert.equal(r.symbol,'00700.HK');assert.equal(r.currency,'HKD');assert.equal(r.unitCost,null);assert.equal(r.price,null);assert.equal(r.asOf,'2026-10-09T04:00:00.000Z');
 for(const asOf of ['2026-10-09','2026-10-09T10:00:00','2026-02-30T10:00:00Z','2026-10-09T24:00:00Z','2027-01-01T00:00:00Z'])assert.throws(()=>normalizeActualRow(row({asOf}),at),/记录时间/);
 assert.throws(()=>normalizeActualRow(row({currency:'HKD'}),at),/输入/);assert.throws(()=>normalizeActualRow(row({feeBasis:'yes'}),at),/费用/);assert.throws(()=>normalizeActualRow(row({price:'0'}),at),/价格/);
});
test('CSV parses quoted delimiters, BOM and CRLF, with strict headers and bounds',()=>{
 const data=row({account:'Synthetic, A',source:'Fixture "only"'}),line=ACTUAL_COLUMNS.map(k=>'"'+String(data[k]??'').replaceAll('"','""')+'"').join(',');
 assert.equal(parseActualCsv('\ufeff'+actualTemplate.replace('\n','\r\n')+line+'\r\n')[0].account,'Synthetic, A');
 for(const csv of ['account,symbol\nA,AAPL.US',actualTemplate+'"broken',actualTemplate+line+',extra',actualTemplate+Array(101).fill(line).join('\n')])assert.throws(()=>parseActualCsv(csv),/CSV/);
});
test('preview does not alter positions; repeated apply and reimport never duplicate snapshots',()=>fixture(({h,save})=>{
 const p=h.preview({rows:[row(),row({quantity:'1.500000'})]});assert.equal(h.snapshot().version,0);assert.equal(h.snapshot().records.length,0);assert.deepEqual(p.items.map(i=>i.action),['add','duplicate']);
 const cmd={id:p.id,hash:p.hash};assert.equal(h.apply(cmd).version,1);assert.equal(h.apply(cmd).replayed,true);assert.equal(h.snapshot().records.length,1);
 const duplicate=h.preview({rows:[row({reason:'A harmless import note'})]});assert.equal(duplicate.canApply,false);assert.equal(duplicate.items[0].action,'duplicate');assert.throws(()=>h.apply({id:duplicate.id,hash:duplicate.hash}),/没有新增/);
 save(row({symbol:'MSFT.US'}));assert.equal(h.apply(cmd).version,1);assert.equal(h.snapshot().version,2);
}));
test('updates and corrections append immutable history; omission never closes a holding',()=>fixture(({h,save})=>{
 save([row(),row({symbol:'MSFT.US'})]);const before=h.snapshot().records.find(r=>r.symbol==='AAPL.US');
 let p=h.preview({rows:[row({price:'115'})]});assert.equal(p.items[0].action,'invalid');assert.match(p.items[0].issue,/说明/);
 p=h.preview({rows:[row({price:'115',reason:'Correct fixture price'})]});assert.equal(p.items[0].action,'correction');h.apply({id:p.id,hash:p.hash});
 save(row({quantity:'0',asOf:'2026-10-09T11:00:00Z',reason:'Snapshot now shows no shares'}));
 assert.equal(h.snapshot().records.length,2);assert.deepEqual(h.history(before.id).at(-1),before);assert.equal(h.history(before.id).length,3);
 const accounts=projectActualAccounts(h.snapshot(),[],at);assert.equal(accounts[0].positions.length,1);assert.equal(accounts[0].realizedCents,null);
}));
test('stale dates, conflicts within a batch and invalid rows block the entire import',()=>fixture(({h,save})=>{
 save(row());const version=h.snapshot().version;
 for(const rows of [[row({asOf:'2026-10-08T10:00:00Z',reason:'Older'})],[row({symbol:'MSFT.US'}),row({symbol:'MSFT.US',quantity:'3'})],[row({symbol:'MSFT.US'}),row({quantity:'-1'})]]){
  const p=h.preview({rows});assert.equal(p.canApply,false);assert.throws(()=>h.apply({id:p.id,hash:p.hash}));assert.equal(h.snapshot().version,version);assert.equal(h.snapshot().records.length,1);
 }
}));
test('concurrent previews, expired previews, clock rollback and altered approvals are rejected',()=>fixture(({h,clock})=>{
 const a=h.preview({rows:[row()]}),b=h.preview({rows:[row({symbol:'MSFT.US'})]});h.apply({id:a.id,hash:a.hash});assert.throws(()=>h.apply({id:b.id,hash:b.hash}),/数据已变化/);
 const c=h.preview({rows:[row({symbol:'MSFT.US'})]});assert.throws(()=>h.apply({id:c.id,hash:'0'.repeat(64)}),/数据已变化/);
 clock('2026-10-09T12:31:00.000Z');assert.throws(()=>h.apply({id:c.id,hash:c.hash}),/过期/);clock('2026-10-09T11:59:59.000Z');assert.throws(()=>h.apply({id:c.id,hash:c.hash}),/过期/);
}));
test('storage failures roll back all rows and allow the same reviewed batch to retry',()=>fixture(({store,h})=>{
 const p=h.preview({rows:[row(),row({symbol:'MSFT.US'})]});store.db.exec("CREATE TRIGGER actual_fixture_fail BEFORE INSERT ON actual_holding_records WHEN json_extract(NEW.payload,'$.symbol')='MSFT.US' BEGIN SELECT RAISE(ABORT,'synthetic failure');END");
 assert.throws(()=>h.apply({id:p.id,hash:p.hash}),/synthetic failure/);assert.equal(h.snapshot().records.length,0);assert.equal(h.snapshot().version,0);
 store.db.exec('DROP TRIGGER actual_fixture_fail');assert.equal(h.apply({id:p.id,hash:p.hash}).version,1);assert.equal(h.snapshot().records.length,2);
}));
test('research binding freezes original version; unrelated or changed new references cannot be applied',()=>fixture(({h,save,topic})=>{
 const p=h.preview({rows:[row({topicId:'synthetic',topicVersion:1})]});topic({id:'synthetic',version:2,status:'active',companies:[{symbol:'AAPL.US'}]});assert.throws(()=>h.apply({id:p.id,hash:p.hash}),/关联研究/);
 save(row({topicId:'synthetic',topicVersion:2}));topic({id:'synthetic',version:3,status:'active',companies:[{symbol:'AAPL.US'}]});save(row({topicId:'synthetic',topicVersion:2,price:'120',reason:'Update original holding'}));assert.equal(h.snapshot().records[0].topicVersion,2);
 const bad=h.preview({rows:[row({symbol:'MSFT.US',topicId:'synthetic',topicVersion:3})]});assert.equal(bad.canApply,false);
}));
test('same symbols in separate accounts and markets remain independent native currency groups',()=>fixture(({h,save})=>{
 save([row(),row({account:'Synthetic B'}),row({symbol:'00700.HK',unitCost:'200',price:'180'}),row({symbol:'600519.SH',unitCost:'',price:''})]);
 const accounts=projectActualAccounts(h.snapshot(),[],at);assert.equal(accounts.length,4);assert.equal(new Set(accounts.flatMap(a=>a.positions.map(p=>p.id))).size,4);
 const hk=accounts.find(a=>a.currency==='HKD');assert.equal(hk.floatingLossCents,-3000);assert.equal(hk.floatingProfitCents,0);assert.equal(hk.navCents,null);
 const cn=accounts.find(a=>a.currency==='CNY');assert.equal(cn.unrealizedCents,null);assert.equal(cn.floatingProfitCents,null);assert.equal(cn.positions[0].costCents,null);
 assert(accounts.every(a=>a.dailyPnlCents===null&&a.maxDrawdownPct===null&&a.realizedCents===null));
}));
test('different snapshot times and partially known positions cannot be summed into account profit',()=>fixture(({h,save})=>{
 save([row(),row({symbol:'MSFT.US',asOf:'2026-10-09T11:00:00Z'})]);let a=projectActualAccounts(h.snapshot(),[],at)[0];assert.equal(a.valuedPositions,2);assert.equal(a.unrealizedCents,null);assert.match(a.unavailable.aggregate,/时间不一致/);
 save(row({symbol:'MSFT.US',asOf:'2026-10-09T11:00:00Z',price:'',reason:'Unknown observation'}));a=projectActualAccounts(h.snapshot(),[],at)[0];assert.equal(a.valuedPositions,1);assert.equal(a.unrealizedCents,null);
}));
test('all-account risks include actual records; projection reads never write or create trading decisions',()=>fixture(({store,h,save})=>{
 save(row());const before=store.db.prepare('SELECT total_changes() n').get().n,a=projectActualAccounts(h.snapshot(),[],at),o=buildWorkbenchOverview({at,actualAccounts:a});
 assert.equal(o.accounts[0].kind,'actual');assert(o.risks.length>0);assert.equal(o.monitoring.length,1);assert.equal(o.decisions.length,0);assert.equal(o.accounts[0].positions[0].openedAt,null);
 assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
}));
test('restored datasets and disabled modes reject writes at the module boundary',()=>fixture(({store,h})=>{
 const p=h.preview({rows:[row()]});store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.throws(()=>h.apply({id:p.id,hash:p.hash}),/恢复副本/);assert.throws(()=>h.preview({rows:[row()]}),/恢复副本/);
 assert.throws(()=>openActualHoldings(store).preview({rows:[row()]}),/当前模式/);assert.equal(h.snapshot().records.length,0);
}));
test('reopening the database retains reviewed batch identity, replay result and correction history',()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-actual-fixture-')),path=join(dir,'fixture.sqlite');let store=openStore(path);
 try{let h=openActualHoldings(store,{enabled:true,clock:()=>at});const p=h.preview({rows:[row()]});h.apply({id:p.id,hash:p.hash});store.close();store=openStore(path);h=openActualHoldings(store,{enabled:true,clock:()=>at});assert.equal(h.apply({id:p.id,hash:p.hash}).replayed,true);assert.equal(h.history(h.snapshot().records[0].id).length,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('tampered payloads fail closed instead of silently changing account facts',()=>fixture(({store,h,save})=>{
 save(row());store.db.exec("UPDATE actual_holding_records SET payload=json_set(payload,'$.quantity','999')");assert.throws(()=>h.snapshot(),/指纹/);
}));
test('HTTP actual record routes preserve instance, origin, body and restore protections and update overview',async()=>{
 const store=openStore(':memory:'),service=createService(store,{mode:'research',instance:{id:'synthetic-instance'},now:()=>Date.parse(at),fetcher:()=>{throw Error('No network');}}),handler=createHandler(store,service);
 const call=async(path,{method='GET',body,headers={}}={})=>{const req=Readable.from(body===undefined?[]:[typeof body==='string'?body:JSON.stringify(body)]);Object.assign(req,{url:path,method,headers:{host:'127.0.0.1:4179','content-type':'application/json','x-signal-instance':'synthetic-instance',...headers}});let status,payload;await handler(req,{writeHead:s=>status=s,end:b=>payload=JSON.parse(b)});return {status,body:payload};};
 try{
  assert.equal((await call('/api/actual-holdings/preview',{method:'POST',body:{rows:[row()]},headers:{'x-signal-instance':'wrong'}})).status,409);
  assert.equal((await call('/api/actual-holdings',{headers:{origin:'https://untrusted.example'}})).status,403);
  assert.equal((await call('/api/actual-holdings?ignored=1')).status,400);
  assert.equal((await call('/api/actual-holdings/preview',{method:'POST',body:'x'.repeat(400001)})).status,413);
  const p=await call('/api/actual-holdings/preview',{method:'POST',body:{rows:[row()]}});assert.equal(p.status,200);const saved=await call('/api/actual-holdings/apply',{method:'POST',body:{id:p.body.id,hash:p.body.hash}});assert.equal(saved.status,200);assert.equal(saved.body.records.length,1);
  const view=(await call('/api/data')).body;assert.equal(view.overview.accounts.filter(a=>a.kind==='actual').length,1);assert.equal(view.paper.positions.length,0);assert.equal(view.overview.decisions.length,0);
  const history=await call('/api/actual-holdings/'+saved.body.records[0].id+'/history');assert.equal(history.body.length,1);
  store.db.prepare("INSERT INTO settings VALUES('restore_review_required','1')").run();assert.equal((await call('/api/actual-holdings/apply',{method:'POST',body:{id:p.body.id,hash:p.body.hash}})).status,409);
 }finally{await service.close();store.close();}
});
