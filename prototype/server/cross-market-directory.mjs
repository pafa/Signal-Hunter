import {directorySheet} from './directory-xlsx.mjs';
export const CROSS_PARSER='cross-market-security-directory-1';
const hkUrl=lang=>`https://www.hkex.com.hk/${lang==='en'?'eng':'chi'}/services/trading/securities/securitieslists/ListOfSecurities${lang==='en'?'':'_c'}.xlsx`;
const szReferer='https://www.szse.cn/market/product/stock/list/';
export const CROSS_SOURCES={HK:['en','cn'].map(lang=>({id:'hk-'+lang,url:hkUrl(lang),format:'xlsx'})),CN:[...['1','8'].map(t=>sseSource(t,1)),{id:'szse-meta',url:'https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&PAGENO=1',referer:szReferer},{id:'szse',url:'https://www.szse.cn/api/report/ShowReport?SHOWTYPE=xlsx&CATALOGID=1110&TABKEY=tab1',format:'xlsx',referer:szReferer}]};
export function sseSource(type,page){return {id:`sse-${type}-p${page}`,url:'https://query.sse.com.cn/sseQuery/commonQuery.do?'+new URLSearchParams({sqlId:'COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L',COMPANY_STATUS:'2,4,5,7,8',type:'inParams',isPagination:'true','pageHelp.cacheSize':'1','pageHelp.beginPage':String(page),'pageHelp.pageSize':'2000','pageHelp.pageNo':String(page),STOCK_TYPE:type}),referer:'https://www.sse.com.cn/assortment/stock/list/share/'};}
const fail=()=>{throw Error('跨市场证券目录字段、日期或完整性不匹配');};
const value=(s,max=500)=>typeof s==='string'&&s.trim()&&s.length<=max;
export function directoryDate(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||!Number.isFinite(Date.parse(v))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail();return v;}
const json=source=>{try{return JSON.parse(source.raw);}catch{fail();}};
const xlsx=(source,signal)=>directorySheet(Buffer.from(source.raw,'base64'),signal);
const missingDate={sourceDate:null,fileCreationTime:null,timezone:'unverified'};
function hkFile(sheet,lang){
 const rows=sheet.rows;if(rows.length<4||rows[0].cells.A!==(lang==='en'?'List of Securities':'證券名單'))fail();
 const match=(lang==='en'?/^Updated as at (\d{2})\/(\d{2})\/(\d{4})$/:/^截\s*至\s*(\d{2})\/(\d{2})\/(\d{4})$/).exec(rows[1].cells.A||'');if(!match)fail();
 const date=directoryDate(`${match[3]}-${match[2]}-${match[1]}`),head=rows[2].cells,expected=lang==='en'?{A:'Stock Code',B:'Name of Securities',C:'Category',D:'Sub-Category',E:'Board Lot',F:'ISIN',Q:'Trading Currency',R:'RMB Counter'}:{A:'股份代號',B:'股份名稱',C:'分類',D:'次分類',E:'買賣單位',F:'國際證券號碼 (ISIN)',Q:'交易貨幣',R:'RMB櫃台'};
 if(Object.entries(expected).some(([k,v])=>head[k]!==v))fail();const seen=new Set(),items=[];
 for(const {cells:r} of rows.slice(3)){if(!/^\d{5}$/.test(r.A||'')||!value(r.B)||!value(r.C)||(r.D!==undefined&&r.D.length>500)||seen.has(r.A))fail();seen.add(r.A);items.push(r);}
 return {date,items};
}
export async function loadHongKong(read,signal){
 const sources=[];for(const source of CROSS_SOURCES.HK)sources.push(await read(source,signal));
 const en=hkFile(await xlsx(sources[0],signal),'en'),cn=hkFile(await xlsx(sources[1],signal),'cn');if(en.date!==cn.date||en.items.length!==cn.items.length)fail();
 const chinese=new Map(cn.items.map(r=>[r.A,r])),entries=en.items.map(r=>{const c=chinese.get(r.A);if(!c||['E','F','Q','R'].some(k=>(r[k]||'')!==(c[k]||'')))fail();
  const equity=r.C==='Equity'&&['Equity Securities (Main Board)','Equity Securities (GEM)','Depositary Receipts'].includes(r.D),chineseEquity=c.C==='股本'&&['股本證券(主板)','股本證券(創業板)','預託證券'].includes(c.D);if(equity!==chineseEquity)fail();
  const currency={HKD:'HKD',RMB:'CNY',USD:'USD'}[r.Q]||null,roundLot=Number((r.E||'').replaceAll(',',''));
  const excluded=[...(!equity?['non-company-equity']:[]),...(currency!=='HKD'?['unsupported-trading-currency']:[]),...(!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(r.F||'')?['isin-unconfirmed']:[]),...(!Number.isSafeInteger(roundLot)||roundLot<=0?['lot-unconfirmed']:[])];
  return {sourceId:'hk-en',sourceSymbol:r.A,symbol:r.A+'.HK',name:c.B,aliases:[r.B,c.B],venue:'XHKG',exchange:'HKEX',currency,isin:r.F||null,roundLot:Number.isSafeInteger(roundLot)?roundLot:null,securityType:equity?'equity-candidate':'unconfirmed',testIssue:false,financialStatus:null,listingDate:null,dualCounter:r.R||null,rawFields:{en:r,zh:c},eligible:!excluded.length,excluded};
 });
 return {sources:sources.map(s=>({...s,sourceDate:en.date,fileCreationTime:null,timezone:'unverified'})),entries};
}
export function parseShanghai(source,type,page){
 const v=json(source),p=v.pageHelp,rows=v.result;if(!p||!Array.isArray(rows)||p.pageNo!==page||!Number.isInteger(p.pageSize)||p.pageSize<1||p.pageSize>2000||!Number.isInteger(p.total)||p.total<1||p.total>20000||p.pageCount!==Math.ceil(p.total/p.pageSize)||p.pageCount>10||rows.length!==Math.min(p.pageSize,p.total-(page-1)*p.pageSize)||JSON.stringify(rows)!==JSON.stringify(p.data))fail();
 const entries=rows.map(r=>{if(r.STOCK_TYPE!==type||!/^\d{6}$/.test(r.A_STOCK_CODE||'')||!value(r.SEC_NAME_CN)||!value(r.FULL_NAME))fail();const listingDate=directoryDate((r.LIST_DATE||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')),excluded=r.DELIST_DATE&&r.DELIST_DATE!=='-'?['reported-delisting']:[];
  return {sourceId:source.id,sourceSymbol:r.A_STOCK_CODE,symbol:r.A_STOCK_CODE+'.SH',name:r.SEC_NAME_CN,aliases:[r.SEC_NAME_FULL,r.COMPANY_ABBR,r.COMPANY_ABBR_EN,r.FULL_NAME,r.FULL_NAME_IN_ENGLISH].filter(s=>value(s)),venue:'XSHG',exchange:'SSE',currency:'CNY',listingDate,delistingDate:r.DELIST_DATE||null,securityType:'equity-candidate',testIssue:false,financialStatus:null,roundLot:null,rawFields:r,eligible:!excluded.length,excluded};
 });return {entries,total:p.total,pages:p.pageCount,pageSize:p.pageSize};
}
export function parseShenzhen(sheet,source,metadata){
 const meta=json(metadata);if(!Array.isArray(meta))fail();const tab=meta.find(x=>x.metadata?.tabkey==='tab1'),m=tab?.metadata;if(!m||m.catalogid!=='1110'||m.name!=='A股列表'||!Number.isInteger(m.recordcount)||m.recordcount<1||m.recordcount>20000||!Array.isArray(tab.data))fail();
 const date=directoryDate(m.subname?.trim()),rows=sheet.rows,head=rows[0]?.cells;if(sheet.name!=='A股列表'||!head||head.B!=='公司全称'||head.C!=='英文名称'||head.E!=='A股代码'||head.F!=='A股简称'||head.G!=='A股上市日期'||rows.length-1!==m.recordcount)fail();
 const entries=rows.slice(1).map(({cells:r})=>{if(!/^\d{6}$/.test(r.E||'')||!value(r.F)||!value(r.B)||!['主板','创业板'].includes(r.A))fail();return {sourceId:source.id,sourceSymbol:r.E,symbol:r.E+'.SZ',name:r.F,aliases:[r.B,r.C].filter(s=>value(s)),venue:'XSHE',exchange:'SZSE',currency:'CNY',listingDate:directoryDate(r.G),securityType:'equity-candidate',testIssue:false,financialStatus:null,roundLot:null,rawFields:r,eligible:true,excluded:[]};});
 const byCode=new Map(entries.map(e=>[e.sourceSymbol,e]));for(const r of tab.data){const e=byCode.get(r.agdm);if(!e||e.listingDate!==r.agssrq)fail();}
 return {entries,date};
}
export async function loadMainland(read,signal){
 const sources=[],entries=[];
 for(const type of ['1','8']){let total,pages,pageSize;for(let page=1;page===1||page<=pages;page++){const s=await read(sseSource(type,page),signal),p=parseShanghai(s,type,page);if(page>1&&(p.total!==total||p.pages!==pages||p.pageSize!==pageSize))fail();({total,pages,pageSize}=p);sources.push({...s,...missingDate});entries.push(...p.entries);}}
 const metadata=await read(CROSS_SOURCES.CN[2],signal),source=await read(CROSS_SOURCES.CN[3],signal),parsed=parseShenzhen(await xlsx(source,signal),source,metadata);
 sources.push(...[metadata,source].map(s=>({...s,sourceDate:parsed.date,fileCreationTime:null,timezone:'unverified'})));entries.push(...parsed.entries);return {sources,entries};
}
