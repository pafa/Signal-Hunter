import {readFileSync,readdirSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {EVALUATION_VERSION,FORWARD_START,LABELS} from '../shared/evaluation.mjs';
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
export function buildEvaluationBaseline(db,root,{frozenAt=new Date().toISOString()}={}){
 const sources=collectEvaluationSources(root),topics=db.prepare('SELECT id,payload FROM research_topics ORDER BY id').all();
 const materialSnapshots=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_materials'").get()?db.prepare('SELECT * FROM research_materials ORDER BY document_id,revision').all():[];
 const sourceAttempts=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_source_attempts'").get()?db.prepare('SELECT * FROM research_source_attempts ORDER BY id').all():[];
 const screeningSnapshots=Object.fromEntries(['screening_rules','screening_samples','screening_reviews'].map(table=>[table,db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)?db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all():[]]));
 const configuration={settings:db.prepare('SELECT * FROM settings ORDER BY key').all(),paperParameters:db.prepare('SELECT payload FROM paper_books').all().map(r=>JSON.parse(r.payload).params),runtime:{node:process.versions.node},scope:'全部 server/shared 模块、依赖锁及研究配置；未启用自动模型或前向评分'};
 configuration.screeningCapture='全部层级留样；人工复核非盲审，事件簇与留出样本资格待核验';
 const rulesHash=digest(JSON.stringify({sources,configuration}));
 return {protocolVersion:EVALUATION_VERSION,frozenAt,forwardStart:new Date(Math.max(Date.parse(FORWARD_START),Date.parse(frozenAt))).toISOString(),excludedTopicIds:topics.map(t=>t.id),excludedClusterIds:topics.map(t=>t.id),clusterPolicy:'既有主题及同事件后续均排除；新事件簇必须在判断前审查',labels:LABELS,rulesHash,sources,configuration,supersedes:'baseline-20260925-v08.json：路由依赖冻结不完整，保留为历史诊断工件；v09 及以后按不同规则分别比较',materialSnapshots,sourceAttempts,screeningSnapshots,topics:topics.map(t=>JSON.parse(t.payload)),versions:db.prepare('SELECT * FROM research_versions ORDER BY topic_id,version').all(),news:db.prepare('SELECT * FROM news ORDER BY id').all(),revisions:db.prepare('SELECT * FROM revisions ORDER BY news_id,version').all(),triage:db.prepare('SELECT * FROM triage ORDER BY news_id,news_revision,rules_version').all(),execution:'research-only; screening intake captured; no independent forward eligibility or return statistics'};
}
