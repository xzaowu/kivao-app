# 上游贡献候选记录

本轮已按用户授权检查首个 PR，并将通用修复分别提交上游；不把 KIVAO 主线、品牌或发布配置整体提交上游。

## 已提交

- [PR #1056：画布 Esc 优先关闭可见浮层](https://github.com/ddcat-ai/open-ai-canvas/pull/1056)。
- 独立提交：`d33fc0a55dba120db63144f432308e7d12317fcb`，作者关联 `xzaowu`。
- 本地格式、类型、lint、完整前端测试通过（3503 pass），桌面和手机视口的真实画布浏览器验证通过。
- 首次提交时上游 CI 为 `action_required`；后续已于 2026-11-16 合并，合并提交 `6b57b128e448f027a25c1bc06f237b41f00a28ec`。GitHub 作者关联为 `CONTRIBUTOR`，无待处理审查意见。

## 本轮独立贡献

| 主题 | 上游入口 | 独立提交 | 本地验证 |
| --- | --- | --- | --- |
| Turnstile 加载失败恢复与窄屏适配 | [PR #1061](https://github.com/ddcat-ai/open-ai-canvas/pull/1061) | `2337688d4f3994464ba5098293cdfe524bbf892d` | 原实现 1 pass／10 fail；修复后组件交互通过。同步上游后重跑推送前 4 项检查、0 失败；完整前端 3558 pass／0 fail |
| 普通／微信注册成功后只恢复会话 | [PR #1062](https://github.com/ddcat-ai/open-ai-canvas/pull/1062) | `4d07f5e7486cee4874dd0ff242df63bd991550c2` | 推送前 4 项检查、0 失败；完整前端 3559 pass／0 fail |
| 批量上传操作锁与新批次清理 | [PR #1063](https://github.com/ddcat-ai/open-ai-canvas/pull/1063) | `8440da669a9d80ecfe34bdf76a702ed312e88785` | 原实现组件交互 0 pass／3 fail；推送前 4 项检查、0 失败；完整前端 3558 pass／0 fail |
| 模型目录失败重试与会话隔离 | [PR #1064](https://github.com/ddcat-ai/open-ai-canvas/pull/1064) | `3397a0e0d04843427192d7df938d3d434a75f300` | 原实现会话恢复 0 pass／6 fail；推送前 4 项检查、0 失败；完整前端 3564 pass／0 fail |

- 四个 PR 均为公共 fork `xzaowu/open-ai-canvas` 的独立分支，直接基于上游，不互相堆叠。
- 注册补丁保留协议校验，并把源码位置断言限定到协议后方的注册按钮。Turnstile 旧实例回调测试由独立验证码 PR 负责，不混入注册补丁。
- 批量上传同步旧源码断言，以适配格式化和新的引用锁，保留上传进度、错误原因与失败重试检查。
- 模型目录仅提取读取恢复和状态展示；保留上游 `image_usage`／`imagePricing`，不带入 KIVAO 的游客、分组导航或其他选择器定制。
- 最终远端核对：四个 PR 均开放待审查、没有合并冲突。[注册 CI](https://github.com/ddcat-ai/open-ai-canvas/actions/runs/43892212203) 与[批量上传 CI](https://github.com/ddcat-ai/open-ai-canvas/actions/runs/43893476914) 已成功；[验证码 CI](https://github.com/ddcat-ai/open-ai-canvas/actions/runs/43895079972) 与[模型目录 CI](https://github.com/ddcat-ai/open-ai-canvas/actions/runs/43894400262) 仍在运行，不视为已通过。状态可能随后变化，以 GitHub 为准。
- 本地证据位于 Git 忽略的 `.local/cache/upstream-contribution-review/`；未提交日志、密钥、数据库或真实运营资料。
- 本轮没有真实 Cloudflare／微信 OAuth、浏览器真机、对象存储上传或模型调用验收；无相关后端改动，后端检查、支付插件双架构及预演台 E2E 未在本地运行。

## 推荐顺序

1. Turnstile 加载失败恢复与窄屏适配：小范围通用修复，有对照复现与回归。
2. 普通／微信注册成功后的会话恢复：只恢复会话，不重放成功注册及一次性票据。
3. 批量上传进行中的防重复操作及新批次清理：只提取本方新增部分，保留上游已实现功能的来源。
4. 模型目录失败重试和账号切换隔离：调用方较多，单独审查。
5. 深度动作捕捉：上游已实现相对深度视频，需求 Issue 已结项，不再整理同功能 PR。

## 深度动作捕捉的贡献边界

- 首次候选检查时的上游 `ac9a1a33` 未找到 `depth_capture`／`volcengine-mediakit-video-depth` 实现；本轮又复核了最新上游及开放 PR 关键词，未发现直接同题项，不代表穷尽全部历史讨论。
- 已有独立声明式协议插件、视频节点结果与连线、开始前不提交、后台处理参数、资源归属校验、按输出时长结算及模拟回归。
- 功能输出相对深度视频，不输出骨骼动作、BVH 或三维动画；名称和功能说明应向维护者说清楚。
- 本地记录仍缺真实服务效果、耗时、HEVC 播放及供应商账单验收，不把 Stub 验证写成真实调用通过。
- 正式提取前复核官方接口、计费、结果持久化和资源访问边界，保留作者与许可证，不夹带 KIVAO 品牌、运营数据或发布配置。
- [需求讨论 Issue #1060](https://github.com/ddcat-ai/open-ai-canvas/issues/1060) 已由上游提交 [3361eef](https://github.com/ddcat-ai/open-ai-canvas/commit/3361eef01ee9348b89630491beabd293d12162ba) 覆盖主要功能并进入 main。已依用户授权附上实现关联并关闭为 `completed`，保留讨论记录，不再提交重复功能 PR。结项依据是源码实现核对，不代表真实付费服务、HEVC 跨浏览器播放或供应商账单验收已完成；本轮未做真实模型调用。

本轮不修改生产环境，不合并上游或 KIVAO 的 main，不发布镜像、标签或部署。
