import {byId,eventFor} from '../data';
import {initialState} from '../state';

// Fictional scenario revisions. Urgency is manually authored for UI review.
export const increments=[
 {id:'inc-xiaomi',stockId:'xiaomi',time:'14:32',kind:'反证',urgency:'urgent',title:'交付节奏低于原假设',before:'交付提速，等待利润兑现',after:'兑现节奏放缓，原有假设需要复核',impact:'持仓已进入计划末段，优先复核并评估减仓。',counter:'单一交付线索不能代表整个季度，需要进一步核验。',reason:'持仓反证 · 接近复核期',next:'下一次交付数据更新；最迟第 20 个交易日',version:'R03 → R04',source:'演示场景 / 交付线索修订'},
 {id:'inc-nvda',stockId:'nvda',time:'14:28',kind:'更新',urgency:'watch',title:'算力订单预期上修',before:'仅有投入计划，订单尚未验证',after:'增加采购意向线索，收入兑现仍待核验',impact:'研究假设增强，维持建仓申请，等待人工判断。',counter:'采购意向不等于已确认订单；自研芯片可能分流需求。',reason:'待批申请 · 新证据',next:'5 个交易日内核查订单与交付',version:'R01 → R02',source:'演示场景 / 订单线索'},
 {id:'inc-msft',stockId:'msft',time:'14:25',kind:'更新',urgency:'watch',title:'云需求线索继续改善',before:'需求增强，观察转化',after:'新增需求线索与原判断一致',impact:'可评估增仓，先核对持仓暴露与原始判断。',counter:'资本开支与折旧仍可能压低利润率。',reason:'持仓更新 · 增仓待评估',next:'第 15 个交易日复核收入转化',version:'R02 → R03',source:'演示场景 / 企业需求'},
 {id:'inc-tencent',stockId:'tencent',time:'14:21',kind:'新增',urgency:'normal',title:'游戏经营数据出现改善',before:'暂无本轮研究记录',after:'建立增长持续性观察假设',impact:'进入重点研究，形成建仓申请供你判断。',counter:'活动期表现不能直接外推长期收入。',reason:'新增观察机会',next:'第 7 个交易日核对产品表现',version:'新建 R01',source:'演示场景 / 经营数据'},
 {id:'inc-catl',stockId:'catl',time:'14:16',kind:'更新',urgency:'normal',title:'储能订单进入执行阶段',before:'项目处于意向阶段',after:'执行线索增加，毛利改善未验证',impact:'继续跟踪交付兑现，暂不改变持有期假设。',counter:'订单规模不等于利润，价格竞争可能抵消增量。',reason:'例行研究更新',next:'10 个交易日内核对交付与毛利',version:'R01 → R02',source:'演示场景 / 项目进度'},
 {id:'inc-baba',stockId:'baba',time:'14:08',kind:'新增',urgency:'normal',title:'云业务指引变化',before:'尚未纳入本轮重点',after:'新增观察，等待业务数据支持',impact:'保持观察；补充证据后再提交申请。',counter:'增长指引尚未转化为收入或现金流。',reason:'观察中 · 不急于决策',next:'下一次业务数据更新',version:'新建 R01',source:'演示场景 / 业务指引'},
];
export const urgencyNames={urgent:'紧急',watch:'关注',normal:'常规'};
export function researchFor(stockId){return increments.find(e=>e.stockId===stockId)||{id:`plan-${stockId}`,stockId,time:'—',kind:'计划',urgency:'normal',title:byId[stockId].event,before:'已建立初始研究假设',after:'本轮没有新证据，维持观察',impact:eventFor(stockId)?.thesis||'继续验证经营改善与价格表现。',counter:byId[stockId].risk,reason:'例行持仓复核',next:'在原定持有期内复核',version:'R01',source:'初始演示研究计划'};}
export function terminalInitialState(){const state=initialState();return {...state,nextId:6,applications:[
 {id:'REQ-004',stockId:'xiaomi',type:'sell',status:'pending',price:33.84,qty:200,created:'09-24 14:32',note:'交付假设减弱，申请减少 200 股演示持仓。'},
 {id:'REQ-005',stockId:'msft',type:'buy',status:'pending',price:445.96,qty:10,created:'09-24 14:25',note:'需求线索继续改善，申请增加 10 股演示持仓。'},
 ...state.applications,
]};}
export function actionLabel(app,held,qty=app.qty){return app.type==='buy'?(held?'增仓':'建仓'):Number(qty)===(held?.qty||0)?'清仓':'减仓';}
