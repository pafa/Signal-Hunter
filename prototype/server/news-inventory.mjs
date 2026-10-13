// Count current source records independently from exact stored links. This is
// an inventory, not article equivalence, event clustering or evidence quality.
export function newsInventory(db){
 const groups=db.prepare("SELECT json_extract(payload,'$.url') url,count(*) entries FROM news GROUP BY json_extract(payload,'$.url')").all();
 const result={schema:'news-inventory/1',sourceEntries:0,distinctLinks:0,repeatedLinkEntries:0,sharedLinks:0,unresolvedLinkEntries:0};
 for(const {url,entries} of groups){
  result.sourceEntries+=entries;
  let valid=false;
  if(typeof url==='string'&&url===url.trim())try{const parsed=new URL(url);valid=['https:','http:'].includes(parsed.protocol)&&!!parsed.hostname&&!parsed.username&&!parsed.password;}catch{}
  if(!valid){result.unresolvedLinkEntries+=entries;continue;}
  result.distinctLinks++;
  result.repeatedLinkEntries+=entries-1;
  if(entries>1)result.sharedLinks++;
 }
 return result;
}
