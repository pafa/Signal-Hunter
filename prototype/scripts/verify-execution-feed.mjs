import {mkdirSync,writeFileSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {openStore} from '../server/store.mjs';
import {loadExecutionConfig,openExecutionInputs} from '../server/execution-inputs.mjs';

const [configPath,output,...extra]=process.argv.slice(2);
if(!configPath||!output||extra.length||!isAbsolute(configPath)||!isAbsolute(output)){
 console.error('用法：npm run execution:verify -- <私有配置绝对路径> <全新输出目录绝对路径>');process.exitCode=1;
}else{
 let store;
 try{
  const config=loadExecutionConfig(configPath);
  mkdirSync(output,{mode:0o700});
  // No production database, HTTP service, model call or order is opened here.
  store=openStore(':memory:');const feed=openExecutionInputs(store,{config}),result=feed.refresh();
  const report={schema:'execution-feed-review/1',at:new Date().toISOString(),status:feed.status(),result,
   symbols:Object.keys(feed.inputs().quotes),rightsBasis:'operator-reviewed configuration; supplier rights not independently certified',
   simulationAccountsChanged:false,productionDatabaseOpened:false};
  writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({accepted:report.status.accepted,rejected:report.status.rejected,error:report.status.error,simulationAccountsChanged:false}));
  if(!report.status.accepted)process.exitCode=2;
 }catch{
  console.error('执行源核验失败：检查私有配置、数据包、来源权限及全新输出目录。未覆盖已有文件，未操作市场账户。');process.exitCode=1;
 }finally{store?.close();}
}
