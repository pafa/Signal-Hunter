import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Terminal from './terminal/Terminal';
import MajorWorkbench from './major/MajorWorkbench';
import IntegratedWorkbench from './integrated/IntegratedWorkbench';
import './styles.css';
import './screens.css';
import './responsive.css';

const view=new URLSearchParams(window.location.search).get('view');
createRoot(document.getElementById('root')).render(view==='classic'?<App />:view==='demo'?<Terminal />:view==='research-v4'?<MajorWorkbench />:<IntegratedWorkbench />);
