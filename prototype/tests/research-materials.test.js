import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {openPaper} from '../server/paper.mjs';
import {createService} from '../server/service.mjs';
import {createHandler} from '../server/index.mjs';
import {publicSourceUrl,isPublicIPv4,readPublicArticle,extractArticle} from '../server/source-reader.mjs';
import {relatedCandidates} from '../shared/research-links.mjs';
import {materialInput} from '../server/research-materials.mjs';
const at='2026-09-25T01:00:00.000Z';
const input={title:'Acme acquisition announcement',sourceName:'Acme investor relations',url:'https://ir.acme.com/announcement',publishedAt:'2026-09-20',scope:'excerpt',body:'The transaction is proposed, subject to approval. Closing is not assured.',stance:'unverified',family:'corporate',step:'fact',interpretation:'Proposed stage does not establish completion'};
function setup(options={}){const s=openStore(':memory:'),r=openResearch(s,{seed:false,clock:()=>at,...options});return {s,r,t:r.create({title:'Acme acquisition',summary:'Review a previously unfamiliar event'})};}
const html='<html><head><title>Company announcement</title></head><body><article><h1>Company announcement</h1>'+Array.from({length:5},(_,i)=>`<p>Paragraph ${i}: Acme announced a proposed acquisition, subject to shareholder approval. The company has not completed the transaction. The consideration and timing remain subject to terms in the agreement.</p>`).join('')+'</article><script>globalThis.readerPwned=true</script></body></html>';

