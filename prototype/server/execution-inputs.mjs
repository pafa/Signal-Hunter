import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {instrument} from '../shared/securities.mjs';
import {quoteIssues} from './market-sim-risk.mjs';
import {isMarketInstant,compareMarketTime} from './market-time.mjs';

const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const instant=(from,to,at)=>isMarketInstant(from)&&isMarketInstant(to)&&compareMarketTime(from,at)<=0&&compareMarketTime(at,to)<=0;
const label=v=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
export function readPrivateExecutionFile(path,maxBytes=4*1024*1024){
 if(!isAbsolute(path))throw Error('执行输入需要私有文件的绝对路径');
 let fd;try{
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);
  if(!stat.isFile()||stat.size>maxBytes||stat.mode&0o077||typeof process.getuid==='function'&&stat.uid!==process.getuid())throw 0;
  return readFileSync(fd,'utf8');
 }catch{throw Error('执行输入文件不可读、过大或权限不符合0600要求');}finally{if(fd!==undefined)closeSync(fd);}
}
export function validateExecutionConfig(config){
 const p=config?.permission,c=config?.capabilities;
 if(config?.schema!=='execution-feed/1'||!label(config.id)||!label(config.source)||!isAbsolute(config.framePath||'')||!p||p.reviewed!==true||p.usage!=='paper-execution'||!label(p.id)||!label(p.sourceDocument)||!isMarketInstant(p.validFrom)||!isMarketInstant(p.validUntil)||compareMarketTime(p.validFrom,p.validUntil)>=0||!Array.isArray(p.markets)||!p.markets.length||p.markets.some(m=>!['CN','HK','US'].includes(m))||c?.quantityUnit!=='shares'||!['verified-allocatable','verified-after-queue'].includes(c.capacity)||['identityVerified','rulesVerified','fxVerified','feesVerified'].some(k=>c[k]!==true))throw Error('执行源权限或身份、容量、FX、规则、费用能力尚未核对');
 return structuredClone(config);
}
export function loadExecutionConfig(path){return validateExecutionConfig(JSON.parse(readPrivateExecutionFile(path,65536)));}

