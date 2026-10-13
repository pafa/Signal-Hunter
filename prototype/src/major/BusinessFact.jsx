import React from 'react';
import {BUSINESS_FACT_VERDICTS} from '../../shared/business-facts.mjs';
export default function BusinessFact({value,renderCitations,citationKey}){
 if(value?.type!=='business-fact')return null;
 return <details><summary>查看业务事实依据 · {BUSINESS_FACT_VERDICTS[value.verdict]}</summary><p>{value.reason}</p><p className="m-note">本版模型对冻结资料的判断，当前检查另列；未完成独立事实核验。没有新证据不表示事实未发生，授权或计划不表示已执行。</p>{renderCitations?renderCitations(value.citations,citationKey):value.citations.map((c,i)=><blockquote key={i}>{c.quote}<small>{c.evidenceId} · 正文</small></blockquote>)}</details>;
}