test('source reader rejects credentials, private and non-HTTPS targets before any transport',async()=>{
 let calls=0;for(const url of ['http://ir.acme.com/a','https://user:secret@ir.acme.com/a','https://127.0.0.1/a','https://[::1]/a','https://localhost/a','https://router.internal/a','https://ir.acme.com:444/a'])await assert.rejects(readPublicArticle(url,{request:async()=>{calls++;}}));
 assert.equal(calls,0);assert.equal(publicSourceUrl('https://ir.acme.com/a#part').href,'https://ir.acme.com/a');
 for(const address of ['127.0.0.1','10.2.3.4','169.254.169.254','172.20.0.1','192.168.1.1','100.64.1.1','198.18.1.1','203.0.113.4','224.0.0.1','::1'])assert.equal(isPublicIPv4(address),false,address);
 assert.equal(isPublicIPv4('93.184.216.34'),true);
 await assert.rejects(readPublicArticle('https://ir.acme.com/a',{resolver:async()=>[{address:'93.184.216.34'},{address:'127.0.0.1'}],request:async()=>{calls++;}}),/非公网/);assert.equal(calls,0);
});
test('redirects revalidate DNS and pin the checked address; loops, timeout and HTTP restrictions fail honestly',async()=>{
 const resolved=[],sent=[];const resolver=async host=>{resolved.push(host);return [{address:host==='private.acme.com'?'10.0.0.1':'93.184.216.34'}];};
 await assert.rejects(readPublicArticle('https://ir.acme.com/a',{resolver,request:async(url,ip)=>{sent.push([url.href,ip]);return {status:302,headers:{location:'https://private.acme.com/b'}};}}),/非公网/);
 assert.deepEqual(resolved,['ir.acme.com','private.acme.com']);assert.deepEqual(sent,[['https://ir.acme.com/a','93.184.216.34']]);
 await assert.rejects(readPublicArticle('https://ir.acme.com/a',{resolver,request:async()=>({status:302,headers:{location:'/a'}})}),/重定向/);
 await assert.rejects(readPublicArticle('https://ir.acme.com/a',{resolver,request:async()=>({status:403,headers:{}})}),/403/);
 // Keep one referenced timer so Node's unref'ed AbortSignal can fire during this isolated test.
 const timer=setTimeout(()=>{},100);try{await assert.rejects(readPublicArticle('https://ir.acme.com/a',{timeoutMs:10,resolver:()=>new Promise(()=>{})}),/超时/);}finally{clearTimeout(timer);}
});
test('article extraction returns plain text, never executes scripts and refuses short or oversized pages',async()=>{
 const article=extractArticle(html,'https://ir.acme.com/a');assert.match(article.body,/subject to shareholder approval/);assert.doesNotMatch(article.body,/<script|readerPwned/);assert.equal(globalThis.readerPwned,undefined);assert.equal(article.scope,'extracted-text');
 assert.throws(()=>extractArticle('<html>Sign in</html>','https://ir.acme.com/a'),/未提取/);
 assert.throws(()=>extractArticle('x'.repeat(1_000_001),'https://ir.acme.com/a'),/1 MB/);
 assert.throws(()=>extractArticle(html,'https://news.google.com/rss/articles/abc'),/聚合/);
 const result=await readPublicArticle('https://ir.acme.com/a',{resolver:async()=>[{address:'93.184.216.34'}],request:async()=>({status:200,headers:{},body:html})});assert.equal(result.method,'public-article-2');
});
test('offset publication times remain valid and bilingual source-path recall exposes its lexical basis',()=>{
 assert.equal(materialInput({...input,publishedAt:'2026-09-25T00:30:00+08:00'},at).publishedAt,'2026-09-25T00:30:00+08:00');
 const candidates=relatedCandidates({title:'White House denies diesel export ban'},[{id:'diesel',version:1,title:'柴油出口传闻随后被否认',companies:[],evidence:[{claim:'后续否认',url:'https://www.reuters.com/world/us/white-house-denies-diesel-export-ban-2026-09-24/'}]}]);
 assert.equal(candidates[0].topicId,'diesel');assert.match(candidates[0].reasons[0],/来源词重合/);
});
test('manual material freezes exact text and acquisition, deduplicates retries and preserves revisions',()=>{
 let now=at;const {s,r,t}=setup({clock:()=>now});try{
  const a=r.saveMaterial(t.id,{version:1,...input});const first=r.materialList(t.id).materials[0];assert.equal(first.availableAt,at);assert.equal(first.body,input.body);assert.equal(a.evidence[0].verification,'unverified');assert.equal(a.version,2);
  assert.equal(r.saveMaterial(t.id,{version:2,...input}).version,2);assert.equal(r.materialList(t.id).materials.length,1);
  now='2026-09-26T01:00:00.000Z';const b=r.saveMaterial(t.id,{version:2,...input,body:'The proposal was withdrawn by Acme.',stance:'against'});assert.equal(b.version,3);const rows=r.materialList(t.id).materials;assert.equal(rows[1].revision,2);assert.equal(rows[1].availableAt,now);assert.equal(rows[0].availableAt,at);assert.equal(r.history(t.id).find(x=>x.version===2).topic.evidence.length,1);
  const packet=r.packet(t.id);assert.equal(packet.input.evidence[0].material.body,input.body);assert.equal(packet.input.evidence[1].material.body,'The proposal was withdrawn by Acme.');assert.equal(packet.analysisMode,'assistant-review-required');assert.equal(r.packet(t.id).inputHash,packet.inputHash);
 }finally{s.close();}
});
test('bad scope, future or invalid date and stale research cannot write material or evidence',()=>{
 const {s,r,t}=setup();try{for(const patch of [{scope:'extracted-text'},{scope:'full-verified'},{publishedAt:'2026-02-31'},{publishedAt:'2027-01-01'},{body:''},{url:'javascript:alert(1)'},{version:0}])assert.throws(()=>r.saveMaterial(t.id,{version:1,...input,...patch}));assert.equal(r.get(t.id).version,1);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM research_materials').get().n,0);
 }finally{s.close();}
});
test('failed fetch is auditable and does not create successful evidence or orphaned material',async()=>{
 const {s,r,t}=setup({sourceReader:async()=>{throw new Error('HTTP 403 fixture');}});try{await assert.rejects(r.readMaterial(t.id,{version:1,...input}),/403/);assert.equal(r.get(t.id).version,1);assert.equal(r.materialList(t.id).materials.length,0);assert.equal(r.materialList(t.id).attempts[0].state,'failed');}finally{s.close();}
});
test('a concurrent research edit or duplicate read cannot overwrite work when source fetch returns',async()=>{
 let release;const {s,r,t}=setup({sourceReader:()=>new Promise(resolve=>{release=resolve;})});try{
  const pending=r.readMaterial(t.id,{version:1,...input});await assert.rejects(r.readMaterial(t.id,{version:1,...input}),/正在读取/);
  r.update(t.id,{version:1,nextEvidence:'A colleague added a question'});release({...input,scope:'extracted-text'});await assert.rejects(pending,/研究已更新/);
  assert.equal(r.get(t.id).nextEvidence,'A colleague added a question');assert.equal(r.materialList(t.id).materials.length,0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM research_materials').get().n,0);
 }finally{s.close();}
});
test('source and topic writes roll back together on a database failure',()=>{
 const {s,r,t}=setup();try{s.db.exec("CREATE TRIGGER fail_version BEFORE INSERT ON research_versions BEGIN SELECT RAISE(ABORT,'fixture failure'); END");assert.throws(()=>r.saveMaterial(t.id,{version:1,...input}),/fixture failure/);assert.equal(r.get(t.id).version,1);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM research_materials').get().n,0);assert.equal(r.materialList(t.id).attempts.length,0);}finally{s.close();}
});
test('all stored news including older-than-500 can be processed and browsed without duplication',()=>{
 const {s,r}=setup();try{const news=Array.from({length:610},(_,i)=>({id:`news-${i}`,title:i===0?'Acme acquisition withdrawn':'Community weather report '+i,publisher:'Reuters',url:'https://www.reuters.com/a'+i,publishedAt:at}));s.ingest(news,at);assert.equal(s.news().length,500);r.process();assert.equal(s.db.prepare('SELECT COUNT(*) n FROM triage').get().n,610);
  const seen=[];let page=r.newsPage({limit:100});const ceiling=page.ceiling;seen.push(...page.items.map(n=>n.id));s.ingest([{...news[0],id:'newly-arrived'}],at);
  while(page.nextCursor){page=r.newsPage({limit:100,before:page.nextCursor,ceiling});seen.push(...page.items.map(n=>n.id));}assert.equal(seen.length,610);assert.equal(new Set(seen).size,610);assert.ok(seen.includes('news-0'));assert.ok(!seen.includes('newly-arrived'));
  assert.equal(r.newsPage({q:'Acme acquisition',bucket:'review'}).items[0].id,'news-0');assert.ok(r.newsPage({bucket:'quiet'}).total>0);assert.equal(r.newsPage({bucket:'pending'}).items[0].id,'newly-arrived');assert.equal(r.newsPage({q:'%'}).total,0);assert.throws(()=>r.newsPage({before:'nan'}),/分页/);
 }finally{s.close();}
});
test('revised old news is reclassified, with exact revision acquisition preserved',()=>{
 const {s,r}=setup();try{s.ingest([{id:'n',title:'Ordinary weather',publishedAt:at}],at);r.process();s.ingest([{id:'n',title:'Acme auditor resigns after fraud discovery',publishedAt:at}],'2026-09-25T02:00:00Z');assert.equal(r.newsPage({bucket:'pending'}).total,1);r.process();const n=r.newsPage({bucket:'review'}).items[0];assert.equal(n.revision,2);assert.equal(n.revisionFirstSeen,'2026-09-25T02:00:00Z');assert.equal(s.revisions('n').length,2);}finally{s.close();}
});
test('related candidates expose reasons; links freeze target version and revocation retains history',()=>{
 const {s,r,t}=setup();try{let target=r.create({title:'Acme acquisition proposal',summary:'The prior stage'});const candidates=relatedCandidates(t,r.list());assert.equal(candidates[0].topicId,target.id);assert.match(candidates[0].reasons.join(''),/来源词重合/);assert.equal(candidates[0].probability,undefined);
  assert.throws(()=>r.linkTopic(t.id,{version:1,topicId:t.id}),/自身/);
  let a=r.linkTopic(t.id,{version:1,topicId:target.id,targetVersion:1,kind:'followup',active:true,note:'The same proposal has a later stage'});const frozen=r.packet(t.id).inputHash;
  target=r.update(target.id,{version:1,hypothesis:{logic:'Later revised judgment'}});assert.equal(r.related(t.id).links[0].currentVersion,2);assert.equal(r.packet(t.id).input.relatedResearch[0].version,1);assert.equal(r.packet(t.id).inputHash,frozen);assert.equal(r.related(target.id).incoming.length,1);
  assert.throws(()=>r.linkTopic(t.id,{version:a.version,topicId:target.id,targetVersion:1,kind:'followup',active:true,note:'Stale'}),/新版本/);
  a=r.linkTopic(t.id,{version:a.version,topicId:target.id,targetVersion:2,kind:'followup',active:false,note:'Different legal entity after checking'});assert.equal(r.related(target.id).incoming.length,0);assert.equal(r.history(t.id)[1].topic.relatedEvents[0].active,true);assert.equal(a.evidence.length,0);
 }finally{s.close();}
});
test('new HTTP material path handles split UTF-8 without corruption and leaves paper account unchanged',async()=>{
 const s=openStore(':memory:'),service=createService(s),handler=createHandler(s,service);const topic=service.research.create({title:'Local integration',summary:'Isolated fixture'}),book=service.paper.snapshot();
 const call=async(method,url,body)=>{let status,result;const bytes=Buffer.from(JSON.stringify(body));await handler({method,url,headers:{host:'127.0.0.1:4179','content-type':'application/json'},async *[Symbol.asyncIterator](){for(let i=0;i<bytes.length;i+=7)yield bytes.subarray(i,i+7);}},{writeHead:n=>status=n,end:b=>result=JSON.parse(b)});return {status,result};};
 try{const body='中文材料，包含传闻与反证。'.repeat(800);const response=await call('POST',`/api/research/${topic.id}/materials`,{...input,body,version:1});assert.equal(response.status,200);assert.equal(service.research.materialList(topic.id).materials[0].body,body);assert.deepEqual(service.paper.snapshot(),book);assert.equal((await call('PATCH',`/api/research/${topic.id}`,{nextEvidence:'x'.repeat(17000)})).status,413);}finally{s.close();}
});
test('material added to a held topic updates displayed research version while persisted orders and holdings stay unchanged',()=>{
 const s=openStore(':memory:'),r=openResearch(s,{clock:()=>at}),p=openPaper(s,r,{clock:()=>at});
 try{const before=s.db.prepare('SELECT payload FROM paper_books').get().payload,versions=s.db.prepare('SELECT COUNT(*) n FROM paper_versions').get().n,t=r.get('agent-cpu');
  r.saveMaterial(t.id,{...input,version:t.version,step:t.chain[0].id});
  assert.equal(p.snapshot().positions.find(p=>p.topicId===t.id).currentResearchVersion,t.version+1);
  assert.equal(s.db.prepare('SELECT payload FROM paper_books').get().payload,before);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM paper_versions').get().n,versions);
 }finally{s.close();}
});
