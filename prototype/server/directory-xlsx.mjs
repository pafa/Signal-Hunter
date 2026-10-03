import yauzl from 'yauzl';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
const fail=()=>{throw Error('证券目录工作簿格式或大小无效');};
const parser=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:true,isArray:name=>['row','c','si','sheet','Relationship','r'].includes(name)});
const xml=bytes=>{const s=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/<!DOCTYPE|<!ENTITY/i.test(s)||XMLValidator.validate(s)!==true)fail();return parser.parse(s);};
const text=v=>typeof v==='string'?v:!v?'':typeof v['#text']==='string'?v['#text']:Array.isArray(v.r)?v.r.map(r=>text(r.t)).join(''):text(v.t);
// Read fixed worksheet values only. Never evaluate formulas, follow links or extract files.
export async function directorySheet(bytes,signal){
 if(!Buffer.isBuffer(bytes)||bytes.length>5000000)fail();
 const wanted=new Set(['xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/sharedStrings.xml','xl/worksheets/sheet1.xml']),files=new Map(),seen=new Set();
 const zip=await yauzl.fromBufferPromise(bytes,{validateEntrySizes:true,strictFileNames:true});let total=0,count=0;
 try{for await(const entry of zip.eachEntry()){
  signal?.throwIfAborted();if(++count>50||seen.has(entry.fileName)||entry.isEncrypted())fail();seen.add(entry.fileName);if(!wanted.has(entry.fileName))continue;
  if(entry.uncompressedSize>25000000||(total+=entry.uncompressedSize)>30000000)fail();
  const stream=await zip.openReadStreamPromise(entry),chunks=[];let size=0;const abort=()=>stream.destroy(Error('Cancelled'));signal?.addEventListener('abort',abort,{once:true});
  try{for await(const chunk of stream){signal?.throwIfAborted();size+=chunk.length;if(size>entry.uncompressedSize||size>25000000)fail();chunks.push(chunk);}}finally{signal?.removeEventListener('abort',abort);stream.destroy();}
  if(size!==entry.uncompressedSize)fail();files.set(entry.fileName,Buffer.concat(chunks));
 }}finally{zip.close();}
 const workbook=files.get('xl/workbook.xml'),rels=files.get('xl/_rels/workbook.xml.rels'),sheet=files.get('xl/worksheets/sheet1.xml');if(!workbook||!rels||!sheet)fail();
 const sheets=xml(workbook).workbook?.sheets?.sheet;if(!Array.isArray(sheets)||sheets.length!==1)fail();
 const relationships=xml(rels).Relationships?.Relationship||[],rel=relationships.find(r=>r['@_Id']===sheets[0]['@_id']);if(!rel||!['worksheets/sheet1.xml','/xl/worksheets/sheet1.xml'].includes(rel['@_Target'])||rel['@_TargetMode']==='External'||!rel['@_Type']?.endsWith('/worksheet'))fail();
 const strings=files.has('xl/sharedStrings.xml')?(xml(files.get('xl/sharedStrings.xml')).sst?.si||[]).map(text):[];
 if(strings.length>100000)fail();const sourceRows=xml(sheet).worksheet?.sheetData?.row;if(!Array.isArray(sourceRows)||sourceRows.length>30000)fail();
 let last=0;const rows=[];
 for(const row of sourceRows){const number=Number(row['@_r']);if(!Number.isInteger(number)||number<=last||number>30000)fail();last=number;const cells={};
  for(const c of row.c||[]){const match=/^([A-Z]{1,2})([1-9]\d*)$/.exec(c['@_r']||'');if(!match||+match[2]!==number||Object.hasOwn(cells,match[1])||Object.hasOwn(c,'f'))fail();const type=c['@_t'];let value='';if(type==='s'){const i=Number(c.v);if(c.v===undefined||!Number.isInteger(i)||i<0||i>=strings.length)fail();value=strings[i];}else if(type==='inlineStr')value=text(c.is);else if(!type||['n','str'].includes(type))value=text(c.v);else if(c.v!==undefined)fail();if(value.length>2000)fail();cells[match[1]]=value.trim();}
  if(Object.values(cells).some(Boolean))rows.push({number,cells});
 }
 return {name:sheets[0]['@_name'],rows};
}
