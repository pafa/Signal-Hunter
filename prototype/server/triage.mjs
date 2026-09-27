// Cheap, explainable headline routing. These rules never declare a trade signal.
import {routeEvent,acquisitionStage} from './event-routing.mjs';
import {headlineCompanies} from '../shared/company-directory.mjs';
import {headlineScreening} from '../shared/headline-screening.mjs';
export const RULES_VERSION = 'major-triage/0.5.0';

export function classifyHeadline(item) {
  const text=item.title||'', reasons=[],topicHints=[];
  let bucket='quiet',category='常规资讯',stage='标题待核验';
  const muse=/\bmuse\b/i.test(text)&&!/\bband\b|\bconcert\b|乐队/i.test(text);
  const agent=/\bagent(?:s|ic)?\b|personal ai|智能体/i.test(text);
  const cpu=/\bcpu\b|\bepyc\b|\bxeon\b|\bneoverse\b|linux|服务器/i.test(text);
  if(/acquir|acquisition|takeover|merger|收购|重组|并购/i.test(text)&&/100\s*%|control(?:ling)?|all[- ](?:cash|stock)|buyout|控股|全资|全部|重大/i.test(text)) {
    bucket='review';category='控制权 / 重大重组';reasons.push('出现控制权或全额交易线索，需要核对标的、交易阶段与相对体量');
    stage=acquisitionStage(text);
    if(/新华传媒|财联社|界面财联社/.test(text))topicHints.push('xinhua-acquisition');
  }
  if((muse||/app store|应用商店/i.test(text))&&/no\.?\s*1\b|number one|top[s]?\b.*(?:chart|app)|overtak|登顶|榜首/i.test(text)) {
    bucket='review';category='产品突破';reasons.push('出现登顶或排名突破线索；需补地区、榜单类别、持续天数及活跃留存');
  }
  if((muse||agent)&&/block|ban(?:s|ned)?\b|restrict|integrat|connect|partner|封禁|限制|接入|开放|合作/i.test(text)) {
    bucket='review';category='生态开放 / 约束';reasons.push('平台开放或限制可能改变触达范围；方向及盈利影响未确认');
  }
  if(/files? for bankruptcy|default(?:s|ed)? on|accounting fraud|fabricated (?:revenue|sales|accounts)|(?:auditor|audit firm).{0,35}resign|(?:financial statements|accounts).{0,35}(?:not|cannot|can't).{0,15}relied|withdraws? financial statements|license revok|approval revok|申请破产|债务违约|财务造假|吊销许可|撤销批准|审计师辞任|撤回财报/i.test(text)){
    bucket='review';category='经营 / 存续风险';reasons.push('可能改变经营存续或关键业务资格；先核验原始公告、主体与事件阶段');
  }
  if(/(?:earnings|profit|revenue|盈利|利润|收入).{0,20}(?:fall|drop|plung|collaps|下降|暴跌).{0,15}\d+\s*%|(?:loses?|leaves?|terminates?).{0,25}(?:key|largest|major) customer|(?:key|largest|major) customer.{0,20}(?:leaves?|terminates?)/i.test(text)){
    bucket='review';category='经营变化';reasons.push('经营规模或关键客户变化候选；核对基期、一次性因素、业务占比及已知预期');
  }
  if(/(?:announc|impos|tighten|lift|approv|repeal|实施|宣布|取消|通过).*(?:export (?:ban|control)|sanction|tariff|出口管制|制裁|关税)/i.test(text)){
    bucket='review';category='政策 / 准入变化';reasons.push('可能改变市场准入或成本；需确认生效时间、适用范围及公司业务敞口');
  }
  if(/(?:rais|cut|slash|withdraw|boost|上调|下调|撤回).*(?:guidance|outlook|forecast|指引|盈利预测)/i.test(text)){
    bucket='review';category='经营指引变化';reasons.push('经营预期可能改变；核对新旧指引、相对幅度和市场事前预期，不能只看增长率');
  }
  if(/(?:major|record|largest|multi.year|重大|创纪录|长期).*(?:contract|order|supply deal|订单|合同)|(?:factory|plant|产线).*(?:shutdown|halt|fire|停产|火灾)/i.test(text)){
    bucket='review';category='订单 / 供给冲击';reasons.push('订单或供给可能改变收入路径；需要金额、期限、产能占比及对手方确认');
  }
  if(/\bmicron\b|\bdram\b|\bnand\b|\bhbm\b|gigadevice|memory chip|存储芯片|兆易创新|澜起科技/i.test(text))topicHints.push('memory-global');
  if(muse)topicHints.push('muse-adoption','agent-cpu');
  if(muse&&/spotify|amazon/i.test(text))topicHints.push('spotify-access');
  if((agent&&cpu)||(/\bgrok\b/i.test(text)&&/updat|releas|迭代|更新/i.test(text)))topicHints.push('agent-cpu');
  if(bucket==='quiet'&&topicHints.length){bucket='clue';category='主题增量线索';reasons.push('与在研主题有关，单条不足以认定为重大事件');}
  const event=routeEvent(text);
  if(category==='经营指引变化'&&event.nonCorporateForecast){bucket='clue';category='宏观线索';reasons.splice(0,reasons.length,'宏观预测不是公司盈利指引；业务传导需单独验证');}
  if(event.matches.length){bucket='review';category=event.matches[0].category;stage=event.stage;for(const m of event.matches)reasons.push(`候选核验：${m.question}`);}
  if(!reasons.length)reasons.push('当前规则未命中；可人工提升或关联主题，未命中不等于不重要');
  const companies=headlineCompanies(text);
  const result={rulesVersion:RULES_VERSION,bucket,category,stage,messageStatus:event.messageStatus,reasons,matchedRules:event.matches.map(m=>m.id),magnitudeHints:event.magnitudeHints,topicHints:[...new Set(topicHints)],companies,contentScope:'headline-only',assessment:'重大性待核验',tradeSignal:false};
  return {...result,screening:headlineScreening(item,result)};
}

export function evidenceCoverage(topic) {
  const rows=topic.evidence||[];
  // Count origins, not repeated articles or attachments. Context is not proof of a causal link.
  const usable=rows.filter(e=>e.verification!=='unverified'&&e.stance!=='unverified');
  const support=usable.filter(e=>e.stance==='supports');
  const families=[...new Set(support.map(e=>e.family))];
  const origins=[...new Set(support.map(e=>e.originKey))];
  return {pendingAgainst:rows.filter(e=>e.verification==='unverified'&&e.stance==='against').length,support:support.length,against:usable.filter(e=>e.stance==='against').length,
    pending:rows.filter(e=>e.verification==='unverified'||e.stance==='unverified').length,
    families,origins,missingSteps:(topic.chain||[]).filter(step=>!support.some(e=>e.step===step.id)).map(step=>step.id),
    conclusion:'证据覆盖情况，不是重大性分数或上涨概率'};
}
