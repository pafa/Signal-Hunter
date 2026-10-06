import test from 'node:test';import assert from 'node:assert/strict';
import {editorDraftKey,readEditorDraft,persistEditorDraft,resetEditorDraft,acknowledgeEditorDraft} from '../src/major/editor-drafts.js';
const storage=()=>{const rows=new Map();return {getItem:k=>rows.get(k),setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};};
const initial={base:3,value:{text:'original'}},valid=v=>typeof v?.text==='string';
const key=()=>editorDraftKey({id:crypto.randomUUID(),createdAt:'2026-10-04'},'fixture','hypothesis');
test('draft identity separates instance, topic creation and form; malformed stored input is ignored',()=>{
 const t={id:'topic',createdAt:'first'};assert.equal(new Set([editorDraftKey(t,'a','claim'),editorDraftKey(t,'b','claim'),editorDraftKey({...t,createdAt:'second'},'a','claim'),editorDraftKey(t,'a','hypothesis')]).size,4);
 for(const input of ['invalid',JSON.stringify({base:0,value:{text:'bad'},generation:1}),JSON.stringify({base:1,value:null,generation:1})]){const s=storage(),k=key();s.setItem(k,input);assert.equal(readEditorDraft(k,initial,valid,s).value.text,'original');}
});
test('exact submitted generation clears only its draft and delayed reply cannot erase newer edits or a discarded form',()=>{
 const s=storage(),k=key(),first=readEditorDraft(k,initial,valid,s),submitted=persistEditorDraft(k,first,{text:'submitted'},s);const newer=persistEditorDraft(k,submitted,{text:'later'},s);
 assert.equal(acknowledgeEditorDraft(k,submitted,{text:'server'},4,s).retained,true);assert.deepEqual(readEditorDraft(k,initial,valid,s),newer);assert.equal(newer.base,3);
 assert.equal(acknowledgeEditorDraft(k,newer,{text:'server'},4,s).retained,false);assert.equal(s.getItem(k),undefined);assert.equal(readEditorDraft(k,{...initial,base:4},valid,s).base,4);
 const edit=persistEditorDraft(k,newer,{text:'discard'},s);resetEditorDraft(k,{text:'fresh'},8,s);assert.equal(acknowledgeEditorDraft(k,edit,{text:'old'},5,s).retained,true);assert.equal(readEditorDraft(k,{...initial,base:8},valid,s).base,8);
});
test('blocked session storage preserves a volatile draft in memory through remount',()=>{
 const k=key(),s={getItem(){throw Error('denied');},setItem(){throw Error('quota');},removeItem(){throw Error('denied');}};
 const first=readEditorDraft(k,initial,valid,s),next=persistEditorDraft(k,first,{text:'keep'},s);assert.equal(next.volatile,true);assert.equal(readEditorDraft(k,initial,valid,s).value.text,'keep');
});

test('clean remount reads newest research while retaining generation separation from old replies',()=>{
 const s=storage(),k=key(),first=readEditorDraft(k,initial,valid,s),submitted=persistEditorDraft(k,first,{text:'old'},s);resetEditorDraft(k,{text:'discarded'},3,s);
 const remounted=readEditorDraft(k,{base:5,value:{text:'latest server'}},valid,s);assert.equal(remounted.value.text,'latest server');const newer=persistEditorDraft(k,remounted,{text:'new pending'},s);assert.notEqual(newer.generation,submitted.generation);assert.equal(acknowledgeEditorDraft(k,submitted,{text:'late old'},4,s).retained,true);assert.equal(readEditorDraft(k,initial,valid,s).value.text,'new pending');
});

test('full permitted material body survives cold storage restore including JSON-escaped characters',()=>{
 const s=storage(),k=key(),body='\u0001'.repeat(80000);s.setItem(k,JSON.stringify({base:3,generation:1,dirty:true,value:{text:body}}));assert(s.getItem(k).length>262144);assert.equal(readEditorDraft(k,initial,valid,s).value.text,body);
});
