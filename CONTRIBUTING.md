# Contributing · 贡献指南

欢迎修复可复现缺陷、改善研究流程与易用性、补充合成测试，以及加入来源和使用范围明确的数据适配器。中英文 issue 和 PR 均可。先阅读 [产品说明](README.md) 与 [架构](docs/ARCHITECTURE.md)。

## 从一个明确的问题开始

小修复可直接准备 PR；涉及数据模型、研究规则或交互流程的较大改变，先用功能建议说明问题、预期行为与验收标准。不要把收益提升当作未经验证的功能结论。

1. 核对远端 main、工作目录、分支、HEAD 和已有改动，从最新已验证主干建立任务分支，一次改动解决一个连贯问题。
2. 按 README 安装，以离线演示、合成输入或临时 SQLite 复现。不要测试自己的正式研究库。
3. 保留输入、研究、主张和模拟决定的旧版本；规则变化需有版本与反例。
4. 执行下列检查。页面变化另外检查桌面与窄屏的实际交互。
5. PR 说明触发条件、行为变化、依赖、准确候选提交、实际验证与未测环境。按下列审查与集成流程处理。

```sh
cd prototype
npm ci --ignore-scripts
npm test
npm run build
npm run release:check
```

## 开发、审查与集成

采用小批次开发。独立工作从最新已验证的 main 开始；必须依赖未合并功能时，明确记录父 PR、父提交及当前 PR 的目标分支。默认最多保留 3 层未合并依赖；达到上限或完成一个可演示批次时，先审查和收敛，再展开新功能。已有较长依赖链逐批消化，保留未提交工作，不靠删除分支、强推或重复开 PR 清空队列。修复反馈更新原 PR。

每个批次依次完成：

1. **确定范围。** 在 [任务清单](docs/BACKLOG.md) 写明验收标准、依赖和未完成项；一个工作包可以包含多批，但一批通过不代表工作包整体完成。
2. **实现和验证。** 保留旧输入、模型结果、研究及账本版本；在隔离库执行必需检查。涉及历史数据时检查升级、重启、失败后旧记录保留及恢复。页面改动检查真实交互。
3. **审查完整差异。** 包含新增文件、接口与数据语义，检查权限边界、失败路径、并发、时间依据和回归；记录准确 head、发现、修复与尚未覆盖的验收。CI 通过只证明该检查执行成功，不替代代码审查和业务验收。
4. **形成可批准候选。** 代码审查和相关检查通过后，提交仓库、PR、准确 head、依赖及验证摘要。合入主干须获得针对候选的明确人工批准；候选实质变化后重新确认。批准合并不同时批准部署或迁移。
5. **按依赖集成。** 先合父 PR。子 PR 原目标若是父分支，必须在核对父提交已进入 main 后改为 main，重新审阅实际差异及检查结果，再按获批范围合入。较长共享依赖链优先保留提交祖先关系的 merge commit，避免 squash/rebase 让后续差异重复或丢失；如主干有冲突，修复并重新验证候选。
6. **核对主干和运行实例。** 确认 main 包含获批提交、主干 CI 通过，并记录集成结果。启动或升级某个研究实例时另核对代码提交、数据集/数据库标识、备份和恢复依据；浏览器能打开不代表已运行最新候选。

较长历史依赖链可先在独立整合分支准备一个草稿候选：列出纳入的准确 PR heads，以合并提交保留全部祖先关系，核对文件差异并运行组合验证。这个步骤不修改 main，不关闭或改目标原 PR，也不替代各 PR 审阅与页面验收。整合候选完成必要验收并获准确版本批准后，才可作为一个批次合入 main；随后逐项核对原 heads 已进入 main，再整理原 PR 状态。

任务状态只维护在 BACKLOG；重要流程和产品决定写入 [决策记录](docs/DECISIONS.md)。报告分别列出“候选实现与验证”“已合并”“运行实例验收”三种状态，标明证据及日期。未定义加权验收标准前，不用 PR 合并比例或测试数量充当 18 项的整体完成度。归档审查快照可作证据，不作为另一份持续维护的任务清单。

## 数据和权限

不要提交账户信息、密钥、正文缓存、私人数据库或未经授权的新闻材料。需要行情问题的复现时，提供来源、证券、时区、获取时间和允许分享的最小合成样例。

新增适配器需说明来源、使用条件、时间戳、时区、币种、延迟、限流及失败行为。新增公共文件需加入 `prototype/scripts/release-files.mjs` 的允许清单；个人输出不应进入该清单。

本项目使用本地单用户研究和人工批准的模拟流程。贡献不应顺带改变资金、风险限额、自动执行权限或接入真实下单。安全漏洞按 [安全说明](SECURITY.md) 私密报告。

## 贡献许可

提交贡献表示你有权贡献相关内容，并同意原创贡献按本项目 MIT 许可证提供。第三方源码保留许可声明；第三方数据的权利不会自动转换为 MIT。

## English

Issues and PRs in English are welcome. Start with a reproducible problem and keep each change focused. Discuss larger workflow, schema, or research-rule changes before implementation. Use an isolated development copy, a task branch, synthetic inputs, and temporary databases. Preserve historical inputs, research, and simulation decisions.

Start independent work from verified main; explicitly record parent PRs for dependent work and keep new dependency chains to at most three unmerged layers. Review full diffs and exact-head checks before seeking explicit approval of the candidate. Integrate parents first, verify ancestry, retarget children to main, and review the resulting diffs and checks. Preserve commit ancestry for shared stacks. Merging, deployment, and private-data migration are separate actions. Track candidate validation, main integration, and running-instance acceptance separately in BACKLOG.

Run the checks above, exercise changed UI behavior on desktop and a narrow viewport, and report results and untested environments. New adapters must document data rights, timestamps, currencies, delays, limits, and failure behavior. Update the release allowlist for new public files. Never include credentials, private databases, article caches, or unauthorized data. Do not add live trading or change approval and risk boundaries incidentally. Contributions you own are provided under MIT; third-party rights remain separate.
