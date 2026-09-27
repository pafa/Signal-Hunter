// Headline routing only: patterns identify questions to investigate, never verified facts.
const rules = [
 ['project-risk','项目 / 履约风险',/\bforce majeure\b|不可抗力|(?=.*(?:data cent(?:er|re)|power|financing|funding|数据中心|电力|融资))(?=.*(?:project|construction|项目|建设))(?=.*(?:delay|halt|suspend|cancel|延期|暂停|取消))/iu,'履约通知还是推测、融资与电力瓶颈、合同责任、相对项目敞口及替代方案'],
 ['investment','资本开支 / 投资计划',/(?=.*(?:invest(?:ment|s|ing)?|capex|capital spending|投资|资本开支))(?=.*(?:billion|million|亿美元|亿元))(?=.*(?:plans?|announc|commits?|raises?|cuts?|计划|宣布|承诺|上调|下调))/iu,'新计划还是既定承诺、总额与年度额、融资成本、回报周期及相对现金流'],
 ['policy','政策 / 市场准入',/(?=.*(?:export ban|export control|tariff|carbon emission|social media|chatbots?|free trade|permits?|出口|关税|准入|排放|许可证))(?=.*(?:ban|repeal|propos|plan|halt|restrict|limit|deal|禁令|撤销|计划|限制|协议))/iu,'提案、报道、否认与生效分开；行业敞口及适用范围'],
 ['industrial-deal','产业合作 / 投资',/(?=.*(?:deal|agreement|concessions?|合作|协议|让步))(?=.*(?:manufactur|make.*chips|production|investment|制造|投资|产能))/iu,'谈判或已签、投资义务、商业化可行性与受益主体'],
 ['labor','劳资 / 供给风险',/(?=.*(?:union|workers?|employees?|工会|员工))(?=.*(?:strike|walkout|罢工|停工))/iu,'罢工准备或实际发生、产能比例、库存缓冲与持续期'],
 ['energy-forecast','能源供需预期',/(?=.*(?:oil|natural gas|copper|石油|天然气|铜))(?=.*(?:output|export|supply|demand|产量|出口|供需))(?=.*(?:cuts?|raises?|slash|revis|下调|上调|修订))(?=.*(?:forecast|outlook|预期|预测))/iu,'供需预测修订幅度、期限及上市公司业务敞口'],
 ['deal','并购 / 控制权',/\b(?:acquir\w*|acquisition|takeover|merger|buyout)\b|收购|并购|重组/iu,'交易阶段、相对规模、融资与稀释'],
 ['approval','审批 / 商业化',/(?=.*(?:\bdrug\b|therapy|treatment|vaccine|disease|cancer|FDA|EMA|药|疗法|适应症))(?=.*(?:approv|authoriz|获批|批准))/iu,'正式审批范围、市场准入和原有预期'],
 ['clinical','临床 / 管线风险',/(?=.*(?:trial|clinical|study|临床|试验))(?=.*(?:fail|halt|stop|abandon|discontinu|terminat|失败|终止|未达))/iu,'试验阶段、终点、项目价值与其他管线'],
 ['recall','产品召回',/(?=.*(?:recalls?|召回))(?=.*(?:cars?|vehicles?|products?|devices?|food|batteries|units|汽车|车辆|产品|电池))/iu,'涉及范围、严重程度、补救成本与业务占比'],
 ['order','订单 / 交付',/(?=.*(?:orders?|contracts?|deal|订单|合同))(?=.*(?:billion|million|\d+\s*(?:aircraft|planes|jets)|亿美元|亿元|架飞机))(?=.*(?:wins?|signs?|lands?|secures?|finali[sz]|orders?|签署|获得|落实))/iu,'旧承诺还是新增订单、交付条件与利润'],
 ['supply','供给 / 产能冲击',/(?=.*(?:mine|plant|factory|production|output|refinery|supply|矿|工厂|产能|产量))(?=.*(?:\bhalts?\b|\bshutdown\b|\bshuts?\b|disrupt|suspend|停产|暂停|中断))/iu,'受损供给比例、库存、替代与恢复期限'],
 ['capital','资本回报',/buybacks?|share repurchases?|回购/iu,'授权与实际执行、资金来源及稀释抵消'],
 ['regulatory','监管调查',/(?=.*(?:probes?|investigat|antitrust|调查|反垄断))(?=.*(?:regulator|regulatory|authorit|government|EU\b|US\b|China|监管|政府))/iu,'调查与处罚分开、业务敞口与适用范围'],
];
const denial=/\b(?:denies|denied|denial|refutes|debunks)\b|否认|辟谣/iu;
const rumor=/\b(?:rumou?r|reportedly)\b|\bsources? (?:say|says)\b|according to sources|(?:Bloomberg(?: News)?|Politico|WSJ|Wall Street Journal|the Information|Financial Times)\s+reports?|传闻|消息人士/iu;
const tentative=/\b(?:talks|considers?|considering|set to|prepares|proposes?|may|could)\b|考虑|或将|拟议/iu;
export function acquisitionStage(text){
 if(denial.test(text))return '否认 / 反证，不能沿用旧前提';
 if(/terminat|cancel|终止|撤回/iu.test(text))return '终止 / 撤回，需评估反向影响';
 if(rumor.test(text))return '传闻 / 转述，尚未确认';
 if(/\b(?:not|never|hasn.t|haven.t|didn.t|cannot|can.t|unable to|failed to|fails to|yet to)\b[^.!?;]{0,55}\bcomplet\w*|\bincomplete\b|\bcompletion\b[^.!?;]{0,35}\b(?:delay|postpon|pending)\w*|(?:尚未|未能|无法|尚不|并未|没有).{0,15}(?:完成|交割)|(?:交割|完成).{0,10}(?:推迟|延期)/iu.test(text))return '尚未完成';
 if(tentative.test(text)||/\b(?:expects?|aims?|plans?|intends?|scheduled|will|would|pending|before|until)\b|预计|计划|有望|拟|将|有待|尚待/iu.test(text))return '拟议 / 条件待满足，尚非最终结果';
 if(/\b(?:completed|completes)\b|已完成|完成交割|交割完成/iu.test(text))return '标题称已完成，待公告核实';
 return '拟议 / 阶段待核实';
}
export function routeEvent(text){
 const matches=rules.filter(([, ,re])=>re.test(text)).map(([id,category,,question])=>({id,category,question}));
 const reversal=denial.test(text)&&/ban|deal|acquir|merger|shutdown|takeover|restrict|禁令|收购|停产|交易|限制/iu.test(text);
 if(reversal)matches.unshift({id:'denial',category:'反证 / 否认',question:'原消息、正式回应与受影响的既有研究'});
 let stage='标题线索，事实与量级待核验';
 if(denial.test(text))stage='否认 / 反证，不能沿用旧前提';
 else if(/terminat|cancel|终止|撤回/iu.test(text)&&matches.some(m=>m.id==='deal'))stage='终止 / 撤回，需评估反向影响';
 else if(rumor.test(text))stage='传闻 / 转述，尚未确认';
 else if(tentative.test(text)&&matches.length)stage='拟议 / 谈判，尚非最终结果';
 else if(matches.some(m=>m.id==='deal'))stage=acquisitionStage(text);
 else if(matches.some(m=>m.id==='capital'))stage='授权或执行状态待核验';
 // Macro/weather forecasts are not company earnings guidance.
 const nonCorporateForecast=/(?:weather|temperature|hurricane|gas output|oil demand|economic growth|GDP|天气|气温|天然气产量)/iu.test(text);
 return {matches,stage,messageStatus:denial.test(text)?'denial-reported':rumor.test(text)?'rumor':tentative.test(text)&&matches.length?'proposed':'unverified',nonCorporateForecast,magnitudeHints:[...new Set(text.match(/(?:[$€£¥]\s*\d[\d.,]*\s*(?:billion|million|bn|mln)?|\d[\d.,]*\s*(?:%|billion|million|亿元|亿美元|万辆))/giu)||[])].slice(0,5)};
}
