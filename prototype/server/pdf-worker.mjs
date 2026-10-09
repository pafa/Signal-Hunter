import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {MAX_PDF_BYTES,MAX_PDF_PAGES,MAX_PDF_TEXT,pdfPageMarker} from '../shared/pdf-source.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const warnings=[];
// PDF.js diagnostics must not corrupt the JSON response or expose unbounded text.
console.log=console.warn=console.error=(...v)=>{if(warnings.length<10)warnings.push(v.map(String).join(' ').slice(0,300));};
globalThis.fetch=async()=>{throw Error('PDF解析不允许网络请求');};
let task;
try{
 let size=0;const chunks=[];for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX_PDF_BYTES)throw Error('PDF超过8 MB');chunks.push(chunk);}
 const {getDocument,PermissionFlag}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const assets=new URL('./',import.meta.resolve('pdfjs-dist/package.json'));
 // Built-in fonts and CMaps stay in the pinned package. No document URLs,
 // scripts, actions, embedded files, rendering or external fonts are loaded.
 task=getDocument({data:new Uint8Array(Buffer.concat(chunks)),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,useWasm:false,stopAtErrors:true,cMapUrl:fileURLToPath(new URL('cmaps/',assets)),cMapPacked:true,standardFontDataUrl:fileURLToPath(new URL('standard_fonts/',assets)),verbosity:1});
 const pdf=await task.promise;
 const permissions=await pdf.getPermissions();
 if(permissions&&!permissions.includes(PermissionFlag.COPY))throw Error('PDF限制文字复制，未提取内容');
 if(!pdf.numPages||pdf.numPages>MAX_PDF_PAGES)throw Error('PDF超过120页，未截取部分冒充完整文字层');
 const metadata=await pdf.getMetadata();if(metadata.info?.EncryptFilterName)throw Error('PDF已加密，未提取内容');const pages=[],emptyPages=[];let body='';
 for(let n=1;n<=pdf.numPages;n++){
  const page=await pdf.getPage(n),content=await page.getTextContent({includeMarkedContent:false,disableNormalization:false});
  let text='';for(const item of content.items){if(typeof item.str!=='string')continue;text+=item.str+(item.hasEOL?'\n':' ');if(text.length+body.length>MAX_PDF_TEXT)throw Error('PDF文字超过8万字符，未截断保存');}
  text=text.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const start=body.length;body+=pdfPageMarker(n)+(text?'\n'+text:'')+(n===pdf.numPages?'':'\n\n');
  if(body.length>MAX_PDF_TEXT)throw Error('PDF文字超过8万字符，未截断保存');
  pages.push({page:n,start,end:body.length,characters:text.length,sha256:sha(text)});if(!text)emptyPages.push(n);page.cleanup();
 }
 if(emptyPages.length===pages.length)throw Error('PDF没有可提取文字层，扫描页尚未读取');
 const title=typeof metadata.info?.Title==='string'?metadata.info.Title.trim():'';
 process.stdout.write(JSON.stringify({title,body,extraction:{pages,emptyPages,warnings}}));
}catch(e){process.stdout.write(JSON.stringify({error:e?.name==='PasswordException'?'PDF已加密，未尝试解密或读取':String(e?.message||'PDF提取失败').slice(0,300)}));}
finally{await task?.destroy();}
