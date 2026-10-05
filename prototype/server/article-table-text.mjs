export const TABLE_TEXT_VERSION='html-table-text/1';
const clean=text=>text.replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const fail=()=>{throw Error('网页表格结构无效或超过读取上限，请核对原表并补充必要摘录');};
const span=(cell,name,remaining)=>{
 const raw=cell.getAttribute(name);if(raw===null)return 1;
 if(!/^\d{1,4}$/.test(raw.trim()))fail();const n=Number(raw);
 if(name==='rowspan'&&n===0)return remaining;
 if(n<1||n>(name==='rowspan'?remaining:256))fail();return n;
};
// Coordinates describe the retained HTML table model, not inferred financial headers or CSS layout.
export function articleTableText(document,html){
 const root=document.createElement('div');root.innerHTML=html;
 // Readability can select a tbody and leave orphan tr/td tags; HTML reparsing drops them.
 // Its serialized text escapes source prose. Refuse lost cell/row markup rather than flatten it.
 for(const tag of ['tr','td','th'])if((html.match(new RegExp(`<${tag}(?:\\s|>)`,'gi'))||[]).length!==root.querySelectorAll(tag).length)fail();
 const tables=[...root.querySelectorAll('table')];if(tables.length>50)fail();
 let cellsSeen=0,slotsSeen=0;
 for(let index=tables.length-1;index>=0;index--){
  const table=tables[index],rows=[...table.rows],occupied=new Set(),entries=[];
  if(rows.length>1000)fail();let width=0;
  for(let r=0;r<rows.length;r++){
   const row=rows[r];let column=0,remaining=1;
   while(r+remaining<rows.length&&rows[r+remaining].parentElement===row.parentElement)remaining++;
   for(const cell of row.cells){
    if(++cellsSeen>10000)fail();while(occupied.has(`${r}:${column}`))column++;
    const down=span(cell,'rowspan',remaining),across=span(cell,'colspan',remaining);
    if(column+across>256||slotsSeen+down*across>100000)fail();
    for(let y=r;y<r+down;y++)for(let x=column;x<column+across;x++){
     const key=`${y}:${x}`;if(occupied.has(key))fail();occupied.add(key);slotsSeen++;
    }
    const text=clean(cell.textContent);
    if(text||down>1||across>1)entries.push(`r${r+1}${down>1?`:${r+down}`:''} c${column+1}${across>1?`:${column+across}`:''} ${cell.tagName.toLowerCase()} ${JSON.stringify(text)}`);
    column+=across;width=Math.max(width,column);
   }
  }
  const caption=table.caption?`caption ${JSON.stringify(clean(table.caption.textContent))}\n`:'';
  const block=`\n[HTML table ${index+1}; ${TABLE_TEXT_VERSION}; rows=${rows.length}; columns=${width}; coordinates added by extractor; empty cells keep their positions but text is omitted]\n${caption}${entries.join('\n')}\n[/HTML table ${index+1}]\n`;
  table.replaceWith(document.createTextNode(block));
 }
 return clean(root.textContent);
}
