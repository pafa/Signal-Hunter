export const EVENT_IDENTITY_CONTEXT_VERSION='event-identity-paragraph/1';
export {CONTEXT_ENTITIES_VERSION} from './company-ownership.mjs';
const normalize=value=>value.normalize('NFKC').trim().toLocaleLowerCase('en-US');

// Keep the reviewed occurrence immutable. A unique quote may recover its own
// paragraph only when the named actor is missing from that quote but present
// in the paragraph. Context is evidence to review, not an automatic company link.
export function eventIdentityContext(material,event){
 if(event?.quoteField!=='body'||typeof material?.body!=='string'||typeof event.quote!=='string'||!event.quote||typeof event.actor!=='string')return null;
 const actor=normalize(event.actor);if(actor.length<2||['未知','unknown','we','our','it','they'].includes(actor)||normalize(event.quote).includes(actor))return null;
 const body=material.body,at=body.indexOf(event.quote);if(at<0||body.indexOf(event.quote,at+1)!==-1)return null;
 const paragraphs=[...body.matchAll(/\r?\n[ \t]*\r?\n/g)];
 const start=paragraphs.filter(m=>m.index+m[0].length<=at).at(-1),end=paragraphs.find(m=>m.index>=at+event.quote.length);
 const from=start?start.index+start[0].length:0,to=end?end.index:body.length,quote=body.slice(from,to);
 if(quote.length>2400||!normalize(quote).includes(actor)||quote===event.quote||/\r?\n[ \t]*\r?\n/.test(quote))return null;
 return {schema:EVENT_IDENTITY_CONTEXT_VERSION,field:'body',start:from,end:to,quote,limitation:'同段上下文仅用于核对当前事项主体；不是新事项、法律归属、证券身份或业务影响的证明'};
}

export const EVENT_IDENTITY_CONTEXT_INSTRUCTIONS=`input.identityEventContext是原事项引文所在的同一段原文，保留正文位置；原eventFocus不改写。仅为补回代词、简称或省略主体的上下文，不得按全文或邻段关联公司。
每项mention新增eventConnection：relation为direct、context、unrelated或unclear；anchorQuote只能逐字引用原eventFocus.quote，direct必须非空。主quote仍须逐字来自identityEventContext.quote并包含name；reason须解释同段主quote与原事项动作/对象的直接对应。公司名只出现在产品前缀、网页作者或常规背景不自动证明当前主体、法律归属或母子公司关系。存在不同主体、不同动作或代词指代不明时保留context/unclear，不自动关联。同段可能有多个事项，不能把所有公司加入当前事项。
只有明确公司、准确目录唯一身份、模型确定且eventConnection=direct的项可成为待核实研究关联。引用完整不证明受益、财务敞口或可交易；不从事件actor/title本身补造原文提及。`;
