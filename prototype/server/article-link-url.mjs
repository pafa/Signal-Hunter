import {publicSourceUrl} from './public-source-url.mjs';

// Only the protocol of an explicit same-host link may change. Requests still
// use the public HTTPS reader; failure never falls back to insecure HTTP.
export function articleLinkUrl(value,base){
 const source=publicSourceUrl(base),linked=new URL(value,source);
 if(linked.protocol!=='http:')return {url:publicSourceUrl(linked.href).href};
 if(linked.hostname!==source.hostname||linked.port||linked.username||linked.password)throw Error('不能升级此来源链接');
 const originalUrl=linked.href;linked.protocol='https:';
 return {url:publicSourceUrl(linked.href).href,originalUrl};
}
export function validateLinkUpgrade(link,base){
 if(!Object.hasOwn(link,'originalUrl'))return;
 if(typeof link.originalUrl!=='string'||link.originalUrl.length>2000||!link.originalUrl.startsWith('http://'))throw Error('链接升级记录无效');
 const resolved=articleLinkUrl(link.originalUrl,base||link.url);
 if(resolved.url!==link.url||resolved.originalUrl!==link.originalUrl)throw Error('链接升级记录无效');
}

// Each original anchor label has collapsed whitespace. Newlines therefore
// separate distinct explicit labels for one fetch URL without inventing a URL.
export function mergeLinkLabels(current,incoming){
 const labels=current.split('\n'),seen=new Set(labels);let label=current,truncated=false;
 for(const value of incoming.split('\n')){
  if(!value||seen.has(value))continue;seen.add(value);
  const next=label?label+'\n'+value:value;
  if(next.length>200){truncated=true;continue;}label=next;
 }
 return {label,truncated};
}
