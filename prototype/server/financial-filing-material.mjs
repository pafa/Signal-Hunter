import {JSDOM} from 'jsdom';
import {articleTableText} from './article-table-text.mjs';
import {secIssuer,SEC_TICKERS_URL,financialDigest} from './financial-source-material.mjs';

import {secIssuerNameMatch,secIssuerNameNote} from './sec-issuer-name.mjs';
export const FINANCIAL_CASE_FILING_VERSION='sec-filing-excerpts/5';
export const FINANCIAL_CASE_EXHIBIT_VERSION='sec-filing-exhibits/5';
export const FINANCIAL_COMPATIBLE_FILING_VERSION='sec-filing-excerpts/4';
export const FINANCIAL_COMPATIBLE_EXHIBIT_VERSION='sec-filing-exhibits/4';
export const FINANCIAL_FILING_VERSION='sec-filing-excerpts/3';
export const FINANCIAL_EXHIBIT_VERSION='sec-filing-exhibits/3';
const filingVersions=['sec-filing-excerpts/1','sec-filing-excerpts/2',FINANCIAL_FILING_VERSION,FINANCIAL_COMPATIBLE_FILING_VERSION,FINANCIAL_CASE_FILING_VERSION];
const exhibitVersions=['sec-filing-exhibits/1','sec-filing-exhibits/2',FINANCIAL_EXHIBIT_VERSION,FINANCIAL_COMPATIBLE_EXHIBIT_VERSION,FINANCIAL_CASE_EXHIBIT_VERSION];
export const MAXIMUM_FILING_EXHIBITS=4;
const parsed=new Map();
const exhibitPlans=new Map();
const fail=message=>{throw Error(message);};
const generationVersion=(versions,generation,compatible)=>{
 if(![1,2].includes(generation))fail('申报读取代次无效');
 if(compatible?.schema==='sec-issuer-name/2'){if(generation!==2)fail('旧申报代次不支持大小写核对');return versions[4];}
 return versions[(generation-1)*2+Number(!!compatible)];
};
const instant=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export const secSubmissionsUrl=cik=>/^\d{10}$/.test(cik)?`https://data.sec.gov/submissions/CIK${cik}.json`:fail('申报目录CIK无效');
const primaryUrl=(cik,accession,name)=>{
 if(!/^\d{10}-\d{2}-\d{6}$/.test(accession)||typeof name!=='string'||name.length>180||!/^[-A-Za-z0-9_]+(?:\.[-A-Za-z0-9_]+)*\.html?$/.test(name))fail('申报原件路径无效');
 return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll('-','')}/${name}`;
};

// The accession prefix can belong to a filing agent. The directory CIK comes
// from the exact issuer, and the filename only from that issuer's archived API.
export function filingPlan(issuer,document){
 if(document.url!==secSubmissionsUrl(issuer.cik)||!instant(document.receivedAt)||!Buffer.isBuffer(document.body))fail('申报目录来源无效');
 const raw=JSON.parse(document.body.toString('utf8')),r=raw.filings?.recent;
 if(String(raw.cik).padStart(10,'0')!==issuer.cik||!Array.isArray(raw.tickers)||!raw.tickers.includes(issuer.ticker))fail('申报目录发行人身份不一致');
 const issuerName=secIssuerNameMatch(issuer.name,raw.name);
 const fields=['accessionNumber','filingDate','reportDate','form','primaryDocument'];
 if(!r||!Array.isArray(r.accessionNumber)||r.accessionNumber.length>10000||fields.some(k=>!Array.isArray(r[k])||r[k].length!==r.accessionNumber.length))fail('申报目录列长度或范围无效');
 const asOf=document.receivedAt.slice(0,10),cutoff=new Date(Date.parse(asOf)-730*86400000).toISOString().slice(0,10),seen=new Set(),eligible=[];
 for(let i=0;i<r.accessionNumber.length;i++){
  const accession=r.accessionNumber[i];if(typeof accession!=='string'||seen.has(accession))fail('申报目录编号缺失或重复');seen.add(accession);
  if(!/^(10-Q|10-K|20-F|40-F|8-K|6-K)(\/A)?$/.test(r.form[i]))continue;
  if(!day(r.filingDate[i])||r.reportDate[i]&&!day(r.reportDate[i]))fail('申报目录日期无效');
  if(r.filingDate[i]>asOf||r.filingDate[i]<cutoff||r.reportDate[i]&&r.reportDate[i]>r.filingDate[i])continue;
  eligible.push({accession,form:r.form[i],filingDate:r.filingDate[i],reportDate:r.reportDate[i]||null,primaryDocument:r.primaryDocument[i],url:primaryUrl(issuer.cik,accession,r.primaryDocument[i])});
 }
 eligible.sort((a,b)=>b.filingDate.localeCompare(a.filingDate)||b.accession.localeCompare(a.accession));
 const periodic=eligible.find(f=>/^(10-Q|10-K|20-F|40-F)/.test(f.form)),current=eligible.find(f=>/^(8-K|6-K)/.test(f.form)&&(!periodic||f.filingDate>=periodic.filingDate));
 return {issuer,...(issuerName?{issuerName}:{}),selection:{asOf,cutoff,scope:'recent-columnar-array-only',returned:r.accessionNumber.length,eligible:eligible.length,maximumDocuments:2,olderIndexFilesRead:false,exhibitsRead:false},filings:[periodic,current].filter(Boolean)};
}

const cues=[/repurchas|buyback/i,/cash flow|cash equivalents|liquidity/i,/earnings per share|net income|dilut/i,/stock.based|share.based|common stock/i,/U\.S\. dollars|United States dollars|in millions|in thousands/i,/forward.looking|risk factors/i];
function excerpt(html,url,generation){
 const dom=new JSDOM(html,{url});
 try{
  const d=dom.window.document;if(d.querySelectorAll('*').length>100000)fail('申报原件元素超过读取上限');
  if(/access denied|request rate threshold|undeclared automated tool|verify you are human/i.test(d.title))fail('申报原件返回访问限制页面');
  for(const e of [...d.querySelectorAll('*')])if(['script','style','noscript','template','ix:header','ix:hidden'].includes(e.localName)||e.hasAttribute('hidden')||/display\s*:\s*none/i.test(e.getAttribute('style')||''))e.remove();
  // Repeated document method lookups scan named elements in jsdom. Only text
  // nodes are inserted below, so bind this unchanged method once per document.
  let createTextNode;
  for(const e of d.body.querySelectorAll('div,p,h1,h2,h3,h4,h5,h6,li,br')){createTextNode??=d.createTextNode.bind(d);e.before(createTextNode('\n'));e.after(createTextNode('\n'));}
  // SEC filings have more cells than a news article. Keep the old budget for
  // historical replay; all other table geometry and output bounds stay fixed.
  const text=articleTableText(d,d.body.innerHTML,{maximumTables:500,maximumCells:generation===1?10000:20000});
  if(text.length<200||text.length>1500000)fail('申报原件可读文字不足或超过读取上限');
  const blocks=[];let at=0;
  while(at<text.length){
   if(text[at]==='\n'){at++;continue;}
   const table=/^\[HTML table (\d+);/.exec(text.slice(at)),end=table?text.indexOf(`\n[/HTML table ${table[1]}]`,at):text.indexOf('\n',at);
   if(table&&end<0)fail('申报表格边界无效');
   const stop=table?end+`\n[/HTML table ${table[1]}]`.length:end<0?text.length:end;
   blocks.push({start:at,end:stop,text:text.slice(at,stop),table:!!table});at=stop;
  }
  const maximumCharacters=18000,picked=new Set();let retained=0;
  const add=i=>{const b=blocks[i];if(!b||picked.has(i)||retained+b.text.length>maximumCharacters)return false;picked.add(i);retained+=b.text.length;return true;};
  if(text.length<=maximumCharacters){for(let i=0;i<blocks.length;i++)add(i);}else{
   for(let i=0;i<blocks.length;i++){if(retained+blocks[i].text.length>1500)break;add(i);}
   for(const cue of cues){const ranked=blocks.map((b,i)=>({b,i})).filter(x=>cue.test(x.b.text)).sort((a,b)=>Number(b.b.table)-Number(a.b.table)||a.i-b.i);for(const {i} of ranked)if(add(i)){add(i-1);add(i+1);break;}}
   const ranked=blocks.map((b,i)=>({b,i,score:cues.filter(c=>c.test(b.text)).length})).filter(x=>x.score).sort((a,b)=>b.score-a.score||a.i-b.i);
   for(const {i} of ranked){add(i);add(i-1);add(i+1);}
  }
  const ranges=[...picked].sort((a,b)=>a-b).map(i=>({start:blocks[i].start,end:blocks[i].end}));
  return {fullTextHash:financialDigest(Buffer.from(text)),fullTextCharacters:text.length,retainedCharacters:retained,maximumCharacters,ranges,omittedBlocks:blocks.length-picked.size,blocks:blocks.length,body:ranges.map(r=>`[选段 ${r.start}:${r.end}，提取文字UTF-16位置]\n${text.slice(r.start,r.end)}`).join('\n\n')};
 }finally{dom.window.close();}
}

export function financialFilingMaterial(symbol,documents,accession,{generation=2}={}){
 generationVersion(filingVersions,generation,false);
 if(!Array.isArray(documents)||documents.length!==3)fail('申报原件须保留映射、目录和HTML原件');
 for(const d of documents)if(!Buffer.isBuffer(d.body)||!d.body.length||d.body.length>12*1024*1024||!instant(d.receivedAt))fail('申报原件响应或时间无效');
 const sources=documents.map(d=>({url:d.url,receivedAt:d.receivedAt,sha256:financialDigest(d.body),bytes:d.body.length}));
 const key=JSON.stringify({schema:FINANCIAL_FILING_VERSION,generation,symbol,accession,sources});
 if(parsed.has(key))return structuredClone(parsed.get(key));
 const [map,index,document]=documents;if(map.url!==SEC_TICKERS_URL)fail('申报证券映射来源无效');
 const issuer=secIssuer(symbol,map.body),plan=filingPlan(issuer,index),filing=plan.filings.find(f=>f.accession===accession);
 if(!filing||document.url!==filing.url||document.body.length>8*1024*1024)fail('申报原件不属于选定目录或超过8MB');
 const html=new TextDecoder('utf-8',{fatal:true}).decode(document.body);if(!/<(?:html|body|!doctype)\b/i.test(html))fail('申报原件不是HTML');
 const extracted=excerpt(html,filing.url,generation);
 const {body:selectionText,...selection}=extracted;
 const body=[`SEC申报原文选段：${issuer.name}；证券 ${symbol}；CIK ${issuer.cik}。`,...(plan.issuerName?[secIssuerNameNote(plan.issuerName)]:[]),`表单 ${filing.form}；申报编号 ${filing.accession}；目录申报日 ${filing.filingDate}；报告期 ${filing.reportDate||'未知'}；原件实际获取 ${document.receivedAt}。`,'以下是程序按固定财务词项选取的原文和完整表格块，不是全文、附件或独立审计。未选内容仍未分析；申报日期不能替代首次获取时间。表格r/c坐标由提取器添加，金额单位、期间、预测性质必须回看表头及正文，不能补零或跨口径运算。',`提取文字 ${selection.fullTextCharacters} 字符；保留 ${selection.retainedCharacters} 字符，${selection.ranges.length}/${selection.blocks} 块；未选 ${selection.omittedBlocks} 块。`,selectionText].join('\n');
 const material={title:`${issuer.name} · ${filing.form} 原文选段 · ${filing.filingDate}`,sourceName:'SEC EDGAR · 发行人申报原件',url:filing.url,scope:'excerpt',publishedAt:null,body,filingSource:{schema:generationVersion(filingVersions,generation,plan.issuerName),issuer,...(plan.issuerName?{issuerName:plan.issuerName}:{}),filing,sources,selection,coverage:plan.selection}};
 parsed.set(key,structuredClone(material));if(parsed.size>8)parsed.delete(parsed.keys().next().value);return material;
}

// A primary filing authorizes only its visible, same-accession HTML links.
// No guessed filenames, cross-filing references, recursive crawl or redirects.
export function filingExhibitPlan(symbol,documents,accession,options={}){
 const primary=financialFilingMaterial(symbol,documents,accession,options),{issuer,filing}=primary.filingSource;
 const key=JSON.stringify({symbol,accession,schema:primary.filingSource.schema,sources:primary.filingSource.sources});
 if(exhibitPlans.has(key))return structuredClone(exhibitPlans.get(key));
 const dom=new JSDOM(new TextDecoder('utf-8',{fatal:true}).decode(documents[2].body),{url:filing.url});
 try{
  const d=dom.window.document;
  for(const e of [...d.querySelectorAll('*')])if(['script','style','noscript','template','ix:header','ix:hidden'].includes(e.localName)||e.hasAttribute('hidden')||/display\s*:\s*none/i.test(e.getAttribute('style')||''))e.remove();
  const links=[...d.querySelectorAll('a[href]')],unique=new Map();let excluded=0;
  if(links.length>10000)fail('申报附件链接超过读取上限');
  for(const a of links){
   const href=a.getAttribute('href'),label=a.textContent.replace(/\s+/g,' ').trim();
   if(!href||href.startsWith('#'))continue;
   let url;try{url=new URL(href,filing.url);}catch{excluded++;continue;}
   const path=/^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/([-A-Za-z0-9_]+(?:\.[-A-Za-z0-9_]+)*\.html?)$/.exec(url.pathname);
   if(href.length>2000||url.origin!=='https://www.sec.gov'||url.username||url.password||url.search||!path||path[3].length>180||String(Number(path[1]))!==String(Number(issuer.cik))||path[2]!==accession.replaceAll('-','')||!label||label.length>500){excluded++;continue;}
   url.hash='';url.pathname=`/Archives/edgar/data/${Number(issuer.cik)}/${path[2]}/${path[3]}`;
   if(url.href===filing.url)continue;
   if(!unique.has(url.href))unique.set(url.href,{url:url.href,label});
  }
  const all=[...unique.values()];
  const plan={issuer,...(primary.filingSource.issuerName?{issuerName:primary.filingSource.issuerName}:{}),filing,selection:{scope:'visible-same-accession-html-links-only',eligible:all.length,selected:Math.min(all.length,MAXIMUM_FILING_EXHIBITS),omitted:Math.max(0,all.length-MAXIMUM_FILING_EXHIBITS),excludedLinks:excluded,maximumDocuments:MAXIMUM_FILING_EXHIBITS,recursive:false},exhibits:all.slice(0,MAXIMUM_FILING_EXHIBITS)};
  exhibitPlans.set(key,structuredClone(plan));if(exhibitPlans.size>8)exhibitPlans.delete(exhibitPlans.keys().next().value);return plan;
 }finally{dom.window.close();}
}

export function financialExhibitMaterial(symbol,documents,accession,{generation=2}={}){
 generationVersion(exhibitVersions,generation,false);
 if(!Array.isArray(documents)||documents.length!==4)fail('申报附件须保留映射、目录、主申报和附件原件');
 const parent=documents.slice(0,3),document=documents[3],plan=filingExhibitPlan(symbol,parent,accession,{generation});
 const exhibit=plan.exhibits.find(x=>x.url===document.url);
 if(!exhibit||!Buffer.isBuffer(document.body)||!document.body.length||document.body.length>8*1024*1024||!instant(document.receivedAt))fail('附件不属于主申报明确链接的选择范围或原件无效');
 const html=new TextDecoder('utf-8',{fatal:true}).decode(document.body);if(!/<(?:html|body|!doctype)\b/i.test(html))fail('申报附件不是HTML');
 const sources=documents.map(d=>({url:d.url,receivedAt:d.receivedAt,sha256:financialDigest(d.body),bytes:d.body.length}));
 const key=JSON.stringify({schema:FINANCIAL_EXHIBIT_VERSION,generation,symbol,accession,sources});if(parsed.has(key))return structuredClone(parsed.get(key));
 const {body:selectionText,...selection}=excerpt(html,document.url,generation);
 const body=[`SEC申报附件原文选段：${plan.issuer.name}；证券 ${symbol}；CIK ${plan.issuer.cik}。`,
  ...(plan.issuerName?[secIssuerNameNote(plan.issuerName)]:[]),
  `主申报 ${plan.filing.form}；申报编号 ${accession}；目录申报日 ${plan.filing.filingDate}；附件实际获取 ${document.receivedAt}。`,
  `主申报链接文字：${exhibit.label}；主申报原件：${plan.filing.url}。`,
  '仅沿主申报可见的同一申报目录HTML链接读取，不证明附件内容与当前新闻事件一致、法律效力或事实已独立核实。附件发布日期未知；主申报日期不替代附件发布日期或首次获取时间。不递归读取附件内链接。',
  `程序选段保留 ${selection.retainedCharacters} / ${selection.fullTextCharacters} 字符，${selection.ranges.length}/${selection.blocks} 块；未选 ${selection.omittedBlocks} 块。未选内容仍未分析，金额单位及期间须核对表头和正文。`,selectionText].join('\n').trimEnd();
 const material={title:`${plan.issuer.name} · ${plan.filing.form} 附件选段 · ${document.url.split('/').at(-1)}`.slice(0,200),sourceName:'SEC EDGAR · 发行人申报附件',url:document.url,scope:'excerpt',publishedAt:null,body,
  filingSource:{schema:generationVersion(exhibitVersions,generation,plan.issuerName),issuer:plan.issuer,...(plan.issuerName?{issuerName:plan.issuerName}:{}),filing:plan.filing,exhibit,sources,selection,coverage:plan.selection}};
 parsed.set(key,structuredClone(material));if(parsed.size>8)parsed.delete(parsed.keys().next().value);return material;
}

export function validateFilingSource(value,url,body,at){
 const exhibit=exhibitVersions.includes(value?.schema),count=exhibit?4:3;
 if(![...filingVersions,...exhibitVersions].includes(value?.schema)||!Array.isArray(value.sources)||value.sources.length!==count||value.sources.some(s=>!instant(s.receivedAt)||Date.parse(s.receivedAt)>Date.parse(at)||!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.bytes)||s.bytes<1||s.bytes>12*1024*1024)||value.sources[0].url!==SEC_TICKERS_URL||value.sources[1].url!==secSubmissionsUrl(value.issuer?.cik)||value.sources[count-1].url!==url||value.filing?.url!==value.sources[2].url||exhibit&&value.exhibit?.url!==url||!body.startsWith(exhibit?'SEC申报附件原文选段：':'SEC申报原文选段：'))fail('申报原文选段记录无效');
 return structuredClone(value);
}
export function verifyFilingDocuments(material,read){
 const documents=material.filingSource.sources.map(s=>{const bytes=read(s.sha256);if(!bytes||bytes.length!==s.bytes||financialDigest(bytes)!==s.sha256)fail('申报原始响应校验失败');return {url:s.url,receivedAt:s.receivedAt,body:Buffer.from(bytes)};});
 const exhibit=exhibitVersions.includes(material.filingSource.schema),versions=exhibit?exhibitVersions:filingVersions,index=versions.indexOf(material.filingSource.schema);
 if(index<0)fail('申报读取版本无效');
 const reader=exhibit?financialExhibitMaterial:financialFilingMaterial;
 const expected=reader(material.filingSource.issuer.symbol,documents,material.filingSource.filing.accession,{generation:index<2?1:2});
 for(const key of Object.keys(expected))if(JSON.stringify(expected[key])!==JSON.stringify(material[key]))fail('申报选段与原始响应不符');
 return documents;
}
