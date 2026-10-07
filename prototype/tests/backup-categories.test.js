import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,writeFileSync,readdirSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openStore} from '../server/store.mjs';import {createService} from '../server/service.mjs';import {assertDatabaseMode} from '../server/runtime.mjs';import {createBackup} from '../server/backup.mjs';import {previewStorageRetention} from '../server/storage-retention.mjs';
test('capacity classifies same/other datasets, malformed directories and fingerprint mismatches without deleting or relabeling unknowns as corrupt',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'signal-backup-categories-')),root=join(dir,'backups'),stores=[],services=[];
 try{
 for(let i=0;i<2;i++){const path=join(dir,i+'.sqlite'),store=openStore(path);assertDatabaseMode(store,'research');const service=createService(store,{mode:'research'});service.research.create({title:'Synthetic dataset '+i,summary:'Independent history'});stores.push(store);services.push(service);await createBackup(path,root);}
 const third=await createBackup(join(dir,'0.sqlite'),root);const mp=join(third.directory,'manifest.json'),manifest=JSON.parse(readFileSync(mp,'utf8'));manifest.sha256='0'.repeat(64);writeFileSync(mp,JSON.stringify(manifest));writeFileSync(join(root,'old-format-note'),'retain');const before=readdirSync(root).sort();
 const result=await previewStorageRetention(join(dir,'0.sqlite'),root,{classifyDatasets:true});assert.deepEqual(result.categories,{sameDataset:1,otherDataset:1,identityUnknown:0,fingerprintMismatch:1,unknownFormat:1,unreadable:0});assert.deepEqual(readdirSync(root).sort(),before);assert.equal(readFileSync(join(root,'old-format-note'),'utf8'),'retain');assert(result.snapshots.filter(x=>x.category!=='sameDataset').every(x=>!x.candidate));
 }finally{for(const s of services)await s.close();for(const s of stores)s.close();rmSync(dir,{recursive:true,force:true});}
});
