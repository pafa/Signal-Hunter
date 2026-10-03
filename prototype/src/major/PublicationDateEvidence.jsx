import React from 'react';
const states={known:'已读取',missing:'没有找到明确发布日期',invalid:'格式或时区无法确认',conflict:'来源日期互相冲突',overflow:'日期字段过多或过长'};
const sourceLabel=source=>source==='csrc:article-date'?'证监会文章日期':source==='hkma:release-date'?'金管局新闻稿日期':source.startsWith('meta:')?'文章元数据':source.startsWith('jsonld:')?'结构化文章数据':'页面日期标记';
export default function PublicationDateEvidence({evidence,showMissing=false}){
 if(!evidence)return showMissing?<p className="m-note">旧材料未记录日期读取依据；历史日期未改写。</p>:null;
 return <details className="publication-evidence"><summary>日期读取依据 · {states[evidence.status]||'待核对'}</summary><p className="m-note">这是来源标注的发布日期，不是事件发生时间或历史可获取时间。多个字段也不代表多个独立来源。</p>{evidence.candidates.length?<ul>{evidence.candidates.map((c,i)=><li key={i}>{sourceLabel(c.source)}：{c.raw||'空值'}</li>)}</ul>:<p>未保存可用的日期字段。</p>}{!!evidence.excluded?.length&&<><p className="m-note">以下字段与页面明确标注的生成时间相同，未作为文章发布日期：</p><ul>{evidence.excluded.map((c,i)=><li key={i}>页面生成元数据：{c.raw}<br/>识别依据：{c.context}</li>)}</ul></>}{evidence.truncated&&<p className="m-warning">仅保留范围内的字段，未据此选择发布日期。</p>}</details>;
}
