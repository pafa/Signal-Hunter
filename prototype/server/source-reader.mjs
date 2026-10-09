import {collectPublicationDates,publicationDateResult} from './publication-date.mjs';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {publicSourceUrl,isPublicIPv4} from './public-source-url.mjs';
export {publicSourceUrl,isPublicIPv4} from './public-source-url.mjs';
import {prepareArticleExtraction,finishArticleExtraction} from './article-extraction.mjs';
import {articleTableText} from './article-table-text.mjs';
import {JSDOM} from 'jsdom';
import {Readability} from '@mozilla/readability';
import {sourceLinks} from './source-links.mjs';
import {extractPdf} from './pdf-source.mjs';
import {MAX_PDF_BYTES} from '../shared/pdf-source.mjs';

export const READER_VERSION='public-article-9';
export const MAX_SOURCE_BYTES=1_000_000;
function assertArticleHost(url){
 if(['news.google.com','consent.google.com','accounts.google.com'].includes(url.hostname))throw new Error('这是聚合或登录入口，请在阅读来源后粘贴发布方的文章链接');
}
// Resolve once, validate every address, and pin the chosen IP in the TLS request.
// Redirects re-enter this check. No browser cookies, credentials, scripts or subresources.
function transport(url,address,signal){
 return new Promise((resolve,reject)=>{
  const req=https.get(url,{agent:false,signal,headers:{'User-Agent':'SignalHunter/0.11 (personal public-source reader)','Accept':'text/html,application/xhtml+xml,application/pdf','Accept-Encoding':'identity'},lookup:(_host,options,callback)=>options.all?callback(null,[{address,family:4}]):callback(null,address,4)},res=>{
   const status=res.statusCode,headers=res.headers;
   if(status>=300&&status<400||status!==200){res.resume();resolve({status,headers,body:''});return;}
   const pdf=/^application\/pdf(?:;|$)/i.test(headers['content-type']||'');
   if(!pdf&&!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(headers['content-type']||'')){res.resume();reject(new Error('当前支持 HTML 和有文字层的 PDF，其他格式保留读取缺口'));return;}
   if(headers['content-encoding']&&headers['content-encoding']!=='identity'){res.resume();reject(new Error('来源未返回可读取的未压缩页面'));return;}
   const charset=/charset\s*=\s*["']?([^\s;"']+)/i.exec(headers['content-type']||'')?.[1];
   if(!pdf&&charset&&!/^(utf-?8|us-ascii)$/i.test(charset)){res.resume();reject(new Error('来源不是 UTF-8 编码，保留读取缺口以避免乱码'));return;}
   const maximum=pdf?MAX_PDF_BYTES:MAX_SOURCE_BYTES,message=pdf?'PDF超过8 MB，保留读取缺口':'来源页面超过 1 MB，保留读取缺口';
   if(Number(headers['content-length'])>maximum){res.destroy();reject(new Error(message));return;}
   let bytes=0;const chunks=[];
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maximum){res.destroy(new Error(message));return;}chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>{const data=Buffer.concat(chunks);resolve({status,headers,body:pdf?data:data.toString('utf8')});});
  });req.on('error',reject);
 });
}
export function extractArticle(html,url){
 if(Buffer.byteLength(html)>MAX_SOURCE_BYTES)throw new Error('来源页面超过 1 MB');
 assertArticleHost(new URL(url));
 const dom=new JSDOM(html,{url});
 try{
  const dates=collectPublicationDates(dom.window.document,url);
  const preparation=prepareArticleExtraction(dom.window.document,url);
  const article=new Readability(dom.window.document,{maxElemsToParse:18000,charThreshold:200}).parse();
  const body=article?.textContent?.replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  if(!body||body.length<200||/^(?:access denied|just a moment|request blocked|enable javascript|verify you are human)/i.test(article.title||''))throw new Error('未提取到足够正文，可能是访问限制或非文章页面；可手动补充');
  const structuredBody=articleTableText(dom.window.document,article.content);
  if(structuredBody.length>80000)throw new Error('正文超过 8 万字符，请手动补充必要段落');
  const publication=publicationDateResult(dates),extractionEvidence=finishArticleExtraction(dom.window.document,url,preparation,article.content);
  const linkRoot=dom.window.document.createElement('div');linkRoot.innerHTML=article.content;
  return {title:(article.title||new URL(url).hostname).slice(0,200),sourceName:(article.siteName||new URL(url).hostname).slice(0,160),body:structuredBody,...publication,extractionEvidence,sourceLinks:sourceLinks(linkRoot,url),scope:'extracted-text',method:READER_VERSION};
 }finally{dom.window.close();}
}
export async function readPublicArticle(value,{resolver=lookup,request=transport,timeoutMs=20000}={}){
 let url=publicSourceUrl(value);const signal=AbortSignal.timeout(timeoutMs);
 const bounded=promise=>new Promise((resolve,reject)=>{const abort=()=>reject(new Error('公开网页读取超时'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
 for(let redirects=0;redirects<=3;redirects++){
  assertArticleHost(url);
  const addresses=await bounded(resolver(url.hostname,{all:true,family:4}));
  if(!addresses.length||addresses.some(a=>!isPublicIPv4(a.address)))throw new Error('来源解析到非公网地址，未发起读取');
  const response=await bounded(request(url,addresses[0].address,signal));
  if([301,302,303,307,308].includes(response.status)){
   if(redirects===3||!response.headers.location)throw new Error('来源重定向过多或缺少目标');
   url=publicSourceUrl(new URL(response.headers.location,url).href);continue;
  }
  if(response.status!==200)throw new Error(`来源返回 HTTP ${response.status}，未读取正文；可自行阅读后补充材料`);
  const material=/^application\/pdf(?:;|$)/i.test(response.headers['content-type']||'')?await extractPdf(response.body,url.href,{signal}):extractArticle(response.body,url.href);
  return {...material,url:url.href,requestedUrl:publicSourceUrl(value).href};
 }
}
