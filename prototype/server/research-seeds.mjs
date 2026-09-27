// Curated retrospective cases: imported now, never backdated as early discoveries.
const source={
  meta:'https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse',
  spotify:'https://newsroom.spotify.com/2026-09-23/spotify-meta-muse-agent/',
  amazon:'https://www.axios.com/2026/09/21/amazon-meta-muse-ai-agentic-shopping',
  rank:'https://www.axios.com/2026/09/18/meta-muse-personal-agent-make-money',
  xinhua:'https://money.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=12610617&stockid=600825',
  amd:'https://www.amd.com/en/products/processors/server/epyc/ai/agentic-ai.html',
  arm:'https://newsroom.arm.com/news/arm-agi-cpu-neoverse-css-n4-agentic-ai',
  intel:'https://www.intel.com/content/dam/www/central-libraries/us/en/documents/2024-12/xeon-6-processors-with-p-cores-ig.pdf',
};
const evidence=(id,claim,sourceName,url,date,family,step,extra={})=>({id,claim,sourceName,url,publishedAt:date,datePrecision:date?'day':'unknown',family,step,originKey:sourceName,stance:'supports',verification:'primary',...extra});
const company=(symbol,name,role,note,url)=>({symbol,name,role,note,url});
const hypothesis=(logic,trigger,invalidation,industryHorizon)=>({logic,trigger,invalidation,industryHorizon,holdingHorizon:'尚未确定；产业周期不等于单笔持有期',reviewAt:'',action:'observe'});

