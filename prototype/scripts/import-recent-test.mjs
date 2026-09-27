import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openStore} from '../server/store.mjs';
import {openResearch} from '../server/research.mjs';
import {syncResearchWatches} from '../server/workflow.mjs';
const [input,dbPath]=process.argv.slice(2);if(!input||!dbPath)throw new Error('Usage: import-recent-test.mjs TOPICS_JSON DB_PATH');
const topics=JSON.parse(await readFile(resolve(input),'utf8'));
// Validate every record in an isolated database before writing any real records.
const validation=openStore(':memory:');try{const r=openResearch(validation,{seed:false});for(const t of topics)r.importTestCase(t);}finally{validation.close();}
const live=openStore(resolve(dbPath));try{const r=openResearch(live,{seed:false});
 for(const t of topics){const row=live.db.prepare('SELECT payload FROM research_topics WHERE id=?').get(t.id);if(row&&JSON.parse(row.payload).inputHash!==t.inputHash)throw new Error('已有案例内容不同，停止整批导入');}
 const before=live.db.prepare('SELECT count(*) n FROM research_topics').get().n;for(const t of topics)r.importTestCase(t);const watches=syncResearchWatches(live,r.list());console.log(JSON.stringify({before,after:r.list().length,watches,ids:topics.map(t=>t.id)}));}finally{live.close();}
