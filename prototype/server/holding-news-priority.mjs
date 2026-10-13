import {researchPriority} from './event-continuity.mjs';

// A scheduling hint from the saved headline screening, not a materiality verdict.
// Every fourth dispatch follows the original FIFO so ordinary work keeps moving.
export function selectHoldingSource(rows,positions,burst=0,priorities=new Map()){
 const priority=row=>{const current=priorities.get(row.news_id);if(current?.revision===row.revision)return current.priority;const t=JSON.parse(row.payload).screening;return researchPriority({symbols:t?.companies?.map(c=>c.symbol)||[],urgency:t?.screening?.urgency,bucket:t?.bucket,urgencyReason:t?.screening?.urgencyReason},{positions});};
 const preferred=burst<3?rows.find(r=>{const p=priority(r);return p.level==='urgent'&&p.held.length;}):null;
 const row=preferred||rows[0];if(!row)return null;
 const p=priority(row),selectedFor=preferred?'holding-risk':burst>=3?'fifo-fairness':'fifo';
 return {row,nextBurst:preferred?burst+1:0,selection:{engine:'holding-source-priority/1',newsId:row.news_id,revision:row.revision,selectedFor,held:p.held,level:p.level,materiality:'unassessed',tradeSignal:false}};
}
