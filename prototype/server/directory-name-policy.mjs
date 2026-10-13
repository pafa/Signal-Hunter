export const DIRECTORY_NAME_POLICY='official-issuer-aliases/1';
const reviewedAt='2026-10-11T08:14:33.000Z';
export const directoryReviewedNamesAvailable=asOf=>Date.parse(asOf)>=Date.parse(reviewedAt);
const norm=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
// These are source-backed names, not first-word matching. They apply only to
// the exact current directory security/name and never establish tradability.
const reviewed=[
 {symbol:'CDNS.US',name:'Cadence Design Systems, Inc. - Common Stock',aliases:['Cadence'],sources:['https://investor.cadence.com/overview/default.aspx?lid=investor_relations','https://www.sec.gov/Archives/edgar/data/813672/000081367226000016/cdns-20251231.htm']},
 {symbol:'SAP.US',name:'SAP SE ADS',aliases:['SAP','SAP SE'],sources:['https://www.sap.com/investors/en/resources/faq.html']}
];
export function directoryNameAliases(entry,issuerName,source,asOf){
 if(!entry.symbol?.endsWith('.US'))return [];
 const proofs=[];
 // Strip one terminal legal form only after an explicit common-stock suffix
 // was removed. Parent/subsidiary words and arbitrary prefixes stay intact.
 const match=issuerName&&/^(.{4,}?)(?:,?\s+)(?:Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|Limited|plc)$/i.exec(issuerName);
 if(match&&match[1].trim().length>=4)proofs.push({alias:match[1].trim(),rule:'terminal-legal-form',directoryName:entry.name,source});
 if(directoryReviewedNamesAvailable(asOf))for(const item of reviewed){
  if(item.symbol!==entry.symbol||norm(item.name)!==norm(entry.name))continue;
  for(const alias of item.aliases)proofs.push({alias,rule:'reviewed-issuer-name',directoryName:entry.name,sources:[...item.sources],reviewedAt});
 }
 return proofs;
}
