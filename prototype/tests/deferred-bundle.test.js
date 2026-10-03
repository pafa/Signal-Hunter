import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {fileURLToPath} from 'node:url';

test('production default entry excludes deferred workspaces and panels; every chunk dependency is emitted',async()=>{
 const {output}=await build({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),logLevel:'silent',build:{write:false}});
 const chunks=new Map(output.filter(item=>item.type==='chunk').map(item=>[item.fileName,item]));
 const initial=new Set();
 function visit(name){if(initial.has(name))return;initial.add(name);for(const imported of chunks.get(name).imports)visit(imported);}
 for(const chunk of chunks.values()){
  if(chunk.isEntry)visit(chunk.fileName);
  for(const imported of [...chunk.imports,...chunk.dynamicImports])assert.ok(chunks.has(imported),`Missing production chunk ${imported}`);
 }
 const initialModules=[...initial].flatMap(name=>Object.keys(chunks.get(name).modules));
 const assets=new Map(output.filter(item=>item.type==='asset').map(item=>[item.fileName,item]));
 const initialCss=[...new Set([...initial].flatMap(name=>[...chunks.get(name).viteMetadata.importedCss]))].map(name=>String(assets.get(name).source)).join('\n');
 assert.match(initialCss,/\.v10-library-button/,'the unopened news library entry retains its initial styles');
 for(const chunk of chunks.values())for(const name of chunk.viteMetadata.importedCss)assert.ok(assets.has(name),`Missing stylesheet ${name}`);
 assert.ok(initialModules.some(id=>id.endsWith('/integrated/IntegratedWorkbench.jsx')),'default workspace stays eager');
 for(const suffix of ['/App.jsx','/terminal/Terminal.jsx','/major/MajorWorkbench.jsx','/major/TopicDetail.jsx','/terminal/DataDesk.jsx','/major/NewsLibrary.jsx','/major/NewsInspector.jsx','/integrated/CompanyDossier.jsx']){
  assert.equal(initialModules.some(id=>id.endsWith(suffix)),false,`${suffix} must not be in initial JS`);
  assert.ok([...chunks.values()].some(chunk=>Object.keys(chunk.modules).some(id=>id.endsWith(suffix))),`${suffix} must remain available`);
 }
});
