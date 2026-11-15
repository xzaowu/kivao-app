# KIVAO 新基线升级：账号与模型选择性迁入

更新：2026-11-15。以本页范围为准，取代此前保留历史作品和旧支付依赖的方案。已完成在线逻辑快照、真实数据导入、原生服务校验、本地候选镜像、浏览器及隔离切回演练；迁入工具与证据整理为独立本地提交。没有切换生产、停止生产服务、修改生产数据、发布镜像或推送。

## 1. 已确认的范围

用户确认旧订单均为测试订单，并放弃旧任务、画布和素材；支付与技能采用当前新基线的官方实现，支付由所有者重新配置。

| 迁入 | 不迁入 |
| --- | --- |
| 账号、ID、密码哈希、身份绑定、角色、状态、用户分组与数据库头像 | 旧会话、验证码、OAuth 临时状态 |
| 积分余额、原始积分流水、已有存储授权及推广／兑换权益 | 旧充值订单、计费订单、通知、对账运行、支付套餐与支付配置 |
| 渠道、密钥密文、模型、定价／成本／币种、能力参数、逻辑模型及路由、分组授权 | 历史任务／Agent 执行与记忆、画布／快照、素材／文件、项目／短剧／创作历史、API 日志 |
| 必要的邮箱／注册／第三方登录／验证组件、积分与用户限额设置 | 旧技能及用户技能状态、旧支付／技能定制、旧运营配置／工作台／灵感／提示词模板、旧对象存储设置 |
| 两份独立坤肉插件及启用态、原 `.settings-key` 的独立受控副本 | 其他旧插件登记与开关、旧 data 整目录、旧 Redis 队列 |

原始积分流水不改金额、不补造开户记录，也不清空冻结积分。流水中的旧订单 ID 保留为历史追溯标识，可查原库；新版不提供对应旧订单明细。当前原生积分流水查询不依赖订单 JOIN，消费报告使用 LEFT JOIN；旧消费的订单能力等扩展字段将不再可用。已有存储授权引用的旧套餐／订单同理。

“不迁入”不是删除：旧数据库、文件、插件和备份完整保留回退。本次确认不授权清理生产或改写订单状态。必要设置的确切键白名单在 `kivao_import.go`；未分类表／设置仍阻断。

## 2. 已核实的基线与只读快照

