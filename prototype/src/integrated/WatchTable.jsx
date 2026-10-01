import React from 'react';
import {number} from './format';
export default function WatchTable({rows,picks,setPicks,checks,onCompany}){
 return <div className="watch-table-scroll"><table className="i-table watch-research-table"><thead><tr><th>比较</th><th>公司 / 原币收盘</th><th>关注原因 / 最新变化</th><th>持仓 / 待批</th><th>下次复核</th></tr></thead><tbody>{rows.map(c=><tr key={c.symbol}>
 <td><input type="checkbox" aria-label={`比较 ${c.symbol}`} checked={picks.includes(c.symbol)} disabled={!picks.includes(c.symbol)&&picks.length>=6} onChange={e=>setPicks(v=>e.target.checked?[...v,c.symbol]:v.filter(s=>s!==c.symbol))}/></td>
 <td><button className="daily-company" onClick={()=>onCompany(c.symbol)}><b>{c.name}</b><small>{c.symbol}</small></button><span>{number(c.quote?.points?.filter(p=>p.close>0).at(-1)?.close)} {c.quote?.currency||'—'}</span><small>{checks['daily:'+c.symbol]?.state==='error'?'更新失败 · 缓存时间 ':''}{c.quote?.lastDate||'日线缺失'}</small></td>
 <td><p>{c.reason||c.note||'尚无研究关系'}</p><small>主题增量：{c.latestChange||'暂无增量'}</small></td><td>{c.positionQty?`${number(c.positionQty)} 股`:'无持仓'}<small>{c.pending||0} 笔待批</small></td><td>{c.reviewAt||'待安排'}</td>
 </tr>)}</tbody></table><p className="m-note">勾选最多 6 家，再切换多股并列或同基准对比。日期及比较组合在本浏览器会话中保留。</p></div>;
}
