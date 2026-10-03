import test from 'node:test';import assert from 'node:assert/strict';
import {extractArticle,readPublicArticle} from '../server/source-reader.mjs';
import {validateExtractionEvidence,ARTICLE_SCOPE_INSTRUCTIONS} from '../server/article-extraction.mjs';
import {materialInput,openMaterials} from '../server/research-materials.mjs';
import {openStore} from '../server/store.mjs';import {materialComparisonSnapshot} from '../server/semantic-materials.mjs';
import {comparisonPrompt,MATERIAL_SEMANTIC_VERSION,SEMANTIC_VERSION} from '../server/semantic-events.mjs';import {codexPrompt,CODEX_PROMPT_VERSION} from '../server/codex-research.mjs';
const url='https://www.csrc.gov.cn/csrc/c100028/c1234567/content.shtml',generic='https://news.acme.com/article',body='这是原创合成测试正文，虚构企业发布了一项计划。材料引用一份尚未提供的附件，不能仅根据文件标题推断内容，仍需逐项核对。正文中的字号与分享一词具有业务含义，不能按字词删除。'.repeat(5);
const html=extra=>`<html><head><title>合成公告</title></head><body><div class="content"><div class="info"><p class="fl">日期：2024-01-01 来源：测试</p><p id="changeSize" class="changeSize">界面字号专用文字</p><div id="share" class="share">界面分享专用文字</div></div><div class="detail-news"><p>${body}</p>${extra}</div></div></body></html>`;
const read=extra=>extractArticle(html(extra),url);
const link=(href,label='附件')=>`<a href="${href}">${label}</a>`;
test('cleaning removes only verified publisher controls and preserves business text, date and unread attachments',()=>{
 const a=read('<div id="files" style="display:none">'+link('files/plan.pdf','附件：计划.pdf')+'</div>');assert.ok(a.body.includes(body));assert.doesNotMatch(a.body,/界面字号专用文字|界面分享专用文字/);assert.equal(a.publishedAt,'2024-01-01');assert.equal(a.extractionEvidence.scanScope,'publisher-article-links');assert.deepEqual(a.extractionEvidence.removedControls,{fontSize:1,share:1});assert.deepEqual(a.extractionEvidence.attachments,[{url:new URL('files/plan.pdf',url).href,label:'附件：计划.pdf',formatHint:'pdf',status:'unread'}]);assert.equal(a.method,'public-article-4');
});
test('identical class names on other hosts and outside publisher control locations do not authorize removal',()=>{
 const a=extractArticle(html(''),generic);assert.deepEqual(a.extractionEvidence.removedControls,{fontSize:0,share:0});
 const b=read('<div class="info"><div id="share" class="share"><p>业务分享段落必须保留。</p></div></div>');assert.match(b.body,/业务分享段落必须保留/);
});
test('attachment scan excludes page navigation, deduplicates URLs and records format hints without reading',()=>{
 const page=html(link('/files/a.PDF#one','A')+link('/files/a.PDF#two','B')+link('/files/b.docx?x=1','报告')+link('/download?id=3','附件 3')+link('#files','附件')+link('','附件')).replace('</body>',link('/footer.pdf','页脚报告')+'</body>');const a=extractArticle(page,url);assert.equal(a.extractionEvidence.attachments.length,3);assert.deepEqual(a.extractionEvidence.attachments.map(x=>x.formatHint),['pdf','docx','unknown']);assert.ok(a.extractionEvidence.attachments.every(x=>x.status==='unread'));
});
test('generic pages scan only extracted HTML and record download-attribute links',()=>{
 const a=extractArticle(`<html><head><title>Test</title></head><body><article><p>${body}</p><a href="/download?id=1" download>资料</a>${link('/r.xlsx','report.xlsx')}</article><footer>${link('/footer.pdf','footer')}</footer></body></html>`,generic);assert.equal(a.extractionEvidence.scanScope,'extracted-html-links');assert.equal(a.extractionEvidence.attachments.length,2);assert.equal(a.extractionEvidence.profile,'generic');
});
test('unsafe attachment URLs are not rendered or requested; only a single page fetch occurs',async()=>{
 const unsafe=['javascript:alert(1)','data:text/html,fixture','file:fixture.pdf','http://example.com/a.pdf','https://127.0.0.1/a.pdf','https://u:p@example.com/a.pdf','https://router.internal/a.pdf'];let calls=0;
 const a=await readPublicArticle(url,{resolver:async()=>[{address:'93.184.216.34'}],request:async()=>{calls++;return {status:200,headers:{},body:html(unsafe.map(x=>link(x,'附件')).join('')+link('https://files.acme.com/a.pdf','附件'))};}});assert.equal(calls,1);assert.equal(a.extractionEvidence.omittedAttachmentLinks,unsafe.length);assert.equal(a.extractionEvidence.attachments.length,1);
});
test('attachment limits retain bounded evidence and disclose omissions rather than claiming completeness',()=>{
 const a=read(Array.from({length:32},(_,i)=>link('/files/'+i+'.pdf','附件 '+i)).join(''));assert.equal(a.extractionEvidence.attachments.length,30);assert.equal(a.extractionEvidence.truncated,true);
 const b=read(link('/files/a.pdf','x'.repeat(201)));assert.equal(b.extractionEvidence.attachments[0].label.length,200);assert.equal(b.extractionEvidence.truncated,true);
 const c=read(link('/'+ 'a'.repeat(2000)+'.pdf'));assert.equal(c.extractionEvidence.attachments.length,0);assert.equal(c.extractionEvidence.omittedAttachmentLinks,1);
});
test('changed publisher layout falls back without asserting known article coverage',()=>{
 const a=extractArticle(html(link('/a.pdf')).replace('class="detail-news"','class="changed"'),url);assert.equal(a.extractionEvidence.scanScope,'extracted-html-links');assert.equal(a.extractionEvidence.attachments.length,1);
});
test('reading scope validates URL profile, exact shape, counts, unread status and attachment addresses',()=>{
 const a=read(link('/a.pdf')),e=a.extractionEvidence;assert.deepEqual(validateExtractionEvidence(e,url),e);
 for(const mutate of [v=>v.profile='generic',v=>v.removedControls.share=-1,v=>v.removedControls.fontSize=1.5,v=>v.scanScope='full-text',v=>v.truncated='false',v=>v.omittedAttachmentLinks=-1,v=>v.attachments[0].status='read',v=>v.attachments[0].url='javascript:alert(1)',v=>v.attachments.push(v.attachments[0]),v=>v.attachments[0].formatHint='html',v=>v.extra=true]){const x=structuredClone(e);mutate(x);assert.throws(()=>validateExtractionEvidence(x,url),/范围记录无效/);}
 assert.throws(()=>materialInput({...a,url,scope:'excerpt'},'2026-10-03'),/仅用于网页提取/);assert.throws(()=>validateExtractionEvidence(e,generic),/范围记录无效/);
});
test('scope changes append immutable material revisions and remain in frozen semantic inputs',()=>{
 const s=openStore(':memory:'),m=openMaterials(s.db,{clock:()=> '2026-10-03T00:00:00Z'});try{
 const a=read(link('/a.pdf')),legacy={title:a.title,sourceName:a.sourceName,body:a.body,url,scope:'extracted-text',publishedAt:a.publishedAt,publicationDateEvidence:a.publicationDateEvidence};const old=m.prepare('t',legacy,'public-web');old.persist();const before=s.db.prepare('SELECT * FROM research_materials WHERE id=?').get(old.material.id);assert.equal(Object.hasOwn(materialComparisonSnapshot(s.db,{id:old.material.id,revision:1}),'extractionEvidence'),false);
 const next=m.prepare('t',{...a,url},'public-web');next.persist();assert.equal(next.material.revision,2);assert.deepEqual(s.db.prepare('SELECT * FROM research_materials WHERE id=?').get(old.material.id),before);const snapshot=materialComparisonSnapshot(s.db,{id:next.material.id,revision:2});assert.deepEqual(snapshot.extractionEvidence,a.extractionEvidence);const retry=m.prepare('t',{...a,url},'public-web');retry.persist();assert.equal(retry.material.id,next.material.id);
 const changed=structuredClone(next.material);changed.extractionEvidence.attachments[0].label='changed';s.db.prepare('UPDATE research_materials SET payload=? WHERE id=?').run(JSON.stringify(changed),changed.id);assert.throws(()=>materialComparisonSnapshot(s.db,{id:changed.id,revision:2}),/快照校验失败/);
 }finally{s.close();}
});
test('research and material-comparison prompts disclose unread scope without altering headline-only prompt',()=>{
 assert.ok(codexPrompt({}).includes(ARTICLE_SCOPE_INSTRUCTIONS));assert.equal(CODEX_PROMPT_VERSION,'codex-research-4');assert.ok(comparisonPrompt({schema:MATERIAL_SEMANTIC_VERSION,input:{}}).includes(ARTICLE_SCOPE_INSTRUCTIONS));assert.equal(comparisonPrompt({schema:SEMANTIC_VERSION,input:{}}).includes(ARTICLE_SCOPE_INSTRUCTIONS),false);
});
