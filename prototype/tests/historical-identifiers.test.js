import test from 'node:test';import assert from 'node:assert/strict';
import {historicalProfile,historicalMatch} from '../server/historical-mechanisms.mjs';
import {historicalBodyProfile,historicalBodyMatch} from '../server/historical-body.mjs';
import {directoryCodeRecall} from '../server/directory-code-recall.mjs';
const match=(left,right)=>historicalMatch({title:left},{title:right},historicalProfile({title:left}),historicalProfile({title:right}));
test('explicit matching venue and symbol recalls an unlisted-directory acquisition without claiming issuer identity',()=>{
 const r=match('Violet (Nasdaq: SYNX) terminates its merger agreement','Violet (NASDAQ:SYNX) announces acquisition of Studio');
 assert.equal(r.status,'candidate');assert.equal(r.sameIssuer,false);assert.deepEqual(r.explicitIdentifiers,[{symbol:'SYNX.US',venue:'XNAS'}]);assert.equal(r.domains.length,0);assert(r.reasons.some(x=>x.includes('证券代码')));assert(r.differences.some(x=>x.includes('历史有效期')));
});
test('market-qualified identifiers reuse directory parsing and cannot cross incompatible venues or malformed extensions',()=>{
 for(const right of ['NYSE:SYNX','NASDAQ:OTHERQ','SYNX.USX','HKEX:SYNX.US','BSE:430047'])assert.equal(match('NASDAQ:SYNX merger announcement',right+' acquisition').status,'no_context');
 assert.equal(match('NASDAQ:SYNX merger announcement','NASDAQ:SYNX and NYSE:SYNX acquisition').status,'no_context');
 assert.equal(match('NASDAQ:SYNX merger announcement','NASDAQ:SYNX routine bulletin').status,'no_mechanism');
 assert.equal(match('NASDAQ:META merger announcement','NYSE:META acquisition').status,'no_context');
 assert.equal(match('NASDAQ:META merger announcement','META.USX acquisition').status,'no_context');
 assert.equal(match('Meta announces merger','Meta discusses acquisition').sameIssuer,true);
 assert.equal(match('HKEX:700 merger announcement','00700.HK acquisition').status,'candidate');
 const parsed=directoryCodeRecall('ＮＡＳＤＡＱ：ＳＹＮＸ');assert.deepEqual(parsed.tokens,[{symbol:'SYNX.US',venue:'XNAS'}]);assert(parsed.matches({symbol:'SYNX.US',venue:'XNAS'}));assert(!parsed.matches({symbol:'SYNX.US',venue:'XNYS'}));
 assert.equal(match('ＮＡＳＤＡＱ：ＳＹＮＸ merger announcement','SYNX.US acquisition').status,'candidate');
});
test('body identifiers must accompany the mechanism in the same saved span, with exact source quotations',()=>{
 const record=(id,body)=>({id,revision:1,title:'Company update',kind:'material',body,contentScope:'excerpt'});
 const left=record('left','Violet (Nasdaq: SYNX) terminates its merger agreement.'),right=record('right','Violet (NASDAQ:SYNX) announces acquisition of Studio.');
 const r=historicalBodyMatch(left,right,historicalBodyProfile(left),historicalBodyProfile(right));assert.equal(r.status,'candidate');assert.equal(r.sameIssuer,false);
 for(const [side,record] of [['anchor',left],['candidate',right]]){const q=r.quotes[side];assert.equal(record[q.field].slice(q.start,q.end),q.text);assert(q.text.includes('SYNX'));}
 const separated=record('separated','Listed as NASDAQ:SYNX. Another company announces an acquisition.');assert.equal(historicalBodyMatch(left,separated,historicalBodyProfile(left),historicalBodyProfile(separated)).status,'no_context');
});
