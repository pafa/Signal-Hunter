import {CROSS_PARSER,loadHongKong,loadMainland} from './cross-market-directory.mjs';
import {createHash} from 'node:crypto';
import {COMPANY_DIRECTORY} from '../shared/company-directory.mjs';
import {securityIdentity} from '../shared/securities.mjs';
import {digest} from './codex-research.mjs';
import {directoryCodeRecall,DIRECTORY_RECALL} from './directory-code-recall.mjs';
export const DIRECTORY_SOURCES=[{id:'nasdaq',url:'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt',header:'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares'},{id:'other',url:'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt',header:'ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol'}];
export const DIRECTORY_PARSER='nasdaq-symbol-directory-1';
const venueNames={Q:'XNAS',A:'XASE',N:'XNYS',P:'ARCX',Z:'BATS',V:'IEXG'};
const failure=message=>{throw new Error(message);};
const norm=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const summary=s=>({id:s.id,market:s.market||'US',parser:s.parser,receivedAt:s.receivedAt,counts:s.counts,sources:s.sources.map(({raw,...v})=>v),scope:s.scope});
export function parseDirectoryFile(source,raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>5000000||raw.includes('\0'))failure('证券目录格式或大小无效');
 const lines=raw.replace(/^\uFEFF/,'').trimEnd().split(/\r?\n/);if(lines.shift()!==source.header||lines.length<2||lines.length>30001)failure('证券目录表头、条数或结束标记无效');
 const last=lines.pop().split('|'),match=/^File Creation Time: (\d{2})(\d{2})(\d{4})(\d{2}):(\d{2})$/.exec(last[0]||'');
 if(!match||![7,8].includes(last.length)||last.slice(1).some(Boolean))failure('证券目录表头、条数或结束标记无效');
 const [,month,day,year,hour,minute]=match,sourceDate=`${year}-${month}-${day}`;
 if(!Number.isFinite(Date.parse(sourceDate+'T00:00:00Z'))||new Date(sourceDate+'T00:00:00Z').toISOString().slice(0,10)!==sourceDate||+hour>23||+minute>59)failure('证券目录生成日期无效');
 const fields=source.header.split('|'),seen=new Set(),entries=lines.map(line=>{
  const values=line.split('|');if(values.length!==fields.length||values.some(v=>v.length>1000))failure('证券目录行格式无效');
  const r=Object.fromEntries(fields.map((k,i)=>[k,values[i].trim()])),code=r.Symbol||r['ACT Symbol'],name=r['Security Name'];
  if(!code||!name||seen.has(code)||!['Y','N'].includes(r.ETF)||!['Y','N'].includes(r['Test Issue'])||!/^\d{1,6}$/.test(r['Round Lot Size'])||+r['Round Lot Size']<1)failure('证券目录代码、类型或重复行无效');seen.add(code);
  const exchange=source.id==='nasdaq'?'Q':r.Exchange,venue=venueNames[exchange]||null;
  let symbol=null;try{if(/^[A-Z][A-Z0-9.-]{0,11}$/.test(code))symbol=securityIdentity(code+'.US').symbol;}catch{}
  const stock=/\b(?:common stock|common shares|ordinary shares|capital stock|american depositary shares|american depositary receipts)\b/i.test(name)&&!/\b(?:warrants?|rights|preferred|preference|notes|debentures|bonds)\b/i.test(name)&&!/(?: - |, )Units\b/i.test(name);
  const excluded=[...(r['Test Issue']==='Y'?['test-issue']:[]),...(r.ETF==='Y'?['etf']:[]),...(!symbol?['unsupported-symbol']:[]),...(!venue?['unknown-venue']:[]),...(!stock?['equity-type-unconfirmed']:[])];
  return {sourceId:source.id,sourceSymbol:code,symbol,name,venue,exchange,securityType:r.ETF==='Y'?'etf':stock?'equity-candidate':'unconfirmed',testIssue:r['Test Issue']==='Y',financialStatus:r['Financial Status']||null,roundLot:Number(r['Round Lot Size']),rawFields:r,eligible:!excluded.length,excluded};
 });
 return {sourceDate,fileCreationTime:last[0].slice(20),timezone:'unverified',entries};
}
export function openSecurityDirectory(store,{enabled=true,fetcher=fetch,now=Date.now}={}){
 const db=store.db;let job=null,closed=false;const cache=new Map();
 db.exec(`CREATE TABLE IF NOT EXISTS security_directory_snapshots(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS security_directory_attempts(id TEXT PRIMARY KEY,status TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS security_directory_lease(slot INTEGER PRIMARY KEY CHECK(slot=1),owner TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
 const guard=()=>{if(db.prepare("SELECT value FROM settings WHERE key='restore_review_required'").get()?.value==='1')failure('恢复副本需先完成核对确认');};
 const read=id=>{const row=db.prepare('SELECT payload FROM security_directory_snapshots WHERE id=?').get(id);if(!row)failure('证券目录快照不存在');const s=JSON.parse(row.payload),{snapshotHash,...value}=s;if(digest(value)!==snapshotHash)failure('证券目录快照校验失败');return s;};
 const marketOf=value=>{if(!['US','CN','HK'].includes(value))failure('证券目录市场无效');return value;};
 const ids=market=>db.prepare("SELECT id FROM security_directory_snapshots WHERE COALESCE(json_extract(payload,'$.market'),'US')=? ORDER BY rowid DESC").all(marketOf(market));
 const current=(market='US')=>{const id=ids(market)[0]?.id;if(!id)return null;if(cache.get(market)?.id!==id)cache.set(market,read(id));return cache.get(market);};
 const today=()=>new Date(now()).toISOString().slice(0,10);
 const future=s=>s.sources.some(x=>x.sourceDate&&x.sourceDate>today());
 const active=market=>{const latest=current(market);if(!latest||!future(latest))return latest;for(const {id} of ids(market).slice(1)){const s=read(id);if(!future(s))return s;}return null;};
 const projected=s=>s?{...summary(s),futureDated:future(s),asOfDateUTC:today()}:null;
 const identity=(entry,s)=>{
  const known=COMPANY_DIRECTORY.find(c=>c.symbol===entry.symbol),base=securityIdentity(entry.symbol);
  return {...base,name:entry.name,aliases:[...new Set([...(entry.aliases||[]),...(known?.aliases||[])])],issuerKey:known?.issuerKey||entry.symbol,venue:entry.venue,identityStatus:'directory-snapshot',identitySource:s.sources.find(x=>x.id===entry.sourceId).url,identityBasis:`官方目录快照 ${s.sources.find(x=>x.id===entry.sourceId).sourceDate||'来源生成日期未知'}；非实时上市/交易核验，历史有效期未知`,directorySnapshotId:s.id,directoryVersion:s.parser,sourceSymbol:entry.sourceSymbol,isin:entry.isin||null,reportedListingDate:entry.listingDate||null,financialStatus:entry.financialStatus,listingValidity:'unverified',directoryReceivedAt:s.receivedAt};
 };
 async function readSource(source,signal){
  const requestedAt=new Date(now()).toISOString(),r=await fetcher(source.url,{redirect:'error',signal,headers:{'User-Agent':'SignalHunter/0.11 directory research',...(source.referer?{Referer:source.referer}:{})}});
  if(!r.ok)failure('证券目录上游请求失败');if(Number(r.headers.get('content-length'))>5000000)failure('证券目录格式或大小无效');
  const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>5000000)failure('证券目录格式或大小无效');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),raw=source.format==='xlsx'?bytes.toString('base64'):new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  return {id:source.id,url:source.url,requestedAt,receivedAt:new Date(now()).toISOString(),raw,rawHash:createHash('sha256').update(bytes).digest('hex'),bytes:size,...(source.format==='xlsx'?{rawEncoding:'base64'}:{})};
 }
 const api={
  current,
  status({market='US'}={}){marketOf(market);const s=current(market);return {market,enabled:enabled&&!closed,running:!!job||!!db.prepare('SELECT 1 FROM security_directory_lease WHERE expires_at>=?').get(now()),current:projected(s),active:projected(active(market)),markets:Object.fromEntries(['US','CN','HK'].map(m=>[m,projected(current(m))])),ageDays:s?Math.max(0,(now()-Date.parse(s.receivedAt))/86400000):null,history:ids(market).slice(0,20).map(({id})=>projected(read(id))),attempts:db.prepare('SELECT payload FROM security_directory_attempts ORDER BY rowid DESC').all().map(r=>{const a=JSON.parse(r.payload);return a.status==='running'&&(a.expiresAt??Date.parse(a.startedAt)+60000)<now()?{...a,status:'interrupted'}:a;}).filter(a=>(a.market||'US')===market).slice(0,20),coverage:{US:'Nasdaq及其他交易所目录；测试证券、ETF、无法确认股票类型或代码的行不作为公司候选',CN:'沪市主板/科创板与深市A股；未含北交所、退市全集及历史有效区间',HK:'港交所中英文名单；仅港币普通股/GEM/预托证券候选，非港币柜台和其他类型保留但不参与模型'},historicalValidity:'unknown; snapshots show observation, not listing effective intervals'};},
  search(params={}){
   if(!params||Object.keys(params).some(k=>!['q','offset','snapshotId','market'].includes(k)))failure('证券目录查询参数无效');
   let {q='',offset=0,snapshotId,market='US'}=params;marketOf(market);
   offset=Number(offset);if(typeof q!=='string'||q.length>120||!Number.isSafeInteger(offset)||offset<0)failure('证券目录查询参数无效');
   const s=snapshotId?read(snapshotId):current(market);if(s&&(s.market||'US')!==market)failure('证券目录快照与市场不符');if(!s)return {items:[],total:0,offset,snapshot:null};const query=norm(q),rows=s.entries.filter(e=>e.eligible&&(!query||norm(e.name).includes(query)||(e.aliases||[]).some(a=>norm(a).includes(query))||norm(e.symbol).includes(query)||norm(e.sourceSymbol)===query));
   return {items:rows.slice(offset,offset+20).map(e=>identity(e,s)),total:rows.length,offset,snapshot:projected(s)};
  },
  selection(text){
   const snapshots=['US','CN','HK'].map(m=>active(m)).filter(Boolean);if(!snapshots.length)return null;const codes=directoryCodeRecall(text),corpus=' '+norm(codes.names)+' ',matches=[];
   for(const s of snapshots){
   for(const e of s.entries.filter(e=>e.eligible&&(!e.listingDate||e.listingDate<=today()))){
    const known=COMPANY_DIRECTORY.find(c=>c.symbol===e.symbol),stem=e.name.split(' - ')[0].replace(/\b(?:common stock|common shares|ordinary shares|american depositary (?:shares|receipts)).*$/i,'').replace(/\b(?:incorporated|inc\.?|corporation|corp\.?|limited|ltd\.?|plc|class [a-z])\b[., ]*/gi,'').trim();
    const names=[stem,e.name,...(e.aliases||[]),...(known?[known.name,...known.aliases]:[])].map(norm).filter(n=>n.replaceAll(' ','').length>=(/\p{Script=Han}/u.test(n)?2:known?3:4));
    const explicit=codes.matches(e);
    const knownExact=(known?.aliases||[]).some(a=>/^[A-Z]{2,5}$/.test(a)&&new RegExp(`(?<![A-Za-z0-9])${a}(?![A-Za-z0-9])`).test(codes.names));
    if(explicit||knownExact||names.some(n=>/\p{Script=Han}/u.test(n)?corpus.includes(n):new RegExp(`(?<![a-z0-9])${n}(?![a-z0-9])`,'u').test(corpus)))matches.push(identity(e,s));
   }
   }
   // Input is bounded and the coverage note is part of the frozen model packet.
   const selected=matches.slice(0,80),coveredMarkets=snapshots.map(s=>s.market||'US');return {entries:selected,coveredMarkets,basis:{snapshotId:digest(snapshots.map(s=>s.id)),snapshots:snapshots.map(s=>({id:s.id,market:s.market||'US',parser:s.parser})),parser:CROSS_PARSER,sourceDates:snapshots.flatMap(s=>s.sources.map(x=>({id:x.id,date:x.sourceDate}))),totalEligible:snapshots.reduce((n,s)=>n+s.counts.eligible,0),matched:matches.length,selected:selected.length,omitted:Math.max(0,matches.length-selected.length),method:DIRECTORY_RECALL,limitation:'有限名称召回；显式代码按完整标识及交易所匹配，名称仍可能歧义。未选入不代表不存在或未上市，未来日期的目录/上市日不参与当前召回。'}};

  },
  refresh(data){
   guard();if(!enabled||closed)failure('当前模式不启用证券目录联网更新');if(!data||!['requestId','market,requestId'].includes(Object.keys(data).sort().join(','))||typeof data.requestId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(data.requestId))failure('证券目录更新请求无效');
   const market=marketOf(data.market||'US');
   const old=db.prepare('SELECT payload FROM security_directory_attempts WHERE id=?').get(data.requestId);if(old){const prior=JSON.parse(old.payload);if((prior.market||'US')!==market)failure('证券目录请求标识已用于其他市场');return prior;}if(job)failure('证券目录正在更新，请等待');
   const started={id:data.requestId,market,status:'running',startedAt:new Date(now()).toISOString(),expiresAt:now()+120000};
   db.exec('BEGIN IMMEDIATE');try{guard();db.prepare('DELETE FROM security_directory_lease WHERE expires_at<?').run(now());if(db.prepare('SELECT 1 FROM security_directory_lease').get())failure('证券目录正在更新，请等待');db.prepare('INSERT INTO security_directory_lease VALUES(1,?,?)').run(started.id,now()+120000);db.prepare('INSERT INTO security_directory_attempts VALUES(?,?,?)').run(started.id,started.status,JSON.stringify(started));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
   const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);
   const done=(async()=>{
    try{
     let sources,entries,parser=DIRECTORY_PARSER;
     if(market==='US'){const parsed=await Promise.all(DIRECTORY_SOURCES.map(async source=>{const s=await readSource(source,signal);return {...s,...parseDirectoryFile(source,s.raw)};}));sources=parsed.map(({entries,...s})=>s);entries=parsed.flatMap(s=>s.entries);}
     else{parser=CROSS_PARSER;({sources,entries}=await (market==='HK'?loadHongKong:loadMainland)(readSource,signal));}
     const keys=entries.filter(e=>e.symbol).map(e=>e.symbol);

     if(new Set(keys).size!==keys.length)failure('证券目录来源之间存在代码冲突');
     const id=digest({parser,...(market==='US'?{}:{market}),sources:sources.map(s=>({id:s.id,rawHash:s.rawHash}))}),value={id,market,parser,receivedAt:new Date(now()).toISOString(),sources,entries,counts:{rows:entries.length,eligible:entries.filter(e=>e.eligible).length,excluded:entries.filter(e=>!e.eligible).length},scope:'current-directory-observation; not complete historical listing coverage'};
     const saved={...value,snapshotHash:digest(value)};db.exec('BEGIN IMMEDIATE');try{guard();if(signal.aborted||!db.prepare('SELECT 1 FROM security_directory_lease WHERE owner=? AND expires_at>=?').get(started.id,now()))throw Error('Cancelled');const previous=active(market);if(previous&&sources.some(s=>s.sourceDate&&previous.sources.find(p=>p.id===s.id)?.sourceDate&&[s.sourceDate,s.fileCreationTime||''].join(' ')<[previous.sources.find(p=>p.id===s.id).sourceDate,previous.sources.find(p=>p.id===s.id).fileCreationTime||''].join(' ')))failure('证券目录日期倒退，保留已有快照');db.prepare('INSERT OR IGNORE INTO security_directory_snapshots VALUES(?,?)').run(id,JSON.stringify(saved));const result={...started,status:'complete',finishedAt:new Date(now()).toISOString(),snapshotId:id,counts:saved.counts};db.prepare('UPDATE security_directory_attempts SET status=?,payload=? WHERE id=?').run(result.status,JSON.stringify(result),started.id);db.exec('COMMIT');cache.clear();}catch(e){db.exec('ROLLBACK');throw e;}
    }catch(error){const result={...started,status:'failed',finishedAt:new Date(now()).toISOString(),message:'证券目录更新失败；原快照保留，请检查来源状态',reason:signal.aborted?'timeout-or-cancelled':'source-or-validation'};db.prepare('UPDATE security_directory_attempts SET status=?,payload=? WHERE id=?').run(result.status,JSON.stringify(result),started.id);controller.abort();}
    finally{db.prepare('DELETE FROM security_directory_lease WHERE owner=?').run(started.id);job=null;}
   })();job={controller,done};return started;
  },
  async wait(){await job?.done;return api.status();},
  async close(){closed=true;job?.controller.abort();await job?.done;}
 };
 return api;
}
