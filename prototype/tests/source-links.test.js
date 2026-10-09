import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {extractArticle} from '../server/source-reader.mjs';
import {sourceLinks,validateSourceLinks,validateSourceRequests,SOURCE_LINK_SCHEMA} from '../server/source-links.mjs';
import {materialInput} from '../server/research-materials.mjs';
import {digest,codexDraftSchema,validateCodexDraft} from '../server/codex-research.mjs';
import {validateCandidate} from '../server/model-research-runs.mjs';
import {dossier} from './automatic-research-fixture.mjs';
const base='https://ir.acme.com/report',link=(href,label='原始声明')=>`<a href="${href}">${label}</a>`;
const capture=html=>{const d=new JSDOM(html);try{return sourceLinks(d.window.document,base);}finally{d.window.close();}};
const packet=()=>{const input={topicId:'one',topicVersion:1,evidence:[{id:'material:one',material:{sourceLinks:capture(`<p>需要核对${link('/statement')}</p>`)}}]};return {schema:'event-research-packet-1',analysisMode:'assistant-review-required',input,inputHash:digest(input)};};
const req={evidenceId:'material:one',url:'https://ir.acme.com/statement',reason:'核对公告中的生效条件'};

test('captures literal article links with bounded context; unsafe, attachment, duplicate and self links are not targets',()=>{
 const result=capture(`<p>公告引用${link('/statement#section')}${link('/statement')}${link(base)}${link('http://public.com/no')}${link('https://127.0.0.1/no')}${link('https://internal.local/no')}${link('https://ir.acme.com/plan.docx')}${link('javascript:alert(1)')}${link('/cdn-cgi/l/email-protection','[email protected]')}${link('#same')}</p>`);
 assert.equal(result.schema,SOURCE_LINK_SCHEMA);assert.equal(result.links.length,1);assert.equal(result.links[0].url,req.url);assert.match(result.links[0].context,/公告引用/);assert.deepEqual(validateSourceLinks(result),result);
 const bounded=capture(Array.from({length:35},(_,i)=>link('/'+i,'甲'.repeat(220))).join(''));assert.equal(bounded.links.length,30);assert.equal(bounded.truncated,true);assert.equal(bounded.links[0].label.length,200);
});
test('reader exposes only extracted article links, without reading targets or changing unknown publication time',()=>{
 const html=`<html><head><title>原始正文</title></head><body><nav>${link('/nav','导航')}</nav><article><h1>原始正文</h1><p>${'公告内容尚需核验。'.repeat(60)}${link('/statement')}</p></article></body></html>`;
 const result=extractArticle(html,base);assert.equal(result.publishedAt,null);assert.deepEqual(result.sourceLinks.links.map(x=>x.url),[req.url]);assert.deepEqual(materialInput({...result,url:base},'2026-10-09').sourceLinks,result.sourceLinks);assert.throws(()=>materialInput({...result,url:base,scope:'excerpt'},'2026-10-09'),/网页提取/);
});
test('source request requires exact evidence-link pair, unique URLs, missing evidence and at most three targets',()=>{
 const p=packet();assert.deepEqual(validateSourceRequests([req],p),[req]);assert.equal(validateSourceRequests(undefined,p),undefined);
 for(const value of [[{...req,url:req.url+'?guess=true'}],[{...req,evidenceId:'material:other'}],[req,req],[{...req,reason:''}],[{...req,tools:'browse'}],Array(4).fill(req)])assert.throws(()=>validateSourceRequests(value,p));
 const output=dossier(p);output.sourceRequests=[req];assert.equal(validateCodexDraft({sections:output.sections,missingEvidence:[],sourceRequests:[]},p).sourceRequests.length,0);assert.throws(()=>validateCodexDraft({sections:output.sections,missingEvidence:[],sourceRequests:[req]},p));
 const schema=codexDraftSchema(p);assert.deepEqual(schema.properties.sourceRequests.items.properties.url.enum,[req.url]);assert.deepEqual(schema.properties.sourceRequests.items.properties.evidenceId.enum,[req.evidenceId]);p.input.eventSynthesis={};p.inputHash=digest(p.input);assert.equal(codexDraftSchema(p).properties.sourceRequests.maxItems,0);assert.throws(()=>validateCodexDraft({sections:output.sections,missingEvidence:['缺口'],sourceRequests:[req]},p));
});
test('persisted sourceRequests cannot differ from raw model output, and old outputs remain valid',()=>{
 const p=packet(),old=dossier(p);validateCandidate(old,p,{model:'test-model',topicId:'one'});assert.throws(()=>validateCandidate({...old,sourceRequests:[req]},p,{model:'test-model',topicId:'one'}));
 const value={sections:old.sections,missingEvidence:old.missingEvidence,sourceRequests:[req]},rawOutput=JSON.stringify(value),valid={...old,...value,rawOutput,trace:{...old.trace,outputHash:digest(rawOutput)}};validateCandidate(valid,p,{model:'test-model',topicId:'one'});
});
