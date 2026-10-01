import {researchReadiness} from '../shared/research-readiness.mjs';
import {canAutoWatch} from '../shared/company-directory.mjs';
import {claimsOf} from '../shared/claims.mjs';
import {CLAIM_STATES} from '../shared/uncertainty.mjs';
import {evidenceCoverage} from './triage.mjs';
import {reviewedVersion,pendingCounterevidence} from '../shared/review-state.mjs';
export const WORKFLOW_VERSION='event-workflow/0.9.0';
export function assessTopic(topic,{today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),book=null}={}){
 const coverage=evidenceCoverage(topic),h=topic.hypothesis,missing=coverage.missingSteps.map(id=>topic.chain.find(s=>s.id===id)?.title||id);
 const reviewDue=!!h.reviewAt&&h.reviewAt<=today||claimsOf(topic).some(c=>c.resolveBy&&c.resolveBy<=today&&['open','unresolved'].includes(c.outcome));
 const blockers=[...missing.map(s=>`${s}缺支持证据`),...(!h.trigger?['交易触发未定义']:[]),...(!h.invalidation?['失效条件未定义']:[])];
 const positions=(book?.positions||[]).filter(p=>p.topicId===topic.id||topic.companies.some(c=>c.symbol===p.symbol));
 const invalidated=positions.filter(p=>(book?.reviews||[]).filter(r=>r.symbol===p.symbol&&r.at>=p.openedAt).at(-1)?.result==='invalidated');
 const weakened=positions.some(p=>(book?.reviews||[]).filter(r=>r.symbol===p.symbol&&r.at>=p.openedAt).at(-1)?.result==='weakened');
 const orders=(book?.orders||[]).filter(o=>o.topicId===topic.id&&o.status==='pending');
 const unreviewedAgainst=pendingCounterevidence(topic,book,positions).length;
 const researchAgainst=!positions.length&&coverage.against;
 const reason=invalidated.length?'持仓逻辑已失效':unreviewedAgainst?'持仓出现反向线索':weakened?'持仓逻辑减弱':researchAgainst?'研究有反证':reviewDue?'复核已到期':orders.some(o=>o.stale)?'申请研究版本变化':positions.some(p=>p.topicId===topic.id&&reviewedVersion(book,p)!==topic.version)?'持仓研究已更新':orders.length?'有待批申请':'补证与观察';
 const rank=topic.status==='archived'?9:invalidated.length?0:unreviewedAgainst?1:researchAgainst||weakened?2:reviewDue?3:reason==='申请研究版本变化'||reason==='持仓研究已更新'?4:orders.length?5:6;
 return {readiness:researchReadiness(topic),assessment:topic.assessment||null,assessmentLabel:CLAIM_STATES[topic.assessment?.status]||'状态待评估',version:WORKFLOW_VERSION,topicId:topic.id,topicVersion:topic.version,reviewDue,priority:rank<=4?'优先复核':'常规跟进',priorityRank:rank,priorityReason:reason,positionSymbols:positions.map(p=>p.symbol),pendingCount:orders.length,invalidatedSymbols:invalidated.map(p=>p.symbol),unreviewedAgainst,stage:topic.status==='archived'?'已归档':invalidated.length?'退出复核':researchAgainst||unreviewedAgainst?'反证复核':blockers.length?'带不确定性研判':'人工复核',action:invalidated.length?'先核对退出申请，暂停新增相关风险':researchAgainst||unreviewedAgainst?'核验反证对原假设的影响':blockers.length?'评估真伪概率、条件影响与补证路径':'核验预期差与交易条件',blockers,coverage,automaticBuy:false,
  next:topic.nextEvidence,marketExpectations:'待核验事前涨幅、估值与盈利预期',execution:'关联公司可自动关注；研究未直接生成买卖批准'};
}
export function syncResearchWatches(store,topics){
 store.db.exec('CREATE TABLE IF NOT EXISTS research_watch_links(topic_id TEXT NOT NULL,symbol TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(topic_id,symbol));');
 const added=[],deferred=[];
 for(const t of topics.filter(t=>t.status==='active'))for(const c of t.companies){
  if(store.db.prepare('SELECT 1 FROM research_watch_links WHERE topic_id=? AND symbol=?').get(t.id,c.symbol))continue;
  if(!canAutoWatch(c)){deferred.push({topicId:t.id,symbol:c.symbol,reason:'上市主体待核对；公司关系与传闻仍保留研究'});continue;}
  try{store.addWatch(c.symbol);store.db.prepare('INSERT INTO research_watch_links VALUES(?,?,?)').run(t.id,c.symbol,new Date().toISOString());added.push(c.symbol);}
  catch(error){deferred.push({topicId:t.id,symbol:c.symbol,reason:error.message});}
 }
 return {added:[...new Set(added)],deferred,limit:40,policy:'已关联公司首次自动关注；人工取消后不强制加回；只在明确主题关系内扩展'};
}
