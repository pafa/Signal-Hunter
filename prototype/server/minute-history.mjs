import {providerMinuteTimestamp,validProviderMinute} from '../shared/provider-time.mjs';

// Research cache policy only: neither accepted bars nor their timestamps authorize fills.
export function minuteCacheDecision(previous,quote,receivedAt){
 const next=providerMinuteTimestamp(quote.providerTime,quote.providerTimezone),now=Date.parse(receivedAt);
 if(next!==null&&Number.isFinite(now)&&next>now+60000)return {activated:false,reason:'minute-future'};
 if(!previous)return {activated:true,reason:'accepted'};
 const old=providerMinuteTimestamp(previous.providerTime,previous.providerTimezone);
 // Prefer an explicit clock over an unknown one; this is not proof of chronological order.
 if(next!==null&&old===null)return {activated:true,reason:'replaces-unverified-time'};
 // A legacy future cache must not prevent recovery to a correctly dated response.
 if(next!==null&&old!==null&&Number.isFinite(now)&&old>now+60000)return {activated:true,reason:'replaces-future-cache'};
 let order=null;
 if(next!==null&&old!==null)order=next-old;
 else if(quote.provider===previous.provider&&quote.providerTimezone===previous.providerTimezone&&validProviderMinute(quote.providerTime)&&validProviderMinute(previous.providerTime))order=quote.providerTime.localeCompare(previous.providerTime);
 if(order!==null&&order<0)return {activated:false,reason:'minute-regression'};
 if(order===null&&validProviderMinute(previous.providerTime))return {activated:false,reason:'minute-time-incomparable'};
 return {activated:true,reason:'accepted',noNewBar:order===0};
}
