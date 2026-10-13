import {hash,instrument,yahooSymbol,minuteUrl,parseMinutes,parseYahooMinutes} from './providers.mjs';
import {parseDaily} from './daily.mjs';
import {providerMinuteTimestamp} from '../shared/provider-time.mjs';
import {diagnoseMarketData} from './market-diagnostics.mjs';

export const RESEARCH_PRICE_VERSION='research-market-prices/1';
export const RESEARCH_PRICE_INSTRUCTIONS='marketSource 是本次研判前取得并冻结的公开价量选段；核对证券、币种、市场时区、source.receivedAt、dataAt 和 diagnostics。diagnostics 是实际读取时的状态；调用时结合 generatedAt 重新判断数据年龄，各周期并非同时采集。不是实时或可成交报价，不得把收盘价当 EPS、收益或目标价。日线只保留已结束交易日，分钟剔除未结束柱；缺失成交量、复权语义及交付延迟未核验。陈旧价格只能作为标明日期的背景；当前获取的历史曲线不能冒充当时已可见数据、独立前向表现或事件因果。没有估值与事件兑现依据仍保留买卖点未知，不能仅凭这些曲线制造行动。';
export function researchPriceUrls(symbol,interval){
 const spec=instrument(symbol),base='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(yahooSymbol(spec));
 if(interval==='1d')return [base+'?interval=1d&range=6mo&events=div%2Csplits'];
 if(interval==='1m')return [...spec.ids.map(minuteUrl),base+'?interval=1m&range=1d'];
 throw Error('研究价量周期无效');
}
const instant=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export function researchPriceMaterial(symbol,interval,document){
 const spec=instrument(symbol),{url,receivedAt,body}=document;
 if(!researchPriceUrls(symbol,interval).includes(url)||!instant(receivedAt)||!Buffer.isBuffer(body)||!body.length||body.length>2_000_000)throw Error('研究价量原件地址、时间或大小无效');
 const payload=JSON.parse(body.toString('utf8'));
 const quote=interval==='1d'?parseDaily(payload,symbol,receivedAt):url.includes('eastmoney.com')?parseMinutes(payload,spec):parseYahooMinutes(payload,spec);
 const quality=interval==='1d'?quote.dailyQuality:quote.minuteQuality;
 // Charts can display partial/unverified data. A citeable research input is stricter.
 if(interval==='1d'&&(quality.sourceInterval!=='1d'||quote.duplicateDates.length))throw Error('研究日线周期未核实或交易日重复');
 if(interval==='1m'&&(quality.invalidRows>(quality.missingCloseTimes||[]).length||quality.duplicateTimes.length||quote.provider==='yahoo-public-chart'&&quality.sourceInterval!=='1m'))throw Error('研究分钟数据周期或时间序列未通过核对');
 let points=quote.points,unfinished=interval==='1d'?quote.incomplete:0,delayedInstantRows=0;
 if(interval==='1m'){
  const stamps=points.map(p=>providerMinuteTimestamp(p.time,quote.providerTimezone));
  if(stamps.some(t=>t===null))throw Error('研究分钟数据时区未核实');
  if(stamps.some(t=>t>Date.parse(receivedAt)))throw Error('研究分钟数据时点晚于实际获取时间');
  // Yahoo may append its latest trade after the minute bars. Its receipt can
  // cross a minute boundary; regularMarketTime identifies that instant, not a
  // completed bar. Only this exact trailing instant may be discarded.
  const data=payload?.chart?.result?.[0],times=data?.timestamp,last=times?.at(-1),lastPoint=points.at(-1);
  const trailingInstant=quote.provider==='yahoo-public-chart'&&Number.isInteger(last)&&last%60!==0&&last===data.meta.regularMarketTime&&last*1000<=Date.parse(receivedAt)&&times.slice(0,-1).every(t=>Number.isInteger(t)&&t%60===0)&&quality.roundedTimes.length===1&&quality.roundedTimes[0]===lastPoint.time;
  const ended=t=>providerMinuteTimestamp(t,quote.providerTimezone)+60000<=Date.parse(receivedAt);
  if(quality.roundedTimes.some(t=>ended(t)&&!(trailingInstant&&t===lastPoint.time)))throw Error('研究已结束分钟含非整分钟时间，不能当作分钟柱');
  delayedInstantRows=trailingInstant&&ended(lastPoint.time)?1:0;
  points=points.filter((p,i)=>stamps[i]+60000<=Date.parse(receivedAt)&&!(delayedInstantRows&&i===quote.points.length-1));unfinished=quote.points.length-points.length-delayedInstantRows;
  if(!points.length)throw Error('研究分钟数据没有已结束的有效柱');
 }
 const limit=interval==='1d'?252:480,omitted=Math.max(0,points.length-limit);points=points.slice(-limit);
 const last=points.filter(p=>p.close!==null).at(-1);
 const normalized={...quote,points,receivedAt,...(interval==='1m'?{providerTime:last.time,last:last.close}: {})};
 const diagnostics=diagnoseMarketData(symbol,normalized,{state:'ok',attemptedAt:receivedAt,receivedAt},receivedAt,{interval});
 const coverage={requestedRange:interval==='1d'?'6mo':'1d',returnedValidRows:quote.points.length,selectedRows:points.length,omittedOlderRows:omitted,unfinishedRows:unfinished,missingCloseRows:interval==='1d'?quote.missing:(quality.missingCloseTimes||[]).length,missingVolumeRows:points.filter(p=>p.volume===null||p.volume===undefined).length,first:points[0].date||points[0].time,last:last.date||last.time};
 // Existing accepted v1 materials retain exactly the same derived bytes.
 // This optional field is produced only for input previously rejected above.
 if(delayedInstantRows)coverage.delayedInstantRows=delayedInstantRows;
 const source={url,receivedAt,sha256:hash(body),bytes:body.length};
 const marketSource={schema:RESEARCH_PRICE_VERSION,symbol:spec.symbol,market:spec.market,currency:spec.currency,marketTimezone:spec.marketTimezone,provider:quote.provider,providerTimezone:quote.providerTimezone||spec.marketTimezone,interval,source,coverage,diagnosticsAsOf:receivedAt,diagnostics,priceBasis:quote.priceBasis||'供应商分钟 close；非可成交报价，复权语义未独立核验',volumeBasis:quote.volumeBasis||quote.minuteVolume?.unit||'当前解析器未提供成交量，不推定为零',actions:quote.actions||[],calendarVersion:quote.calendarVersion||null};
 const header=[`${symbol} · ${interval==='1d'?'日线':'分钟'}价量研究快照`, `证券 ${symbol}；市场 ${spec.market}；价格币种 ${spec.currency}；市场时区 ${spec.marketTimezone}；柱时间口径 ${marketSource.providerTimezone}`,`来源 ${quote.provider}；实际获取 ${receivedAt}；最新数据 ${diagnostics.dataAt||'未知'}；读取时数据状态 ${diagnostics.dataState}`,`请求窗口 ${coverage.requestedRange}；有效返回 ${coverage.returnedValidRows} 行；选取 ${coverage.selectedRows} 行；更早未选 ${omitted} 行；未结束排除 ${unfinished} 行；缺失收盘 ${coverage.missingCloseRows} 行；选段缺失成交量 ${coverage.missingVolumeRows} 行。返回窗口不保证连续或完整。`,marketSource.priceBasis,marketSource.volumeBasis,RESEARCH_PRICE_INSTRUCTIONS];
 if(delayedInstantRows)header.push('另剔除1个与供应商 regularMarketTime 一致的尾部最新成交点；跨分钟收到的即时成交仍不是完整分钟柱。');
 const table=[`时间 | close（${spec.currency} 每股市场价格） | volume（供应商原单位未核实）`,...points.map(p=>`${p.date||p.time} | ${p.close??'未知'} | ${p.volume??'未知'}`)];
 const actions=quote.actions?.length?['供应商公司行动（不保证完整，不据此自动调整价格）：',...quote.actions.map(a=>JSON.stringify(a))]:['本响应未提供公司行动记录，不证明不存在公司行动。'];
 return {title:`${symbol} ${interval==='1d'?'日线':'分钟'}价量研究快照`,sourceName:quote.provider,url,scope:'excerpt',publishedAt:null,body:[...header,...table,...actions].join('\n'),marketSource};
}
export function validateMarketSource(source,url,body,at){
 if(!source||source.schema!==RESEARCH_PRICE_VERSION||!['1d','1m'].includes(source.interval)||!researchPriceUrls(source.symbol,source.interval).includes(url)||source.source?.url!==url||!instant(source.source.receivedAt)||Date.parse(source.source.receivedAt)>Date.parse(at)||!/^[a-f0-9]{64}$/.test(source.source.sha256)||!Number.isSafeInteger(source.source.bytes)||source.source.bytes<1||source.source.bytes>2_000_000||typeof body!=='string')throw Error('研究价量来源记录无效');
 return structuredClone(source);
}
export function verifyMarketDocument(material,read){
 const s=material.marketSource,body=read(s.source.sha256);
 if(!body||body.length!==s.source.bytes||hash(body)!==s.source.sha256)throw Error('研究价量原始响应校验失败');
 const doc={url:s.source.url,receivedAt:s.source.receivedAt,body:Buffer.from(body)},expected=researchPriceMaterial(s.symbol,s.interval,doc);
 if(['title','sourceName','url','scope','publishedAt','body','marketSource'].some(k=>JSON.stringify(expected[k])!==JSON.stringify(material[k])))throw Error('研究价量选段与原始响应不一致');
 return [doc];
}
