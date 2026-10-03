import {crc32} from 'node:zlib';
// Small uncompressed ZIP fixtures; all contents are synthetic, no publisher data.
export function zip(entries){
 const chunks=[],central=[];let offset=0;
 for(const [path,text] of entries){const name=Buffer.from(path),body=Buffer.from(text),local=Buffer.alloc(30),header=Buffer.alloc(46),crc=crc32(body);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt32LE(crc,16);header.writeUInt32LE(body.length,20);header.writeUInt32LE(body.length,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(offset,42);
  chunks.push(local,name,body);central.push(header,name);offset+=local.length+name.length+body.length;
 }
 const end=Buffer.alloc(22),directory=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,directory,end]);
}
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export function workbookFiles(rows,{name='Sheet1',target='worksheets/sheet1.xml'}={}){return [
 ['xl/workbook.xml',`<workbook xmlns:r="urn:relationships"><sheets><sheet name="${escape(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
 ['xl/_rels/workbook.xml.rels',`<Relationships><Relationship Id="rId1" Type="urn/worksheet" Target="${target}"/></Relationships>`],
 ['xl/worksheets/sheet1.xml',`<worksheet><sheetData>${rows.map((cells,i)=>`<row r="${i+1}">${Object.entries(cells).map(([col,v])=>`<c r="${col}${i+1}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`]
];}
export const workbook=(rows,options)=>zip(workbookFiles(rows,options));
export const hkRows=(lang,date='02/10/2026')=>[
 {A:lang==='en'?'List of Securities':'證券名單'},
 {A:(lang==='en'?'Updated as at ':'截 至 ')+date},
 lang==='en'?{A:'Stock Code',B:'Name of Securities',C:'Category',D:'Sub-Category',E:'Board Lot',F:'ISIN',Q:'Trading Currency',R:'RMB Counter'}:{A:'股份代號',B:'股份名稱',C:'分類',D:'次分類',E:'買賣單位',F:'國際證券號碼 (ISIN)',Q:'交易貨幣',R:'RMB櫃台'},
 {A:'01211',B:lang==='en'?'BYD COMPANY':'比亞迪股份',C:lang==='en'?'Equity':'股本',D:lang==='en'?'Equity Securities (Main Board)':'股本證券(主板)',E:'500',F:'CNE100000296',Q:'HKD'},
 {A:'80001',B:'Synthetic RMB equity',C:lang==='en'?'Equity':'股本',D:lang==='en'?'Equity Securities (GEM)':'股本證券(創業板)',E:'100',F:'CNE100000296',Q:'RMB'},
 {A:'04001',B:'Synthetic debt',C:lang==='en'?'Debt Securities':'債券',E:'10,000',F:'HK0001127551',Q:'HKD'}
];
export const szRows=()=>[{A:'板块',B:'公司全称',C:'英文名称',E:'A股代码',F:'A股简称',G:'A股上市日期'},{A:'主板',B:'合成比亚迪有限公司',C:'BYD Synthetic',E:'002594',F:'比亚迪',G:'2011-06-30'}];
export const szMeta=(date='2026-10-02')=>[{metadata:{tabkey:'tab1',catalogid:'1110',name:'A股列表',recordcount:1,subname:date},data:[{agdm:'002594',agssrq:'2011-06-30'}]}];
export function shResponse(type='1',page=1,total=1,pageSize=1){const rows=[{STOCK_TYPE:type,A_STOCK_CODE:type==='1'?`60000${page}`:'688001',SEC_NAME_CN:'合成沪市公司'+page,FULL_NAME:'Synthetic Shanghai '+page,LIST_DATE:'20200101',DELIST_DATE:'-'}];return {result:rows,pageHelp:{pageNo:page,pageSize,total,pageCount:Math.ceil(total/pageSize),data:rows}};}
