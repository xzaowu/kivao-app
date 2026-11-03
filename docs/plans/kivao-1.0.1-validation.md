# KIVAO 1.0.1 开发验证记录

状态：两项产品实现及本机验证完成，待人工产品确认；未发布镜像、未部署生产。
本轮仅授权本地开发/测试/提交、经检查推送结项文档分支和开发分支。
未获 main 合并、发布标签、镜像发布或生产部署授权。生产仍以 [r1 固定清单](../operations/kivao-production-r1.json)为准。

## 基线、血统和提交

- 工作分支：dev/kivao-1.0.1-baseline，工作区初始干净，结项 7593b6a2 已在祖先链中，仅引入一次。
- 父基线：e19976f61bd08c271ae88d9921a20f8304d729f4；应用源码 eeccf718e8ad78aee98ca49d142d0594ea7000b2。
- 品牌提交：bf0fb5f7；公告提交：38eda4c2；第三个提交补欢迎页品牌调用方、元数据/会话切换回归和本文档。最终完整 SHA 见该分支 Git 历史。
- 未合并/rebase main，不包含 main 的 14 个后续提交。main、首发分支与 r1 标签未修改。
- 结项文档已按 10 文件白名单及常见凭据模式检查后推送 docs/kivao-first-cutover-closeout，提交仍为 7593b6a2。
  只推脱敏摘要，不含 .env、原始验收副本、恢复私钥、CMS 备份或业务数据。模式扫描不作为公开仓库放行证据。

## 两项实现

**品牌：** HTML 初始标题、前端默认名称/SEO/页脚/品牌标识为 KIVAO，新增自行绘制的 K 字母标记。
AppProviders 在外观未解析时保留 KIVAO 加载态；正常异步启动继续进行，不把整个 application 导入串行延迟 4 秒。
服务端明确 configured=false 时，前端身份回退 KIVAO；已经保存的品牌名称、Logo、深浅 Logo 与 SEO 仍是权威。
错误或超时后解除加载态，后续聚焦刷新仍保留最后成功身份；默认标记用 currentColor mask 适配主题。
未全仓替换字符串，未修改服务端身份、存储协议标识、许可证、Agent 人设或默认资源。
补查独立 /welcome 入口，将大标题与辅助标签改用当前 brandName；上游章节资料、源码入口、许可和演示素材署名保留。

**公告：** 普通用户的产品公告不再回退 CHANGELOG.md；关闭、旧数据或空内容显示“暂无已发布的产品公告”，
不伪造 KIVAO 发布记录，也不展示内部源码版本。后台已启用的图文/视频公告和自定义版本继续使用。
顶部和侧栏实际复用 WorkspaceAccountCard，两个入口共用相同实现；旧 WorkspaceSidebarFooter 当前没有调用方，本次没有修改。
管理员通过独立技术入口读取原 CHANGELOG.md；后台桌面/移动入口保留源码版本，系统更新页面及 API 未改。
入口和弹窗都要求会话已恢复且角色为 admin；角色失效后技术入口消失。显隐规则不是静态技术日志的保密机制。
公告编辑器和重置说明同步新语义，服务端公告校验、持久化与媒体权限保持原实现。

普通用户系统插件显隐属于原计划 P2，本轮明确延期；未修改插件目录、筛选、启停或权限合同。

## 自动化验证

依赖使用现有 Bun 1.3.9 和 bun.lock，bun install --frozen-lockfile；未改依赖或锁文件。
改动 Web 文件按现有 Prettier 配置格式化；类型检查、Lint、含 pretest 的完整测试及真实生产构建通过。
品牌相关专项 25 项，公告相关专项 12 项；完整测试 2,890 项通过（另含 pretest）。
新增行为回归覆盖未配置身份投影、异步成功/失败、已保存深浅 Logo/SEO、管理员/普通用户/未恢复会话与角色变化。
已有公告 Markdown 安全、图文视频渲染、校验、刷新失败保留及并发保存测试继续通过。

冻结分支没有 scripts/verify-before-push.mjs。为执行当前仓库要求的真实脚本，
只在 Git 忽略的本地缓存中复用 main=82fc5c03 的该脚本，唯一调整为 ROOT 指向当前工作区；
未将它写入产品提交或合并 main。命令为：

~~~bash
bun .local/cache/verify/verify-before-push.mjs --base 7593b6a2 --jobs 4
~~~

--base 指定本轮真实开发起点，自动范围不使用 --only，避免把 main 独有的 14 个提交当成本次变更。
脚本运行 Web 的 CI 同口径格式/类型/Lint/test（含 pretest）；本轮不涉及 previs，按脚本规则不运行预演台 E2E。
具体日志保持在本地 .local/cache/verify，最终检查针对本文件所在提交，工作区须干净后才推送。
backend 源码未变，不重跑 Go/PG/Redis；支付插件双架构构建未在本机覆盖。
构建仍有原有大 chunk 与无效动态导入警告，本轮没有顺带改打包架构。

