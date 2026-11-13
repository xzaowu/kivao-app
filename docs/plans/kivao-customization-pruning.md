# KIVAO 定制瘦身清单

## 已确认的方向

以固定上游提交 `3979305c1413be231cbaef242e50afc67f553c5e` 作为本次清单的功能比较对象，KIVAO 对照为 `245c7fc39febee8b2c4f76c677d9fec82a222621`。该上游提交属于 main 的未发布增量，Schema 104；不是已验收发布候选。后续试迁仍须固定 SHA，不随 main 漂移。

所有者已选择：

1. 采用上游多页面助手入口，取消原先“助手只在画布显示”的产品限制。
2. 手机和桌面优先采用上游新版布局，不再要求复刻现有 KIVAO 的页面排版。

本清单把历史实现按“保留、上游替代、不再移植”收敛。这里的“不再移植”是新基线选代码时的取舍，不是删除当前分支、历史提交或数据库内容。当前没有切换分支、替换源码或执行数据转换。

## 一、保留：8 组必要能力

| 编号 | 保留的最小需求 | 当前代码定位 | 新基线的边界 |
| --- | --- | --- | --- |
| K01 | KIVAO 默认标题、正式风筝资产、Logo/SEO 异步回退、协议名称 | `web/public/kivao-mark.png`、`web/src/components/brand/brand-logo.tsx`、`web/src/stores/use-appearance-store.ts`、`web/src/services/appearance-bootstrap.ts` | 使用上游主题和布局，只覆盖集中默认值与品牌资产；已保存的自定义外观仍生效 |
| K02 | 后台管理工具/效果的素材组、必填与上限、注意事项、多个作品示例，以及按分组引用素材的一键生成 | `backend/internal/model/models_workbench.go`、`backend/internal/workbench/inputs.go`、`web/src/lib/workbench-inputs.ts`、`web/src/lib/workbench-template.ts`、`web/src/pages/admin/workbench-tools/`、`web/src/pages/workbench/` | 保留能力和 JSON/资源引用；选择器、按钮和页面结构可采用上游样式。先对比新版数据合同，不整目录覆盖 |
| K03 | 自营灵感大厅的后台增删改查、工具关联及多示例；不默认恢复外部推荐同步 | `backend/internal/app/inspirations.go`、`backend/internal/repository/inspirations.go`、`web/src/pages/admin/inspirations-page.tsx`、`web/src/pages/inspirations/` | 运营内容与可控来源是保留目标，瀑布流等展示优先复用上游组件 |
| K04 | 技能公开须审核、上下架、公开目录及 Agent 使用准入 | `backend/internal/skills/skill_review.go`、`backend/internal/repository/skill_review.go`、`backend/internal/database/skill_publication_migration.go`、`web/src/pages/admin/skill-review-page.tsx` | 上游后台技能管理可采用，KIVAO 的公开状态和权限必须保留；不能把待审核或下架记录转换成公开 |
| K05 | 后台控制功能开放、系统/应用插件的全站开关、普通用户入口策略和节点开关 | `backend/internal/platform/feature_availability.go`、`backend/internal/app/plugin_management.go`、`web/src/pages/admin/components/feature-availability-panel.tsx`、`web/src/components/layout/workspace-sidebar-nav.tsx`、`web/src/router.tsx` | 前台不恢复插件、Eagle、技术/更新公告入口；保留系统公告和后台所需管理能力。隐藏入口不影响服务端加载模型协议插件 |
| K06 | 坤肉视频、坤肉音频、独立深度动作捕捉协议及对应节点/工作台能力 | `plugin-packages/kivao-kunrou-video/`、`plugin-packages/kunrou-chat-audio/`、`plugin-packages/volcengine-mediakit-video-depth/`、`web/src/lib/canvas/canvas-video-depth.ts`、`web/src/components/canvas/canvas-video-depth-panel.tsx` | 保留协议 ID、模型路由和业务能力；协议宿主、请求传输和公共节点控件优先采用上游新版 |
| K07 | 自有发布身份、固定 digest、既有部署组合、Agent init 和数据保留 | `.github/kivao-1.0.1.json`、`scripts/kivao-release.py`、`scripts/kivao-apply-image-lock.py`、`docs/operations/` | 沿用既有发布机制，更新候选配置，不新增审批体系；不把官方自动发布/Host Updater 当作 KIVAO 部署入口 |
| K08 | 用户端明确的业务文案与标识策略 | `web/src/lib/guest-workspace.ts`、`web/src/stores/use-auth-dialog-store.ts`、`backend/internal/app/storage_location.go`、`web/src/pages/create/`、`web/src/components/canvas/` | 保留游客“登录后查看模型”、默认存储前缀及导出 `app: kivao`、不暴露内部供应商信息等小差异；不强求旧页面排版与助手停靠方式 |

