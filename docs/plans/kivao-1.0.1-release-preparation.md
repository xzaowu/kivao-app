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
只有独立的 Registry 只读检查 job 声明 packages:read；令牌仅在内存中用于 HTTPS pull 认证，不写 Docker 登录文件或 Artifact。
CI 不推镜像；带 GHCR 名称的 candidate-SHA 标签只存在该 Runner 的本地 Docker 中。

1. 冻结范围门禁：验证完整 HEAD、祖先链、产品快照、受保护目录的 Git tree/blob、依赖锁、Schema 77 来源及正式图标 SHA-256。
2. 完整复用原 quality.yml：Agent 静态/架构检查、Backend 全部分片及 PG/Redis 依赖门禁、支付插件检查、Web 格式/类型/Lint/pretest/全量测试与预演台 Chrome E2E。
   原工作流的 ARM64 支付 smoke 仅在 PR 条件下运行；本次 push 的候选架构仅为 linux/amd64，不声称验证 ARM64。
3. 从当前候选 SHA 构建三个 linux/amd64 镜像，记录锁文件、Dockerfile 哈希、构建参数、OCI 标签、实际 image ID 和 BuildKit 元信息。
4. 只启动无网络、只读的独立检查容器，覆盖 ENTRYPOINT，不启动业务服务或迁移：
   Web 检查实际 JS 中的提交 SHA 及正式图标字节；Backend 检查 yingce-backend 的嵌入 SHA，并记录两个迁移 CLI 的实际 SHA-256；Agent 检查实际 build-info.json 的版本/SHA/时间。
   两个迁移 CLI 不链接应用 buildinfo 字段，不声称它们嵌有候选 SHA；其来源由同镜像的构建上下文、Dockerfile/源代码冻结及实际二进制哈希追溯，始终不执行迁移。
5. 使用当前 workflow 的 GITHUB_TOKEN 验证三个 r1 固定 manifest 可读，再要求三个候选修订均明确返回 MANIFEST_UNKNOWN。
   身份、权限、网络、限流、重定向或响应不确定均失败；不得把 401/403 或无已知可读基准的 404 当作不存在。
6. 只有完整质量检查、三个构建和 Registry 只读检查全部成功才生成 kivao-101-ci-report。
   报告中的 registry_digest 为 null，image ID/BuildKit digest 不能冒充已发布 registry digest；CI 成功不代表人工已授权发布。

配置在 .github/kivao-1.0.1.json；验证/成对锁工具为 scripts/kivao-release.py，边界测试为 scripts/test_kivao_release.py。
CI Artifact 仅上传源码与构建元信息，不上传 .env、业务数据、备份、恢复私钥或模型密钥。
Artifact 默认保留 14 天；发布前证据若已过期，应重跑同 SHA 或重新评审候选，不绕过门禁。

## 未来发布入口（当前禁止执行）

.github/workflows/kivao-1.0.1-publish.yml 只监听 kivao-1.0.1-* 标签，进一步要求：

