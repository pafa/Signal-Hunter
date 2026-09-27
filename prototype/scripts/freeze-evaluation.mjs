import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {buildEvaluationBaseline,digest} from '../server/evaluation-baseline.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const version=JSON.parse(readFileSync(resolve(root,'prototype/package.json'),'utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('需要明确版本后才能冻结');
const destination=resolve(root,`data/runtime/evaluation/baseline-${new Date().toISOString().slice(0,10).replaceAll('-','')}-v${version}.json`);
if(existsSync(destination)){console.log('Baseline already frozen; no overwrite: '+destination);process.exit(0);}
const db=new DatabaseSync(resolve(root,'data/runtime/workbench.sqlite'),{readOnly:true});
try{
 db.exec('BEGIN');
 const baseline=buildEvaluationBaseline(db,root);
 db.exec('COMMIT');mkdirSync(resolve(root,'data/runtime/evaluation'),{recursive:true});writeFileSync(destination,JSON.stringify(baseline,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({path:destination,topics:baseline.topics.length,rulesHash:baseline.rulesHash,sha256:digest(readFileSync(destination)),forwardStart:baseline.forwardStart}));
}finally{db.close();}