K02、K03 是主要的自有产品定制，不能按“只换 Logo”估算工作量。其他组优先收敛为设置、独立插件或少量注册/权限补丁，而不是旧包整份复制。用户、渠道、价格、积分、支付、媒体等原始数据保留，属于转换要求，不是可以随代码瘦身删除的内容。

## 二、上游替代：8 组旧实现不整包回放

“优先上游”不表示当前已经证明完全等价。试迁时先走新版实际路径，再用保留的业务回归证明能力；差异未解决的组不得标记完成。

| 编号 | 优先采用的上游能力 | 当前 KIVAO 对照 | 只补回什么 |
| --- | --- | --- | --- |
| R01 | 官方完整电商 Agent、知识库、技能及轮次 | `backend/internal/app/commerce_studio*.go`、`web/src/pages/commerce-studio/`、`web/src/services/api/commerce-studio.ts` | KIVAO 自有任务计费/权限要求、必要入口配置及旧项目转换；不再维护改名后的平行模块 |
| R02 | 新版登录表单、弹窗、账号会话隔离与跨设备对话同步 | `web/src/components/auth/`、`web/src/stores/use-auth-dialog-store.ts`、`web/src/services/commerce-studio-session.ts`、`backend/internal/auth/` | 品牌、游客草稿和账号隔离要求；跨设备历史采用上游存储结构，不复制旧本机历史方案 |
| R03 | 新版模型菜单、选择后关闭、渠道标签及模型参数适配 | `web/src/styles/shared/model-picker.css`、`web/src/lib/model-pricing.ts`、`backend/internal/app/model_capability*.go` | 已保存模型排序、公开名称、价格单位和路由行为；手机布局不复制旧 CSS |
| R04 | 新版 Agent、短剧助手、记忆、MCP、配额和进程资源管理 | `backend/internal/app/cloud_agent*.go`、`backend/agent-runtime/pi/`、`yingce-agent/`、`web/src/components/canvas/canvas-cloud-agent*` | KIVAO 的账号/审批/费用保护和现有集成能力。采用新版页面上下文和入口，移除仅画布限制 |
| R05 | 上游任务、上传隔离、SSE、资源保存和计费修复 | `backend/internal/app/task_*.go`、`backend/internal/app/provider*.go`、`backend/internal/assets/`、`backend/internal/platform/`、`web/src/services/api/request.ts` | 用已有 UNKNOWN、幂等、配额、扣退、账号切换等场景验证新版。缺失保护才修，不覆盖新版公共基础层 |
| R06 | 官方易支付新版多支付方式和错误处理 | `plugin-packages/official-payment-epay/`、`backend/internal/app/payment_methods_test.go`、`backend/internal/app/payment_close_rpc_test.go` | 核对当前配置兼容及原订单版本后再替代；跨币种和实收金额按历史语义转换，不能通过默认值改价 |
| R07 | 上游技能阅读、后台编辑和目录管理 | `web/src/pages/skills/`、`backend/internal/skills/`、`web/src/pages/admin/skill-review-page.tsx` | 正文预览隐藏元数据和 K04 的审核准入；不保持旧阅读器内部结构 |
| R08 | 新版短剧、分镜编辑、预演与画布工作区 | `web/src/components/canvas/`、`web/src/pages/canvas/`、`backend/internal/production/`、`backend/internal/app/drama*.go` | 深度动作捕捉、节点开关、资源与导出兼容；不继续单独移植每个短剧/画布增强功能 |

