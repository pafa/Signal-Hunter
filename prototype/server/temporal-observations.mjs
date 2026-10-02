import {marketClock} from '../shared/market-clock.mjs';
export const TEMPORAL_ENGINE='sampled-price/1';
const MAX_SAMPLES=512;
export function temporalObservation(condition,base,previous,{at,armedAt}={}){
 const now=Date.parse(at),p=previous?.engine===TEMPORAL_ENGINE?previous:null;
 const cleared={engine:TEMPORAL_ENGINE,checkedAt:at,watermark:p?.watermark||null,last:null,samples:[]};
 const reply=(state,reason,memory,extra={})=>({state,reason,input:{...base.input,temporal:{engine:TEMPORAL_ENGINE,mode:condition.mode,maxGapSeconds:condition.maxGapSeconds,holdSeconds:condition.holdSeconds||null,sampleCount:memory.samples.length,startedAt:memory.samples[0]?.dataAt||null,...extra}},memory});
 if(base.state==='unknown')return reply('unknown',base.reason+'；时序连续性已重置',cleared);
 const stamp=Date.parse(base.input.dataAt),received=Date.parse(base.input.receivedAt),armed=Date.parse(armedAt),limit=condition.maxGapSeconds*1000;
 if(!Number.isFinite(stamp)||!Number.isFinite(armed)||stamp<armed||stamp>now||received<stamp||now-stamp>limit)return reply('unknown','需要本版启用后新鲜、时间一致的分钟采样',cleared);
 const session=marketClock(condition.symbol,base.input.dataAt),current=marketClock(condition.symbol,at);
 if(!session.known||!current.known||session.label!=='交易中'||current.label!=='交易中'||session.date!==current.date)return reply('unknown','当前或样本不在已知连续交易时段，重新建立观察基线',cleared);
 const segment=clock=>clock.session.market==='US'?'day':clock.minute<780?'am':'pm';
 if(segment(session)!==segment(current))return reply('unknown','采样跨越午间休市，重新建立观察基线',cleared);
 const sample={dataAt:base.input.dataAt,receivedAt:base.input.receivedAt,observedAt:at,price:base.input.price,provider:base.input.provider,providerTimezone:base.input.providerTimezone,quoteHash:base.input.quoteHash,session:`${session.date}:${segment(session)}`,matches:base.state==='true'};
 const watermark=Date.parse(p?.watermark),last=p?.last;
 if(p&&now<Date.parse(p.checkedAt))return reply('unknown','检查时钟倒退，等待新的分钟采样',cleared);
 if(stamp<watermark)return reply('unknown','行情时间倒退；保留时间水位并重置连续性',cleared);
 if(stamp===watermark){
  if(last&&last.price===sample.price&&last.provider===sample.provider&&last.providerTimezone===sample.providerTimezone&&last.session===sample.session)return reply('false','同一时点未出现新的价格采样，不推进穿越或计时',{...p,checkedAt:at});
  return reply('unknown','同一时点的价格或来源发生修订，等待下一新样本',cleared);
 }
 const continuous=last&&sample.session===last.session&&sample.provider===last.provider&&sample.providerTimezone===last.providerTimezone&&stamp-Date.parse(last.dataAt)<=limit&&now-Date.parse(p.checkedAt)<=limit;
 const memory={...cleared,watermark:sample.dataAt,last:sample};
 if(condition.mode==='cross'){
  memory.samples=continuous?[last,sample]:[sample];
  if(!continuous)return reply('unknown','首次采样、来源变化或间隔中断；已建立新的穿越基线',memory);
  const crossed=condition.operator==='gte'?last.price<condition.value&&sample.price>=condition.value:last.price>condition.value&&sample.price<=condition.value;
  return reply(crossed?'true':'false',crossed?'相邻有效采样穿越阈值':'相邻有效采样未穿越阈值',memory,{previous:last,...(crossed?{samples:memory.samples}:{})});
 }
 if(!sample.matches)return reply('false','最新采样未达到阈值，持续窗口已重置',memory);
 const samples=continuous&&last.matches?[...p.samples,sample]:[sample];
 if(samples.length>MAX_SAMPLES)return reply('unknown','持续窗口超过512个采样，重新建立基线',{...memory,samples:[sample]});
 memory.samples=samples;
 const sourceSpanSeconds=(stamp-Date.parse(samples[0].dataAt))/1000,observedSeconds=Math.min(sourceSpanSeconds,(now-Date.parse(samples[0].observedAt))/1000),matched=samples.length>=2&&observedSeconds>=condition.holdSeconds;
 return reply(matched?'true':'false',matched?'有效采样持续满足已设时长':continuous?'有效采样尚未达到指定持续时长':'新窗口开始；不计首次观察前或中断期间的时间',memory,{sourceSpanSeconds,observedSeconds,...(matched?{samples}:{})});
}
