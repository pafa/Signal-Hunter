import {SEC_TICKERS_URL} from '../../server/financial-source-material.mjs';
import {secSubmissionsUrl} from '../../server/financial-filing-material.mjs';
export const filingAt='2026-10-08T00:00:00.000Z';
export const filingMap={0:{cik_str:1045810,ticker:'NVDA',title:'NVIDIA CORP'}};
export const quarterlyUrl='https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/nvda-20260726.htm';
export const syntheticFilingHtml='<!doctype html><html><head><title>Synthetic filing for tests</title></head><body><h1>NVIDIA CORP synthetic report</h1><p>These are synthetic financial test inputs, not investment facts. The report period ends 2026-07-26. Amounts below use USD, and periods must not be mixed.</p><table><tr><th>Indicator</th><th>Six months</th><th>Three months</th></tr><tr><td>Cash flow</td><td>USD 200</td><td>USD 100</td></tr><tr><td>Repurchases</td><td>USD 20</td><td>USD 10</td></tr></table><p>Repurchases represent prior cash payments, not a future authorization. Forward-looking plans are uncertain and need separate evidence. Earnings per share and stock-based dilution have not been independently checked in this fictional test.</p></body></html>';
export function filingIndex({both=false}={}){
 const r={accessionNumber:['0001045810-26-000075'],filingDate:['2026-08-26'],reportDate:['2026-07-26'],form:['10-Q'],primaryDocument:['nvda-20260726.htm']};
 if(both){r.accessionNumber.push('0001193125-26-000076');r.filingDate.push('2026-09-03');r.reportDate.push('2026-09-02');r.form.push('8-K');r.primaryDocument.push('current.htm');}
 return {cik:'0001045810',name:'NVIDIA CORP',tickers:['NVDA'],filings:{recent:r,files:[{name:'unread-older.json'}]}};
}
export const filingDocuments=(html=syntheticFilingHtml,index=filingIndex())=>[
 {url:SEC_TICKERS_URL,receivedAt:filingAt,body:Buffer.from(JSON.stringify(filingMap))},
 {url:secSubmissionsUrl('0001045810'),receivedAt:filingAt,body:Buffer.from(JSON.stringify(index))},
 {url:quarterlyUrl,receivedAt:filingAt,body:Buffer.from(html)}
];
