# KIVAO 后续构建、发布与上游整合原则

本文件是后续发布规则，不构成发布或生产授权。1.0.1 已获两项产品开发及开发分支推送授权，未获发布标签、镜像发布或生产部署授权；当前进展见 [开发验证记录](../plans/kivao-1.0.1-validation.md)。
当前生产事实见 [首发结项](kivao-first-cutover-closeout.md)及[固定清单](kivao-production-r1.json)。

## 分支与版本

- 冻结 release/kivao-baseline-eeccf718 和 kivao-1.0.0-eeccf718-r1；不改写已发布标签。
- docs/kivao-first-cutover-closeout 仅含本次文档；dev/kivao-1.0.1-baseline 建自该文档提交。
  应用源码仍从线上 eeccf718/e19976f6 基线开始，未带入 main 的 14 个后续提交。
- 下一轮每个产品问题独立提交并可单独回退，评审后选定候选 SHA，再建 release/kivao-1.0.1。
  1.0.1 是规划版本，不代表已经构建、验收或发布。
- main 当前是上游同步来的开发快照，不是生产基线；不得把发布分支强推/合并成覆盖 main 的手段。
- 已发布分支不 rebase，不 force-push。开发分支如需同步，在本分支边界内操作，不以“更新到 main”为由混入未评估功能。
- 当前仓库 Private。本轮不改变可见性，不同步私有备份、凭据或原始验收副本。

## 现有工具的边界

现有 .github/workflows/kivao-baseline.yml、scripts/kivao-build-baseline.py
以及 scripts/kivao-apply-image-lock.py 都为首发 r1 专用：
SOURCE、RELEASE、允许标签/分支、源码路径无改动检查及回滚锁均有硬编码。
即使运行在新的分支，旧工作流的 build 仍 checkout eeccf718，不能用于有产品变化的 1.0.1。
现有锁工具也不能直接接受 1.0.1，更不能假设 --rollback 会回到当前 KIVAO r1。

1.0.1 已另行准备[当前候选 CI 与成对镜像锁](../plans/kivao-1.0.1-release-preparation.md)，不改上述 r1 工具。
新的流程仍待匹配 SHA 的 CI 和人工发布授权，不能因代码已准备就发布镜像。
不得通过跳过源码检查、移动 r1 标签或只改显示版本号伪装新发布。

原 .github/workflows/publish-images.yml 在 main/v* 等入口触发，
仍使用 open-ai-canvas-* 包名和可变标签/Release 推广策略，禁止作为 KIVAO 发布入口。
将来向 main 整合之前，先在集成分支审查并隔离/替换该流程，避免 main push 意外触发旧发布。
现在不改工作流，也不发 v* 标签。

## 推荐发布顺序

1. **生产基线上的最小实现。** 只实现当轮明确批准的体验修复及必要测试/发布准备；当前为品牌和公告两项，插件显隐代码改造取消，使用已有后台设置。
   版本优先不变更 Schema、协议、计费和任务执行；所有实际改动相对 e19976f6 审核。
2. **本地最小充分验证。** 按目标分支真实 Quality checks 运行格式、类型、lint、专项测试和真实 Web 构建；
   涉及 Backend 时按影响范围补 Go 测试。支付插件构建或 PG/Redis 专项若未覆盖，明确留给匹配 SHA 的 CI。
   生产基线没有 main 后来的 verify-before-push.mjs，不能调用不存在的脚本或为使用脚本引入整组 main 功能。
3. **独立副本/合成夹具。** 依项目 .local/project-workbench-debug 约定使用全新非生产目录和数据库，
   测试管理员/普通用户、冷启动和延迟/失败接口；Stub 替代模型、支付及通知，默认阻断出站。
   不复制生产 .env，不挂生产卷或 Docker Socket，不用真实业务副本作日常开发账号库。
4. **候选工作流审查。** 新流程只允许选定 KIVAO 分支/专用标签；checkout 已验证候选 SHA，
   构建参数 BUILD_COMMIT 与 OCI revision 等于实际候选 SHA，不能继续固定 eeccf718。
   记录锁文件/依赖版本、构建工具链、3 个 Dockerfile、linux/amd64、版本和构建时间。
   没有明确扩展架构需求，不顺带升级 Node/Go/Bun、PG 或 Redis。
