# 源码发布指南

信号猎手按 **MIT 本地工具**分发。交付物是可独立运行的源码、锁定依赖、公共文档、明确列入的介绍图片和合成演示。无需域名或在线部署，不发布 npm 包。

## 生成可审阅候选

在 `prototype` 目录运行：

```sh
npm test
npm run build
npm run release:check
npm run release:prepare -- /absolute/new-directory
```

最后一条命令的路径是占位示例，需换成尚不存在的新绝对路径。导出器只复制允许清单中的文件，并生成 `RELEASE-MANIFEST.json`，包含每个文件的 SHA-256 和大小。不使用 Git 暂存区、不提交、不联网，也不复制运行库、依赖目录和个人研究档案。遇到符号链接、可疑凭据、本机路径和断开的文档链接会失败。

只使用导出的目录作为发布输入，不打包整个开发目录。两张产品介绍图是明确列入的公共资产，其余历史截图、附件和采集快照不进入候选。详见 [数据政策](DATA-POLICY.md)。

## 检查和验证

1. 审阅新增/修改文件、图片与 manifest；扫描不能代替内容、数据权利和敏感信息审阅。
2. 在独立导出目录按 README 安装并检查，使用该目录自己的依赖和数据库。
3. 验证离线演示启动、网页/API/代理健康和正常停止；不能把原开发服务已在运行当作候选通过。
4. 记录实际测试环境、命令、结果和未覆盖的平台；版本记录在 [CHANGELOG](../CHANGELOG.md)，任务状态只在 [BACKLOG](BACKLOG.md)。
5. 审阅候选后，取得针对目标仓库与此版本的发布批准。若内容再变，重新导出并核对。

## 仓库公开时的配置

- About：使用 [名称与产品表述](BRANDING.md) 中的定位，主页 URL 留空。
- 文档：根目录中文 README、英文入口、MIT 和第三方声明随源码提供。
- 协作：启用 Issues，使用仓库内的缺陷/功能表单与 PR 模板；文档在仓库维护，不依赖 Wiki。
- 检查：启用 Actions，运行锁文件安装、测试、构建和发布检查；不配置模型或数据源密钥。
- 安全：启用 Private vulnerability reporting，并实际核验私密入口；不要把 SECURITY.md 当作开关已经启用的证据。
- 首版：标记 early preview / prerelease，附能力边界、运行说明与候选校验记录，不把本地测试写成远端 CI 通过。

GitHub 的表单与私密报告配置分别依据 [Issue forms 文档](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms) 和 [Private vulnerability reporting 文档](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)。这些是待应用的设置说明，实际状态以远端核验结果为准。

## 保护开发实例

发布副本的文档、依赖、数据库和测试端口与个人工作台分开。候选的验证不能自动证明原工作台或研究模型有效；任何发布或回滚都不得覆盖个人数据库。模式兼容和备份方法见 [运行指南](../prototype/README.md)。