- 完整格式 kivao-1.0.1-候选前12位SHA-rN（N 从 1 起），必须是注解标签并精确指向已验证候选。
- 所有者新的明确 IMAGE PUBLISH 授权后，才允许设置 KIVAO_101_PUBLISH_APPROVAL 并启用 KIVAO_101_PUBLISH_ENABLED=true；本轮不配置或启用变量。
- 移除 Environment 引用。私有仓库没有可用的独立 Required Reviewers，不创建无保护环境来冒充审批。
  采用[所有者精确授权与标签推送门禁](#单人私有仓库的人工授权机制)，这是自审约束，不是独立双人审批。
- 读取授权记录指定的唯一 CI run，检查工作流路径、push 事件、专用分支、完整 SHA、completed/success，再下载完整报告。
  旧 SHA、缺失/过期 Artifact、质量失败、缺角色、Registry 证据缺失或嵌入 SHA 不匹配均拒绝。
- 三个自有仓库：ghcr.io/xzaowu/kivao-app-web、kivao-app-backend、kivao-app-agent。现有修订必须明确不存在，鉴权/网络不确定不视为缺失。
- 在任何 packages:write job 启动前，独立 packages:read job 先核对所有三个修订；各角色 push 前再验证本角色不存在、授权尚未过期。
  发布工作流全局串行，拒绝 rerun（run_attempt 必须为 1），不能通过重跑覆盖部分成功的修订。
- 未来发布会从同一 SHA 重建并再次做镜像身份检查，检查后才 push；随后按 registry digest 拉回，要求 image ID 仍等于刚验证的镜像。
  基础镜像标签/系统包可随时间变化，因此不保证重建与之前 CI 镜像逐字节相同，不伪造 digest。
- 不使用 v*、latest、旧 r1 标签或旧发布工作流，不覆盖已有镜像或发布资料。一个角色发布失败可能留下部分不可变修订；没有全部成功不能产生最终锁，不能以覆盖同 tag 的方式修补。

源码 VERSION 仍为 v1.7.3.3，构建参数和 OCI version 保留该来源版本；独立 KIVAO 版本由 io.kivao.release 和专用标签标识。
原 publish-images.yml、kivao-baseline.yml 与 r1 工具保持不变；不把它们应用于当前分支，也不推 main。

## 单人私有仓库的人工授权机制

### 实际能力与信任边界

门禁修正时，仓库为所有者 xzaowu 名下 Private，仅一名协作者 xzaowu，具有 admin/push 权限。
仓库环境和变量列表为空；Rulesets API 返回 HTTP 403，提示升级计划才能使用，账户 API 未返回具体套餐。
因此不宣称已有受保护标签、独立审批或可用的私有 Environment Required Reviewers。
GitHub Free/Pro/Team 的 Required Reviewers 仅对公开仓库可用，见[官方文档](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。
本方案不改变仓库可见性、套餐、协作者或权限。

默认无授权变量、无启用开关，不发布。未来必须有所有者新的明确镜像发布授权，并由所有者身份推送专用注解标签。
workflow 同时要求 github.actor 和 github.triggering_actor 都为 xzaowu，拒绝其他账号、workflow_dispatch、分支 push 和 rerun。
标签本身无平台保护保证；具有写权限的人仍可能创建/删除标签。管理员也能修改 workflow、变量或其他发布入口，
这是信任所有者账号及其凭据的自审方案，不能防御管理员主动绕过、账号失陷或恶意修改受信任工作流。
将来引入协作者或获得独立审批能力时，必须重新评审标签保护、代码审核与包权限。

### 授权记录

KIVAO_101_PUBLISH_APPROVAL 为非敏感 JSON（不是密钥），必须包含：

```json
{
  "decision": "IMAGE_PUBLISH_APPROVED",
  "approved_by": "xzaowu",
  "sha": "<人工批准的完整40位候选SHA>",
  "release": "kivao-1.0.1-<该SHA前12位>-r1",
  "ci_run_id": 123456789,
  "authorization_ref": "HD-KIVAO-101-IMAGE-PUBLISH-01",
  "approved_at": "<人工批准时间，含时区>",
  "expires_at": "<授权过期时间，含时区>"
}
```

上例是无效占位模板，不构成授权。必须复制实际 Human Decision 的范围与引用，不得把 VISUAL PASS 或 RELEASE GATE REPAIR 当成 IMAGE PUBLISH_APPROVED。
有效期最多 24 小时，未来开始、已过期、错误 SHA/版本/CI run 或缺少字段全部拒绝。
同一 SHA 的新修订也必须重新批准明确 rN，不复用旧授权，不移动旧标签。
授权记录及精确 CI 验证结果上传为发布审计 Artifact，并在最终 paired locks Artifact 中一并保留。

### 仅供未来获批后由所有者执行

1. 冻结候选 SHA；核对其完整 CI 成功、报告仍可下载、三个包的私有可见性及候选修订不存在。
2. 取得新的明确 IMAGE PUBLISH 授权，将上述真实字段保存到 Git 忽略的 .local/release-approval.json，人工检查后设置：

   ```bash
   gh variable set KIVAO_101_PUBLISH_APPROVAL -R xzaowu/kivao-app < .local/release-approval.json
   gh variable set KIVAO_101_PUBLISH_ENABLED -R xzaowu/kivao-app --body true
   ```

3. 在干净且 HEAD 等于已批准 SHA 的工作区创建新的注解标签；标签必须精确指向该 SHA，先核对远端没有同名标签再推送。
   此处不提供自动创建/推送标签的脚本，保留所有者明确的人工动作。本轮禁止执行。
4. 记录 tag push 所对应的发布 run ID，观察授权、只读 preflight、三个镜像验证/发布及锁生成结果。
   不使用 Environment 审批；真正的人工动作是先批准精确记录，再由所有者推送标签。
5. 无论成功、失败、取消，均由所有者关闭开关并清空授权记录，再读取变量确认；失败时不重跑或覆盖同修订：

   ```bash
   gh variable set KIVAO_101_PUBLISH_ENABLED -R xzaowu/kivao-app --body false
   gh variable delete KIVAO_101_PUBLISH_APPROVAL -R xzaowu/kivao-app
   ```

workflow 不持有修改仓库变量的管理凭据，不能自动完成这一步。开关不是即时终止按钮，已排队/运行 job 可能读取到先前的变量快照；
紧急撤销须同时取消对应 workflow，并核对实际发布状态。到期检查与精确版本约束减少误触发范围，不能替代取消动作。
Registry 不提供跨三个仓库的原子提交；预检后到 push 之间仍存在外部写入竞争，且一个角色失败可能留下部分修订。
当前只有所有者维护，发布期间禁止其他 Registry 写入；如出现竞争或部分发布，立即停止、记录已有 digest，重新评审下一修订，禁止覆盖。

### 三种凭据分别验证

- 本地 gh OAuth：本轮通过所有者交互式增加 read:packages 后，已能读取三个私有包的元信息。
  仓库 admin 不自动等于包权限，不将 Token 输出到终端/聊天/日志/仓库。
- 本地 Registry：从 gh 交互认证中在进程内取得只读凭据，经 GHCR HTTPS pull 认证，核对 r1 manifest 和候选不存在。
  不保存 Docker auth，不执行 docker login/push；发布新 SHA 后必须针对该新版本重新核对。
- Actions GITHUB_TOKEN：由 GitHub 按 job 签发，CI/preflight 只请求 packages:read；只有通过授权后的正式发布 job 请求 packages:write。
  CI 的真实只读结果可证明其 pull 能力，不能以此宣称已做过写入验收。首次真实写入仍属于下一轮明确授权。
  本地 OAuth 权限不会自动传递给 Actions；包关联仓库也不能替代实际读取验证，见 [GHCR 认证与权限](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

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
- 所有者已明确 VISUAL PASS，接受 22 张真实路由预览体现的品牌与 UI；不再调整 Logo 或生成截图。
  该接受范围基于本地静态构建/模拟 API，原 CI 未留存可运行镜像的证据限制仍保留；本轮产品 tree 不变，视觉结论沿用到发布流程修正提交。
- 真实后端公告保存、真实模型、支付与通知不在本轮范围；下一阶段仍要验证 PG17 隔离副本、生产拉取和回滚条件。
- 本轮只修正/测试流程并推送开发分支。只有新 SHA 的完整 CI 和 Registry 只读检查通过后才能报告技术准备就绪，
  然后再次申请 IMAGE PUBLISH；不会因 VISUAL PASS、r1 曾成功发布或流程已就绪而自动写 GHCR。
