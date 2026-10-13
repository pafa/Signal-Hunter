import assert from 'node:assert/strict';
import {attachmentIdentityFixture,attachmentEvent,parentQuote} from './attachment-identity-fixture.mjs';
import {output,config} from '../automatic-research-fixture.mjs';
import {companyEntitiesPacket,companyEntitiesPrompt,companyEntitiesSchema} from '../../server/company-entities.mjs';
import {identityDirectoryScope} from '../../server/pipeline-identity-followup.mjs';
import {digest} from '../../server/codex-research.mjs';
export const ownershipQuote='NVIDIA owns and controls Synthetic Subsidiary One.';
export const subjectQuote='Synthetic Subsidiary One (Bank)';
export const actionQuote=subjectQuote+' was selected for 国家项目甲.';
export const parentBody=actionQuote+' '+ownershipQuote+' These are synthetic names and relations, not facts about any company.';
export const parentMention=()=>({name:'NVIDIA',quote:ownershipQuote,quoteField:'body',entityType:'company',resolution:'candidate',symbols:['NVDA.US'],reason:'Synthetic exact directory identity only',eventConnection:{relation:'parent',anchorQuote:parentQuote,reason:'Synthetic control of the direct project participant; parent is not the participant itself',ownership:{subjectName:'Synthetic Subsidiary One',subjectReference:'Bank',subjectQuote,actionQuote,ownershipQuote}}});
export const parentJobs=f=>f.store.db.prepare("SELECT * FROM research_pipeline_event_jobs WHERE kind='identity' AND json_type(payload,'$.packet.input.identityAttachment')='object' ORDER BY rowid").all().map(j=>({...j,p:JSON.parse(j.payload)}));
export function parentFixture({identity,...options}={}){return attachmentIdentityFixture({count:1,attachmentBody:parentBody,...options,identity:(p)=>{const m=parentMention();if(p.schema.endsWith('-1')||p.input.eventFocus.actor!=='国家项目甲'){m.eventConnection={relation:p.input.eventFocus.actor!=='国家项目甲'?'unrelated':'context',anchorQuote:p.input.eventFocus.quote,reason:'Legacy background only, no ownership classification'};}return identity?identity(p,m):output(p,'resolution',{mentions:[m],scopeNote:'Synthetic indirect impact candidate, not legal attribution or a trade',missingEvidence:['Economic exposure and ownership semantic verification']});}});}
export async function oldParentIdentity(f){
 f.add(1);await f.until(()=>parentJobs(f).some(j=>j.status==='queued'));
 const row=parentJobs(f)[0],p=row.p;
 p.packet=companyEntitiesPacket(f.store,f.service.research,row.topic_id,p.request,{schema:'company-attachment-entities-1'});
 p.identityFollowup.scopeHash=identityDirectoryScope(p.packet);
 const configHash=digest({model:config.model,binary:config.binary,effort:'high',timeoutMs:config.timeoutMs});
 p.executionHash=digest({kind:'identity',packet:p.packet,prompt:companyEntitiesPrompt(p.packet),schema:companyEntitiesSchema(p.packet),configHash});
 f.store.db.prepare('UPDATE research_pipeline_event_jobs SET payload=? WHERE id=?').run(JSON.stringify(p),row.id);
 await f.until(()=>parentJobs(f)[0].status==='completed');
 assert.equal(attachmentEvent(f).companies.length,0);
 return parentJobs(f)[0];
}
export async function parentFinished(f){await f.until(()=>{const t=attachmentEvent(f);return t?.companies.length===1&&t.dossier?.basedOnResearchVersion===t.version&&!f.store.db.prepare("SELECT 1 FROM research_pipeline_event_jobs WHERE status IN ('queued','running')").get();});}
