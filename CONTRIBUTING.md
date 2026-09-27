# Contributing · 贡献指南

欢迎修复可复现缺陷、改善研究流程与易用性、补充合成测试，以及加入来源和使用范围明确的数据适配器。中英文 issue 和 PR 均可。先阅读 [产品说明](README.md) 与 [架构](docs/ARCHITECTURE.md)。

## 从一个明确的问题开始

小修复可直接准备 PR；涉及数据模型、研究规则或交互流程的较大改变，先用功能建议说明问题、预期行为与验收标准。不要把收益提升当作未经验证的功能结论。

1. 从当前仓库建立自己的开发副本，使用任务分支，一次改动解决一个连贯问题。
2. 按 README 安装，以离线演示、合成输入或临时 SQLite 复现。不要测试自己的正式研究库。
3. 保留输入、研究、主张和模拟决定的旧版本；规则变化需有版本与反例。
4. 执行下列检查。页面变化另外检查桌面与窄屏的实际交互。
5. PR 说明触发条件、行为变化、实际验证与未测环境。维护者审阅后合入。

```sh
cd prototype
npm ci --ignore-scripts
npm test
npm run build
npm run release:check
```

## 数据和权限

不要提交账户信息、密钥、正文缓存、私人数据库或未经授权的新闻材料。需要行情问题的复现时，提供来源、证券、时区、获取时间和允许分享的最小合成样例。

新增适配器需说明来源、使用条件、时间戳、时区、币种、延迟、限流及失败行为。新增公共文件需加入 `prototype/scripts/release-files.mjs` 的允许清单；个人输出不应进入该清单。

本项目使用本地单用户研究和人工批准的模拟流程。贡献不应顺带改变资金、风险限额、自动执行权限或接入真实下单。安全漏洞按 [安全说明](SECURITY.md) 私密报告。

## 贡献许可

提交贡献表示你有权贡献相关内容，并同意原创贡献按本项目 MIT 许可证提供。第三方源码保留许可声明；第三方数据的权利不会自动转换为 MIT。

## English

Issues and PRs in English are welcome. Start with a reproducible problem and keep each change focused. Discuss larger workflow, schema, or research-rule changes before implementation. Use an isolated development copy, a task branch, synthetic inputs, and temporary databases. Preserve historical inputs, research, and simulation decisions.

Run the checks above, exercise changed UI behavior on desktop and a narrow viewport, and report results and untested environments. New adapters must document data rights, timestamps, currencies, delays, limits, and failure behavior. Update the release allowlist for new public files. Never include credentials, private databases, article caches, or unauthorized data. Do not add live trading or change approval and risk boundaries incidentally. Contributions you own are provided under MIT; third-party rights remain separate.
