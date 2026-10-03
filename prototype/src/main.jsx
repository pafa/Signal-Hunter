import React from 'react';
import { createRoot } from 'react-dom/client';
import {createDeferredView} from './DeferredView';
import IntegratedWorkbench from './integrated/IntegratedWorkbench';
import './styles.css';
import './screens.css';
import './responsive.css';

const App=createDeferredView(()=>import('./App'),{title:'经典演示',mode:'page'});
const Terminal=createDeferredView(()=>import('./terminal/Terminal'),{title:'交易演示',mode:'page'});
const MajorWorkbench=createDeferredView(()=>import('./major/MajorWorkbench'),{title:'旧版研究工作台',mode:'page'});
const view=new URLSearchParams(window.location.search).get('view');
createRoot(document.getElementById('root')).render(view==='classic'?<App />:view==='demo'?<Terminal />:view==='research-v4'?<MajorWorkbench />:<IntegratedWorkbench />);
