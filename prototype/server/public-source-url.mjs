import {isIP} from 'node:net';
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
