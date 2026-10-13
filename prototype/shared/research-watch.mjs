import {businessReviewSchedule} from './business-facts.mjs';
// A system polling policy, never a model forecast, trade expiry or sell date.
export const WATCH_REVIEW_CONTRACT='research-observation-review/1';
export const WATCH_ACTION_VERSION='research-watch/1';
export const WATCH_REVIEW_INTERVAL_MS=86400000;
export const isWatchResearch=value=>value?.version===WATCH_ACTION_VERSION&&value.action==='watch'&&value.validUntil===null&&value.holdingHorizon?.status==='unknown';
export function watchReviewSchedule(value,preparedAt,at){
 const saved=Date.parse(preparedAt),now=Date.parse(at);
 if(!isWatchResearch(value)||!Number.isFinite(saved)||!Number.isFinite(now)||saved>now)return null;
 return {policy:WATCH_REVIEW_CONTRACT,preparedAt,nextReviewAt:new Date(saved+WATCH_REVIEW_INTERVAL_MS).toISOString(),intervalMs:WATCH_REVIEW_INTERVAL_MS,due:saved+WATCH_REVIEW_INTERVAL_MS<=now};
}
export const researchReviewSchedule=(assessment,preparedAt,at)=>businessReviewSchedule(assessment,preparedAt,at)||watchReviewSchedule(assessment?.recommendation,preparedAt,at);
export function validWatchReviewTrigger(trigger,assessment,preparedAt,at){
 const s=researchReviewSchedule(assessment,preparedAt,at);
 return !!s?.due&&trigger.kind==='observation'&&trigger.group==='reviewCadence'&&trigger.symbol===assessment.symbol&&trigger.policy===s.policy&&trigger.preparedAt===s.preparedAt&&trigger.value===s.nextReviewAt;
}
export const reviewHasActiveScope=(triggers,held)=>triggers.some(t=>['observation','capability'].includes(t.kind)||held.includes(t.symbol));
