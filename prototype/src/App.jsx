import React,{useReducer,useState,useEffect} from 'react';
import {initialState,reducer} from './state';
import {byId,events} from './data';
import {Icon,Button,Panel} from './components';
import {Dashboard,Watchlist} from './Dashboard';
import {Research} from './Research';
import {Applications,Records} from './Transactions';
import {Portfolio} from './Portfolio';
import {ApplicationDrawer,StockDrawer} from './Details';

const navigation=[{id:'overview',label:'研究概览',icon:'home'},{id:'research',label:'事件分析',icon:'file'},{id:'applications',label:'待审批申请',icon:'user'},{id:'portfolio',label:'模拟持仓',icon:'chart'},{id:'watchlist',label:'关注列表',icon:'star'},{id:'records',label:'决策记录',icon:'book'}];
function Sources(){return <><div className="page-title"><div><h1>来源与规则</h1><p>先确定工作台如何帮助你，再决定信息如何进入。</p></div></div><Panel className="sources-panel"><div className="sources-intro"><Icon name="file" size={26}/><h2>这部分，留待你来定义。</h2><p>本次初稿用少量预设事件展示分析和决策过程。新闻入口与重大性判断没有被默认设定。</p></div><div className="future-row"><span>01</span><div><h3>新闻怎么进来</h3><p>后续由你指定来源、导入方式和需要保留的信息。</p></div><span className="quiet-label">待定义</span></div><div className="future-row"><span>02</span><div><h3>什么是重大新闻</h3><p>后续一起确定事件类别、影响范围和进入研究的标准。</p></div><span className="quiet-label">待定义</span></div><div className="future-row"><span>03</span><div><h3>重点关注哪些股票</h3><p>围绕关注标的、相关申请与已买入股票跟踪，不做全市场采集。</p></div><span className="quiet-label">范围已明确</span></div><div className="prototype-note"><Icon name="info"/><span>原型中的事件、分析、行情和收益都是演示数据。操作保留在当前页面，刷新后恢复初始样例。</span></div></Panel></>;}

export default function App(){
 const [state,dispatch]=useReducer(reducer,undefined,initialState),[page,setPage]=useState('overview'),[detail,setDetail]=useState(null),[toast,setToast]=useState('');
 const pending=state.applications.filter(a=>a.status==='pending').length;
 const counts={research:events.length,applications:pending,portfolio:state.positions.length};
 const label=navigation.find(n=>n.id===page)?.label||'来源与规则';
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),4200);return()=>clearTimeout(timer);},[toast]);
 const navigate=id=>{setPage(id);setDetail(null);window.scrollTo({top:0,behavior:'instant'});};
 const onApplication=id=>setDetail({kind:'application',id});const onStock=id=>setDetail({kind:'stock',id});
 const onSubmit=(stockId,side)=>{const existing=state.applications.find(a=>a.stockId===stockId&&a.status==='pending');if(existing){onApplication(existing.id);return;}const id=`REQ-${String(state.nextId).padStart(3,'0')}`;dispatch({type:'submit',stockId,side});setDetail({kind:'application',id});setToast(`${byId[stockId].name}的模拟${side==='sell'?'卖出':'买入'}申请已提交，等待你确认`);};
 const onDecide=(id,decision,price,qty,note)=>{const app=state.applications.find(a=>a.id===id);dispatch({type:'decide',id,decision,price,qty,note});setDetail(null);setToast(decision==='approved'?`${byId[app.stockId].name}已模拟${app.type==='buy'?'买入，持仓已更新':'卖出，持仓已更新'}`:'已拒绝申请，决定已保留在记录中');};
 const common={state,navigate,onApplication,onStock,onSubmit};
 return <div className="app-shell"><a className="skip-link" href="#main-content">跳到主要内容</a><aside className="sidebar"><div className="brand"><img src="/signal.svg" alt=""/><div><strong>信号猎手</strong><span>事件驱动 · 模拟决策</span></div></div><nav aria-label="主导航">{navigation.map((item,i)=><button key={item.id} className={`nav-item ${page===item.id?'active':''} ${i===4?'nav-divider':''}`} aria-label={item.label} aria-current={page===item.id?'page':undefined} onClick={()=>navigate(item.id)}><Icon name={item.icon} size={20}/><span>{item.label}</span>{counts[item.id]!==undefined&&<em>{String(counts[item.id]).padStart(2,'0')}</em>}</button>)}</nav><div className="sidebar-bottom"><button aria-label="来源与规则" className={`source-nav ${page==='sources'?'active':''}`} onClick={()=>navigate('sources')}><Icon name="settings"/><span>来源与规则</span><small>待定义</small></button><div className="profile"><span className="avatar">PA</span><span>私人研究空间<small>本地界面原型 v0.1</small></span></div></div></aside>
 <main className="main-content" id="main-content"><header className="topbar"><div className="breadcrumb"><span>工作台</span><span>/</span><b>{label}</b></div><div className="topbar-actions"><span className="demo-label"><i/>演示数据</span><Button icon="reset" className="reset-button" onClick={()=>{dispatch({type:'reset'});setDetail(null);setToast('已恢复初始演示数据');}}>重置演示</Button></div></header><div className="page-content" key={page}>
  {page==='overview'&&<Dashboard {...common}/>}{page==='research'&&<Research {...common}/>}{page==='applications'&&<Applications {...common}/>}{page==='portfolio'&&<Portfolio {...common}/>}{page==='watchlist'&&<Watchlist {...common}/>}{page==='records'&&<Records {...common}/>}{page==='sources'&&<Sources/>}
 </div><footer className="workspace-footer"><span>信号猎手 · 让判断可以被追踪</span><span>样例数据 · 未接入新闻与行情</span></footer></main>
 {detail?.kind==='application'&&state.applications.some(a=>a.id===detail.id)&&<ApplicationDrawer key={detail.id} application={state.applications.find(a=>a.id===detail.id)} state={state} onClose={()=>setDetail(null)} onDecide={onDecide}/>}
 {detail?.kind==='stock'&&<StockDrawer key={detail.id} stockId={detail.id} state={state} onClose={()=>setDetail(null)} onSubmit={onSubmit} onApplication={onApplication}/>}
 {toast&&<div className="toast" role="status"><Icon name="check"/><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={()=>setToast('')}><Icon name="close" size={15}/></button></div>}
 </div>;
}
