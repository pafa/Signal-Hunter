// All prices, news, quantities, analyses and returns below are fictional UI fixtures.
export const stocks = [
  { id:'maotai', symbol:'600519.SH', name:'贵州茅台', market:'A股', currency:'CNY', price:1496.98, entry:1450, range:[1430,1460], target:[1550,1600], hold:[20,30], event:'渠道数据改善', sector:'消费 · 白酒', trend:[0,.8,.5,1.6,1.4,2.1,1.9,1.5,2.6,2.9,2.3,2.5,3.24], risk:'渠道库存再次增加，或需求改善未在后续数据中得到验证。' },
  { id:'msft', symbol:'MSFT', name:'微软', market:'美股', currency:'USD', price:445.96, entry:420, range:[415,423], target:[458,470], hold:[15,30], event:'企业云需求扩张', sector:'科技 · 云计算', trend:[0,1.2,.8,2.4,2.1,3.3,3.1,4.2,3.8,4.7,5.9,5.4,6.18], risk:'云业务需求未转化为收入，或资本开支挤压利润率。' },
  { id:'baba', symbol:'9988.HK', name:'阿里巴巴', market:'港股', currency:'HKD', price:124.8, entry:121, range:[120,123], target:[134,140], hold:[10,20], event:'云业务指引变化', sector:'科技 · 云与电商', trend:[0,.2,.1,1.4,1.1,2.4,2.8,1.8,2.2,2.1,2.9,3.2,3.6], risk:'观察后续财报是否支持增长假设，关注投入增加对现金流的影响。' },
  { id:'nvda', symbol:'NVDA', name:'英伟达', market:'美股', currency:'USD', price:130.24, entry:130.24, range:[128,132], target:[142,148], hold:[10,20], event:'算力资本支出上调', sector:'科技 · 半导体', trend:[0,-.5,.8,.4,1.8,1.4,3.1,2.7,3.2,2.5,4.8,4.3,5.6], risk:'若客户资本开支下修、交付延迟，或示例价格跌破 US$ 122，重新评估买入逻辑。' },
  { id:'tencent', symbol:'0700.HK', name:'腾讯控股', market:'港股', currency:'HKD', price:512.4, entry:512.4, range:[505,518], target:[548,565], hold:[15,30], event:'游戏业务增长超预期', sector:'互联网 · 游戏', trend:[0,1,.7,1.5,1.1,1.9,1.6,2.4,2.3,3.1,2.7,3.5,3.8], risk:'新产品表现不及预期，或增长不能延续到下一报告期。' },
  { id:'catl', symbol:'300750.SZ', name:'宁德时代', market:'A股', currency:'CNY', price:286.8, entry:286.8, range:[278,289], target:[310,325], hold:[20,40], event:'储能订单落地', sector:'新能源 · 电池', trend:[0,.5,.2,1.4,2.3,1.4,2.2,2.1,3.5,3.8,3.2,4.4,4.1], risk:'订单兑现节奏低于预期，或行业价格竞争抵消订单增量。' },
  { id:'xiaomi', symbol:'1810.HK', name:'小米集团', market:'港股', currency:'HKD', price:33.84, entry:34.9, range:[34,35], target:[38,40], hold:[10,20], event:'新产品交付提速', sector:'消费科技 · 汽车', trend:[0,.7,.2,-.4,-.9,-.5,-1.5,-1.1,-2.2,-1.7,-2.5,-2.8,-3.04], risk:'交付增长未带来利润改善；计划窗口已接近，优先检查假设。' },
  { id:'zijin', symbol:'601899.SH', name:'紫金矿业', market:'A股', currency:'CNY', price:24.23, entry:23.2, range:[22.8,23.4], target:[25.5,27], hold:[20,40], event:'铜价与产量预期改善', sector:'资源 · 有色金属', trend:[0,.3,.2,1.1,.7,1.8,1.4,2.3,2.1,3.6,3.1,3.9,4.44], risk:'金属价格回落或新增产量未如期释放。' },
];

