import {defineConfig} from 'vite';
import {runtimeConfig} from './server/runtime.mjs';
const {apiPort,frontendPort}=runtimeConfig();
const proxy={'/api':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:true}};
export default defineConfig({server:{host:'127.0.0.1',port:frontendPort,strictPort:true,proxy},preview:{host:'127.0.0.1',port:frontendPort,strictPort:true,proxy}});
