import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {instrument,yahooSymbol,fetchText,hash} from '../server/providers.mjs';
import {parseStudyBars} from '../server/event-study.mjs';
const dir=resolve(process.argv[2]||'');
const cases=JSON.parse(await readFile(dir+'/cases-input.json','utf8')),news=JSON.parse(await readFile(dir+'/news.json','utf8'));
const symbols=[...new Set(cases.flatMap(c=>c.companies.map(x=>x[0])))],prices=[],checks=[];
await mkdir(dir+'/prices',{recursive:true});
const tasks=symbols.flatMap(symbol=>['1d','5m'].map(interval=>({symbol,interval})));
for(let i=0;i<tasks.length;i+=3){
 const results=await Promise.all(tasks.slice(i,i+3).map(async({symbol,interval})=>{
  const url=new URL('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(yahooSymbol(instrument(symbol))));
  url.search=new URLSearchParams({period1:String(Math.floor(Date.parse(news.protocol.startAt)/1000)),period2:String(Math.floor(Date.parse(news.protocol.endAt)/1000)),interval,includePrePost:'false',events:'div,splits'});
  try{const raw=await fetchText(url.href),receivedAt=new Date().toISOString();await writeFile(dir+'/prices/'+symbol+'-'+interval+'.json',raw);const p=parseStudyBars(JSON.parse(raw),symbol,interval,receivedAt);
   return {price:p,check:{symbol,interval,url:url.href,receivedAt,sha256:hash(raw),bars:p.bars.length,start:p.bars[0].at,end:p.bars.at(-1).at}};
  }catch(e){return {check:{symbol,interval,url:url.href,error:e.message}};}
 }));
 for(const r of results){checks.push(r.check);if(r.price)prices.push(r.price);console.log(JSON.stringify(r.check));}
}
await writeFile(dir+'/prices.json',JSON.stringify({checks,prices},null,2));