export const byId = Object.fromEntries(stocks.map(s => [s.id,s]));
export const events = [
 { id:'event-nvda', stockId:'nvda', category:'产业动态', time:'09-24 09:18', title:'算力投入计划上调，关注订单向收入的传导', summary:'情景假设：大型云服务商上调下一阶段算力投入计划。观察 GPU 订单能否兑现，而不是只跟随新闻标题。', thesis:'支出预期上修，可能提高计算芯片的需求能见度。', chain:['资本开支计划上调，为算力需求提供先行线索。','若采购与交付节奏兑现，相关芯片业务有望受益。','观察价格是否进入计划区间，再结合后续订单证据判断。'], counter:'资本开支也可能流向自研芯片；乐观预期可能已经反映在价格中。', review:'5 个交易日后核查订单与交付线索；第 10 日复核是否继续持有。' },
 { id:'event-tencent', stockId:'tencent', category:'公司经营', time:'09-24 08:42', title:'游戏业务表现改善，观察增长的持续性', summary:'情景假设：重点游戏产品表现强于原先假设。需要继续观察留存、流水与后续产品节奏。', thesis:'产品表现改善可能带来收入与经营利润预期修正。', chain:['产品表现改善，形成值得跟踪的经营线索。','增长持续性决定收入预期是否需要调整。','结合估值和后续经营验证，分阶段复核交易假设。'], counter:'单期增长可能受活动驱动，不能直接外推整个季度。', review:'第 7 个交易日复核产品表现；第 15 日重新评估持有周期。' },
 { id:'event-catl', stockId:'catl', category:'订单变化', time:'09-23 15:36', title:'储能项目订单落地，关注兑现节奏与毛利', summary:'情景假设：新增储能项目订单进入执行阶段。跟踪交付节奏与订单质量，而不是只比较订单总额。', thesis:'新增订单可能改善产能利用率，但利润传导仍需验证。', chain:['项目由意向转向执行，需求线索更清晰。','交付带来利用率改善，关注毛利能否同步提升。','在预定价格区间申请买入，持续跟踪兑现进度。'], counter:'订单规模不等于净利润，原材料和竞争可能抵消增量。', review:'每 10 个交易日核对交付与利润假设。' },
 { id:'event-baba', stockId:'baba', category:'业务指引', time:'09-23 11:05', title:'云业务指引变化，等待增长质量进一步验证', summary:'情景假设：管理层对云业务增长表达更积极判断。先保留观察，再结合真实业务数据决定是否申请买入。', thesis:'若增长与利润改善同步出现，可能形成新的研究机会。', chain:['增长指引出现变化，建立关注记录。','比较需求增长、定价与投入之间的关系。','后续证据支持时，才转为模拟买入申请。'], counter:'指引可能尚未转化为收入；投入期自由现金流可能承压。', review:'下一次业务数据更新时复核，最长 10 个交易日重新判断。' },
 { id:'event-msft', stockId:'msft', category:'需求变化', time:'09-10 10:20', title:'企业云需求扩张，持续跟踪收入转化', summary:'情景假设：企业云需求增强，已建立模拟持仓。现在重点验证增长能否延续，而不是重复放大初始叙事。', thesis:'需求增强有望支撑收入增长，持续观察利润率变化。', chain:['需求线索出现后形成初始研究假设。','人工确认后建立模拟持仓。','比较阶段表现与原始判断，决定是否继续持有。'], counter:'资本开支与折旧可能压低利润率。', review:'第 15 个交易日进行持有期复盘。' },
 { id:'event-zijin', stockId:'zijin', category:'行业周期', time:'09-05 13:45', title:'铜价与产量预期改善，验证周期和公司因素', summary:'情景假设：行业价格与公司产量线索同时改善。持仓后分开追踪行业贡献和公司执行情况。', thesis:'价格与产量共振可能改善经营表现。', chain:['记录行业价格与公司产量的独立线索。','在计划条件内建立模拟持仓。','持续核查两个驱动是否都在兑现。'], counter:'周期反转可能压过公司产量增长。', review:'每 10 个交易日核查产量与行业假设。' },
];
export const eventFor = id => events.find(e=>e.stockId===id);
export const initialPositions = [
 {stockId:'maotai',qty:100,price:1450,date:'09-05',days:14},
 {stockId:'msft',qty:20,price:420,date:'09-10',days:11},
 {stockId:'xiaomi',qty:500,price:34.9,date:'08-28',days:19},
 {stockId:'zijin',qty:1000,price:23.2,date:'09-05',days:14},
];
export const initialApplications = ['nvda','tencent','catl'].map((stockId,i)=>({
 id:`REQ-00${i+1}`,stockId,type:'buy',status:'pending',price:byId[stockId].price,qty:[20,100,100][i],created:['09-24 09:26','09-24 09:05','09-23 16:02'][i],note:'',eventId:eventFor(stockId).id,
}));

export const portfolioCurves = {
 '1周':[2.01,2.1,1.82,2.54,2.71,2.37,3.12,3.29],
 '1月':[0,-.5,-.1,.2,.8,.72,1.2,1.08,1.9,1.4,1.6,1.25,2.01,1.84,2.34,2.24,2.86,3.01,2.44,2.76,3.38,3.27,4.42,4.77,4.33,4.92,5.12,4.62,4.43,5.29,4.82],
 '3月':[0,-1.2,.2,1.4,.6,2.1,1.5,2.8,2.3,3.9,3.1,4.5,3.9,5.2,4.8,5.6,6.9,6.3,7.9,7.31],
 '全部':[0,.9,-2.1,-.2,1.8,1.2,3.2,2.3,4.6,3.5,5.6,5.1,6.8,6.1,8.2,7.7,9.8,9.16],
};
export const periodLabels = {'1周':['09/18','09/21','09/24'],'1月':['08/26','09/02','09/09','09/16','09/24'],'3月':['06/26','07/18','08/10','09/01','09/24'],'全部':['04/01','05/15','07/01','08/15','09/24']};

export function money(n,currency='CNY') { return `${({CNY:'¥',HKD:'HK$',USD:'US$'})[currency]} ${Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
export function pct(n) { return `${n>=0?'+':''}${n.toFixed(2)}%`; }
export function holdText(stock) {return `${stock.hold[0]}–${stock.hold[1]} 个交易日`;}
export function gain(position) {return (byId[position.stockId].price / position.price - 1) * 100;}
export function nowLabel() { return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace('/','-'); }