export function researchSeeds(at=new Date().toISOString()) {
 const vm=evidence('muse-vm','Muse 的独立 Linux 虚拟机使用 CPU、内存与存储执行任务。','Meta 技术说明',source.meta,'2026-09-08','mechanism','load');
 const spotify=evidence('spotify-connection','Spotify 公告支持 Muse 播放、搜索及管理歌单。','Spotify 官方',source.spotify,'2026-09-23','ecosystem','access');
 const amazon=evidence('amazon-block','Amazon 限制 Muse 购物访问。','Axios',source.amazon,'2026-09-21','constraint','access',{verification:'reported',stance:'against'});
 const ranking=evidence('muse-rank','Muse 登顶美国 iPhone 免费应用榜（报道口径）。','Axios',source.rank,'2026-09-18','adoption','adoption',{verification:'reported'});
 const userClue=evidence('grok-linux','用户线索：Grok 迭代、Linux 复兴、Company Agent 增长；具体版本、规模与时间序列待补。','用户提出','',null,'adoption','adoption',{verification:'unverified',stance:'unverified',originKey:'user'});
 const memory={
  id:"memory-global",title:"存储景气会如何跨市场传导？",type:"cluster",label:"全球联动",summary:"美股先行只触发复核；核验存储景气、业务差异和 A/H 预期差。",
  chain:[{id:"leader",title:"海外增量",question:"订单、指引或股价改变了什么？"},{id:"cycle",title:"景气验证",question:"DRAM/NAND/NOR 价格与库存是否同向？"},{id:"mapping",title:"公司传导",question:"对应产品、客户与利润敏感性如何？"},{id:"expectation",title:"预期差",question:"当地股价、盈利预测已反映多少？"}],
  evidence:[evidence("memory-user","用户提出：美国存储公司变化可能传导到港股和 A 股估值；尚无本轮涨幅与因果核验。","用户提出","",null,"other","leader",{verification:"unverified",stance:"unverified"}),evidence("micron-business","Micron 业务涵盖 DRAM、NAND、NOR；业务资料不是股价上涨或新增订单证据。","Micron 官方","https://www.micron.com/about/company/corporate-profile",null,"supply","mapping",{stance:"context"}),evidence("giga-ah","兆易创新官方披露 A 股 603986 与港股 3986，两地上市属于同一公司。","GigaDevice 官方","https://www.gigadevice.com/about/news-and-event/news/gigadevice-listed-on-hkex",null,"corporate","mapping",{stance:"context"})],
  companies:[company("MU.US","Micron","存储制造 / 海外参照","产品组合与 HBM、DRAM、NAND 周期需分开。","https://www.micron.com/about/company/corporate-profile"),company("603986.SH","兆易创新 A","存储设计 / A 股映射","NOR、利基 DRAM 与美光产品结构不同；不可机械套涨幅。","https://www.gigadevice.com/about/news-and-event/news/gigadevice-listed-on-hkex"),company("03986.HK","兆易创新 H","同一发行人 / H 股","与 A 股合并算集中度；汇率、流动性和交易时段不同。","https://www.gigadevice.com/about/news-and-event/news/gigadevice-listed-on-hkex"),company("688008.SH","澜起科技","内存接口 / 配套环节","不是存储颗粒厂；需验证服务器内存升级带来的价值量。","https://www.montage-tech.com/Solution/General-Purpose_Server")],
  hypothesis:hypothesis("海外存储变化可能经供需与预期传导至 A/H 相关公司，需确认业务敞口和本地尚未计价的增量。","确认同类产品景气、公司订单与当地预期差后再评估价位。","海外涨幅由个别客户或 HBM 业务推动；国内产品结构不匹配；本地价格已充分反映。","按价格/库存月度与财报季度验证；不预设补涨时间"),nextEvidence:"同口径产品价格、库存、盈利预测修订和三地收盘时点对齐；先剔除汇率和大盘影响。"
 };
 const topics=[memory,{
  id:'agent-cpu',title:'Agent 普及会改变 CPU 需求吗？',type:'cluster',label:'复合假设',summary:'把产品采用、运行机制与硬件供给放入同一条链，验证新增需求最终由谁兑现。',
  chain:[{id:'adoption',title:'Agent 活跃',question:'新增、留存、付费与实际任务量是否持续？'},{id:'load',title:'CPU 负载',question:'每活跃用户 CPU 秒、并发与效率变化是多少？'},{id:'purchase',title:'采购增量',question:'现有闲置容量能否消化？是否形成新增订单？'},{id:'earnings',title:'盈利兑现',question:'哪些公司份额、售价、利润和估值会改变？'}],
  evidence:[vm,ranking,userClue,evidence('amd-position','AMD 将 EPYC 作为 Agent 工作负载方案；属于供应商产品主张，尚非采购兑现证据。','AMD 官方',source.amd,null,'supply','load',{stance:'context'}),evidence('arm-position','Arm 推出面向 Agent 的 CPU 与 Neoverse 平台方案；仍需核验客户采购和财务贡献。','Arm 官方',source.arm,'2026-09-08','supply','purchase',{stance:'context'}),evidence('arm-prior','历史对照：Arm 在 3 月已发布面向 Agent 的 CPU，说明产业叙事早已出现；本次需找超出旧预期的增量。','Arm 官方','https://newsroom.arm.com/news/arm-agi-cpu-launch','2026-03-24','supply','purchase',{stance:'context'})],
  companies:[company('INTC.US','Intel','CPU 供应商','Xeon 敞口待量化；竞争份额与其他业务会影响收益。',source.intel),company('AMD.US','AMD','CPU / GPU 供应商','EPYC 是研究入口；不能把公司整体视为纯 CPU 敞口。',source.amd),company('ARM.US','Arm','CPU 产品 / IP 平台','区分芯片业务与授权收入，核验合同和兑现周期。',source.arm)],
  hypothesis:hypothesis('若 Agent 活跃和任务量持续增加，且单任务效率提升不足以抵消计算用量，可能带动 CPU 与服务器需求。','先获得真实 CPU 消耗时间序列，再检查增量采购、供应商订单及市场预期差。','GPU 推理可能同步增长；任务效率提高、闲置容量、云厂商自研、价格竞争都可能削弱上市公司的收益。','约一年（用户初始假设，未验证）'),
  nextEvidence:'活跃 Agent × 任务量 × 单任务 CPU 秒，再对照服务器采购、订单与公司盈利。',
 },{
  id:'spotify-access',title:'Spotify 接入 Muse，生态价值如何兑现？',type:'cluster',label:'生态分化',summary:'开放与限制是两种平台策略。接入扩大使用场景的可能性，仍须验证增量用户与收入。',
  chain:[{id:'access',title:'开放 / 限制',question:'功能范围和授权边界是什么？'},{id:'usage',title:'使用增量',question:'是否新增收听、留存与付费转化？'},{id:'earnings',title:'盈利兑现',question:'收入增量能否覆盖内容成本？'}],evidence:[spotify,amazon,ranking],
  companies:[company('SPOT.US','Spotify','直接接入平台','潜在受益待验证：留存、付费转化、内容成本。',source.spotify),company('META.US','Meta','Agent 提供方','接入丰富功能；封禁同时限制可服务范围。',source.meta),company('AMZN.US','Amazon','限制访问的平台','电商控制与云计算需求存在不同影响方向。',source.amazon)],
  hypothesis:hypothesis('开放 Muse 可能改善 Spotify 的使用便利性，并带来留存或转化增量。','跟踪实际接入使用量、付费转化与收入，比较市场原有预期。','便利性未带来新增付费；用户入口被 Agent 控制；内容成本抵消收入增长。','尚待评估；产品使用验证与财报兑现分别跟踪'),nextEvidence:'Muse 入口的新增收听、付费转化及留存数据；不从开放本身推定“大幅利好”。',
 },{
  id:'muse-adoption',title:'Muse 登顶美国免费榜',type:'event',label:'产品突破',summary:'排名跃迁是值得优先核验的线索；持续使用与商业转化决定其后续意义。',
  chain:[{id:'adoption',title:'榜单突破',question:'地区、榜单类别、时点是否一致？'},{id:'retention',title:'持续使用',question:'榜单持续多久？留存是否提高？'},{id:'earnings',title:'商业兑现',question:'付费、收入或成本如何变化？'}],evidence:[ranking],companies:[company('META.US','Meta','产品所属公司','Muse 产品热度与 Meta 财务影响需单独建立联系。',source.meta)],hypothesis:hypothesis('产品采用出现跃迁，可能改变用户获取或 Agent 使用规模。','补充官方榜单连续快照、留存与使用指标。','短期营销或尝鲜后使用下降；缺少付费与成本验证。','热度按天 / 周观察；商业影响待财报验证'),nextEvidence:'美国 iPhone 免费总榜的连续快照；首次快照只作基线，不能声称发现登顶时刻。',
 },{
  id:'xinhua-acquisition',title:'新华传媒拟收购界面财联社 100% 股权',type:'event',label:'重大重组',summary:'控制权及业务结构变化值得优先核验。预案阶段与完成交割必须分开。',
  chain:[{id:'proposal',title:'重组预案',question:'收购比例、对价、估值及发行稀释？'},{id:'approval',title:'审核 / 条件',question:'哪些批准尚未完成？'},{id:'closing',title:'交割 / 兑现',question:'是否完成与并表，业绩如何兑现？'}],evidence:[evidence('xinhua-plan','公司披露拟发行股份购买界面财联社 100% 股权的预案；不是已完成收购。','公司预案（公告转载）',source.xinhua,'2026-09-19','corporate','proposal',{verification:'reported'})],companies:[company('600825.SH','新华传媒','拟收购方','直接主体；核对对价、稀释、审批及交易条件。',source.xinhua)],hypothesis:hypothesis('重大重组可能改变业务结构与盈利预期，实际影响取决于交易条件。','核对最新正式公告、交易阶段、估值、稀释与预期差。','方案终止、审批失败、对价或盈利假设不成立。','随预案、审核、交割分别复核；不预设持有时长'),nextEvidence:'正式预案与后续修订、交易对价和发行稀释、审核及交割节点。',
 }];
 return topics.map(topic=>({...topic,status:'active',origin:'retrospective-case',createdAt:at,updatedAt:at,version:1,evidence:topic.evidence.map(e=>({...e,firstSeen:at,retrospective:true}))}));
}