R04、R05 的范围很大，先验证新版，不意味着照搬全部旧修复。已有测试本身也要核对语义与新版调用路径，不能只为通过而修改断言。

## 三、不再移植：3 类历史负担

| 编号 | 新基线不再携带的内容 | 当前定位 | 必须保留的历史/数据 |
| --- | --- | --- | --- |
| D01 | 旧最小商品套图和改名后的完整电商平行源码、两套后台导航 | `web/src/pages/ecommerce/`、`web/src/pages/admin/ecommerce-settings-page.tsx`、`web/src/pages/commerce-studio/`、`backend/internal/model/models_commerce_studio*.go` | 历史 `ecommerce_*`、`commerce_studio_*` 项目与轮次独立映射；清理代码不等于删表。旧链接迁向新版官方入口，不再复制一套工作台 |
| D02 | 旧首页/手机布局、旧弹窗外壳、旧模型菜单排版、助手仅画布及默认固定靠右的专属实现 | `web/src/pages/create/`、`web/src/pages/workbench/`、`web/src/styles/shared/model-picker.css`、`web/src/components/layout/`、`web/src/components/canvas/canvas-cloud-agent*` | 采用上游新版体验；保留品牌、运营能力及必要可用性修正。此项已有所有者明确选择 |
| D03 | 逐条移植脚本、重复的上游修复实现、旧 UI 耦合测试补丁，以及把首发构建限制硬套新版本的接法 | 本地上游审查辅助记录、历史修复提交、`.github/workflows/kivao-baseline.yml`、`scripts/kivao-build-baseline.py` | 已发布提交/标签/镜像锁和生产回退资料继续保留；有价值的行为用例继续验证新版。原发布机制保留，仅旧候选绑定和过渡实现不再复用 |

同一路径可能同时出现在两组：例如旧模型菜单样式不移植，但排序、价格单位与路由行为仍需验证；这是按能力选代码，不是按整个目录删除。

## 数据与发布的独立约束

- 代码瘦身不能取消数据转换。旧 KIVAO Schema 78–81 与官方编号冲突，目标候选为 Schema 104；迁移路线仍按[基线评估](kivao-upstream-rebaseline-assessment.md)先在隔离副本证明。
- `.settings-key`、模型/支付密文、账户与资源 ID、原订单配置版本、功能设置和用户内容必须保留。旧电商两套表不自动合并，先核对数量、ID 冲突及 JSON 内引用。
- 本地虚拟模型和测试项目可用于流程检查，不承担正式数据映射的正确性证明。真实模型质量与费用按已确认安排放到部署验收，调用仍需明确范围。
- 原有发布配置尚有独立未提交修改，不覆盖、不随本清单提交。推送新基线前核对全部 workflow 触发条件；不得误触发 GHCR、官方镜像或部署。

## 下一步的最小可执行范围

先按固定上游 SHA 准备一次本地试迁：官方 Web/Backend/Agent 原生运行、KIVAO 集中品牌默认值、一个自有协议插件。使用全新非生产数据目录和受控虚拟服务，先验证扩展点，暂不搬 K02/K03 全套运营页面，也不连接生产或现有日常开发数据库。

随后依次处理 K02/K03 的配置合同、K04/K05 的权限与入口策略、K06 的其余协议，以及数据转换。在新基线实际通过验证后，将 R/D 项的旧实现留在对照分支，不重新叠加回去。

本次完成的是可执行取舍清单和所有者两项产品选择的记录。补丁确切文件数、完整工期和数据转换方式，等最小试迁及配置字段差异验证后给出；不把 8 组保留能力等同于 8 个文件或 8 次提交。
