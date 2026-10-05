import {minuteCacheDecision} from './minute-history.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {hash,instrument} from './providers.mjs';
import {OFFICIAL_NEWS_SOURCES} from '../shared/news-sources.mjs';

export function openStore(path) {
  if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS news(id TEXT PRIMARY KEY,payload TEXT NOT NULL,hash TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,revision INTEGER NOT NULL,selected INTEGER NOT NULL DEFAULT 0,read INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS revisions(news_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(news_id,version));
    CREATE TABLE IF NOT EXISTS watches(symbol TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS quotes(symbol TEXT PRIMARY KEY,payload TEXT NOT NULL,received_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bars(symbol TEXT NOT NULL,provider_time TEXT NOT NULL,close REAL NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,PRIMARY KEY(symbol,provider_time));
    CREATE TABLE IF NOT EXISTS quote_bars(symbol TEXT NOT NULL,provider TEXT NOT NULL,timezone TEXT NOT NULL,provider_time TEXT NOT NULL,close REAL NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,PRIMARY KEY(symbol,provider,timezone,provider_time));
    CREATE TABLE IF NOT EXISTS checks(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS quote_snapshots(id INTEGER PRIMARY KEY,symbol TEXT NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL,received_at TEXT NOT NULL,activated INTEGER NOT NULL,reason TEXT NOT NULL,UNIQUE(symbol,hash));`);
  db.exec(`CREATE TABLE IF NOT EXISTS daily_quotes(symbol TEXT PRIMARY KEY,payload TEXT NOT NULL,received_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS daily_snapshots(symbol TEXT NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(symbol,hash));`);
  const getSettings=()=>({keywords:db.prepare("SELECT value FROM settings WHERE key='keywords'").get()?.value||'',newsDiscoveryEnabled:db.prepare("SELECT value FROM settings WHERE key='newsDiscoveryEnabled'").get()?.value!=='false',newsTrackingEnabled:db.prepare("SELECT value FROM settings WHERE key='newsTrackingEnabled'").get()?.value!=='false',...Object.fromEntries(OFFICIAL_NEWS_SOURCES.map(s=>[s.setting,db.prepare('SELECT value FROM settings WHERE key=?').get(s.setting)?.value==='true']))});
  const setSettings=changes=>{
    if(Object.keys(changes).some(key=>!['keywords','newsDiscoveryEnabled','newsTrackingEnabled',...OFFICIAL_NEWS_SOURCES.map(s=>s.setting)].includes(key)))throw new Error('不支持的订阅设置');
    if('keywords' in changes&&(typeof changes.keywords!=='string'||changes.keywords.length>120))throw new Error('关键词最多 120 字符');
    for(const key of ['newsDiscoveryEnabled','newsTrackingEnabled',...OFFICIAL_NEWS_SOURCES.map(s=>s.setting)])if(key in changes&&typeof changes[key]!=='boolean')throw new Error('订阅开关需要布尔值');
    db.exec('BEGIN IMMEDIATE');try{for(const [key,value] of Object.entries(changes))db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key,typeof value==='string'?value.trim():String(value));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return getSettings();
  };
  const selectNews='SELECT n.*,r.received_at AS revision_first_seen FROM news n LEFT JOIN revisions r ON r.news_id=n.id AND r.version=n.revision';
  const mapNews=row=>({...JSON.parse(row.payload),firstSeen:row.first_seen,articleFirstSeen:row.first_seen,revisionFirstSeen:row.revision_first_seen||null,lastSeen:row.last_seen,revision:row.revision,selected:!!row.selected,read:!!row.read,note:row.note});
  const newsRows=()=>db.prepare(selectNews+' ORDER BY n.last_seen DESC LIMIT 500').all().map(mapNews).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
  return {
    db,getSettings,setSettings,
    news:newsRows,
    newsById(id){const row=db.prepare(selectNews+' WHERE n.id=?').get(id);return row?mapNews(row):null;},
    revisionAvailableAt(id,revision){return db.prepare('SELECT received_at FROM revisions WHERE news_id=? AND version=?').get(id,revision)?.received_at||null;},
    ingest(items,receivedAt=new Date().toISOString(),onCommit=null) {
      let added=0,updated=0;db.exec('BEGIN IMMEDIATE');
      try {
        for(const item of items){
          const payload=JSON.stringify(item),fingerprint=hash(payload),old=db.prepare('SELECT hash,revision FROM news WHERE id=?').get(item.id);
          if(!old){db.prepare('INSERT INTO news(id,payload,hash,first_seen,last_seen,revision) VALUES(?,?,?,?,?,1)').run(item.id,payload,fingerprint,receivedAt,receivedAt);added++;}
          else if(old.hash!==fingerprint){db.prepare('UPDATE news SET payload=?,hash=?,last_seen=?,revision=revision+1 WHERE id=?').run(payload,fingerprint,receivedAt,item.id);updated++;}
          else {db.prepare('UPDATE news SET last_seen=? WHERE id=?').run(receivedAt,item.id);continue;}
          db.prepare('INSERT INTO revisions VALUES(?,?,?,?)').run(item.id,(old?.revision||0)+1,payload,receivedAt);
        }
        const result={added,updated};onCommit?.(result);db.exec('COMMIT');return result;
      } catch(error){db.exec('ROLLBACK');throw error;}
    },
    editNews(id,changes){
      const row=db.prepare('SELECT * FROM news WHERE id=?').get(id);if(!row)throw new Error('新闻不存在');
      if(Object.keys(changes).some(k=>!['selected','read','note'].includes(k)))throw new Error('不支持的新闻修改');
      if('selected' in changes&&typeof changes.selected!=='boolean'||'read' in changes&&typeof changes.read!=='boolean'||'note' in changes&&(typeof changes.note!=='string'||changes.note.length>4000))throw new Error('选读字段无效');
      db.prepare('UPDATE news SET selected=?,read=?,note=? WHERE id=?').run(Number(changes.selected??!!row.selected),Number(changes.read??!!row.read),changes.note??row.note,id);
    },
    revisions(id){return db.prepare('SELECT version,payload,received_at FROM revisions WHERE news_id=? ORDER BY version DESC').all(id).map(r=>({...JSON.parse(r.payload),version:r.version,receivedAt:r.received_at}));},
    watchlist(){return db.prepare('SELECT symbol,created_at AS createdAt FROM watches ORDER BY created_at').all();},
    addWatch(value){const {symbol}=instrument(value);if(!db.prepare('SELECT 1 FROM watches WHERE symbol=?').get(symbol)&&db.prepare('SELECT COUNT(*) n FROM watches').get().n>=40)throw new Error('工作台最多关注 40 个标的');db.prepare('INSERT OR IGNORE INTO watches VALUES(?,?)').run(symbol,new Date().toISOString());return symbol;},
    removeWatch(symbol){db.prepare('DELETE FROM watches WHERE symbol=?').run(symbol);},
    quote(symbol){const row=db.prepare('SELECT * FROM quotes WHERE symbol=?').get(symbol);return row?{...JSON.parse(row.payload),receivedAt:row.received_at}:null;},
    daily(symbol){const row=db.prepare('SELECT payload FROM daily_quotes WHERE symbol=?').get(symbol);return row?JSON.parse(row.payload):null;},
    saveDaily(quote,{activate=true}={}){
      if(quote.interval!=='1d'||!quote.points?.length)throw new Error('日线缓存格式无效');
      const payload=JSON.stringify(quote);db.exec('BEGIN IMMEDIATE');try{
        if(activate)db.prepare('INSERT OR REPLACE INTO daily_quotes VALUES(?,?,?)').run(quote.symbol,payload,quote.receivedAt);
        db.prepare('INSERT OR IGNORE INTO daily_snapshots VALUES(?,?,?,?)').run(quote.symbol,hash(payload),payload,quote.receivedAt);db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    quoteHistory(symbol,limit=50){
      if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('分钟历史查询最多100条');
      return db.prepare('SELECT * FROM quote_snapshots WHERE symbol=? ORDER BY id DESC LIMIT ?').all(symbol,limit).map(r=>({id:r.id,hash:r.hash,...JSON.parse(r.payload),activated:!!r.activated,reason:r.reason,version:'minute-history/1'}));
    },
    saveQuote(quote,at=new Date().toISOString()){
      db.exec('BEGIN IMMEDIATE');try{
        const row=db.prepare('SELECT * FROM quotes WHERE symbol=?').get(quote.symbol),previous=row?JSON.parse(row.payload):null;
        const archive=(value,receivedAt,decision)=>{const payload=JSON.stringify({quote:value,receivedAt}),digest=hash(payload);db.prepare('INSERT OR IGNORE INTO quote_snapshots(symbol,hash,payload,received_at,activated,reason) VALUES(?,?,?,?,?,?)').run(value.symbol,digest,payload,receivedAt,Number(decision.activated),decision.reason);return digest;};
        if(previous)archive(previous,row.received_at,{activated:true,reason:'legacy-cache'});
        const decision=minuteCacheDecision(previous,quote,at),snapshotHash=archive(quote,at,decision);
        if(!decision.activated){db.exec('COMMIT');return {...decision,snapshotHash};}
        db.prepare('INSERT OR REPLACE INTO quotes VALUES(?,?,?)').run(quote.symbol,JSON.stringify(quote),at);
        const stmt=db.prepare('INSERT INTO bars VALUES(?,?,?,?,?) ON CONFLICT(symbol,provider_time) DO UPDATE SET close=excluded.close,last_seen=excluded.last_seen');
        const sourced=db.prepare('INSERT INTO quote_bars VALUES(?,?,?,?,?,?,?) ON CONFLICT(symbol,provider,timezone,provider_time) DO UPDATE SET close=excluded.close,last_seen=excluded.last_seen');
        for(const point of quote.points){if(quote.provider!=='yahoo-public-chart')stmt.run(quote.symbol,point.time,point.close,at,at);sourced.run(quote.symbol,quote.provider||'legacy',quote.providerTimezone||'unverified',point.time,point.close,at,at);}
        db.exec('COMMIT');return {...decision,snapshotHash};
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    status(id,data){const previous=db.prepare('SELECT payload FROM checks WHERE id=?').get(id);const last=previous?JSON.parse(previous.payload):{};db.prepare('INSERT OR REPLACE INTO checks VALUES(?,?)').run(id,JSON.stringify({...data,receivedAt:data.receivedAt||last.receivedAt||null}));},
    checks(){return Object.fromEntries(db.prepare('SELECT * FROM checks').all().map(row=>[row.id,JSON.parse(row.payload)]));},
    close(){db.close();}
  };
}
