export const usd=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0);
export const number=(n,d=2)=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}).format(n):'—';
export const pct=n=>Number.isFinite(n)?`${n>0?'+':''}${n.toFixed(2)}%`:'—';
export const change=q=>q?.points?.length>1?(q.last/q.points[0].close-1)*100:null;
export const names={buy:'建仓 / 增仓',sell:'减仓 / 清仓',pending:'待确认',filled:'模拟成交',rejected:'已拒绝',expired:'已过期 · 占用释放',intact:'逻辑未变',weakened:'逻辑减弱',invalidated:'逻辑失效',verify:'待核验'};
