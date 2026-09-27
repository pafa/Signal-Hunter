export async function request(path,method='GET',data){
 const response=await fetch(path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(55000)});
 if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('本地数据服务未连接，请启动 npm run api');
 const result=await response.json();if(!response.ok)throw new Error(result.error||'请求失败');return result;
}
export const time=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'未知';
export const stanceNames={supports:'支持',against:'反向约束',context:'背景',unverified:'待核实'};
export const verificationNames={primary:'官方资料',reported:'媒体 / 公告报道',reviewed:'人工核验',unverified:'未核实'};
export const familyNames={adoption:'采用 / 活跃',mechanism:'运行机制',ecosystem:'生态连接',constraint:'限制 / 风险',supply:'供给能力',purchase:'采购 / 订单',earnings:'财务兑现',corporate:'公司行动',other:'其他'};
