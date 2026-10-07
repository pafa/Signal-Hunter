import React,{Component,Suspense,lazy,useState} from 'react';
import {Modal} from './major/Primitives';
import './deferred-view.css';

function Fallback({title,mode,onClose,onRetry}){
 const params=new URLSearchParams(typeof window==='undefined'?'':window.location.search);params.set('view','grid');
 const content=<div className="deferred-message">
  <p role={onRetry?'alert':'status'}>{onRetry?`未能打开${title}，请检查本地服务连接后重试。`:`正在打开${title}…`}</p>
  {onRetry&&<button type="button" onClick={onRetry}>重试打开</button>}
  {mode==='page'&&<a href={`?${params}`}>返回事件工作台</a>}
 </div>;
 if(mode==='dialog')return <Modal title={title} onClose={onClose}>{content}</Modal>;
 return mode==='page'?<main className="deferred-page" aria-label={title}>{content}</main>:content;
}

class LoadBoundary extends Component{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?this.props.fallback:this.props.children;}
}

// Define once at module scope. Reopening a loaded view reuses its lazy component;
// an explicit retry creates a fresh lazy request without remounting the workbench.
export function createDeferredView(load,{title,mode='inline'}){
 let cachedView=lazy(load);
 return function DeferredView(props){
  const [{View,attempt},setRequest]=useState(()=>({View:cachedView,attempt:0}));
  function retry(){cachedView=lazy(load);const nextView=cachedView;setRequest(current=>({View:nextView,attempt:current.attempt+1}));}
  const fallbackProps={title,mode:props.embedded?'inline':mode,onClose:props.onClose};
  return <LoadBoundary key={attempt} fallback={<Fallback {...fallbackProps} onRetry={retry}/>}>
   <Suspense fallback={<Fallback {...fallbackProps}/>}><View {...props}/></Suspense>
  </LoadBoundary>;
 };
}
