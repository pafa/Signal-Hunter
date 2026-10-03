import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {isInstant} from './market-sim-risk.mjs';
export const FX_SOURCE='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const FX_PARSER='ecb-reference-fx/1';
const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const fail=()=>{throw new Error('参考汇率输入或快照无效');};
const scaled=s=>{if(typeof s!=='string'||!/^(0|[1-9]\d{0,10})(\.\d{1,6})?$/.test(s))fail();const [a,b='']=s.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
const fixed=(n,places)=>{const s=n.toString().padStart(places+1,'0');return s.slice(0,-places)+'.'+s.slice(-places);};
const round=(a,b)=>(a+b/2n)/b;
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,processEntities:false});
export function parseReferenceFx(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>131072||/<!DOCTYPE|<!ENTITY/i.test(raw)||XMLValidator.validate(raw)!==true)fail();
 const root=parser.parse(raw)['gesmes:Envelope'],day=root?.Cube?.Cube;
 if(root?.['@_xmlns']!=='http://www.ecb.int/vocabulary/2002-08-01/eurofxref'||root?.['gesmes:Sender']?.['gesmes:name']!=='European Central Bank'||!day||Array.isArray(day)||!/^\d{4}-\d{2}-\d{2}$/.test(day['@_time']||''))fail();
 const sourceDate=day['@_time'];if(!isInstant(sourceDate+'T00:00:00Z'))fail();
 const rows=day.Cube;if(!Array.isArray(rows)||rows.length<3||rows.length>100)fail();
 const eurRates={};for(const row of rows){const c=row['@_currency'],r=row['@_rate'];if(!/^[A-Z]{3}$/.test(c||'')||c==='EUR'||Object.hasOwn(eurRates,c)||scaled(r)<=0n)fail();eurRates[c]=r;}
 if(['USD','CNY','HKD'].some(c=>!eurRates[c]))fail();
 const usd=scaled(eurRates.USD),usdPerUnit=Object.fromEntries(['USD','CNY','HKD'].map(c=>[c,fixed(round(usd*1000000000000n,scaled(eurRates[c])),12)]));
 return {parser:FX_PARSER,sourceDate,datePrecision:'day',baseCurrency:'EUR',eurRates,usdPerUnit,kind:'reference-fx',executable:false,publicationInstant:null};
}
export function convertReferenceFx(snapshot,currency,amount){
 if(!snapshot||snapshot.parser!==FX_PARSER||snapshot.kind!=='reference-fx'||!['USD','CNY','HKD'].includes(currency))fail();
 const input=scaled(amount),usd=scaled(snapshot.eurRates?.USD),local=scaled(snapshot.eurRates?.[currency]);if(usd<=0n||local<=0n)fail();
 return {currency,amount,usdAmount:fixed(round(input*usd*100n,local*1000000n),2),sourceDate:snapshot.sourceDate,snapshotId:snapshot.id||null,kind:'reference-fx-conversion',executable:false,rounding:'half-up USD cents; exact source-rate ratio',basis:{usdPerEur:snapshot.eurRates.USD,unitsPerEur:snapshot.eurRates[currency]}};
}
const project=s=>{if(!s)return null;const {raw,...rest}=s;return rest;};
export function openReferenceFx(store,{enabled=true,fetcher=fetch,now=Date.now}={}){
 const db=store.db,jobs=new Set();let closed=false;
 db.exec(`CREATE TABLE IF NOT EXISTS reference_fx_snapshots(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reference_fx_attempts(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reference_fx_lease(slot INTEGER PRIMARY KEY CHECK(slot=1),owner TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
 const clock=()=>new Date(now()).toISOString();
 const guard=()=>{if(closed||!enabled)throw new Error('当前模式不启用参考汇率更新');if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')throw new Error('恢复副本需先完成核对确认');};
 const read=id=>{const row=db.prepare('SELECT payload FROM reference_fx_snapshots WHERE id=?').get(id);if(!row)fail();const s=JSON.parse(row.payload),{snapshotHash,...body}=s;if(digest(body)!==snapshotHash||digest(s.raw)!==s.rawHash||digest({parser:s.parser,rawHash:s.rawHash})!==id)fail();return s;};
 const all=()=>db.prepare("SELECT id FROM reference_fx_snapshots ORDER BY json_extract(payload,'$.sourceDate') DESC,rowid DESC").all();
 const current=()=>{const at=clock();for(const {id} of all()){const s=read(id);if(s.sourceDate<=at.slice(0,10)&&s.receivedAt<=at)return s;}return null;};
 const attempt=id=>{const row=db.prepare('SELECT payload FROM reference_fx_attempts WHERE id=?').get(id);if(!row)return null;const {source,...r}=JSON.parse(row.payload);return r;};
 const saveAttempt=r=>db.prepare('INSERT OR REPLACE INTO reference_fx_attempts VALUES(?,?)').run(r.id,JSON.stringify(r));
 const status=()=>({enabled,parser:FX_PARSER,current:project(current()),history:all().slice(0,20).map(({id})=>project(read(id))),attempts:db.prepare('SELECT id FROM reference_fx_attempts ORDER BY rowid DESC LIMIT 20').all().map(r=>attempt(r.id)),executable:false,note:'日参考汇率仅供研究换算；不是交易FX，不修改账本净值或成交输入'});
 async function run(id){
  const startedAt=clock();let source=null;
  const assertOwner=()=>{guard();const lease=db.prepare('SELECT * FROM reference_fx_lease WHERE slot=1').get();if(lease?.owner!==id||lease.expires_at<=now())throw new Error('参考汇率更新已失去租约');};
  try{
   const response=await fetcher(FX_SOURCE,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/xml,text/xml'}});
   if(!response.ok||Number(response.headers.get('content-length'))>131072)fail();
   const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>131072)fail();chunks.push(chunk);}
   const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks));source={url:FX_SOURCE,requestedAt:startedAt,receivedAt:clock(),raw,rawHash:digest(raw)};
   if(source.receivedAt<startedAt)fail();
   const parsed=parseReferenceFx(raw),snapshotId=digest({parser:FX_PARSER,rawHash:source.rawHash});
   db.exec('BEGIN IMMEDIATE');try{
    assertOwner();const prior=current(),body={id:snapshotId,...parsed,...source},snapshot={...body,snapshotHash:digest(body)};
    db.prepare('INSERT OR IGNORE INTO reference_fx_snapshots VALUES(?,?)').run(snapshotId,JSON.stringify(snapshot));
    const reason=parsed.sourceDate>clock().slice(0,10)?'future-source-date':prior&&parsed.sourceDate<prior.sourceDate?'source-date-regression':null;
    saveAttempt({id,startedAt,finishedAt:clock(),status:reason?'quarantined':'succeeded',snapshotId,reason});
    db.prepare('DELETE FROM reference_fx_lease WHERE owner=?').run(id);db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  }catch{
   db.exec('BEGIN IMMEDIATE');try{
    // A late response may finish its own attempt, never delete another worker's lease.
    saveAttempt({id,startedAt,finishedAt:clock(),status:'failed',error:'参考汇率更新失败，原快照保留',source});db.prepare('DELETE FROM reference_fx_lease WHERE owner=?').run(id);db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return attempt(id);
 }
 const api={status,read,convert({snapshotId,currency,amount}){const s=snapshotId?read(snapshotId):current();if(!s||s.sourceDate>clock().slice(0,10)||s.receivedAt>clock())fail();return convertReferenceFx(s,currency,amount);},
  refresh(data){
   guard();if(!data||Object.keys(data).join(',')!=='requestId'||typeof data.requestId!=='string'||!/^[A-Za-z0-9_-]{8,80}$/.test(data.requestId))fail();const id=data.requestId;
   db.exec('BEGIN IMMEDIATE');try{
    const old=attempt(id);if(old){db.exec('COMMIT');return Promise.resolve(old);}
    const lease=db.prepare('SELECT * FROM reference_fx_lease WHERE slot=1').get();if(lease&&lease.expires_at>now())throw new Error('参考汇率正在更新，请等待');
    const recent=db.prepare('SELECT payload FROM reference_fx_attempts ORDER BY rowid DESC LIMIT 1').get();if(recent&&now()-Date.parse(JSON.parse(recent.payload).startedAt)<60000)throw new Error('参考汇率最近已请求，请至少间隔一分钟');
    if(lease){const oldAttempt=attempt(lease.owner);if(oldAttempt?.status==='running')saveAttempt({...oldAttempt,status:'interrupted',finishedAt:clock()});}
    saveAttempt({id,startedAt:clock(),status:'running'});db.prepare('INSERT OR REPLACE INTO reference_fx_lease VALUES(1,?,?)').run(id,now()+30000);db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   const job=run(id);jobs.add(job);job.then(()=>jobs.delete(job),()=>jobs.delete(job));return job;
  },async close(){closed=true;await Promise.allSettled([...jobs]);}
 };
 return api;
}
