# KIVAO 1.0.1 最小开发方案

**两项产品改动已实施，未发布或部署。** 本轮授权品牌初始化与 KIVAO 产品公告；普通用户系统插件显隐（P2）代码改造已取消，使用现有后台设置。实施、验证和发布前限制见 [1.0.1 开发验证记录](kivao-1.0.1-validation.md)。以下保留原方案作为设计依据；正式图标见[资产记录](kivao-1.0.1-brand-asset.md)，产品验收仍需人工确认。
生产状态及分支关系见[首发结项](../operations/kivao-first-cutover-closeout.md)，流程见[发布原则](../operations/kivao-release-policy.md)。

## 起点和拆分

dev/kivao-1.0.1-baseline 从 docs/kivao-first-cutover-closeout 的结项提交建立；
初建时应用代码等于 e19976f6/eeccf718，结项提交 7593b6a2 已包含在血统中。当前 main=82fc5c03 另有 14 个提交，不参与本小版本。
本轮在该分支按品牌、公告、回归验证及文档三个小提交实施，不建立并行修复分支，不修改发布标签或生产。

本轮两项需求不动数据库 Schema、登录协议、渠道配置、余额/计费、模型生成协议和 Agent Runtime。
发布流程适配单独一项提交，与产品改动分开评审。

## P1 品牌闪现

**静态发现，不等于已完成浏览器复现：**
web/index.html 已是中性标题“正在加载”和 data favicon，不能误称 HTML 写死影策。
web/src/main.tsx 同时启动 bootstrapAppearance 和 import application；
web/src/stores/use-appearance-store.ts 的初始 brandName/seoTitle/logo/footer 仍有影策默认值，
web/src/services/appearance-bootstrap.ts 超时 4 秒后返回该默认值。
因此应用可能在外观请求完成前渲染默认品牌，失败分支也可能恢复上游身份。

最小实施方向：

- 在真实启动边界或 AppProviders 用现有 resolved 状态隔离带品牌 UI；
  中性加载态结束后再展示已解析外观，不重写路由或创建独立 HTML。
- API 配置仍是权威；只对 KIVAO 构建的未配置/错误回退设计一致的 KIVAO 或中性文本和 logo，
  不显示上游内置 logo 后再替换。复用现有 store/normalizer，先不引入新缓存系统。
- 选择是否等待 appearanceReady 时注意 application.tsx 有 createRoot 副作用；
  单纯 Promise.all 不会阻止 import 的立即渲染。若串行等待，要明确评估最多 4 秒的首屏代价。
- 只处理品牌展示默认值、启动时序及必要资源；不全局改包名、作者、许可、模型提示词或 Agent 人设。
  如果需要新增 KIVAO logo，只用已确认可用的自有素材，不临时引入外部服务。

优先读取/修改入口：web/src/main.tsx、services/appearance-bootstrap.ts、
stores/use-appearance-store.ts、components/layout/app-providers.tsx、真实 header/auth/logo 使用处；
已有 appearance 测试按真实模块补齐，不通过 Nginx 注入遮盖问题。

验收：清空缓存冷启动、正常/慢于 4 秒/失败/空配置接口、/login 和工作区、明暗主题；
观察首帧到稳定态的标题/logo/站点名/页脚，不出现上游品牌闪现。
外观失败必须有限等待并可继续使用，登录和后台设置仍可达；不读取或输出私密外观配置。

## P2 普通用户的系统插件可见性

**代码改造已取消，保持原有逻辑。** 所有者确认现有后台设置已满足需求。下面仅保留历史调查依据，不再安排相关代码改造。

现有能力并非从零缺失：

- backend/internal/platform/feature_availability.go 默认 systemPluginsVisibleToUsers=true。
- backend/internal/app/protocol_registry.go 的 PluginsForUser 已在开关关闭时仅返回 user-scope，
  管理员保留全部；backend/internal/handler/plugin.go 的目录/详情及状态路径应一起核对。
- web/src/pages/plugins/index.tsx 已有筛选，使用 backend management.kind 或官方应用 ID 例外；
  分类数量又使用另一套判断，不能把 origin=official、kind=application 与 activationScope=user 等同。
- plugin_management.go 已拒绝普通用户管理 system-scope，不应重复发明权限模型。

推荐最小契约：沿用管理员显隐开关语义，关时普通用户仅看到允许的 user-scope 应用；
管理员仍能管理系统协议/支付等插件，底层模型协议和支付运行能力不因“隐藏卡片”被禁用。
如果产品目标是即使管理员开关允许也永久隐藏全部官方应用，应另行明确，不混成这次一致性修复。

