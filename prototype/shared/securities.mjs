export function instrument(value) {
  const symbol=String(value||'').trim().toUpperCase();
  let match;
  if ((match=/^(\d{6})\.(SH|SZ)$/.exec(symbol))) return {symbol,code:match[1],market:'A股',currency:'CNY',marketTimezone:'Asia/Shanghai',providerTimezone:'Asia/Shanghai',ids:[`${match[2]==='SH'?1:0}.${match[1]}`]};
  if ((match=/^(\d{1,5})\.HK$/.exec(symbol))) { const code=match[1].padStart(5,'0');return {symbol:`${code}.HK`,code,market:'港股',currency:'HKD',marketTimezone:'Asia/Hong_Kong',providerTimezone:'Asia/Shanghai',ids:[`116.${code}`]}; }
  if ((match=/^([A-Z][A-Z0-9.-]{0,11})\.US$/.exec(symbol))) return {symbol,code:match[1],market:'美股',currency:'USD',marketTimezone:'America/New_York',providerTimezone:'unverified',ids:[105,106,107].map(id=>`${id}.${match[1]}`)};
  throw new Error('请输入 600519.SH、00700.HK 或 AAPL.US 等股票代码');
}

// Existing manually maintained issuer groups, not an exhaustive or live security master.
const issuerGroups=[['GigaDevice','603986.SH','03986.HK'],['SMIC','688981.SH','00981.HK'],['BYD','002594.SZ','01211.HK'],['Alibaba','09988.HK','BABA.US']];
export const SECURITY_VERSION='security-identity/2026-09-25';
export function securityIdentity(value){
 const spec=instrument(value),group=issuerGroups.find(g=>g.slice(1).includes(spec.symbol));
 const venue=spec.symbol.endsWith('.SH')?'XSHG':spec.symbol.endsWith('.SZ')?'XSHE':spec.symbol.endsWith('.HK')?'XHKG':'US-UNRESOLVED';
 return {...spec,securityKey:venue+':'+spec.code,venue,issuerKey:group?.[0]||spec.symbol,relationStatus:group?'已有手工发行人映射':'跨市场关系未映射',listing:spec.symbol==='BABA.US'?'ADR':spec.market==='美股'?'上市类型待核验':spec.market,version:SECURITY_VERSION};
}
export const issuer=value=>securityIdentity(value).issuerKey;
