import {readFileSync} from 'node:fs';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {syncResearchWatches} from '../server/workflow.mjs';
const [file,dbPath]=process.argv.slice(2);
if(!file||!dbPath)throw new Error('Usage: node scripts/import-research-brief.mjs <brief.json> <database>');
const store=openStore(dbPath);
try{const research=openResearch(store,{seed:false}),topic=research.importBrief(JSON.parse(readFileSync(file,'utf8'))),watch=syncResearchWatches(store,[topic]);console.log(JSON.stringify({id:topic.id,version:topic.version,evidence:topic.evidence.length,companies:topic.companies.map(c=>c.symbol),watch}));}finally{store.close();}
