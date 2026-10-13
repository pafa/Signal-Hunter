import test from 'node:test';
import assert from 'node:assert/strict';
import {articleLinkUrl,validateLinkUpgrade} from '../server/article-link-url.mjs';
import {extractArticle,readPublicArticle} from '../server/source-reader.mjs';
import {validateSourceLinks,validateSourceRequests} from '../server/source-links.mjs';
import {validateExtractionEvidence} from '../server/article-extraction.mjs';
import {materialInput,openMaterials,immutableMaterialSnapshot} from '../server/research-materials.mjs';
import {openStore} from '../server/store.mjs';
const base='https://www.csrc.gov.cn/csrc/c100028/c7663393/content.shtml',http='http://www.csrc.gov.cn/csrc/c101981/c7663407/content.shtml',secure=http.replace('http:','https:');
const prose='这是合成的征求意见说明，只有通知入口，不是已经读取的制度条文。'.repeat(12);
const page=links=>`<html><head><title>合成规则说明</title></head><body><nav><a href="/nav.pdf">导航</a></nav><div class="content"><div class="detail-news"><p>${prose}</p>${links}</div></div><footer><a href="/footer.pdf">页脚</a></footer></body></html>`;
const link=(url,label='通知')=>`<p><a href="${url}">${label}</a></p>`;
test('same-host explicit HTTP link changes protocol only and records original query and fragment',()=>{
 assert.deepEqual(articleLinkUrl(http,base),{url:secure,originalUrl:http});
 assert.deepEqual(articleLinkUrl(http+'?x=1#section',base),{url:secure+'?x=1',originalUrl:http+'?x=1#section'});
 assert.deepEqual(articleLinkUrl('/csrc/file.pdf#p',base),{url:'https://www.csrc.gov.cn/csrc/file.pdf'});
 for(const u of ['http://other.gov.cn/a','http://user:secret@www.csrc.gov.cn/a','http://www.csrc.gov.cn:8080/a','http://127.0.0.1/a','http://internal.local/a','javascript:alert(1)'])assert.throws(()=>articleLinkUrl(u,base));
 assert.throws(()=>articleLinkUrl(http,'http://www.csrc.gov.cn/'));
});
test('publisher body and hidden attachment upgrades preserve provenance and exclude navigation',()=>{
 const a=extractArticle(page(link(http)+`<div id="files" style="display:none">${link('http://www.csrc.gov.cn/files/rule.pdf','附件：规则.pdf')}</div>`),base);
 assert.equal(a.sourceLinks.links.length,2);assert.equal(a.sourceLinks.links[0].originalUrl,'http://www.csrc.gov.cn/files/rule.pdf');assert.equal(a.extractionEvidence.attachments[0].originalUrl,'http://www.csrc.gov.cn/files/rule.pdf');
 assert.deepEqual(validateSourceLinks(a.sourceLinks,base),a.sourceLinks);assert.deepEqual(validateExtractionEvidence(a.extractionEvidence,base),a.extractionEvidence);assert.deepEqual(materialInput({...a,url:base},'2026-10-10').sourceLinks,a.sourceLinks);
 const req={evidenceId:'m',url:secure,reason:'读取原文通知'};assert.deepEqual(validateSourceRequests([req],{input:{evidence:[{id:'m',material:a}]}}),[req]);assert.throws(()=>validateSourceRequests([{...req,url:http}],{input:{evidence:[{id:'m',material:a}]}}));
});
test('upgrade records reject changed path, host, credentials, unrecorded protocol and legacy schema forgery',()=>{
 const a=extractArticle(page(link(http)),base),entry=a.sourceLinks.links[0];
 for(const originalUrl of [http+'/guess',http.replace('www.csrc.gov.cn','other.gov.cn'),http.replace('http://','http://user@'),secure])assert.throws(()=>validateLinkUpgrade({...entry,originalUrl},base));
 for(const schema of ['article-source-links/1','article-source-links/2','article-source-links/3'])assert.throws(()=>validateSourceLinks({...a.sourceLinks,schema},base));
 const b=extractArticle(page(link('http://www.csrc.gov.cn/a.pdf','附件')),base);assert.throws(()=>validateExtractionEvidence({...b.extractionEvidence,schema:'article-extraction-2'},base));
 assert.throws(()=>materialInput({...a,url:'https://other.gov.cn/source'},'2026-10-10'));
});
test('HTTPS failure and redirect to HTTP never trigger insecure fallback',async()=>{
 const urls=[];await assert.rejects(readPublicArticle(secure,{resolver:async()=>[{address:'93.184.216.34'}],request:async u=>{urls.push(u.href);return {status:301,headers:{location:http}};}}),/HTTPS/);assert.deepEqual(urls,[secure]);
 let dns=0;await assert.rejects(readPublicArticle(http,{resolver:async()=>{dns++;return [];}}),/HTTPS/);assert.equal(dns,0);
 await assert.rejects(readPublicArticle(secure,{resolver:async()=>[{address:'127.0.0.1'}],request:async()=>assert.fail('private address requested')}),/非公网/);
});
test('legacy material remains byte-identical and new secure link becomes a separate immutable revision',()=>{
 const a=extractArticle(page(link(http)),base),old={...a,extractionEvidence:{...a.extractionEvidence,schema:'article-extraction-2'},sourceLinks:{...a.sourceLinks,schema:'article-source-links/3',links:[],omitted:1}},store=openStore(':memory:'),m=openMaterials(store.db,{clock:()=> '2026-10-10T00:00:00Z'});
 try{const first=m.prepare('t',{...old,url:base},'public-web');first.persist();const snap=immutableMaterialSnapshot(store.db,first.material);const next=m.prepare('t',{...a,url:base},'public-web');next.persist();assert.equal(next.material.revision,2);assert.deepEqual(immutableMaterialSnapshot(store.db,first.material),snap);assert.equal(immutableMaterialSnapshot(store.db,next.material).sourceLinks.links[0].originalUrl,http);}finally{store.close();}
});
