import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyHeadline} from '../server/triage.mjs';
const classify=title=>classifyHeadline({title});
test('a targeted financial-regulator enforcement action or remedial order enters research without declaring materiality or trade direction',()=>{
 for(const title of [
  'Federal Reserve Board announces enforcement action against Acme Banking Company',
  'FCA issues a consent order against Acme Bank',
  'OCC terminates a cease-and-desist order against Acme Bank',
  '证监会对甲公司作出行政处罚决定',
  '香港金管局向甲银行发出纪律处分决定',
 ]){
  const r=classify(title);assert.equal(r.bucket,'review',title);assert.ok(r.matchedRules.includes('regulatory-enforcement'));assert.equal(r.assessment,'重大性待核验');assert.equal(r.tradeSignal,false);assert.equal(r.screening.materiality,'unassessed');
 }
});
test('regulatory proposals and denials stay unconfirmed when they mention a targeted action',()=>{
 const proposed=classify('Federal Reserve may issue an enforcement action against Acme Bank');assert.equal(proposed.bucket,'review');assert.equal(proposed.messageStatus,'proposed');
 const denial=classify('Acme Bank denies that the FCA issued a consent order against it');assert.equal(denial.bucket,'review');assert.equal(denial.messageStatus,'denial-reported');assert.match(denial.stage,/否认/);
});
test('general enforcement discussion, staff notices and non-financial police actions do not become targeted company research',()=>{
 for(const title of [
  'Federal Reserve hosts a conference on enforcement action against banks',
  'FCA announces a training course about consent orders',
  'OCC publishes its enforcement manual for examiners',
  'Local police announce enforcement action against unsafe traffic',
  '证监会举办行政处罚业务培训',
  '香港金管局发布纪律处分程序指引',
 ])assert.notEqual(classify(title).bucket,'review',title);
});
