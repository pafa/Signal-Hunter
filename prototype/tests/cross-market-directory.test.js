import test from 'node:test';
import assert from 'node:assert/strict';
import {directorySheet} from '../server/directory-xlsx.mjs';
import {CROSS_SOURCES,loadHongKong,loadMainland,parseShanghai,parseShenzhen} from '../server/cross-market-directory.mjs';
import {openStore} from '../server/store.mjs';
import {openSecurityDirectory} from '../server/security-directory.mjs';
import {createService} from '../server/service.mjs';
import {companyEntitiesPacket} from '../server/company-entities.mjs';
import {zip,workbookFiles,workbook,hkRows,szRows,szMeta,shResponse} from './helpers/directory-workbooks.mjs';
const date='2026-10-03T12:00:00Z';
function fixture(){let hkDate='02/10/2026',cnDate='2026-10-02',calls=0,broken='';const store=openStore(':memory:');
 const fetcher=async url=>{calls++;if(url.includes(broken)&&broken)throw Error('synthetic failed source');
  if(url.includes('hkex'))return new Response(workbook(hkRows(url.includes('_c.xlsx')?'cn':'en',hkDate)));
  if(url.includes('query.sse')){const u=new URL(url),type=u.searchParams.get('STOCK_TYPE'),page=Number(u.searchParams.get('pageHelp.pageNo'));return Response.json(shResponse(type,page,type==='1'?2:1));}
  if(url.includes('SHOWTYPE=JSON'))return Response.json(szMeta(cnDate));
  if(url.includes('SHOWTYPE=xlsx'))return new Response(workbook(szRows(),{name:'A股列表'}));
  throw Error('Unexpected source');};
 const service=createService(store,{mode:'research',now:()=>Date.parse(date),fetcher});return {store,service,d:service.securityDirectory,fetcher,get calls(){return calls;},setHK:v=>hkDate=v,setCN:v=>cnDate=v,break:v=>broken=v,async close(){await service.close();store.close();}};
}
const refresh=async(f,market,id)=>{f.d.refresh({market,requestId:id});await f.d.wait();return f.d.status({market});};
test('qualified codes cannot recall a different exchange or an embedded code substring',async()=>{
 const f=fixture();try{
  await refresh(f,'CN','recall-exchange-cn-0001');await refresh(f,'HK','recall-exchange-hk-0001');
  for(const text of ['SZSE:600001','SSE:002594','NASDAQ:01211','HKEX:002594','1600001.SH','600001.SHARES','x01211.HK','01211.HK-extra'])assert.deepEqual(f.d.selection(text).entries,[],text);
  for(const [text,symbol] of [['SSE:600001','600001.SH'],['SZSE:002594','002594.SZ'],['HKEX:01211','01211.HK'],['（600001.SH）','600001.SH'],['hkex：1211','01211.HK']])assert.deepEqual(f.d.selection(text).entries.map(e=>e.symbol),[symbol],text);
 }finally{await f.close();}
});
test('workbook reads fixed cells and rich shared strings, rejecting formulas, external sheets, duplicate entries and entities',async()=>{
 assert.deepEqual((await directorySheet(workbook([{A:'合成 & text',B:'00001'}]))).rows,[{number:1,cells:{A:'合成 & text',B:'00001'}}]);
 const files=workbookFiles([{A:'unused'}]);files[2][1]='<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';files.push(['xl/sharedStrings.xml','<sst><si><r><t>甲</t></r><r><t>乙</t></r></si></sst>']);assert.equal((await directorySheet(zip(files))).rows[0].cells.A,'甲乙');
 for(const mode of ['formula','external','duplicate','entity','bad-index','duplicate-cell','wrong-row']){const bad=structuredClone(files);
  if(mode==='formula')bad[2][1]=bad[2][1].replace('<v>0</v>','<f>1+1</f><v>0</v>');
  if(mode==='external')bad[1][1]=bad[1][1].replace('Target="worksheets/sheet1.xml"','TargetMode="External" Target="https://example.invalid/sheet"');
  if(mode==='duplicate')bad.push(bad[2]);
  if(mode==='entity')bad[2][1]='<!DOCTYPE worksheet [<!ENTITY x SYSTEM "https://example.invalid/entity">]>'+bad[2][1];
  if(mode==='bad-index')bad[2][1]=bad[2][1].replace('<v>0</v>','<v>99</v>');
  if(mode==='duplicate-cell')bad[2][1]=bad[2][1].replace('</row>','<c r="A1"><v>2</v></c></row>');
  if(mode==='wrong-row')bad[2][1]=bad[2][1].replace('r="A1"','r="A2"');
  await assert.rejects(directorySheet(zip(bad)),undefined,mode);
 }
 await assert.rejects(directorySheet(Buffer.alloc(5000001)));const controller=new AbortController();controller.abort();await assert.rejects(directorySheet(workbook([{A:'x'}]),controller.signal));
});
test('HK pairs bilingual security identities, preserves blank debt subcategories and excludes non-HKD and non-equity',async()=>{
 const read=async s=>({...s,raw:workbook(hkRows(s.id==='hk-en'?'en':'cn')).toString('base64')});const r=await loadHongKong(read);assert.equal(r.entries.length,3);assert.equal(r.entries.filter(e=>e.eligible).length,1);assert.equal(r.entries[0].name,'比亞迪股份');assert(r.entries[1].excluded.includes('unsupported-trading-currency'));assert(r.entries[2].excluded.includes('non-company-equity'));assert.equal(r.sources[0].sourceDate,'2026-10-02');
 for(const mode of ['date','isin','classification','duplicate','bad-row'])await assert.rejects(loadHongKong(async s=>{const lang=s.id==='hk-en'?'en':'cn',rows=hkRows(lang);if(lang==='cn'){if(mode==='date')rows[1].A='截 至 03/10/2026';if(mode==='isin')rows[3].F='CNE100000999';if(mode==='classification')rows[3].C='債券';if(mode==='duplicate')rows.push(rows[3]);if(mode==='bad-row')rows.push({A:'unexpected footer'});}return {...s,raw:workbook(rows).toString('base64')};}));
});
test('mainland pagination and workbook counts must agree; source fields retain listing dates without claiming historical completeness',async()=>{
 const f=fixture();try{const read=async s=>{const response=await f.fetcher(s.url);return {...s,raw:s.format==='xlsx'?Buffer.from(await response.arrayBuffer()).toString('base64'):await response.text()};};const r=await loadMainland(read);assert.equal(r.entries.length,4);assert.deepEqual(r.entries.map(e=>e.symbol),['600001.SH','600002.SH','688001.SH','002594.SZ']);assert.equal(r.sources.length,5);assert.equal(r.sources[0].sourceDate,null);assert.equal(r.sources.at(-1).sourceDate,'2026-10-02');assert.equal(r.entries.at(-1).listingDate,'2011-06-30');
  for(const change of [v=>v.pageHelp.total=2,v=>v.pageHelp.pageNo=2,v=>v.result[0].STOCK_TYPE='8',v=>v.result[0].LIST_DATE='20200230']){const v=shResponse();change(v);assert.throws(()=>parseShanghai({raw:JSON.stringify(v)},'1',1));}
  const sheet=await directorySheet(workbook(szRows(),{name:'A股列表'}));for(const change of [v=>v[0].metadata.recordcount=2,v=>v[0].metadata.subname='2026-02-30',v=>v[0].data[0].agssrq='2000-01-01']){const v=szMeta();change(v);assert.throws(()=>parseShenzhen(sheet,{id:'szse'},{raw:JSON.stringify(v)}));}
 }finally{await f.close();}
});
test('market snapshots remain separate, bilingual search is bounded, failures and repeated requests retain old versions',async()=>{
 const f=fixture();try{assert.equal(f.calls,0);const cn=await refresh(f,'CN','cross-cn-request-00001'),hk=await refresh(f,'HK','cross-hk-request-00001');assert.equal(cn.current.counts.rows,4);assert.equal(hk.current.counts.rows,3);assert.equal(f.d.current(),null);assert.equal(f.d.status({market:'CN'}).current.id,cn.current.id);assert.equal(f.d.search({market:'HK',q:'BYD'}).items[0].symbol,'01211.HK');assert.equal(f.d.search({market:'CN',q:'比亚迪'}).items[0].symbol,'002594.SZ');assert.throws(()=>f.d.search({market:'CN',snapshotId:hk.current.id}),/市场/);assert.throws(()=>f.d.refresh({market:'HK',requestId:'cross-cn-request-00001'}),/其他市场/);
  const calls=f.calls;await refresh(f,'HK','cross-hk-request-00001');assert.equal(f.calls,calls);f.break('_c.xlsx');const fail=await refresh(f,'HK','cross-hk-failure-0001');assert.equal(fail.attempts[0].status,'failed');assert.equal(fail.current.id,hk.current.id);assert.equal(f.d.status({market:'CN'}).current.id,cn.current.id);
  assert.equal(f.d.selection('比亚迪 BYD COMPANY').entries.length,2);assert.deepEqual(f.d.selection('比亚迪 BYD COMPANY').coveredMarkets,['CN','HK']);
 }finally{await f.close();}
});
test('future source snapshots remain inspectable but cannot displace current recall, and a later valid fetch can recover',async()=>{
 const f=fixture();try{const first=await refresh(f,'HK','cross-date-current-001');f.setHK('05/10/2026');const future=await refresh(f,'HK','cross-date-future-0001');assert(future.current.futureDated);assert.equal(future.active.id,first.current.id);assert.equal(f.d.search({market:'HK'}).snapshot.id,future.current.id);assert.equal(f.d.selection('BYD COMPANY').entries[0].directorySnapshotId,first.current.id);
  f.setHK('03/10/2026');const corrected=await refresh(f,'HK','cross-date-correct-001');assert.equal(corrected.attempts[0].status,'complete');assert.equal(corrected.current.futureDated,false);assert.equal(corrected.active.id,corrected.current.id);assert.equal(corrected.history.length,3);assert(f.d.search({market:'HK',snapshotId:future.current.id}).snapshot.futureDated);
  f.setHK('01/10/2026');const old=await refresh(f,'HK','cross-date-regress-001');assert.equal(old.attempts[0].status,'failed');assert.equal(old.current.id,corrected.current.id);
 }finally{await f.close();}
 const only=fixture();try{only.setHK('05/10/2026');await refresh(only,'HK','cross-only-future-0001');assert.equal(only.d.status({market:'HK'}).active,null);assert.equal(only.d.selection('BYD COMPANY'),null);}finally{await only.close();}
});
test('official mainland packet replaces only covered markets and keeps source identities frozen',async()=>{
 const f=fixture();try{await refresh(f,'CN','cross-packet-cn-00001');const research=f.service.research;let t=research.create({title:'合成跨市场身份',summary:'合成资料'});t=research.saveMaterial(t.id,{version:t.version,title:'比亚迪材料',sourceName:'合成',url:'https://example.com/byd',body:'比亚迪与合成沪市公司1讨论合作。',scope:'excerpt',stance:'unverified',family:'other',step:'fact',interpretation:'待核对'});const m=research.materialList(t.id).materials[0],p=companyEntitiesPacket(f.store,research,t.id,{version:t.version,materialId:m.id,revision:m.revision});const c=p.input.directory.find(e=>e.symbol==='002594.SZ');assert(c.directorySnapshotId);assert.equal(c.reportedListingDate,'2011-06-30');assert(p.input.directory.some(e=>e.symbol==='01211.HK'));assert(!p.input.directory.some(e=>e.symbol==='600519.SH'));assert.equal(p.input.directorySnapshot.snapshots[0].market,'CN');
 }finally{await f.close();}
});
test('future reported listing dates stay queryable but cannot enter current model recall',async()=>{
 const f=fixture(),store=openStore(':memory:'),d=openSecurityDirectory(store,{now:()=>Date.parse(date),fetcher:async url=>{if(url.includes('SHOWTYPE=JSON')){const v=szMeta();v[0].data[0].agssrq='2026-10-05';return Response.json(v);}if(url.includes('SHOWTYPE=xlsx')){const rows=szRows();rows[1].G='2026-10-05';return new Response(workbook(rows,{name:'A股列表'}));}return f.fetcher(url);}});
 try{d.refresh({market:'CN',requestId:'future-listing-cn-0001'});await d.wait();assert.equal(d.status({market:'CN'}).attempts[0].status,'complete');assert.equal(d.search({market:'CN',q:'002594'}).items[0].reportedListingDate,'2026-10-05');assert.deepEqual(d.selection('比亚迪').entries,[]);}finally{await d.close();store.close();await f.close();}
});
