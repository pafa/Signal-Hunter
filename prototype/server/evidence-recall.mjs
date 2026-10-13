import {describeNews,compareReports,CONTINUITY_RULES_HASH} from './event-continuity.mjs';
import {digest} from './codex-research.mjs';
import {readFileSync} from 'node:fs';

export const EVIDENCE_RECALL_POLICY='received-news-followup/1';
export const EVIDENCE_RECALL_HASH=digest({policy:EVIDENCE_RECALL_POLICY,continuity:CONTINUITY_RULES_HASH,rules:readFileSync(new URL(import.meta.url),'utf8')});

// Retrieval is a lead, never a claim that a gap is resolved. Reuse the existing
// lexical rules; do not search article-wide background for a scoped occurrence.
export function recallEvidenceNews(anchor,pool){
 const event=anchor.event;
 const source=describeNews({...anchor.news,title:event?[event.title,event.actor,event.action,event.object,event.quote].join(' '):anchor.news.title});
 return pool.flatMap(({news,item,description})=>{
  if(news.id===anchor.news.id||news.url===anchor.news.url)return [];
  const match=compareReports(source,description||describeNews(news));
  return match?[{newsId:news.id,revision:news.revision,title:news.title,url:news.url,pipelineId:item.id,rank:match.rank,reasons:match.reasons}]:[];
 }).sort((a,b)=>b.rank-a.rank||a.newsId.localeCompare(b.newsId));
}