| 对象 | 证据范围 |
| --- | --- |
| 生产版本 | `kivao-1.0.5-21fc78c84404-r1`，源码 `21fc78c844040e34977eeec77d028422da2e02b5` |
| 生产 API | Schema 79／expected 79／ready true；构建版本字段为 v1.7.3.3 |
| 新基线开发提交 | `8eb3c995e02fc9bd0f0af5bd00fb96cd1e5bf24d`，要求 Schema 104 |
| GitHub main | 前轮核实 `cc1653f9003d359cf800cd46955002dadc43aae3`，与上述开发提交文件树相同；不是本轮重新核实远端 |
| 开发 CI | [43695985475](https://github.com/xzaowu/kivao-app/actions/runs/43695985475) 成功，对应 8eb3c995；不覆盖本轮未提交导入工具 |

2026-11-15 宝塔 MCP 只读采集确认：

- `/opt/yingce`、Compose 项目 `yingce`；组合为 `docker-compose.yml`、`docker-compose.override.yml`、`operations/agent-stop-repair-r1/agent-init.override.yml`，Agent 实际 `init: true`。data／web／postgres／redis 挂载未变。
- PostgreSQL 17.11，迁移账本 78 条、最大版本 79，尾部是旧定制 78／79。旧官方 migrate 容器已退出，不用于新版导入或启动。
- `.env` 为 0600；`.settings-key` 存在、32 字节、0600，只读了元信息。当时根盘剩余约 9.91 GiB、数据盘约 19.34 GiB；后续只在本地完成候选镜像及副本恢复，生产容量仍需切换前复核。
- 10 个账号／积分账户、445 条积分流水；没有负余额、冻结余额或账本不一致。16 条渠道、204 条模型记录（含删除记录），103 条未删除、34 条启用；54 条禁用记录尚无能力／协议。
- 210 条任务：142 成功、62 失败、6 条 text_replay；未见 queued／running。text_replay 无计费／上游请求／有效租约；一条过期失败视频有 download 恢复元信息。Agent 4 completed、2 failed，cleanup_pending 为 0，上传预约为 0。上述历史不迁入，也不伪造完成状态。
- 10 笔支付订单：3 credited、7 过期 pending。3 条通知均 processed 并关联已入账订单；pending 本库未见付款时间、交易号、到账流水或通知关联。11 条历史对账运行 failed，没有未处理对账明细。用户随后确认均为测试订单，可不迁入；该说明不能免除维护窗口的资金检查。
- 73 条 builtin 技能、15 条用户技能状态、10 条易支付历史配置均不迁入。193 条本地媒体约 477.5 MiB，前轮检查存在／大小正常；不再要求复制到新 data。

生产三镜像已核对实际 ID、RepoDigest、OCI revision、amd64 架构；切换前仍须复核：

```text
ghcr.io/xzaowu/kivao-app-web@sha256:b2aaa111c18868888245cd250907f3469af600a7fabcf4fec83592bb93c220f2
ghcr.io/xzaowu/kivao-app-backend@sha256:98b75357f7e8d7a855df42a0d5112ccb994316a4512fbc2976f0666897c34842
ghcr.io/xzaowu/kivao-app-agent@sha256:86619d93d08090218c919e98146129b37cfc6a5b51e7b38c6cf8ddde6a6ddc8b
```

## 3. 新库导入，旧库不动

旧 78 是 `skill_publication_review`，新 78 是 `drama_cast_voice_looks`；旧 79 是 `payment_order_method`，新 79 是 `ecommerce_agent_and_knowledge`。名称和 checksum 冲突，不允许改数字、删账本或伪造官方迁移已执行。

在独立 PG17 空库正常建立 Schema 104，按清单导入，不复制旧迁移账本。仅重放涉及保留模型记录的官方数据转换 88、89、97，并校准原 ID 序列；不再转换旧画布、支付或技能。付款流程和技能库由新基线提供，支付配置初始为空；正式开放充值前由所有者重新配置并验收。

最终可以复用现有 PG17 服务，但业务库、应用 data、Redis 队列必须与旧版本隔离。新旧应用不能同时处理真实业务。Compose 根目录／项目名、端口、Nginx 和 Agent init overlay 保留；新库身份／连接配置／挂载切换属于未来部署授权范围。

## 4. 本地导入工具

入口 `backend/cmd/kivao-import`，实现 `backend/internal/database/kivao_import*.go`，不会被正常服务器启动调用。

- 默认 plan；`--apply` 才写目标。只接受 literal loopback、PG17、`kivao_rehearsal_` 库名、指定演练根目录内的独立文件副本；拒绝生产库名、远端地址、额外 search_path、源目标相同。
- 源使用只读 REPEATABLE READ 事务，旧账本 1–77 和定制 78／79 必须准确匹配。目标必须为空，或是同一规则成功导入且未改动的副本。
- 规则与回执 ID 为 `accounts-models79-to104-v2`，旧全历史 v1 回执不能复用。保留原 ID、哈希、密文、头像二进制和积分流水；不使用会脱敏密码哈希的业务 JSON 导出。
- 对省略表仅计数，另聚合检查活动与资金状态；不读取旧任务正文、支付配置密文或技能内容。只允许已过期、无到账证据的 pending 测试订单留在旧库；未处理通知／不明资金、活动任务／租约／上传、Agent 清理、冻结积分仍阻断。检查失败或缺少安全检查表也阻断。
- text_replay 只有无上游请求、无计费关联、无活动租约才允许留在旧库。失败媒体恢复记录不迁入，新版不恢复或重试这些任务。
- 保留禁用且能力、协议均为空的占位模型，不猜测协议或自动启用；其他缺失／未知协议仍拒绝。已删除模型的非空协议依赖仍须验证。
- 新 data 导入前只允许 `.settings-key`、`plugin_registry.json`、`plugin-packages`，且注册表／包目录只有指定两个独立插件。拒绝混入媒体、技能、旧支付包等文件。源、目标目录 0700，密钥／登记／包 0600；不得共享文件 inode 或使用符号链接。
- 不复制文件、不生成密钥；核对原密钥相同、包 hash／manifest／ID／启用态，认证解密保留记录后立即丢弃明文，不写日志或文件。目标登记来源为 uploaded，避免新版同步清除自定义包。
- 官方包若与两个独立插件 ID 冲突则停止。协议注册使用实际包，无缺包的内置实现兜底。
- 建表、复制、转换、校验、回执均处于目标事务；失败完整回滚。重复执行只验证摘要，不重复入账，不覆盖改变后的源／目标。摘要覆盖保留的数据与文件；被明确省略的历史只统计，不作为重复导入的内容指纹。
- 报告只输出规则、计数、状态、固定错误码；`productionReady` 始终 false。保留表单表最多十万行，超过则停止，不截断。

连接串仅从私有环境变量 `KIVAO_IMPORT_SOURCE_DSN`、`KIVAO_IMPORT_TARGET_DSN` 注入，不放命令参数、聊天、Git 或 CI Artifact。以下仅用于独立离线演练，不适用于生产或日常开发目录：

```bash
# 从 backend/ 执行；DSN 已在受控私有环境中配置。
export KIVAO_IMPORT_REHEARSAL_ROOT="$(realpath ../.local/cache/kivao-import-rehearsal)"
go run ./cmd/kivao-import \
  --source-data "$KIVAO_IMPORT_REHEARSAL_ROOT/source-data" \
  --target-data "$KIVAO_IMPORT_REHEARSAL_ROOT/target-data" \
  --official-plugins ../plugin-packages \
  --plugin-ids 'kunrou-chat-audio,kivao-kunrou-video'
# plan 全部通过后，同一命令加 --apply 才写入隔离目标。
```

## 5. 验证证据与剩余工作

本地合成 PG17 测试使用独立内部网络、内存数据库，无发布端口、无生产卷、无 Worker：

- 账号密码哈希、头像、余额／流水／历史订单引用、渠道密文与网站归组、原编号序列保持；plan 不写目标，同源重复不重复入账，源摘要不变。
- 源夹具包含旧支付配置、技能自定义字段、过期测试订单、失败对账记录、text_replay、媒体恢复记录、不兼容旧画布及孤立资源引用；新库中被省略的历史表为空，旧插件开关只保留两个坤肉依赖。旧配置中的不可解密密文没有被复制或尝试解密。
- 异常测试覆盖活动／不明资金、冻结余额、未知映射、关联错误、文件／密钥／插件错误、目标修改和插入中途失败回滚；拒绝旧范围回执。CLI 边界验证通过。

两份真实插件包已在本地历史缓存找到，hash 与生产只读结果一致，不涉及业务备份或密钥传输：

| 插件 | 版本 | SHA-256 |
| --- | --- | --- |
| kunrou-chat-audio | 1.0.0 | `58ba924b14cdabacf41c15e10710c133e6606a88d6c52593170981fad759495c` |
| kivao-kunrou-video | 1.2.0 | `0657e1010cf295483bd74e56304c73496712191aaadfdaea47eb3034bd7b7fc7` |

前轮已验证 uploaded 插件连续两次原生初始化、12 种非空协议注册、音频请求／解析和 SD／Veo 创建／轮询／结果 Stub；禁网且没有实例化任务 Worker。生产来源本就为 uploaded，无需线上修改。旧本地 video 1.2.0 的另一 hash 仅 documentation 不同，但仍换成上述生产准确包验证。此证据不是付费供应商验收，本轮没有改包或重复真实调用。

真实数据验证已完成：

- 经授权，通过宝塔 MCP 在线导出 PG 一致性快照，原 `.settings-key` 和两份插件在快照前后 hash／文件元信息稳定；没有停止容器、暂停 Redis、复制活跃 PG 数据目录或调用真实模型／支付。包不含媒体、Redis、Web 或部署配置，不能替代最终切换前的完整回滚备份。
- 密文约 2.33 MiB，经已有恢复公钥 AES-256-GCM 加密、MCP 分段传输后核对 SHA-256 并认证解密。副本使用 Docker `--network none`、不发布端口、独立内存 PG17 和只读输入挂载；130 张源表恢复指纹全部吻合。
- 初次快照捕获了后台对 7 笔过期测试订单的临时 closing 占用，导入器正确拒绝。只读复核后确认回到 pending；在不修改状态的前提下重新选取无 closing 的快照，原位替换同一个服务器临时包。没有放宽 closing／资金检查。
- 实际发现的 5 张 `skill_curation_*` 表归入已放弃的旧技能数据；增加针对性回归，证明旧分类不覆盖新版默认分类。源库、旧任务和订单均未改写。
- 迁入 Schema 104 后保留 10 个账号／积分账户、445 条原始积分流水、16 条渠道、204 条模型记录（含删除记录）和 160 条价格档。重复导入幂等；源 130 表指纹不变。导入器验证 13 个保留密文，原生服务另验证渠道／系统设置中 12 个密文。
- 新版原生服务读取 10 个账号的积分和模型目录成功；原始流水中 238 条非 reserve 记录可由用户流水查询正常读取，其余 reserve 行仍完整保留。34 个启用模型的默认参数报价全部通过：文本 6、图片 7、视频 17、音频 4；没有建计费单或扣款。未覆盖所有素材／规格／边界组合。
- 原生管理员登录与会话读取通过，外部验证码服务使用进程内 Stub，没有对 Cloudflare 发请求；不等于真实浏览器／外部登录验证通过。两份坤肉插件原生初始化成功，新版官方技能初始化 73 条，支付配置为空。所有原生验收写入在隔离目标事务回滚，随后复核导入回执，目标完整摘要不变。
- 本地仅保留一份当前加密包及私有证据；服务器上的本次临时副本在恢复验证后已删除。生产三应用的容器 ID、镜像 ID、启动时间和重启次数与快照前一致，其他备份未动。

### 候选镜像与隔离运行验收

三个本地 AMD64 镜像均从 `git archive 8eb3c995e02fc9bd0f0af5bd00fb96cd1e5bf24d` 构建，版本字段 `v1.8.5`；没有把工作区未提交文件、私有数据或恢复密钥放入上下文。导入工具使用工作区单独编译的演练程序，不在这些应用镜像中。构建上下文 SHA-256 为 `8dcc922604dbc90b695195d234cc4d9ca226063b8b7c0acd5864508bcbafe649`，Dockerfile、依赖锁文件和入口配置 hash 已记录。

| 本地镜像 | Docker inspect Image ID（不是已发布 Registry Digest） |
| --- | --- |
| `kivao-rebaseline-web:8eb3c995e02f` | `sha256:7b90e031d976a3148bab3c84d172ae042bb454e559a65bf6cfb960ca4579d6a2` |
| `kivao-rebaseline-backend:8eb3c995e02f` | `sha256:f73afa9f373f78ba067ef3eb3115026a8591c9bba22a86d86750167a86e06ea7` |
| `kivao-rebaseline-agent:8eb3c995e02f` | `sha256:1e00ac23cca385fb55f18608a3b8f9bb0360927e1782cda9389d7553f87b850e` |

- OCI revision、Web 内嵌提交、Backend readiness 构建提交及 Agent 实际源码／锁文件均匹配上述 SHA。Backend 首次构建遇到 Docker Hub 认证请求 EOF，重试成功；官方支付包构建和容器内冒烟检查通过。Web 有大 chunk／混合静态动态导入的构建提示，构建成功。本轮没有重跑与任务无关的开发测试。
- 复用同一份加密包，PG17 恢复和导入再次通过。所有应用、PG 和临时 Redis 共用 `network none` 命名空间，仅有 loopback；启动 Worker 前验证外网及宿主网关连接均返回 `ENETUNREACH`。不挂生产卷、Docker Socket 或更新器；浏览器仅经宿主 loopback 的入站转发访问，所有外部浏览器请求被拒绝。
- 原管理员真实密码登录、会话、模型目录、钱包、管理渠道、技能和 Agent 能力 API 通过。1440px／390px 的创作、图片、视频、积分弹窗、技能、渠道、插件、支付管理及电商共 18 个页面检查通过，KIVAO 品牌正常，无页面脚本异常或文档横向溢出。未覆盖所有弹窗、手机真机、Safari 或所有模型参数组合。
- 本次发现：省略旧运营配置后，新版默认关闭前台模型、图片／视频工作台、电商及电商视频。先记录默认值，再仅通过隔离副本的管理员 API 开启上述五项完成真实页面验收；没有把旧运营设置重新加入迁入白名单。正式上线需明确配置这些开关以及自定义渠道、系统插件可见性等默认行为。
- 仅在隔离数据库把 Turnstile `enabled` 设为 false，保留原密文；因此本轮密码登录是真实候选 HTTP／浏览器验证，外部验证码、邮箱发送和第三方登录仍未验证。这些演练开关不能原样作为生产配置。
- Backend／Nginx 的 SSE 初始读取、`?after=1` 与 `Last-Event-ID: 1` 重连均通过。使用一次性本地已完成文本夹具，游标分别返回 `[1,2]`／`[2]`／`[2]`，结束事件正确；夹具已删除。真实 Agent 镜像启动子运行时，调用 loopback Stub 一次、回传事件并 settled，401 鉴权和执行后 active=0 通过。没有真实模型／支付调用，没有生成或计费单。
- 停止的只是本轮候选容器；随后用生产当前三个固定 digest，切至独立旧 Schema 79 副本、旧 key／插件副本及独立旧 Web 目录。旧版就绪、原账号浏览器登录、34 个模型与积分读取通过；旧 Web index 与旧镜像发布资源 hash 一致，Agent init 保留。新 Schema 104 库和关键数据未被覆盖，源 130 表指纹不变。此项验证应用／库／目录选择切回，不包含未复制的旧媒体和完整生产 Web 卷恢复。
- 结束后移除本轮 8 个临时容器、内存数据库、宿主转发、解密文件和临时导入二进制；原日常开发的三个容器继续运行。保留三个本地候选镜像、一份原加密包及私有验收记录。本轮没有连接生产服务器，也没有新增服务器备份。

机器记录在 Git 忽略的 `.local/cache/kivao-import-rehearsal/candidate/`；构建、身份、启动、浏览器、SSE／Agent、回退、数据复核与清理分别有结果文件。浏览器截图仅本地私有保留，不进入仓库或 CI Artifact。

迁入工具复核后，重新使用全新的本地 PG17 内存数据库运行合成测试：47 项通过；依赖真实历史插件包的专项沿用上述本地验收，未将私有夹具发送至 CI。测试数据库和容器已清理，不使用日常开发库或新生产备份。

自有发布机制的本地准备见第七节。尚待：推送前完整验证、准确发布 SHA 的远端 CI 与 GHCR digest、生产预拉与容量复核、功能开放／新支付人工配置，以及最终维护窗口备份和切换授权。当前上游 `publish-images.yml` 的所有执行 job 仍限定官方仓库，不会为 KIVAO 发布；不能直接套用上游 `v*`／latest。若后续发布提交变化，必须按新 SHA 构建和验证，不把本次本地 Image ID 当 Registry Digest。

真实提供商调用与支付没有验收。在线数据库快照及稳定密钥／插件只证明本次选择范围的一致性，不承诺媒体或 Redis 与数据库在同一时点，也不是最终停写备份。

## 6. 发布、备份与回滚

- 历史备份 `pre-kivao-105-20261107T190645Z-c7287e4f` 是旧完整发布备份（Schema 77），不能替代当前 Schema 79；`kunrou-video-20261109T160703Z-37c9c5` 是渠道调整备份，含另一项目数据，不能当完整恢复源或连带导入。前轮根盘备份约 1.11 GiB，数据盘归档为空；这两份已有备份未改动。本轮新在线临时包已传回、验证并从服务器清理，见第五节。
- 遵循减少重复副本的偏好：演练复用受控副本，正式维护窗口只新增一套最终一致性备份。即使新版不带媒体，最终回滚备份仍须覆盖完整旧部署。保留旧库／文件用于回退；验收后的清理另行确认。
- 先完成新基线发布脚本与源码／OCI 身份适配、精确 SHA 质量检查及三自有镜像构建；不套用旧 CI，不混用新 Web／旧 Backend。固定 registry digest，Agent 保留 init overlay，禁止官方 latest／Host Updater 覆盖。
- 正式授权后顺序：重新核对版本／容量／任务／资金 → 关写入口并停止旧应用写入 → 一套最终一致性备份 → 以同一快照选择性导入新库及最小文件 → 核验账号／权益／模型／密钥 → 切新库／新 data／隔离 Redis 与三镜像 → 业务验收 → 开放入口。当前不提供可直接对生产执行的命令。
- 开放入口前失败：停止新版，恢复旧 DB／data／web／Redis 配置和上述旧三镜像；原库未迁移，不需要 Schema 降级。开放后有新写入则先停写、对账并保留新库，不能直接回切丢失新订单或作品。
- 不升级 PG／Redis，不修改 Nginx／DNS，不删除生产数据。当前为 **本地候选镜像、真实副本运行与隔离切回通过 / PRODUCTION CUTOVER NOT AUTHORIZED**；尚未发布新镜像或获得最终维护窗口备份与正式切换授权。

## 7. 新基线发布流程准备

本节记录专用开发分支的发布设计，实际执行与失败修正见节末。应用代码冻结在 `8eb3c995e02fc9bd0f0af5bd00fb96cd1e5bf24d`；后续提交仅包含离线迁入工具、测试、发布文件及对应文档。`.github/kivao-rebaseline.json` 固定产品与上游祖先、Schema、平台和当前生产回滚镜像。脚本拒绝产品范围外文件及冻结点之后的 merge；后续若要开发功能，应另行更新候选范围，不能靠修改检查结果放行。

### 候选 CI 与版本

- `.github/workflows/kivao-rebaseline-ci.yml` 仅监听 `dev/kivao-upstream-baseline-3979305c` 的 push，调用当前提交的 `quality.yml`，覆盖完整 Web／Backend／Agent 检查；额外使用 PG17 跑合成迁入用例。历史真实插件夹具仅在本地保留，CI 明确报告该项不重复，其余迁入测试跳过即失败。
- 从实际候选 SHA 的 `git archive` 导出干净构建上下文，构建三个 `linux/amd64` 镜像。核验 OCI source／revision／version、自有发布版本、Web／Backend 内嵌提交，以及 Agent 实际源文件和依赖锁 hash。Agent Dockerfile 不嵌入 `BUILD_COMMIT`，因此不把空构建参数冒称为二进制版本证明。
- CI 权限只有 `contents: read`，无 GHCR 登录、推送或部署步骤。报告 Artifact `kivao-rebaseline-ci-report` 只含源码／镜像身份与结果，不包含镜像归档、业务数据、恢复材料、截图或凭据。
- 拟使用专用版本 `kivao-rebaseline-<实际提交前12位>-r1`；应用自身 `VERSION` 仍是上游 `v1.8.5`，两者分开记录。不是复用旧定制 1.0.x，也不创建 `v*` 或 `latest`。版本和完整 SHA 须在将来发布授权中明确，本轮没有创建标签。
- 三个仓库仍是 `ghcr.io/xzaowu/kivao-app-web`、`kivao-app-backend`、`kivao-app-agent`。旧生产版本、标签、镜像及备份均不覆盖。

### 沿用所有者人工授权

`.github/workflows/kivao-rebaseline-publish.yml` 沿用旧版受审查的所有者授权方式，不新增 Environment，也不声称具备独立审核人。新变量名隔离旧版本授权，缺失即禁止发布：

- 所有者明确授权后才设置 `KIVAO_REBASELINE_PUBLISH_ENABLED=true` 及 `KIVAO_REBASELINE_PUBLISH_APPROVAL`。记录包含 `decision=IMAGE_PUBLISH_APPROVED`、`approved_by=xzaowu`、完整 `sha`、唯一 `release`、整数 `ci_run_id`、`authorization_ref`、带时区的 `approved_at`／`expires_at`；有效期最多 24 小时。
- 只接受所有者身份推送、第一次运行的专用注解标签；提交必须准确匹配。验证授权的 CI run 属于本仓库、专用分支、push 事件、同一 SHA／CI 文件并成功完成，再读取该 run 的完整报告。任何新提交都必须重新跑 CI；发布失败不通过重跑覆盖同名修订。
- 注解标签通过 GitHub Git API 核对远端 ref 的类型、标签对象 ID／名称及其直接目标提交；不能依据 checkout 后 Runner 的本地标签类型判断。接口失败、普通标签、错名、嵌套标签或目标 SHA 不符均停止；没有修改标签的操作。
- Actions 的读包权限先读取已知生产 rollback digest，证明包访问有效，再以准确 `404 MANIFEST_UNKNOWN` 判断三个版本均不存在；未授权、网络错误、包不可读或已有修订均停止。普通 GitHub CLI 的仓库权限不等于 GHCR 或 Actions 包权限。
- 获准的发布 job 才申请 `packages: write`。先构建并验证全部三镜像，再逐个重新检查授权有效期和版本不存在，推送、读取 Registry Digest、按 digest 回拉，核对架构、实际镜像 ID 和源码身份。任何失败停止剩余步骤，保留已成功部分的报告；后续需新修订，不能覆盖。
- 所有者必须在一次发布操作的 `finally`／shell `trap` 中，无论成功、失败、取消，都将开关恢复为 false、删除临时授权记录，并通过 API 复核。`GITHUB_TOKEN` 不能修改仓库变量，工作流只提示清理，不能冒称自动完成。撤销进行中授权还需取消当前 run；仅改变量不保证已启动 job 的环境立即刷新。
- 安全边界是单人所有者确认，不是双人独立审批。仓库管理员仍可改 workflow／变量或使用其他凭据直接写 Registry；当前没有新建或声称存在标签 ruleset、不可变 Registry 策略或受保护 Environment。防重复依靠本流程与固定 digest，不能防止流程外管理员覆盖。

只读确认仓库仍为 Private，本地 GitHub 身份具有仓库管理／推送权限；旧 `KIVAO_101_PUBLISH_ENABLED` 为 false，新版开关与授权记录均不存在。没有读取或输出令牌，也未改远端变量。本轮未重新验证 Actions 的包写权限或候选版本不存在；这些仍是正式发布的强制前置检查。

### 成对锁与本轮验证边界

发布三镜像全部回拉通过后，脚本才生成 `release-images.env`、`rollback-images.env`、`image-locks.json`。release 使用新 Registry Digest，rollback 固定第五节已验收的当前 KIVAO 1.0.5 三 digest。元数据明确 `agent_init_required=true`、Schema 104／79、独立 DB／data／Redis、`image_only_cutover_allowed=false`；不提供自动套用到生产的脚本。新版本不能接旧库直接启动，旧镜像也不能接新库回退。

本轮通过 7 组离线发布门禁测试（含错误身份、SHA、版本、过期／超期、缺失 CI、架构、伪缺包结果及不完整锁），两份 workflow 经 actionlint v1.7.7 检查通过，Go 新文件 gofmt 检查通过。另有上述 PG17 合成回归。完整推送前验证、远端 CI、此轮最终 SHA 三镜像构建／发布尚未执行；此前 `8eb3c995` 本地镜像证据不能冒充新提交已构建。

下一步先按 `AGENTS.md` 对待推送提交执行完整 `verify-before-push.mjs`，通过后推送专用开发分支并核对该 SHA 的 CI。镜像发布与最终生产切换分别等待对应明确授权；生产现有目录、容器和备份本轮保持原状。

### 首次候选 CI 的测试隔离修正

`b2ba5bb0` 已通过本地完整推送前检查（12 项、0 失败），并推送至专用分支。[CI 43715734994](https://github.com/xzaowu/kivao-app/actions/runs/43715734994) 的三个 AMD64 镜像、Web／Chrome E2E、PG17 迁入、Agent 静态检查、支付包与四组 app 分片通过；rest 分片的 `TestCloudAgentAdmissionAndCanvasDeletionAcrossConnections/sqlite` 失败，整体未放行。

该测试与产品代码均未在前两个准备提交中变化。本地原测试重复 100 次复现 1 次同类失败：8 轮竞争共用一个账号／数据库，前几轮获准的任务一直处于活动状态；当成功次数达到默认 5 个上限，下一轮合法返回配额拒绝，而测试只接受「准入成功／删除忙」或「删除成功／准入找不到画布」。修正只让每轮使用独立测试库和两条连接，保留 8 轮、原始并发操作与全部完整性断言，不提高限额、不吞配额错误、不加 sleep；实际准入逻辑、Agent Runtime 与数据库结构不变。发布范围只增加这一明确的 `_test.go` 文件，仍拒绝产品实现变化。修正后的提交须重新跑完整推送前检查及精确 SHA 的远端 CI，不复用首次失败 run 或旧镜像身份。

修正后本地 SQLite 专项重复 100 次通过；使用与 CI 一致的全新 PG16 临时库，将竞争测试与独立 Agent 配额限制测试一起重复 20 次（含 SQLite／PostgreSQL 分支）通过。临时容器已清理，没有触碰业务数据库或生产服务。

### 注解标签发布校验修正

`9345a1624bd3ce48e766a1b00b60ca307824b078` 的 [CI 43717266732](https://github.com/xzaowu/kivao-app/actions/runs/43717266732) 已通过全部 15 项（Web E2E 首次点击超时，失败作业重跑后 76/76 通过，未改产品代码或弱化断言）。所有者随后批准专用版本 `kivao-rebaseline-9345a1624bd3-r1`，注解标签准确指向该提交。

[发布 43720068030](https://github.com/xzaowu/kivao-app/actions/runs/43720068030) 在标签类型校验停止：checkout 首先取得远端注解标签，随后将 Runner 的本地同名引用强制指向事件提交，本地 `cat-file -t` 因而返回 commit。远端仍是原注解标签；发布 job 未执行，三个目标镜像修订均不存在。开关已恢复 false，临时授权已删除并核验，生产未改动。

本次修正仅将标签检查改为远端 ref／tag 对象验证，并补充本地引用被改写的回归与拒绝用例。保留所有者、完整 SHA、版本、CI、有效期和镜像不覆盖规则；不修改产品、Schema、构建来源或回滚锁。失败标签保留，不移动或重跑。修正提交须完成本地推送前检查及新 SHA 的完整候选 CI；后续镜像发布需绑定新 SHA、新专用版本的授权。
