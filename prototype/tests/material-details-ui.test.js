import test from 'node:test';import assert from 'node:assert/strict';import React,{act} from 'react';import {createServer} from 'vite';import {fileURLToPath} from 'node:url';import {JSDOM} from 'jsdom';
test('collapsed material omits full text; opening loads once, preserves adjacent draft, retries errors and ignores unmounted responses',async()=>{
 const vite=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'}),dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),names=['window','document','HTMLElement','fetch','IS_REACT_ACT_ENVIRONMENT'],before=new Map(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let root;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client');root=createRoot(document.getElementById('root'));const {default:Material}=await vite.ssrLoadModule('/src/major/SourceMaterial.jsx');
  const material=id=>({id,revision:1,documentId:'document-'+id,contentHash:id.repeat(64),title:'Material '+id,scope:'excerpt',stance:'unverified',verification:'unverified',sourceName:'Synthetic',availableAt:'2026-10-04T00:00:00Z'}),pending=[];let calls=0;
  globalThis.fetch=async path=>{calls++;return new Promise((resolve,reject)=>pending.push({path,resolve:value=>resolve(new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})),reject}));};
  const render=id=>act(async()=>root.render(React.createElement('div',null,React.createElement('input',{defaultValue:'Unsaved source draft','aria-label':'draft'}),React.createElement(Material,{key:id,topicId:'topic',material:material(id),busy:false}))));
  const toggle=open=>act(async()=>{const el=document.querySelector('details.source-item');el.open=open;el.dispatchEvent(new dom.window.Event('toggle'));});
  await render('a');assert.equal(calls,0);assert.equal(document.querySelector('.source-body'),null);
  await toggle(true);assert.equal(calls,1);assert.match(pending[0].path,/topic\/materials\/a$/);assert.match(document.body.textContent,/正在读取/);
  await toggle(false);await toggle(true);assert.equal(calls,1);
  await act(async()=>pending[0].resolve({...material('a'),body:'Original <script>plain text</script> '+ 'x'.repeat(70000)}));assert.match(document.querySelector('.source-body').textContent,/Original/);assert.equal(document.querySelector('script'),null);assert.equal(document.querySelector('input').value,'Unsaved source draft');
  await toggle(false);assert.equal(document.querySelector('.source-body'),null);await toggle(true);assert.equal(calls,1);assert.match(document.querySelector('.source-body').textContent,/Original/);
  await render('b');await toggle(true);await act(async()=>pending[1].reject(Error('Synthetic read failure')));assert.match(document.querySelector('[role="alert"]').textContent,/Synthetic read failure/);
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='重试读取此版材料').click());assert.equal(calls,3);assert.match(document.body.textContent,/正在读取/);
  await act(async()=>pending[2].resolve({...material('a'),body:'Wrong immutable version'}));assert.match(document.querySelector('[role="alert"]').textContent,/版本不匹配/);assert.equal(document.querySelector('.source-body'),null);
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='重试读取此版材料').click());assert.equal(calls,4);
  await render('c');await act(async()=>pending[3].resolve({...material('b'),body:'Late old response'}));assert(!document.body.textContent.includes('Late old response'));await toggle(true);assert.equal(calls,5);
  await act(async()=>pending[4].resolve({...material('c'),body:'Current immutable version'}));assert.equal(document.querySelector('.source-body').textContent,'Current immutable version');assert.equal(document.querySelector('input').value,'Unsaved source draft');
 }finally{if(root)await act(()=>root.unmount());for(const [k,d] of before)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];dom.window.close();await vite.close();}
});
