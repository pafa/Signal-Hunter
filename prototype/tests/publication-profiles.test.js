import test from 'node:test';
import assert from 'node:assert/strict';
import {extractArticle} from '../server/source-reader.mjs';
import {validatePublicationEvidence} from '../server/publication-date.mjs';
import {materialInput,openMaterials} from '../server/research-materials.mjs';
import {openStore} from '../server/store.mjs';
import {materialComparisonSnapshot} from '../server/semantic-materials.mjs';
const csrc='https://www.csrc.gov.cn/csrc/c100028/c1234567/content.shtml',hkma='https://www.hkma.gov.hk/chi/news-and-media/press-releases/2024/10/20241016-4/';
const text='以下内容为原创合成测试。虚构机构公布一项新的政策，并提出两项不同的实施安排。相关要求尚需核实适用范围、日期、依赖条件和后续修订，不代表任何真实监管政策或交易建议。'.repeat(5);
const extract=(url,head='',header='')=>extractArticle(`<html><head><title>合成公告</title>${head}</head><body>${header}<article><p>${text}</p></article></body></html>`,url);
const meta='<meta name="PubDate" content="2026-08-01 21:56:31"><meta name="others" content="页面生成时间 2026-08-01 21:56:31">';
const info=date=>`<div class="content"><div class="info"><p class="fl">日期：${date}     来源：合成测试</p></div></div>`;
const header=date=>`<div class="content-area"><div class="date">${date}</div><h3 class="press-release-title">合成公告</h3></div>`;
test('CSRC profile records generated-time exclusion with matching explicit context and retains article date',()=>{
 const a=extract(csrc,meta,info('2024-02-06'));assert.equal(a.publishedAt,'2024-02-06');assert.equal(a.publicationDateEvidence.schema,'publication-date-2');assert.equal(a.publicationDateEvidence.profile,'csrc-article-1');assert.deepEqual(a.publicationDateEvidence.candidates,[{source:'csrc:article-date',raw:'2024-02-06'}]);assert.deepEqual(a.publicationDateEvidence.excluded,[{source:'meta:pubdate',raw:'2026-08-01 21:56:31',reason:'page-generation',context:'页面生成时间 2026-08-01 21:56:31'}]);assert.deepEqual(validatePublicationEvidence(a.publicationDateEvidence,a.publishedAt,csrc),a.publicationDateEvidence);
});
test('CSRC cannot discard PubDate without exact explicit generation-time corroboration',()=>{
 for(const head of ['<meta name="PubDate" content="2026-08-01 21:56:31">',meta.replace('页面生成时间 2026-08-01','页面生成时间 2026-08-02'),meta.replace('页面生成时间','文章修改时间')]){const a=extract(csrc,head,info('2024-02-06'));assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.status,'invalid');assert.equal(a.publicationDateEvidence.excluded.length,0);}
 const a=extract(csrc,meta);assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.status,'missing');assert.equal(a.publicationDateEvidence.excluded.length,1);
});
test('publisher selectors and exclusions are restricted to exact HTTPS article hosts and paths',()=>{
 for(const u of ['https://www.csrc.gov.cn.evil.com/csrc/c100028/c1234567/content.shtml','https://www.csrc.gov.cn/csrc/list.shtml','https://other.example.org/a','http://www.csrc.gov.cn/csrc/c100028/c1234567/content.shtml']){const a=extract(u,meta,info('2024-02-06'));assert.equal(a.publishedAt,null);assert.equal(a.publicationDateEvidence.profile,'generic');assert.equal(a.publicationDateEvidence.excluded.length,0);}
 for(const u of ['https://www.hkma.gov.hk/chi/news-and-media/press-releases/','https://www.hkma.gov.hk/chi/other/20241016-4/','https://www.hkma.gov.hk.evil.com/chi/news-and-media/press-releases/2024/10/20241016-4/'])assert.equal(extract(u,'',header('2024年10月16日')).publishedAt,null);
});
test('HKMA Chinese profile keeps day precision and ignores revision date and generic midnight meta',()=>{
 const a=extract(hkma,'<meta name="date" content="2024-10-16T00:00:00+08:00">',header('2024年10月16日')+'<div class="revision-date">修訂日期 : 2026年10月02日</div>');assert.equal(a.publishedAt,'2024-10-16');assert.equal(a.publicationDateEvidence.profile,'hkma-release-1');assert.deepEqual(a.publicationDateEvidence.candidates,[{source:'hkma:release-date',raw:'2024年10月16日'}]);assert.equal(extract(hkma.replace('/chi/','/gb_chi/'),'',header('2024年10月16日')).publishedAt,'2024-10-16');
 assert.equal(extract(hkma,'','<div class="content-area"><div class="date">2024年10月16日</div></div>').publishedAt,null);
});
test('invalid publisher labels, conflicting dates and combined candidate bounds still fail closed',()=>{
 assert.equal(extract(csrc,meta,info('2024-02-30')).publicationDateEvidence.status,'invalid');assert.equal(extract(csrc,meta,info('2024/02/06')).publicationDateEvidence.status,'invalid');
 assert.equal(extract(hkma,'',header('2024年10月16日')+header('2024年10月17日')).publicationDateEvidence.status,'conflict');
 const a=extract(csrc,meta.repeat(21),info('2024-02-06'));assert.equal(a.publicationDateEvidence.status,'overflow');assert.equal(a.publicationDateEvidence.excluded.length+a.publicationDateEvidence.candidates.length,20);
});
test('provenance validation binds profile to material URL and validates exclusion reason and context',()=>{
 const a=extract(csrc,meta,info('2024-02-06')),input={...a,url:csrc};assert.equal(materialInput(input,'2026-10-03').publishedAt,'2024-02-06');
 for(const mutate of [v=>v.excluded[0].context='页面生成时间 2026-08-02 21:56:31',v=>v.excluded[0].reason='ignore',v=>v.profile='generic',v=>v.excluded[0].extra=true,v=>v.excluded.push(null),v=>delete v.excluded]){const e=structuredClone(a.publicationDateEvidence);mutate(e);assert.throws(()=>validatePublicationEvidence(e,a.publishedAt,csrc),/依据无效/);}
 assert.throws(()=>materialInput({...input,url:'https://example.org/article'},'2026-10-03'),/依据无效/);
});
test('v1 evidence retains original resolution and hash when v2 material revisions are added',()=>{
 const store=openStore(':memory:'),materials=openMaterials(store.db,{clock:()=> '2026-10-03T00:00:00Z'});
 try{const input={title:'旧合成材料',sourceName:'合成来源',url:csrc,body:text,scope:'extracted-text',publishedAt:null,publicationDateEvidence:{schema:'publication-date-1',status:'invalid',candidates:[{source:'meta:pubdate',raw:'2026-08-01 21:56:31'}],truncated:false}};
 const old=materials.prepare('t',input,'public-web');old.persist();const before=store.db.prepare('SELECT * FROM research_materials WHERE id=?').get(old.material.id),snapshot=materialComparisonSnapshot(store.db,{id:old.material.id,revision:1});assert.equal(snapshot.publicationDateEvidence.schema,'publication-date-1');
 const a=extract(csrc,meta,info('2024-02-06')),next=materials.prepare('t',{...input,publishedAt:a.publishedAt,publicationDateEvidence:a.publicationDateEvidence},'public-web');next.persist();assert.equal(next.material.revision,2);assert.deepEqual(store.db.prepare('SELECT * FROM research_materials WHERE id=?').get(old.material.id),before);assert.equal(materialComparisonSnapshot(store.db,{id:next.material.id,revision:2}).publicationDateEvidence.excluded.length,1);
 }finally{store.close();}
});
