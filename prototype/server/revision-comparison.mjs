import {digest,CodexResearchError} from './codex-research.mjs';
import {eventComparisonSnapshot} from './semantic-event-scopes.mjs';
import {comparisonSummary} from './semantic-materials.mjs';
import {readSnapshotCache} from './read-snapshot-cache.mjs';

export const REVISION_COMPARISON_VERSION='event-revision-pair-1';
const fail=()=>{throw new CodexResearchError('packet');};
const same=new Set(['repeat','followup','reversal']);
export const comparisonBasis=run=>({runId:run.id,inputHash:run.packet.inputHash,outputHash:run.candidate.trace.outputHash,model:run.model,promptVersion:run.candidate.trace.promptVersion,decisionVersion:run.decisionVersion,comparison:structuredClone(run.candidate.comparison)});

// Rechecking one revision matrix used to parse and hash the same full cluster
// (including every prior pair) for every cell. Reuse only that pure validation,
// keyed by the exact bytes just read, never by a mutable ID or claimed hash.
// Keep one record per connection; membership and current inputs still read live.
const checkedClusters=new WeakMap();
function revisionCluster(db,id){
 if(!checkedClusters.has(db))checkedClusters.set(db,{memo:readSnapshotCache(db,{limit:1,maxBytes:16*1024*1024})});
 const cache=checkedClusters.get(db);return cache.memo(id,()=>{
  const payload=db.prepare('SELECT payload FROM event_clusters WHERE id=?').get(id)?.payload;
  if(typeof payload!=='string')fail();
  if(cache.payload===payload)return cache.record;
  const parsed=JSON.parse(payload);if(!parsed)fail();const {snapshotHash,...value}=parsed;
  if(digest(value)!==snapshotHash)fail();
  const record={status:parsed.status,version:parsed.version,snapshotHash,members:parsed.members};
  if(Buffer.byteLength(payload)<=16*1024*1024){cache.payload=payload;cache.record=record;}else{delete cache.payload;delete cache.record;}return record;
 });
}

// Historical input is available only through an exact, still-owned cluster
// version. Ordinary comparison and clustering continue to require current input.
export function revisionComparisonPacket(store,input){
 if(!input||Object.keys(input).sort().join(',')!=='left,revision,right'||Object.keys(input.revision||{}).sort().join(',')!=='clusterHash,clusterId,clusterVersion')fail();
 const {clusterId,clusterVersion,clusterHash}=input.revision,db=store.db;
 const record=revisionCluster(db,clusterId),{snapshotHash}=record;
 if(record.status!=='active'||record.version!==clusterVersion||snapshotHash!==clusterHash)fail();
 for(const ref of [input.left,input.right])if(!ref||Object.keys(ref).sort().join(',')!=='id,kind,revision'||ref.kind!=='event'||typeof ref.id!=='string'||ref.revision!==1)fail();
 const old=record.members.find(m=>m.kind==='event'&&m.id===input.left.id);
 if(!old||db.prepare('SELECT cluster_id FROM event_cluster_members WHERE member_key=?').get('event:'+old.id)?.cluster_id!==clusterId)fail();
 const left=eventComparisonSnapshot(db,input.left,{historical:true}),right=eventComparisonSnapshot(db,input.right);
 if(digest(comparisonSummary(left))!==digest(old)||left.documentId!==right.documentId||right.materialRevision<=left.materialRevision||record.members.some(m=>m.kind==='event'&&m.id===right.id))fail();
 const data={left,right,revision:structuredClone(input.revision)},packet={schema:REVISION_COMPARISON_VERSION,input:data,inputHash:digest(data)};
 if(Buffer.byteLength(JSON.stringify(packet))>524288)fail();return packet;
}

export const REVISION_INSTRUCTIONS=`修订对应任务：左侧是原事件簇中保留的历史事项，右侧是同一文档新版提取的一项。只判断右侧是否接续左侧的这个具体事项；同篇、同公司、同主题或同一大事件不能证明一一对应。主体、动作、具体对象、阶段与时间都要核对，不按提取顺序、标题相似或事项数量配对。相关但无法确定具体接续关系时返回related或uncertain，禁止为凑齐映射选择。repeat/followup/reversal仅表示右侧与左侧的具体事项有明确接续，方向为右侧相对于左侧。引用只来自各自eventFocus，旧材料不代表当前事实。\n`;

// A complete old-by-new matrix is required. Any uncertainty can hide a second
// match, so no match is selected until every alternative has a definite result.
export function revisionMappingResult(batch,semantic){
 if(!batch.revision||batch.state!=='completed'||!batch.items.length||!batch.revisionPreviousIds?.length)return null;
 const previous=new Set(batch.revisionPreviousIds),expected=new Set();
 if(previous.size!==batch.revisionPreviousIds.length||[...previous].some(id=>!batch.inputs.some(m=>m.id===id)))return null;
 for(const [left,a] of batch.inputs.entries())for(const [right,b] of batch.inputs.entries())if(previous.has(a.id)&&!previous.has(b.id)&&a.documentId===b.documentId)expected.add(left+':'+right);
 if(expected.size!==batch.items.length)return null;
 const pairs=[];
 for(const item of batch.items){
  if(item.status!=='candidate'||!item.runId||!expected.delete(item.left+':'+item.right))return null;
  const r=semantic.get(item.runId),left=batch.inputs[item.left],right=batch.inputs[item.right];
  if(r.stale||!r.active||r.packet.schema!==REVISION_COMPARISON_VERSION||digest(r.packet.input.revision)!==digest(batch.revision)||r.packet.input.left.id!==left.id||r.packet.input.right.id!==right.id||['uncertain','related'].includes(r.candidate.comparison.relation))return null;
  pairs.push({left:comparisonSummary(r.packet.input.left),right:comparisonSummary(r.packet.input.right),basis:comparisonBasis(r)});
 }
 if(expected.size)return null;const oldIds=[...previous],mappings=[],used=new Set();
 for(const id of oldIds){const found=pairs.filter(p=>p.left.id===id&&same.has(p.basis.comparison.relation));if(found.length!==1||used.has(found[0].right.id))return null;used.add(found[0].right.id);mappings.push({beforeId:id,afterId:found[0].right.id});}
 return {batchId:batch.id,revision:batch.revision,planHash:batch.planHash,mappings,pairs};
}
