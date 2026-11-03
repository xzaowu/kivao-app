# KIVAO 1.0.1 发布流水线准备

授权边界：本轮只提交/推送开发分支、运行只构建 CI、验证发布机制；不创建标签、不发布 GHCR、不操作生产。
最终候选 SHA 以工作流 github.sha 和 CI Artifact 的 source_commit 为准。本文不把历史 CI 或本地验证替代最终 SHA 的 CI 结果。

## 冻结产品范围

- 仅 KIVAO 品牌/异步外观，以及产品公告与管理员技术记录分离；品牌资产见[正式风筝记录](kivao-1.0.1-brand-asset.md)。
- 审核后产品快照为 42d3dd53620af5feff9165e79fc488dd5bad45b5，后续只允许发布准备文件及文档变化。
- 取消普通用户系统插件显隐的代码改造，采用现有后台设置。CI 保护插件目录、API、协议和后台开关相关源码不变。
- 仍从生产 e19976f6/eeccf718 血统开发，拒绝 main 的 14 个额外提交和合并提交；不回退或覆盖 main。
- Agent Dockerfile 唯一变化是把已有三个构建参数写入只读 build-info.json，以验证实际 BUILD_COMMIT；不改变 Runtime 协议或服务行为。

## CI 与机器证据

.github/workflows/kivao-1.0.1-ci.yml 只监听专用 dev/release 分支的 push，contents/actions 为 read、packages 为 none。
它不登录 GHCR，不推镜像；带 GHCR 名称的 candidate-SHA 标签只存在该 Runner 的本地 Docker 中。

1. 冻结范围门禁：验证完整 HEAD、祖先链、产品快照、受保护目录的 Git tree/blob、依赖锁、Schema 77 来源及正式图标 SHA-256。
2. 完整复用原 quality.yml：Agent 静态/架构检查、Backend 全部分片及 PG/Redis 依赖门禁、支付插件检查、Web 格式/类型/Lint/pretest/全量测试与预演台 Chrome E2E。
   原工作流的 ARM64 支付 smoke 仅在 PR 条件下运行；本次 push 的候选架构仅为 linux/amd64，不声称验证 ARM64。
3. 从当前候选 SHA 构建三个 linux/amd64 镜像，记录锁文件、Dockerfile 哈希、构建参数、OCI 标签、实际 image ID 和 BuildKit 元信息。
4. 只启动无网络、只读的独立检查容器，覆盖 ENTRYPOINT，不启动业务服务或迁移：
   Web 检查实际 JS 中的提交 SHA 及正式图标字节；Backend 检查 yingce-backend 的嵌入 SHA，并记录两个迁移 CLI 的实际 SHA-256；Agent 检查实际 build-info.json 的版本/SHA/时间。
   两个迁移 CLI 不链接应用 buildinfo 字段，不声称它们嵌有候选 SHA；其来源由同镜像的构建上下文、Dockerfile/源代码冻结及实际二进制哈希追溯，始终不执行迁移。
5. 只有完整质量检查与三个构建全部成功才生成 kivao-101-ci-report。报告中的 registry_digest 为 null，image ID/BuildKit digest 不能冒充已发布 registry digest。

配置在 .github/kivao-1.0.1.json；验证/成对锁工具为 scripts/kivao-release.py，边界测试为 scripts/test_kivao_release.py。
CI Artifact 仅上传源码与构建元信息，不上传 .env、业务数据、备份、恢复私钥或模型密钥。
Artifact 默认保留 14 天；发布前证据若已过期，应重跑同 SHA 或重新评审候选，不绕过门禁。

## 未来发布入口（当前禁止执行）

.github/workflows/kivao-1.0.1-publish.yml 只监听 kivao-1.0.1-* 标签，进一步要求：

- 完整格式 kivao-1.0.1-候选前12位SHA-rN（N 从 1 起），必须是注解标签并精确指向已验证候选。
- 所有者新的明确发布授权后，才允许启用仓库变量 KIVAO_101_PUBLISH_ENABLED=true；本轮不改该变量。
- 发布环境 kivao-image-publish-1.0.1 应在正式发布前由所有者配置保护/审批；本轮不创建或配置环境。
- 读取该完整 SHA 的专用 CI 成功记录并下载完整报告；旧 SHA、缺失/过期 Artifact、质量失败、缺角色或嵌入 SHA 不匹配均拒绝。
- 三个自有仓库：ghcr.io/xzaowu/kivao-app-web、kivao-app-backend、kivao-app-agent。现有修订必须明确不存在，鉴权/网络不确定不视为缺失。
- 未来发布会从同一 SHA 重建并再次做镜像身份检查，检查后才 push；随后按 registry digest 拉回，要求 image ID 仍等于刚验证的镜像。
  基础镜像标签/系统包可随时间变化，因此不保证重建与之前 CI 镜像逐字节相同，不伪造 digest。
- 不使用 v*、latest、旧 r1 标签或旧发布工作流，不覆盖已有镜像或发布资料。一个角色发布失败可能留下部分不可变修订；没有全部成功不能产生最终锁，不能以覆盖同 tag 的方式修补。

源码 VERSION 仍为 v1.7.3.3，构建参数和 OCI version 保留该来源版本；独立 KIVAO 版本由 io.kivao.release 和专用标签标识。
原 publish-images.yml、kivao-baseline.yml 与 r1 工具保持不变；不把它们应用于当前分支，也不推 main。

## 发布锁、回滚锁与部署边界

只有三个角色都有经验证的完整 registry digest 才能生成：

- release-images.env：1.0.1 专用版本与三个新 digest。
- rollback-images.env：固定当前成功 KIVAO r1 的三个 digest，取自生产清单；禁止回到影策官方浮动版本。
- image-locks.json：候选来源、两组锁、Agent init 必需、Schema 77/不授权迁移、migrate 与 Backend 共用镜像键。

工具默认 dry-run，apply-lock 复用 r1 原子替换 helper，只修改四个镜像/版本字段，保留其他环境字节、属主/权限。
只有另获生产授权后才可 --apply；本轮只对临时合成 .env 做 dry-run、应用与回滚测试。
锁不修改或代替 Compose：必须继续携带 Agent init overlay，并保留 PostgreSQL 17、Redis、项目 yingce、所有持久化路径与 127.0.0.1:13100。
不启动 migrate，不安装 Updater，不改 Nginx，不在本轮制作或恢复生产备份。

## 本地验证与剩余人工门禁

- 正式资产逐字节复用、尺寸/格式及既有外观专项通过；自定义深浅 Logo 优先和失败占位逻辑保留。
- 新工具测试覆盖错误 SHA/架构/来源、缺角色、未发布本地镜像冒充 digest、固定 r1 回滚和临时文件原子应用/回滚。
- 新 YAML 经 actionlint 与结构解析检查；推送前执行 CI 同口径 Web 门禁及全量测试/生产构建。
- 最终 CI 状态、运行链接与三个实际构建 ID 在本轮交付及匹配 SHA 的 ci-report Artifact 核对，不能预写成成功。
- 正式小尺寸图标仍待人工视觉确认。真实后端公告保存、真实模型、支付与通知不在本轮范围；下一阶段仍要验证隔离副本与生产拉取条件。
- 发布环境保护是否可用/已配置、GHCR 发布写权限及新修订实际私有可见性须在新的发布授权阶段核实。
  r1 已成功发布不等于本轮执行了写权限测试；本轮从未写 GHCR。