5. **GitHub 检查与私有候选发布分别授权。** 匹配候选 SHA 的所有必需 Quality checks 成功后，
   才创建全新专用标签，例如 kivao-1.0.1-<候选短SHA>-r1；不得覆盖已有 tag。
   只发布 ghcr.io/xzaowu/kivao-app-{web,backend,agent} 的明确修订，不发布 latest。
   三个角色从同一受审查候选 SHA 构建并验收，记录各自真实 registry digest/架构/来源。
6. **成对发布锁。** release-images 固定候选三个 digest；rollback-images 固定当前成功 KIVAO r1 的三个 digest。
   用明确版本/来源校验的工具 dry-run，再人工审核；不要直接复用只接受原官方回滚锁的 r1 工具。
   原影策固定镜像只保留为首发历史应急材料。
7. **生产预检与恢复演练。** 验证服务器认证/架构、预拉固定 digest、数据目录/key/媒体、空间、原镜像和 Web 快照。
   经备份授权后取得受控副本并在独立环境恢复，演练候选镜像和回滚；不因下一版预计无 Schema 变化而省略备份。
8. **单独生产窗口授权。** 停写、排空、最终备份、只重建 Agent/Backend/Web；必须携带 init overlay，
   只用 --no-deps、--pull never、--no-build，不启动 migrate。若实际源码要求新 Schema，先停在 NO-GO，
   另开迁移评审和授权，不隐式升级。
9. **验收与回滚。** 先内部版本/Schema/加密配置和数据门禁，再开 Web、做真实浏览器/只读 API/媒体/SSE/Agent Stub 验收。
   Web 启动即恢复公网写入，正常应用回滚保留当前 DB/data/Redis；数据库覆盖仍单独授权。
   写入新的脱敏成功记录、锁文件与验证摘要，保留旧版资料。

tag、构建完成、CI 成功、隔离验收和生产放行是不同证据；不得互相替代。
未获真实模型/支付授权时只用 Stub，不能通过点击“测试渠道/查单/充值”偷跑验收。

## 与 main 的整合

第一步先在当前生产血统完成独立可验收的 1.0.1；不让它承担 main 的 14 个提交验收。
下一步再从最新、明确记录 SHA 的 main 建独立 integration/kivao-main-1.0.1，
只移植已审核的 KIVAO 小提交以及必要文档/发布治理，不整体合并首发分支，不搬运 .local 资料。

本次 main-only 14 个提交包含：

| 领域 | 代表提交 | 整合时必须重验 |
| --- | --- | --- |
| 素材/画布数据路径 | 85f6ebc1、74d3f871、0055130f | 缺失/删除语义、跨账号素材引用、全量导出清理 |
| 协议/Updater | a4f468ca、2fa2bdde | 插件打包来源、升级最终备份顺序及自有镜像边界 |
| Backend/费用与媒体 | 56ca2402 | 账单汇总、媒体尺寸/裁切/标识、Agent 时效 |
| Web/画布/工作台 | e55eb114、90d82c6f、b3fb0d14、d0d7ddab、82fc5c03 | UI、引用、默认图比例、批量生成及任务合同 |
| CI/格式/README | fb047244、db7259b6、b2dc8e15 | 新检查脚本可用性、格式和自有发布入口 |

不能仅因 main 的 expected Schema 也可能是 77 就宣称数据兼容；
必须比较完整 DDL、迁移账本、模型/序列化/权限/资源/计费行为及现有配置。
集成候选另跑匹配 SHA 的 CI、恢复副本及浏览器回归，必要时另命名下一版本，
经人工确认后才讨论 merge 回 main 和生产发布。

长期上游同步使用独立同步/集成分支与冻结 upstream SHA，逐组审查，
先保护 KIVAO 品牌、权限/可见性、日志来源、自有 GHCR 和部署锁；
保留上游 LICENSE/NOTICE、作者和来源记录，不做全仓“影策”替换。
本轮未 fetch 或合并上游最新开发，也不对其当前状态作发布保证。
