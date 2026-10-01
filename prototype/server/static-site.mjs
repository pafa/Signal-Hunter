import {createReadStream,realpathSync,statSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
export function createStaticHandler(directory){
 const root=realpathSync(directory);
 if(!statSync(resolve(root,'index.html')).isFile())throw new Error('请先运行 npm run build');
 return (req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
  let path;
  try{path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
  if(path.includes('\\')||path.includes('\0')||path.split('/').some(p=>p.startsWith('.'))){res.writeHead(404);res.end();return;}
  let target=resolve(root,'.'+path);
  try{if(statSync(target).isDirectory())target=resolve(target,'index.html');target=realpathSync(target);if(!target.startsWith(root+sep))throw new Error('outside');}
  catch{if(extname(path)){res.writeHead(404);res.end();return;}target=resolve(root,'index.html');}
  const size=statSync(target).size;
  res.writeHead(200,{'Content-Type':types[extname(target)]||'application/octet-stream','Content-Length':size,
   'Cache-Control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache',
   'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"frame-ancestors 'none'; object-src 'none'; base-uri 'self'"});
  if(req.method==='HEAD'){res.end();return;}
  const stream=createReadStream(target);stream.on('error',()=>res.destroy());stream.pipe(res);
 };
}
