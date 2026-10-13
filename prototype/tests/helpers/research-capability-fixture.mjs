import {dossier,config} from '../automatic-research-fixture.mjs';
import {watchFixture,jobs,event} from './watch-review-fixture.mjs';
import {factDossier} from './business-facts-fixture.mjs';
import {digest,codexPrompt,codexDraftSchema} from '../../server/codex-research.mjs';

export function legacyBusinessDossier(packet,{cited=true}={}){
 const r=dossier(packet),e=packet.input.evidence.find(e=>e.material);
 for(const a of r.companyAssessments||[]){
  a.analysis.nextCheck={text:'核对本次回购的实际执行；合成资料仅有授权，不据此推定已执行。',basis:cited?'inference':'unknown',citations:cited?[{evidenceId:e.id,field:'body',quote:e.material.body.slice(0,200)}]:[]};
  a.monitoring.nextCheck={status:'unknown',reason:'旧条件协议无法表达业务是否实际执行，继续等待。',join:'all',conditions:[]};
 }
 r.rawOutput=JSON.stringify({sections:r.sections,missingEvidence:r.missingEvidence,companyAssessments:r.companyAssessments});r.trace.outputHash=digest(r.rawOutput);return r;
}
export const capabilityFixture=({runner,...options}={})=>watchFixture({...options,runner:(p,c)=>runner?runner(p,c):p.businessFactContract?factDossier(p):legacyBusinessDossier(p)});
export function legacyQueue(f,row){
 const p=JSON.parse(row.payload);delete p.packet.businessFactContract;delete p.packet.watchReviewContract;
 if(row.kind==='dossier'){const stable={...p.packet};delete stable.generatedAt;p.executionHash=digest({kind:'dossier',packet:stable,prompt:codexPrompt(stable),schema:codexDraftSchema(stable),configHash:digest({model:config.model,binary:config.binary,effort:config.effort||'high',timeoutMs:config.timeoutMs})});}
 f.store.db.prepare(`UPDATE ${row.kind==='dossier'?'research_pipeline_event_jobs':'event_cluster_research'} SET payload=? WHERE id=?`).run(JSON.stringify(p),row.id);
 return p;
}
export async function legacyReady(f){
 f.add(1);await f.until(()=>jobs(f).some(j=>j.kind==='dossier'&&j.status==='queued'));
 const row=jobs(f).find(j=>j.kind==='dossier'&&j.status==='queued');legacyQueue(f,row);
 await f.until(()=>jobs(f).find(j=>j.id===row.id).status==='completed');return event(f);
}

// Synthetic historical archive: the legacy-compatible output is unchanged;
// both copies of its old packet omit the later optional protocol flags.
export function legacySynthesis(f,row){
 legacyQueue(f,row);
 const r=JSON.parse(f.store.db.prepare('SELECT payload FROM model_research_runs WHERE id=?').get(row.run_id).payload);
 delete r.packet.businessFactContract;delete r.packet.watchReviewContract;
 f.store.db.prepare('UPDATE model_research_runs SET payload=? WHERE id=?').run(JSON.stringify(r),row.run_id);
}