## 真实浏览器范围

本机 Chromium 使用真实 Vite 生产构建与 /login、/plugins、/admin/settings/system-update、/welcome 路由；
127.0.0.1 预览、全新浏览器上下文、合成会话/外观/API 夹具，没有连接生产或本地业务数据库。
所有 API 请求在浏览器层拦截，非 GET 被写门禁拒绝，非本机来源先拦截再中止，不发送到外部。

| 组 | 场景 | 结果 |
| --- | --- | --- |
| 未登录 4 项 | 慢响应后采用自定义 SEO/品牌、未配置的上游默认投影、网络失败、4 秒超时；明暗/桌面/移动 | 登录表单可达，初始标题 KIVAO，无上游品牌闪现，已保存主题/配置采用正确 |
| 普通用户 4 项 | 关闭公告、启用公告、空公告、移动端启用 | 两个真实账户入口展示公告或空态，无技术入口/内部版本，应用插件页可访问 |
| 管理员 3 项 | 关闭/启用公告，明暗主题及移动端 | 产品与技术记录独立，技术内容不被自定义公告替换，系统更新页面只读渲染通过 |
| 欢迎页 2 项 | 默认 KIVAO、慢外观后采用自定义品牌；桌面深色与移动浅色偏好 | 实际大标题和 SEO 采用解析品牌，无上游品牌闪现；尊重 reduced motion，不扩大为 3D 全量验收 |

共 13 个场景、16 次公告/技术弹窗检查，分组执行均 exit 0；页面脚本异常 0、写请求 0。
外观失败/超时采用原有默认登录媒体，会产生被门禁阻断的两个外部媒体来源尝试；没有真实出站传输。
使用 MutationObserver 观察启动标题/文本变化，截图检查了真实产品公告及插件页；窄屏原样隐藏副标题/版本徽标。
浏览器脚本、JSON 汇总和截图只留本地忽略缓存，不包含生产数据，不上传 CI Artifact。

这是前端夹具验收，不是管理员真实密码认证、数据库保存、真实媒体权限或完整插件执行验收。
没有真实模型、支付、查单、通知、Agent 调用；没有点击更新、回退、充值或渠道测试。

## 差异、迁移和后续发布

相对 eeccf718 的原 e19976f6/7593b6a2 发布治理文件仍保留，产品变化仅在 Web 的品牌/公告及必要回归，
其余为文档同步；backend、yingce-agent、数据库模型/迁移、API、依赖锁、Dockerfile、Compose、Nginx、工作流和版本文件未改。
**本轮不需要数据库迁移，未执行任何迁移。** 数据副本与新镜像恢复验收尚未进行，不能据前端 diff 宣称已完成下一次生产兼容验收。

上游整合的主要冲突面是外观默认值、AppProviders、共享账户卡片/菜单、Welcome、AdminShell 和公告编辑文案；
不存在 Schema 冲突来源，但上游后续改同一界面时仍需人工处理语义冲突及角色回归。保留上游技术日志与许可证。
先独立确认本轮 UI，再适配“实际候选 SHA 构建 + 当前 KIVAO r1 回滚”的发布流程，匹配 SHA 的 CI 通过后另行申请专用标签/镜像发布。
现有 r1 工作流/构建脚本固定 eeccf718，锁工具固定 r1/原官方回滚，不能直接发布本分支。
推送开发分支不会触发当前仅 PR/workflow_call 的 Quality checks，也不会触发 r1 或 main 的发布流程；
本轮不创建 PR、触发镜像发布或把旧 CI 当作本候选的新 CI。后续从 main 的整合另开审查，不影响当前生产 r1。

## 产品修改文件索引

- 品牌：web/index.html、web/public/kivao-logo.svg、web/src/stores/use-appearance-store.ts、web/src/components/brand/brand-logo.tsx、web/src/components/layout/app-providers.tsx、web/src/pages/welcome/index.tsx。
- 公告：web/src/components/layout/app-changelog-modal.tsx、app-changelog-dialog.tsx、workspace-account-card.tsx、workspace-account-menu.tsx；web/src/pages/admin/components/admin-shell.tsx、web/src/pages/admin/settings/appearance-settings-page.tsx、components/update-announcement-editor.tsx。
- 回归：web/test/appearance-bootstrap.test.ts、kivao-announcement.test.tsx、update-announcement.test.tsx。其余为专题、待测、代码地图和发布策略的文档同步。
