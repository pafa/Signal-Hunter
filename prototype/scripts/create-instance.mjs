import {registerInstance} from '../server/instance-profile.mjs';
const [database,output,label,frontend='4178',api='4179',extra]=process.argv.slice(2);
if(!database||!output||!label||extra)throw new Error('用法：npm run instance:create -- <现有数据库绝对路径> <新配置绝对路径.instance.json> <名称> [网页端口] [API端口]');
const profile=registerInstance({database,output,label,frontendPort:Number(frontend),apiPort:Number(api)});
console.log(`固定入口已保存：${output}\n${profile.label} · ${profile.mode} · ${profile.id}\n仅只读核对数据，没有启动或迁移数据库。`);
