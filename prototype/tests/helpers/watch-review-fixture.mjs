import {make,event,jobs} from './financial-recovery-fixture.mjs';
import {dossier} from '../automatic-research-fixture.mjs';
import {digest} from '../../server/codex-research.mjs';
import {WATCH_ACTION_VERSION} from '../../shared/research-watch.mjs';
export {event,jobs};
export function watchDossier(packet){
 const r=dossier(packet),e=packet.input.evidence.find(e=>e.material);
 for(const a of r.companyAssessments||[])a.recommendation={version:WATCH_ACTION_VERSION,action:'watch',reason:'合成来源提出后续事项，需继续观察实际执行证据；没有有依据的买卖日期。',citations:[{evidenceId:e.id,field:'body',quote:e.material.body.slice(0,Math.min(200,e.material.body.length))}],validUntil:null,holdingHorizon:{status:'unknown',reason:'没有持有或卖出窗口依据'}};
 r.rawOutput=JSON.stringify({sections:r.sections,missingEvidence:r.missingEvidence,companyAssessments:r.companyAssessments});r.trace.outputHash=digest(r.rawOutput);return r;
}
export function watchFixture({runner,composite=false,watchMembers=false,...options}={}){
 const f=make({mode:'normal',...options,researchRunner:composite&&!watchMembers?dossier:(p,c)=>runner?runner(p,c):watchDossier(p),synthesisRunner:(p,c)=>runner?runner(p,c):watchDossier(p)});
 f.queue.configure({...f.queue.snapshot().settings,financialSources:false});return f;
}
export const watchRefreshes=f=>jobs(f).filter(j=>j.p.monitoringFollowup);
export const synthesisRows=f=>f.store.db.prepare('SELECT * FROM event_cluster_research ORDER BY version').all().map(r=>({...r,p:JSON.parse(r.payload)}));
export async function watchReady(f){f.add(1);await f.until(()=>jobs(f).some(j=>j.status==='completed'));return event(f);}
