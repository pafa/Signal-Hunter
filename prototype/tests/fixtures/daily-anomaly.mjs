import {parseDaily} from '../../server/daily.mjs';
export const anomalyAt='2026-10-02T21:00:00.000Z';
export const anomalyDates=['2026-09-24','2026-09-25','2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02'];
export function anomalyQuote(){
 let p=100;const close=[p,...[-1,1,-2,2,0,10].map(change=>(p*=1+change/100))];
 return parseDaily({chart:{result:[{meta:{symbol:'AAPL',currency:'USD',exchangeTimezoneName:'America/New_York',dataGranularity:'1d'},timestamp:anomalyDates.map(d=>Date.parse(d+'T13:30:00Z')/1000),indicators:{quote:[{close,volume:[1000,900,1000,1100,1000,1000,2000]}]},events:{}}]}},'AAPL.US',anomalyAt);
}
