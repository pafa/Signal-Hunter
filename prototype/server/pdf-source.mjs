import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PDF_SCOPE_SCHEMA,PDF_READER_VERSION,MAX_PDF_PAGES,pdfReaderLimits,pdfPageMarker} from '../shared/pdf-source.mjs';

export const pdfDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Error('PDF文字提取范围记录无效');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;
export function validatePdfScope(v,body){
 const limits=pdfReaderLimits(v?.readerVersion);
 if(!exact(v,'bytes,emptyPages,pages,parser,readerVersion,schema,sha256,textOrder,warnings')||v.schema!==PDF_SCOPE_SCHEMA||!limits||v.parser!=='pdfjs-dist/6.4.299'||v.textOrder!=='pdf-content-stream'||!Number.isSafeInteger(v.bytes)||v.bytes<8||v.bytes>limits.bytes||!/^[a-f0-9]{64}$/.test(v.sha256)||!Array.isArray(v.pages)||!v.pages.length||v.pages.length>MAX_PDF_PAGES||!Array.isArray(v.emptyPages)||!Array.isArray(v.warnings)||v.warnings.length>10||v.warnings.some(w=>typeof w!=='string'||w.length>300))fail();
 if(typeof body!=='string'||body.length>limits.text)fail();
 let end=0;const empty=[];
 for(const [i,p] of v.pages.entries()){
  if(!exact(p,'characters,end,page,sha256,start')||p.page!==i+1||![p.start,p.end,p.characters].every(Number.isSafeInteger)||p.start!==end||p.end<p.start||p.end>body.length)fail();
  const marker=pdfPageMarker(p.page),segment=body.slice(p.start,p.end),suffix=i===v.pages.length-1?'':'\n\n';
  if(!segment.startsWith(marker)||suffix&&!segment.endsWith(suffix))fail();
  const content=segment.slice(marker.length,suffix?-suffix.length:undefined);if(content&&!content.startsWith('\n'))fail();const text=content?content.slice(1):'';
  if(text.length!==p.characters||pdfDigest(text)!==p.sha256)fail();
  if(!text.trim())empty.push(p.page);end=p.end;
 }
 if(end!==body.length||JSON.stringify(empty)!==JSON.stringify(v.emptyPages)||empty.length===v.pages.length)fail();
 return structuredClone(v);
}

// Parsing has a separate heap and deadline. Only bytes cross the boundary;
// the parser never receives the source URL or inherited account credentials.
export async function extractPdf(bytes,url,{signal,timeoutMs=15000,readerVersion=PDF_READER_VERSION}={}){
 const limits=pdfReaderLimits(readerVersion);if(!limits)throw Error('PDF读取版本无效');
 if(!Buffer.isBuffer(bytes)||bytes.length>limits.bytes||bytes.length<8||bytes.subarray(0,5).toString('ascii')!=='%PDF-')throw Error(`PDF格式或容量无效（最大${limits.bytes/1_000_000} MB）`);
 const output=await new Promise((resolve,reject)=>{
  const child=execFile(process.execPath,['--max-old-space-size=256',fileURLToPath(new URL('./pdf-worker.mjs',import.meta.url)),readerVersion],{timeout:timeoutMs,maxBuffer:2_000_000,killSignal:'SIGKILL',signal,env:{NODE_ENV:'production'}},(error,stdout)=>{
   if(error){reject(Error(signal?.aborted?'公开材料读取超时':error.killed?'PDF提取超时，保留读取缺口':'PDF解析进程未完成，保留读取缺口'));return;}
   try{const value=JSON.parse(stdout);if(value.error)throw Error(value.error);resolve(value);}catch(e){reject(e);}
  });
  child.stdin.on('error',()=>{});child.stdin.end(bytes);
 });
 const extractionEvidence={schema:PDF_SCOPE_SCHEMA,readerVersion,parser:'pdfjs-dist/6.4.299',bytes:bytes.length,sha256:pdfDigest(bytes),textOrder:'pdf-content-stream',...output.extraction};
 validatePdfScope(extractionEvidence,output.body);
 const host=new URL(url).hostname;
 return {title:(output.title||host+' PDF公告').slice(0,200),sourceName:host,body:output.body,publishedAt:null,scope:'extracted-text',method:readerVersion,extractionEvidence,sourceDocument:bytes};
}
