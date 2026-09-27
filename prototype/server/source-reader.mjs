import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {JSDOM} from 'jsdom';
import {Readability} from '@mozilla/readability';

export const READER_VERSION='public-article-1';
export const MAX_SOURCE_BYTES=1_000_000;
export function publicSourceUrl(value){
 let url;try{url=new URL(value);}catch{throw new Error('请输入公开网页的 HTTPS 链接');}
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||isIP(url.hostname)||url.hostname.includes(':')||!url.hostname.includes('.')||/(?:^|\.)(?:localhost|local|internal|home|test|invalid|example)$/.test(url.hostname))throw new Error('仅支持无凭据的公开 HTTPS 域名');
 url.hash='';return url;
}
export function isPublicIPv4(address){
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
// Resolve once, validate every address, and pin the chosen IP in the TLS request.
// Redirects re-enter this check. No browser cookies, credentials, scripts or subresources.
function transport(url,address,signal){
 return new Promise((resolve,reject)=>{
  const req=https.get(url,{agent:false,signal,headers:{'User-Agent':'SignalHunter/0.10 (personal public-source reader)','Accept':'text/html,application/xhtml+xml','Accept-Encoding':'identity'},lookup:(_host,options,callback)=>options.all?callback(null,[{address,family:4}]):callback(null,address,4)},res=>{
   const status=res.statusCode,headers=res.headers;
   if(status>=300&&status<400||status!==200){res.resume();resolve({status,headers,body:''});return;}
   if(!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(headers['content-type']||'')){res.resume();reject(new Error('当前仅支持 HTML 正文；PDF 等材料可阅读后粘贴摘录'));return;}
   if(headers['content-encoding']&&headers['content-encoding']!=='identity'){res.resume();reject(new Error('来源未返回可读取的未压缩页面'));return;}
   const charset=/charset\s*=\s*["']?([^\s;"']+)/i.exec(headers['content-type']||'')?.[1];
   if(charset&&!/^(utf-?8|us-ascii)$/i.test(charset)){res.resume();reject(new Error('来源不是 UTF-8 编码，请手动补充以避免乱码'));return;}
   if(Number(headers['content-length'])>MAX_SOURCE_BYTES){res.destroy();reject(new Error('来源页面超过 1 MB，请手动补充必要材料'));return;}
   let bytes=0;const chunks=[];
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_SOURCE_BYTES){res.destroy(new Error('来源页面超过 1 MB，请手动补充必要材料'));return;}chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>resolve({status,headers,body:Buffer.concat(chunks).toString('utf8')}));
  });req.on('error',reject);
 });
}
export function extractArticle(html,url){
 if(Buffer.byteLength(html)>MAX_SOURCE_BYTES)throw new Error('来源页面超过 1 MB');
 if(['news.google.com','consent.google.com','accounts.google.com'].includes(new URL(url).hostname))throw new Error('这是聚合或登录入口，请在阅读来源后粘贴发布方的文章链接');
 const dom=new JSDOM(html,{url});
 try{
  const article=new Readability(dom.window.document,{maxElemsToParse:18000,charThreshold:200}).parse();
  const body=article?.textContent?.replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  if(!body||body.length<200||/^(?:access denied|just a moment|request blocked|enable javascript|verify you are human)/i.test(article.title||''))throw new Error('未提取到足够正文，可能是访问限制或非文章页面；可手动补充');
  if(body.length>80000)throw new Error('正文超过 8 万字符，请手动补充必要段落');
  const publishedAt=article.publishedTime&&Number.isFinite(Date.parse(article.publishedTime))?new Date(article.publishedTime).toISOString():null;
  return {title:(article.title||new URL(url).hostname).slice(0,200),sourceName:(article.siteName||new URL(url).hostname).slice(0,160),body,publishedAt,scope:'extracted-text',method:READER_VERSION};
 }finally{dom.window.close();}
}
export async function readPublicArticle(value,{resolver=lookup,request=transport,timeoutMs=20000}={}){
 let url=publicSourceUrl(value);const signal=AbortSignal.timeout(timeoutMs);
 const bounded=promise=>new Promise((resolve,reject)=>{const abort=()=>reject(new Error('公开网页读取超时'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
 for(let redirects=0;redirects<=3;redirects++){
  const addresses=await bounded(resolver(url.hostname,{all:true,family:4}));
  if(!addresses.length||addresses.some(a=>!isPublicIPv4(a.address)))throw new Error('来源解析到非公网地址，未发起读取');
  const response=await bounded(request(url,addresses[0].address,signal));
  if([301,302,303,307,308].includes(response.status)){
   if(redirects===3||!response.headers.location)throw new Error('来源重定向过多或缺少目标');
   url=publicSourceUrl(new URL(response.headers.location,url).href);continue;
  }
  if(response.status!==200)throw new Error(`来源返回 HTTP ${response.status}，未读取正文；可自行阅读后补充材料`);
  return {...extractArticle(response.body,url.href),url:url.href,requestedUrl:publicSourceUrl(value).href};
 }
}