先在隔离账号夹具中复现：默认/已保存 false/true、管理员/普通用户、未加载 feature、切换账号和网络失败。
若只是当前设置为 true，先如实说明设置因素；不修改生产开关来冒充已修好代码。

实现优先级：

1. 统一卡片列表、分类计数、搜索、详情入口的可见性判断；未解析/未知 scope 时避免短暂露出系统卡片。
2. 检查后端 catalog/detail/status 是否泄露管理入口或敏感配置，复用现有 actor/service 校验。
   确有缺口再做最小 Backend 改动，不仅靠前端隐藏按钮。
3. 系统插件个人启停仍返回拒绝；管理员恢复入口不变；用户状态缓存不得继承管理员列表。
4. 不新增表/权限框架，不删除或卸载系统插件，不改真实渠道和支付配置。

验收：开关关闭时普通用户无系统卡片/计数/详情入口，直访管理操作拒绝；开关开启按契约显示，
管理员全量可管理；用户应用保留，系统协议运行的 Stub 回归不受影响。
专项入口含 backend/internal/app/feature_availability_test.go、plugin_management_test.go，
以及真实插件页筛选与角色切换测试。普通用户夹具只建在非生产数据库。

## P3 原始更新日志

web/vite.config.ts 直接把根 CHANGELOG.md 注入 __APP_CHANGELOG__；
app-changelog-dialog.tsx 在 appearance.updates.enabled=false 时展示它。
app-changelog-modal.tsx 点击后异步刷新外观并立即打开，不能把先显示上游内容再更新算作完成。
已有 lib/update-announcement.ts 和 UpdateAnnouncementContent 应保留，管理员已发布的站点公告优先。

最小方案：

- 给 KIVAO 明确的随版本维护说明，例如 KIVAO_CHANGELOG.md；让构建读取自有用户说明作为回退。
  保留上游 CHANGELOG.md/许可/来源，不删除审计历史，不伪造未上线功能为已发布。
- 自定义站点公告启用时继续优先显示；禁用/为空/加载失败时也不回退原始上游开发日志。
- 入口标题、版本徽标与内容来源一致，未解析时不先露出旧日志。
  版本复用现有 CANVAS_BUILD_VERSION/BUILD_VERSION 参数，避免新增互相矛盾的“当前版本”真相源。
- 后台系统更新的上游 Release 技术信息与普通用户公告分开；本小版本不改 Host Updater 协议，
  不让普通用户看到官方更新按钮，不把文案修复变成启用自动升级。

验收：侧栏/账户菜单两个入口、启用/禁用/空公告、慢刷新/失败、版本一致性、Markdown 安全渲染。
只展示真实已发布 KIVAO 说明，保留管理员编辑能力；不在页面带出私有仓库日志或部署路径。

## 测试与交付边界

- 优先现有单元/组件测试；完成后做 Web typecheck/lint/build 与真实路由浏览器验收。
  只读模拟数据和 Stub；无真实模型生成、支付/查单/通知调用。
- 需要 Go 改动时跑相关权限/插件专项与 Quality checks 要求；普通账号和无网络夹具明确标识。
- 基线工作流有源码冻结检查，修改 Web 后本来就会拒绝，不能把拒绝解释成产品测试失败。
  下一轮新增专用候选 CI/发布入口，在实际候选 SHA 上构建，详见发布原则。
- r1 锁工具、构建脚本的硬编码适配必须评审；新版本回滚锁应指向当前 KIVAO r1。
- 不声明 Schema 兼容已验收：计划目标是零 Schema 变化，须以代码 diff、DDL/账本和实际副本验证证实。
- 两项改动的实际验证见开发验证记录；没有创建 1.0.1 tag 或发布镜像。P2 代码改造已取消，不扩展插件功能范围。

## main 整合安排

已检查的品牌 store、HTML、插件页、更新弹窗、插件管理/handler 和 Vite 入口，
在 eeccf718 到当前 main 的 diff 中没有变化，有利于小提交移植，但不证明全量整合安全。
先在本生产基线上独立验证，再在 integration/kivao-main-1.0.1 逐个移植已评审补丁。
对 main 的 14 个新提交另开功能/数据/计费/媒体/CI 审查，不能借整合文档把它们一起推生产。
本轮不创建集成发布、不合并 main，也不启动生产切换。
