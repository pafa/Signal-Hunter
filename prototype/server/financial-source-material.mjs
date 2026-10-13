import {createHash} from 'node:crypto';

import {secIssuerNameMatch,secIssuerNameNote} from './sec-issuer-name.mjs';
export const FINANCIAL_CASE_SOURCE_VERSION='sec-companyfacts-selection/3';
export const FINANCIAL_COMPATIBLE_SOURCE_VERSION='sec-companyfacts-selection/2';
export const FINANCIAL_SOURCE_VERSION='sec-companyfacts-selection/1';
export const SEC_TICKERS_URL='https://www.sec.gov/files/company_tickers.json';
export const financialDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const financialFactLine=x=>`${x.taxonomy}:${x.tag}（${x.label}） | ${x.unit} ${x.value} | 期间 ${x.start||'时点'} 至 ${x.end} | 申报日 ${x.filed} | 表单 ${x.form} | 申报编号 ${x.accession} | fy ${x.fiscalYear??'未知'} / fp ${x.fiscalPeriod??'未知'} / frame ${x.frame??'未知'}`;
const tags={
 RevenueFromContractWithCustomerExcludingAssessedTax:'营业收入（不含代收税）',Revenues:'收入',SalesRevenueNet:'净销售收入',NetIncomeLoss:'净利润／亏损',
 CashAndCashEquivalentsAtCarryingValue:'现金及现金等价物',StockholdersEquity:'股东权益',Assets:'资产',Liabilities:'负债',LongTermDebtCurrent:'一年内到期长期债务',LongTermDebtNoncurrent:'非流动长期债务',
 PaymentsForRepurchaseOfCommonStock:'回购普通股支付现金',NetCashProvidedByUsedInOperatingActivities:'经营现金流',PaymentsToAcquirePropertyPlantAndEquipment:'购建固定资产支付现金',EarningsPerShareDiluted:'稀释每股收益',WeightedAverageNumberOfDilutedSharesOutstanding:'稀释加权平均股数',EntityCommonStockSharesOutstanding:'普通股流通股数'
};
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const fail=message=>{throw Error(message);};
export function secIssuer(symbol,bytes){
 if(typeof symbol!=='string'||!/^[-A-Z0-9.]+\.US$/.test(symbol))fail('财务来源目前仅覆盖明确的美国上市证券');
 const json=JSON.parse(Buffer.from(bytes).toString('utf8'));
 if(!json||Array.isArray(json)||typeof json!=='object')fail('SEC证券映射格式无效');
 const rows=Object.values(json).filter(r=>r?.ticker===symbol.slice(0,-3));
 if(rows.length!==1||!Number.isSafeInteger(rows[0].cik_str)||rows[0].cik_str<1||rows[0].cik_str>9999999999||typeof rows[0].title!=='string'||!rows[0].title.trim()||rows[0].title.length>160)fail('SEC证券映射缺失或不唯一；不按名称猜测发行人');
 return {symbol,ticker:rows[0].ticker,cik:String(rows[0].cik_str).padStart(10,'0'),name:rows[0].title};
}
export const secFactsUrl=cik=>/^\d{10}$/.test(cik)?`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`:fail('CIK无效');
export function financialMaterial(symbol,documents){
 if(!Array.isArray(documents)||documents.length!==2)fail('财务来源须保留证券映射及完整财务响应');
 const [map,facts]=documents;
 for(const doc of documents)if(!Buffer.isBuffer(doc.body)||!doc.body.length||doc.body.length>12*1024*1024||!instant(doc.receivedAt))fail('财务来源原始响应或获取时间无效');
 if(map.url!==SEC_TICKERS_URL)fail('财务证券映射来源不符');
 const issuer=secIssuer(symbol,map.body);
 if(facts.url!==secFactsUrl(issuer.cik))fail('财务响应与发行人不符');
 const raw=JSON.parse(facts.body.toString('utf8'));
 if(String(raw.cik).padStart(10,'0')!==issuer.cik||!raw.facts||typeof raw.facts!=='object')fail('SEC发行人身份不一致；保留缺口而不混用财务');
 const issuerName=secIssuerNameMatch(issuer.name,raw.entityName);
 const asOf=facts.receivedAt.slice(0,10),cutoff=new Date(Date.parse(asOf)-730*86400000).toISOString().slice(0,10),selected=[],coverage=[];
 for(const [tag,label] of Object.entries(tags)){
  const taxonomy=tag==='EntityCommonStockSharesOutstanding'?'dei':'us-gaap',units=raw.facts[taxonomy]?.[tag]?.units||{};
  for(const [unit,items] of Object.entries(units)){
   if(!Array.isArray(items)||unit.length>40||!/^[A-Za-z][A-Za-z0-9/.-]*$/.test(unit))fail('财务单位或事实数组无效');
   const eligible=items.filter(x=>x&&Number.isFinite(x.val)&&(!Number.isInteger(x.val)||Number.isSafeInteger(x.val))&&day(x.end)&&x.end>=cutoff&&x.end<=asOf&&day(x.filed)&&x.filed<=asOf&&x.filed>=x.end&&(!x.start||day(x.start)&&x.start<=x.end)&&/^(10-K|10-Q|20-F|40-F|6-K|8-K)(\/A)?$/.test(x.form)&&/^\d{10}-\d{2}-\d{6}$/.test(x.accn));
   const groups=new Map();for(const x of eligible){const key=JSON.stringify([x.start||null,x.end]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);}
   const periods=[...groups.values()].sort((a,b)=>b[0].end.localeCompare(a[0].end)||(b[0].start||'').localeCompare(a[0].start||'')).slice(0,8);
   const before=selected.length;
   for(const group of periods){const latest=group.reduce((s,x)=>x.filed>s?x.filed:s,'');const unique=new Map();for(const x of group.filter(x=>x.filed===latest)){
    const fact={taxonomy,tag,label,unit,value:x.val,start:x.start||null,end:x.end,filed:x.filed,form:x.form,accession:x.accn,fiscalYear:Number.isSafeInteger(x.fy)?x.fy:null,fiscalPeriod:typeof x.fp==='string'&&x.fp.length<=10?x.fp:null,frame:typeof x.frame==='string'&&x.frame.length<=40?x.frame:null};unique.set(JSON.stringify(fact),fact);
   }selected.push(...[...unique.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));}
   coverage.push({taxonomy,tag,unit,returned:items.length,eligible:eligible.length,periods:groups.size,selected:selected.length-before});
  }
 }
 if(!selected.length)fail('SEC响应没有当前选择范围内的财务事实');
 const sources=documents.map(d=>({url:d.url,receivedAt:d.receivedAt,sha256:financialDigest(d.body),bytes:d.body.length}));
 const financialSource={schema:issuerName?.schema==='sec-issuer-name/2'?FINANCIAL_CASE_SOURCE_VERSION:issuerName?FINANCIAL_COMPATIBLE_SOURCE_VERSION:FINANCIAL_SOURCE_VERSION,issuer,...(issuerName?{issuerName}:{}),sources,selection:{asOf,cutoff,maximumPeriodsPerTagUnit:8,latestFiledPerPeriod:true,sameDayConflictsRetained:true},coverage,selected};
 const lines=[`SEC公司财务数据选摘：${issuer.name}；证券 ${symbol}；CIK ${issuer.cik}。`,
  ...(issuerName?[secIssuerNameNote(issuerName)]:[]),
  `原始财务响应实际获取 ${facts.receivedAt}；证券映射实际获取 ${map.receivedAt}。`,
  '这是结构化披露数据的程序选摘，不是完整财报正文或独立核验。当前证券映射不证明历史上市身份；发行人自报财务不证明本事件影响、市场预期或目标价。',
  `选择范围：期间结束日在 ${cutoff} 至 ${asOf}，指定标签及单位各最多8个最近期间；每期间保留最新申报日，同日冲突不取平均。未选项目不等于零。`,
  '申报日不是系统首次获取日；期间按实际起止列出，不能把累计期间直接当季度、按披露年度标签拼TTM，或将不同币种／标签混加。自定义标签、分部、附注与未来预期未包含。',
  ...selected.map(financialFactLine)];
 const body=lines.join('\n');if(body.length>80000)fail('财务选摘超过材料范围上限，未静默截断');
 return {title:`${issuer.name} · SEC财务披露选摘`,sourceName:'SEC EDGAR · 发行人申报',url:facts.url,scope:'excerpt',publishedAt:null,body,financialSource};
}
export function validateFinancialSource(value,url,body,at){
 if(![FINANCIAL_SOURCE_VERSION,FINANCIAL_COMPATIBLE_SOURCE_VERSION,FINANCIAL_CASE_SOURCE_VERSION].includes(value?.schema)||!Array.isArray(value.sources)||value.sources.length!==2||value.sources.some(s=>!instant(s.receivedAt)||Date.parse(s.receivedAt)>Date.parse(at)||!/^([a-f0-9]{64})$/.test(s.sha256)||!Number.isSafeInteger(s.bytes)||s.bytes<1||s.bytes>12*1024*1024)||value.sources[0].url!==SEC_TICKERS_URL||value.sources[1].url!==url||url!==secFactsUrl(value.issuer?.cik)||!Array.isArray(value.selected)||!value.selected.length||!body.startsWith('SEC公司财务数据选摘：'))fail('财务来源记录无效');
 return structuredClone(value);
}
export function verifyFinancialDocuments(material,read){
 const documents=material.financialSource.sources.map(s=>{const bytes=read(s.sha256);if(!bytes||bytes.length!==s.bytes||financialDigest(bytes)!==s.sha256)fail('财务原始响应校验失败');return {url:s.url,receivedAt:s.receivedAt,body:Buffer.from(bytes)};});
 const expected=financialMaterial(material.financialSource.issuer.symbol,documents);
 for(const key of Object.keys(expected))if(JSON.stringify(expected[key])!==JSON.stringify(material[key]))fail('财务选摘与原始响应不符');
 return documents;
}
