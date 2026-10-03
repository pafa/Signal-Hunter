import {readFileSync,readdirSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {EVALUATION_VERSION,FORWARD_START,LABELS,evaluationMemberKeys} from '../shared/evaluation.mjs';
export const digest=value=>createHash('sha256').update(value).digest('hex');
// Freeze the entire small research core, including transitive rules, not a hand-picked file list.
export function collectEvaluationSources(root){
 const files=[];
 function walk(dir){for(const e of readdirSync(resolve(root,dir),{withFileTypes:true})){const path=dir+'/'+e.name;if(e.isDirectory())walk(path);else if(/\.[cm]?js$/.test(e.name))files.push(path);}}
 walk('prototype/server');walk('prototype/shared');
 files.push('prototype/package.json','prototype/package-lock.json','docs/EVALUATION-PROTOCOL.md');
 const sources=Object.fromEntries(files.sort().map(path=>{const text=readFileSync(resolve(root,path),'utf8');return [path,{sha256:digest(text),text}];}));
 for(const [path,source] of Object.entries(sources)){
  if(!/\.[cm]?js$/.test(path))continue;
  for(const m of source.text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g)){
   const dependency=relative(root,resolve(root,dirname(path),m[1]));
   if(!sources[dependency])throw new Error('冻结缺少本地依赖：'+path+' -> '+dependency);
  }
 }
 return sources;
}
function clusterExclusions(db){
 const tables=['event_clusters','event_cluster_versions','event_cluster_members'];
 const present=tables.filter(t=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
 if(present.length&&present.length!==tables.length)throw new Error('事件簇存储不完整，无法冻结排除清单');
 const snapshots=Object.fromEntries(tables.map(t=>[t,present.length?db.prepare(`SELECT * FROM ${t} ORDER BY ${t==='event_clusters'?'id':t==='event_cluster_versions'?'cluster_id,version':'member_key'}`).all():[]]));
 const ids=new Set(),memberKeys=new Set(),expectedMembers=new Map();
 for(const row of [...snapshots.event_clusters,...snapshots.event_cluster_versions]){
  const {snapshotHash,...record}=JSON.parse(row.payload);
  if(!record.id||record.id!==(row.id??row.cluster_id)||record.version!==row.version||!Number.isSafeInteger(record.version)||record.version<1||!['active','archived'].includes(record.status)||!Array.isArray(record.members)||!record.members.length||snapshotHash!==digest(JSON.stringify(record)))throw new Error('事件簇历史不完整或指纹不符，无法冻结排除清单');
  ids.add(record.id);
  for(const member of record.members){const keys=evaluationMemberKeys(member);if(!keys)throw new Error('事件簇历史成员身份无效，无法冻结排除清单');for(const key of keys)memberKeys.add(key);}
 }
 for(const row of snapshots.event_clusters){
  const record=JSON.parse(row.payload),history=snapshots.event_cluster_versions.filter(v=>v.cluster_id===row.id);
  if(record.status!==row.status||history.length!==row.version||history.some((v,i)=>v.version!==i+1)||history.at(-1)?.payload!==row.payload)throw new Error('事件簇历史不完整或当前版本不一致，无法冻结排除清单');
  if(record.status==='active')for(const member of record.members){const key=evaluationMemberKeys(member)[0];if(expectedMembers.has(key))throw new Error('事件簇成员存在重复归属，无法冻结排除清单');expectedMembers.set(key,row.id);}
 }
 if(ids.size!==snapshots.event_clusters.length||expectedMembers.size!==snapshots.event_cluster_members.length||snapshots.event_cluster_members.some(row=>expectedMembers.get(row.member_key)!==row.cluster_id))throw new Error('事件簇成员索引与历史不符，无法冻结排除清单');
 return {snapshots,ids:[...ids],memberKeys:[...memberKeys]};
}
export function buildEvaluationBaseline(db,root,{frozenAt=new Date().toISOString()}={}){
 const sources=collectEvaluationSources(root),topics=db.prepare('SELECT id,payload FROM research_topics ORDER BY id').all();
 const versions=db.prepare('SELECT * FROM research_versions ORDER BY topic_id,version').all(),news=db.prepare('SELECT * FROM news ORDER BY id').all(),revisions=db.prepare('SELECT * FROM revisions ORDER BY news_id,version').all();
 const clusters=clusterExclusions(db),excludedTopicIds=[...new Set([...topics.map(t=>t.id),...versions.map(v=>v.topic_id)])].sort();
 const materialSnapshots=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_materials'").get()?db.prepare('SELECT * FROM research_materials ORDER BY document_id,revision').all():[];
 const sourceAttempts=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_source_attempts'").get()?db.prepare('SELECT * FROM research_source_attempts ORDER BY id').all():[];
 const screeningSnapshots=Object.fromEntries(['screening_rules','screening_samples','screening_reviews'].map(table=>[table,db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)?db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all():[]]));
 const configuration={settings:db.prepare('SELECT * FROM settings ORDER BY key').all(),paperParameters:db.prepare('SELECT payload FROM paper_books').all().map(r=>JSON.parse(r.payload).params),runtime:{node:process.versions.node},scope:'全部 server/shared 模块、依赖锁及持久研究配置；模型进程环境未由此脚本采集，前向资格另行核验'};
 configuration.screeningCapture='全部层级留样；人工复核非盲审，事件簇与留出样本资格待核验';
 const excludedEvidenceKeys=[...new Set([...clusters.memberKeys,...excludedTopicIds.map(id=>`event:${id}`),...news.map(n=>`news:${n.id}`),...revisions.map(n=>`news:${n.news_id}`),...materialSnapshots.map(m=>`material:${m.document_id}`)])].sort();
 const rulesHash=digest(JSON.stringify({sources,configuration}));
 return {protocolVersion:EVALUATION_VERSION,frozenAt,forwardStart:new Date(Math.max(Date.parse(FORWARD_START),Date.parse(frozenAt))).toISOString(),excludedTopicIds,excludedClusterIds:[...new Set([...excludedTopicIds,...clusters.ids])].sort(),excludedEvidenceKeys,eventClusterSnapshots:clusters.snapshots,clusterPolicy:'既有主题及同事件后续均排除；新事件簇必须在判断前审查',labels:LABELS,rulesHash,sources,configuration,supersedes:'baseline-20260925-v08.json：路由依赖冻结不完整，保留为历史诊断工件；v09 及以后按不同规则分别比较',materialSnapshots,sourceAttempts,screeningSnapshots,topics:topics.map(t=>JSON.parse(t.payload)),versions,news,revisions,triage:db.prepare('SELECT * FROM triage ORDER BY news_id,news_revision,rules_version').all(),execution:'research-only; screening intake captured; no independent forward eligibility or return statistics'};
}