// Trusted local provider bridge only. There is no browser quote or fill upload route.
// Persist accepted and rejected packets; approval and fills retain the exact normalized frame.
export function openExecutionInputs(store,{config=null,now=Date.now,enabled=true,readFrame=readPrivateExecutionFile}={}){
 const db=store.db,cfg=config?validateExecutionConfig(config):null,configurationHash=cfg?hash(cfg):null;
 db.exec(`CREATE TABLE IF NOT EXISTS execution_input_frames(hash TEXT NOT NULL,configuration_hash TEXT NOT NULL,configuration TEXT NOT NULL,source TEXT NOT NULL,received_at TEXT NOT NULL,raw TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(hash,configuration_hash));
 CREATE TABLE IF NOT EXISTS execution_input_state(slot INTEGER PRIMARY KEY CHECK(slot=1),payload TEXT NOT NULL);`);
 const guard=()=>{if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw Error('恢复副本需先核对，不能更新执行输入');};
 const read=()=>JSON.parse(db.prepare('SELECT payload FROM execution_input_state WHERE slot=1').get()?.payload||'null');
 const update=state=>db.prepare('INSERT INTO execution_input_state VALUES(1,?) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(state));
 const permission=at=>cfg&&instant(cfg.permission.validFrom,cfg.permission.validUntil,at);
 const api={
  status(){const s=read();return {configured:!!cfg,enabled:enabled&&!!cfg,source:cfg?.source||null,permissionCurrent:!!permission(new Date(now()).toISOString()),lastReceivedAt:s?.receivedAt||null,accepted:s?.accepted||0,rejected:s?.rejected||0,error:s?.error||null,frameHash:s?.frameHash||null,configurationMatches:!!s&&s.configurationHash===configurationHash};},
  inputs(){const at=new Date(now()).toISOString(),s=read();
   if(!enabled||!cfg)return {quotes:{},reason:'尚未接入经核对权限的执行行情桥接；观察行情不用于成交'};
   if(!permission(at))return {quotes:{},reason:'执行行情来源授权未生效或已过期'};
   if(!s||s.error||s.configurationHash!==configurationHash)return {quotes:{},reason:s?.error||'执行行情尚未完成来源核对'};
   return {quotes:structuredClone(s.quotes),frameHash:s.frameHash,reason:'经配置核对的供应商输入；费用按来源分项费表覆盖演练bp；模拟成交依赖本人审批与风险检查'};
  },
  refresh(context={}){
   context.assertActive?.();guard();if(!enabled||!cfg)return {skipped:'execution-source-unconfigured'};
   const at=new Date(now()).toISOString();
   let raw,frameHash,result;
   try{
    if(!permission(at)){result={configurationHash,receivedAt:at,quotes:{},accepted:0,rejected:0,error:'执行行情来源授权未生效或已过期'};}
    else {
    raw=readFrame(cfg.framePath);if(typeof raw!=='string'||Buffer.byteLength(raw)>4*1024*1024)throw 0;frameHash=hash(raw);
    const old=read();if(old?.frameHash===frameHash&&old.configurationHash===configurationHash&&!old.error)return {skipped:'unchanged-frame'};
    const packet=JSON.parse(raw);
    if(packet.schema!=='execution-frame/1'||packet.source!==cfg.source||!label(packet.packetId)||!Array.isArray(packet.quotes)||packet.quotes.length<1||packet.quotes.length>80)throw 0;
    const quotes={},rejections=[],seen=new Set();
    for(const input of packet.quotes){
     let symbol=input?.symbol;try{
      const spec=instrument(symbol),market=spec.symbol.endsWith('.US')?'US':spec.symbol.endsWith('.HK')?'HK':'CN';
      if(symbol!==spec.symbol)throw Error('证券代码必须使用规范形式');if(seen.has(symbol)){delete quotes[symbol];throw Error('同一数据包重复证券');}seen.add(symbol);
      if(!cfg.permission.markets.includes(market)||input.source!==cfg.source||input.kind!=='market-simulation-input'||input.verified!==true||input.fx?.executable!==true||input.fx?.currency!==spec.currency||input.fx?.baseCurrency!=='USD'||!input.fees||input.rulesVerified!==true||input.capacityVerified!==true)throw Error('来源、市场、容量、FX或规则核对缺失');
      if(input.liquidityBasis==='after-queue'&&(cfg.capabilities.capacity!=='verified-after-queue'||input.queueVerified!==true||!label(input.queueEvidence)))throw Error('涨停排队后容量缺少核对依据');
      const q={...structuredClone(input),executionFeed:true,authorization:{id:cfg.permission.id,validFrom:cfg.permission.validFrom,validUntil:cfg.permission.validUntil,configurationHash},provenance:{frameHash,packetId:packet.packetId,source:cfg.source}};
      const issues=quoteIssues(symbol,q,{quoteMaxAgeSeconds:3600,feeBps:0},at,{execution:true,allowLimitUp:true});
      if(issues.length)throw Error(issues.join('；'));quotes[symbol]=q;
     }catch{rejections.push({symbol:typeof symbol==='string'?symbol:null,reason:'执行输入未通过权限、身份、时间、数量、FX、规则或费用核对'});}
    }
    result={configurationHash,receivedAt:at,frameHash,accepted:Object.keys(quotes).length,rejected:rejections.length,rejections,quotes,error:Object.keys(quotes).length?null:'本次数据包没有可用于模拟的已核对执行输入'};
    }
   }catch{result={configurationHash,receivedAt:at,frameHash:frameHash||null,accepted:0,rejected:0,quotes:{},error:'执行行情桥接读取或数据格式失败；当前不使用旧包继续成交'};}
   context.assertActive?.();guard();db.exec('BEGIN IMMEDIATE');try{
    if(frameHash)db.prepare('INSERT OR IGNORE INTO execution_input_frames VALUES(?,?,?,?,?,?,?)').run(frameHash,configurationHash,JSON.stringify(cfg),cfg.source,at,raw,JSON.stringify(result));
    update(result);context.assertActive?.();guard();db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   return {accepted:result.accepted,rejected:result.rejected,...(result.error?{error:result.error}:{ok:true})};
  }
 };
 return api;
}
