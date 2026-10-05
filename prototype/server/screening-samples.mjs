import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
const paths=['server/screening-samples.mjs','server/triage.mjs','server/event-routing.mjs','shared/company-directory.mjs','shared/securities.mjs','shared/headline-screening.mjs'];
const sources=Object.fromEntries(paths.map(path=>[path,readFileSync(new URL('../'+path,import.meta.url),'utf8')]));
const rulesHash=digest(JSON.stringify(sources));
export const SCREENING_LABELS={major:'重大候选',ordinary:'普通资讯',unclear:'信息不足'};
export function openScreeningSamples(db,{clock=()=>new Date().toISOString()}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS screening_rules(hash TEXT PRIMARY KEY,payload TEXT NOT NULL,activated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS screening_samples(id TEXT PRIMARY KEY,news_id TEXT NOT NULL,revision INTEGER NOT NULL,rules_hash TEXT NOT NULL,payload TEXT NOT NULL,recorded_at TEXT NOT NULL,UNIQUE(news_id,revision,rules_hash));
 CREATE INDEX IF NOT EXISTS screening_by_news ON screening_samples(news_id,recorded_at);
 CREATE TABLE IF NOT EXISTS screening_reviews(sample_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,recorded_at TEXT NOT NULL,PRIMARY KEY(sample_id,version));`);
 db.prepare('INSERT OR IGNORE INTO screening_rules VALUES(?,?,?)').run(rulesHash,JSON.stringify({sources,scope:'标题初筛及公司目录；不是完整交易或评估基线'}),clock());
 const activatedAt=db.prepare('SELECT activated_at FROM screening_rules WHERE hash=?').get(rulesHash).activated_at;
 const reviews=id=>db.prepare('SELECT payload FROM screening_reviews WHERE sample_id=? ORDER BY version DESC').all(id).map(r=>JSON.parse(r.payload));
 const packet=newsId=>db.prepare('SELECT payload FROM screening_samples WHERE news_id=? ORDER BY recorded_at DESC,rowid DESC LIMIT 12').all(newsId).map(r=>{const p=JSON.parse(r.payload);return {...p,reviews:reviews(p.id)};});
 return {
  rulesHash,
  capture(news,triage,decisionAt){
   const input={id:news.id,revision:news.revision,title:news.title,url:news.url,publisher:news.publisher,publishedAt:news.publishedAt,datePrecision:news.datePrecision||'instant',firstSeen:news.articleFirstSeen,availableAt:news.revisionFirstSeen};
   const id=digest(`${news.id}:${news.revision}:${rulesHash}`),seen=Date.parse(input.firstSeen),available=Date.parse(input.availableAt),decided=Date.parse(decisionAt);
   const prospective=Number.isFinite(seen)&&Number.isFinite(available)&&seen>=Date.parse(activatedAt)&&available>=seen&&decided>=available;
   const payload={id,input,inputHash:digest(JSON.stringify(input)),triage,rulesHash,activatedAt,decisionAt,origin:prospective?'prospective-intake':'historical-diagnostic',evaluationEligible:false,
    limitation:'保存全部初筛层级；尚未经独立事件簇、留出窗口及标签审核，不计入有效性统计'};
   db.prepare('INSERT OR IGNORE INTO screening_samples VALUES(?,?,?,?,?,?)').run(id,news.id,news.revision,rulesHash,JSON.stringify(payload),decisionAt);
  },
  packet(newsId){return {samples:packet(newsId),currentRulesHash:rulesHash};},
  review(data){
   if(!data||typeof data!=='object'||!Number.isInteger(data.version)||data.version<0)throw new Error('复核版本无效');
   const row=db.prepare('SELECT payload FROM screening_samples WHERE id=?').get(data.sampleId);if(!row)throw new Error('初筛样本不存在');
   const sample=JSON.parse(row.payload);
   if(!Object.hasOwn(SCREENING_LABELS,data.verdict))throw new Error('初筛复核分类无效');
   const result={};for(const key of ['novelty','scale','mechanism','expectations','duration','note']){
    const value=data[key]??'';if(typeof value!=='string'||value.trim().length>1200)throw new Error('复核字段最多 1200 字符');result[key]=value.trim();
   }
   if(!result.note)throw new Error('请填写复核依据与限制');
   if(data.verdict==='major'&&['novelty','scale','mechanism'].some(k=>!result[k]))throw new Error('重大候选需说明新增量、相对量级和公司传导；不确定之处请明确写出');
   if(!['headline-only','source-reviewed'].includes(data.scope))throw new Error('阅读范围无效');
   let sourceUrl='';if(data.sourceUrl){try{const u=new URL(data.sourceUrl);if(u.protocol!=='https:'||u.username||u.password||data.sourceUrl.length>2000)throw Error();sourceUrl=u.href;}catch{throw new Error('复核来源需为 HTTPS 链接');}}
   if(data.scope==='source-reviewed'&&!sourceUrl)throw new Error('阅读全文复核需填写实际阅读的来源');
   db.exec('BEGIN IMMEDIATE');try{
    const latest=reviews(data.sampleId)[0];if((latest?.version||0)!==data.version)throw new Error('初筛复核已更新，请重新打开后保存');
    const at=clock(),payload={...result,sampleId:data.sampleId,newsRevision:sample.input.revision,version:data.version+1,verdict:data.verdict,scope:data.scope,sourceUrl,reviewedAt:at,method:'human-review',blind:false,tradeSignal:false};
    db.prepare('INSERT INTO screening_reviews VALUES(?,?,?,?)').run(data.sampleId,payload.version,JSON.stringify(payload),at);db.exec('COMMIT');return payload;
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  stats(){return {total:db.prepare('SELECT COUNT(*) n FROM screening_samples').get().n,current:db.prepare('SELECT COUNT(*) n FROM screening_samples WHERE rules_hash=?').get(rulesHash).n,
   reviewed:db.prepare('SELECT COUNT(DISTINCT sample_id) n FROM screening_reviews').get().n,
   buckets:db.prepare("SELECT json_extract(payload,'$.triage.bucket') bucket,COUNT(*) count FROM screening_samples WHERE rules_hash=? GROUP BY bucket").all(rulesHash),
   rulesHash,activatedAt,evaluationEligible:false};},
 };
}
