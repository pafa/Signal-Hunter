import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {gunzipSync} from 'node:zlib';
import {once} from 'node:events';
import {encodeWorkbenchBody} from '../server/workbench-encoding.mjs';
import {openStore} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {hydrateActualChecks} from '../shared/actual-check-transport.mjs';

const body=JSON.stringify({title:'合成测试 🧪',rows:Array.from({length:200},(_,i)=>({id:i,reason:'原有风险、未知输入和历史版本均完整保留',value:null}))});
test('HTTP encoding preserves exact UTF-8 bytes and honors refused, preferred and legacy representations',async()=>{
 for(const header of ['gzip','gzip, deflate, br','GZIP;Q=1.000','*','gzip;q=0.5, identity;q=0.2','gzip;q=0.1, identity;q=0']){
  const r=await encodeWorkbenchBody(body,header);assert.equal(r.status,200);assert.equal(r.headers['Content-Encoding'],'gzip');assert.equal(r.headers['Content-Length'],r.body.length);assert.equal(r.headers.Vary,'Accept-Encoding');assert.equal(gunzipSync(r.body).toString(),body);assert(r.body.length<Buffer.byteLength(body));
 }
 for(const header of [undefined,'','identity','br','gzip;q=0','gzip;q=0.2, identity;q=1','gzip;q=0, *;q=1','gzip;q=0, gzip;q=1','gzip;q=2','gzip;q=no','gzip;level=1']){
  const r=await encodeWorkbenchBody(body,header);assert.equal(r.status,200);assert.equal(r.headers['Content-Encoding'],undefined);assert.equal(r.body,body);assert.equal(r.headers['Content-Length'],Buffer.byteLength(body));assert.equal(r.headers.Vary,'Accept-Encoding');
 }
 for(const header of ['*;q=0','gzip;q=0,identity;q=0','br,identity;q=0'])assert.equal((await encodeWorkbenchBody(body,header)).status,406);
 assert.equal((await encodeWorkbenchBody('{}','gzip')).body,'{}');
 assert.equal(gunzipSync((await encodeWorkbenchBody('{}','gzip,identity;q=0')).body).toString(),'{}');
});

async function fixture(fn){
 const store=openStore(':memory:'),service=createService(store,{mode:'research',instance:{id:'encoding-fixture'},now:()=>Date.parse('2026-10-12T04:03:00Z')});
 let handler;const server=http.createServer((req,res)=>handler(req,res));
 try{
  let topic=service.research.create({title:'Synthetic HTTP encoding',summary:'完整依据与旧版继续保留'});topic=service.research.addCompany(topic.id,{version:topic.version,symbol:'AAPL.US',note:'Synthetic association'});
  const p=service.actualHoldings.preview({rows:[{account:'Synthetic',symbol:'AAPL.US',quantity:'1',unitCost:'100',price:'110',asOf:'2026-10-12T04:00:00Z',source:'Synthetic',feeBasis:'included',topicId:topic.id,topicVersion:topic.version}]});
  assert(p.canApply);service.actualHoldings.apply({id:p.id,hash:p.hash});await service.runOperation('observations');
  server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;handler=createHandler(store,service,{apiPort:port,frontendPort:port});
  const request=(headers={},url='/api/data')=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port,path:url,headers:{'X-Signal-Instance':'encoding-fixture','X-Signal-Holding-Checks':'summary-v1',...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);}).on('error',reject);});
  await fn({store,service,request,port,handler});
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await service.close();store.close();}
}
test('real HTTP sends complete and conditional snapshots with identical validators and no read writes',()=>fixture(async({store,service,request})=>{
 const before=store.db.prepare('SELECT total_changes() n').get().n,history=service.actualHoldings.snapshot();
 const raw=await request({'Accept-Encoding':'identity'}),zip=await request({'Accept-Encoding':'gzip'});
 assert.equal(raw.status,200);assert.equal(zip.status,200);assert.equal(zip.headers['content-encoding'],'gzip');assert.equal(zip.headers['cache-control'],'no-store');assert.equal(zip.headers['x-content-type-options'],'nosniff');assert.equal(zip.headers.vary,'Accept-Encoding');assert.equal(Number(zip.headers['content-length']),zip.body.length);
 assert.deepEqual(gunzipSync(zip.body),raw.body);assert.equal(zip.headers['x-signal-topics-hash'],raw.headers['x-signal-topics-hash']);
 const headers={'X-Signal-Topics-Hash':raw.headers['x-signal-topics-hash']},next=await request({...headers,'Accept-Encoding':'gzip'}),plain=await request({...headers,'Accept-Encoding':'identity'});
 assert.deepEqual(gunzipSync(next.body),plain.body);assert.equal(JSON.parse(plain.body).research.topicsUnchanged,true);
 const parsed=hydrateActualChecks(JSON.parse(gunzipSync(zip.body))),check=parsed.overview.accounts.find(a=>a.kind==='actual').positions[0].monitoring.checks[0];assert.equal(parsed.observationInbox.actualChecks.length,10);
 const ref=check.detailRef,detail=await request({},`/api/actual-holdings/${ref.recordId}/checks/${ref.checkId}/${ref.hash}`);assert.equal(detail.status,200);assert.equal(JSON.parse(detail.body).check.id,check.id);
 assert.equal((await request({'Accept-Encoding':'gzip','X-Signal-Instance':'wrong'})).status,409);assert.equal((await request({'Accept-Encoding':'gzip',Origin:'https://example.test'})).status,403);
 const unsupported=await request({'Accept-Encoding':'identity;q=0,gzip;q=0'});assert.equal(unsupported.status,406);assert.equal(JSON.parse(unsupported.body).error,'不支持请求的响应编码');
 assert.deepEqual(service.actualHoldings.snapshot(),history);assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
}));

test('existing browser client transparently decodes HTTP compression before rehydrating cached research and holding checks',t=>fixture(async({request,port})=>{
 const original=globalThis.fetch,seen=[];globalThis.fetch=async(path,options)=>{const response=await original(`http://127.0.0.1:${port}${path}`,options);seen.push({encoding:response.headers.get('content-encoding'),hash:response.headers.get('x-signal-topics-hash')});return response;};t.after(()=>{globalThis.fetch=original;});
 const {request:api}=await import(`../src/major/api.js?encoding-${Math.random()}`),first=await api('/api/data'),next=await api('/api/data');
 const raw=await request({'Accept-Encoding':'identity'});assert.deepEqual(first,hydrateActualChecks(JSON.parse(raw.body)));assert.deepEqual(next,first);assert(seen.every(r=>r.encoding==='gzip'));assert.equal(seen[0].hash,seen[1].hash);
}));

test('closed responses are not written after asynchronous compression finishes',async()=>{
 const handler=createHandler({}, {instance:{id:'closed'},snapshot:()=>({research:{topics:[]},fixture:body})});
 let writes=0;await handler({method:'GET',url:'/api/data',headers:{host:'127.0.0.1:4179','accept-encoding':'gzip'}},{destroyed:true,writeHead:()=>writes++,end:()=>writes++});assert.equal(writes,0);
});
