# KIVAO 首次生产接管结项

**PRODUCTION CUTOVER GO。** 本文件是私有运维记录，不纳入公开文档站。
它记录 r1 的冻结状态和本次只读复核，不是新的部署授权；每次维护前必须核实实际状态。
本次复核日期：2026-11-03。
完整机器清单见 [kivao-production-r1.json](kivao-production-r1.json)，未来发布规则见 [发布与上游整合原则](kivao-release-policy.md)。

## 发布身份及生产复核

| 对象 | 固定身份 |
| --- | --- |
| 生产发布 | kivao-1.0.0-eeccf718-r1 |
| 发布提交 | e19976f61bd08c271ae88d9921a20f8304d729f4 |
| 应用源码 / OCI revision | eeccf718e8ad78aee98ca49d142d0594ea7000b2 |
| 内部应用版本 | v1.7.3.3，首发未改产品功能 |
| Schema / 迁移账本 | 77 / 76 条；未执行 migrate-schema up |
| 架构 | linux/amd64 |
| 结项复核 | 生产成功记录与运行 image ID 一致，3 应用 healthy，Agent init=true，HTTPS ready 200/code 0/Schema 77 |
| 仓库可见性 | GitHub 当前为 Private；本次未改变 |

首次维护开始于 2026-11-03 12:18:27，北京时间 12:31:50 确认恢复 HTTPS，12:37 完成验收；维护约 13 分 22 秒。
发布提交含准备文件，应用构建源码锁定 eeccf718，因此两者 SHA 不同是预期行为。

| 镜像 | 固定 registry 引用 |
| --- | --- |
| Web | ghcr.io/xzaowu/kivao-app-web@sha256:e72091fcf0ea4388dd1c089ba0ea3445a9bfa0baf44b2949c01a916db5adcbba |
| Backend | ghcr.io/xzaowu/kivao-app-backend@sha256:5a2d8b4ecf3153700d523b21547ae7049c45e898acaef18cda0bb2f66a02a21b |
| Agent | ghcr.io/xzaowu/kivao-app-agent@sha256:c4c1f5db0e5534340494533d1adc7edfdb136b5cac47aac0aef194a67470a70c |

禁止使用 latest、官方安装脚本、影策官方浮动镜像或官方自动更新器覆盖这套自有镜像。
后续批准的发布必须仍记录不可变 registry digest，不能把 image ID 当 registry digest。
本次未安装或启用 Host Updater。

## GitHub 与生产的关系

本次同时通过 GitHub API 和远端 refs 核实：

- main：82fc5c03233c33380a5335146c50bb507deb5692。
- release/kivao-baseline-eeccf718：e19976f61bd08c271ae88d9921a20f8304d729f4。
- 注解标签 kivao-1.0.0-eeccf718-r1：标签对象 e9b232bffc3a788d2f09dbf74663fea7e00ffc44，解引用到 e19976f6。
- merge-base 为 eeccf718；main 独有 14 个提交，发布分支独有 1 个准备提交。不是 main 等于线上。
- [分支检查](https://github.com/xzaowu/kivao-app/actions/runs/41420310966)和[标签发布](https://github.com/xzaowu/kivao-app/actions/runs/41422427278)均在 e19976f6 上 completed/success。

不得直接合并首发分支覆盖 main，不得回退 main，也不得未经独立兼容评估直接从 main 发布生产。
首发分支和注解标签保持冻结。本结项在独立 docs/kivao-first-cutover-closeout 本地分支记录；
下一轮 dev/kivao-1.0.1-baseline 从该文档提交起步，应用代码仍等于生产基线。
本轮没有推送新分支或创建新标签。

## 部署目录与唯一编排方式

部署目录 /opt/yingce，Compose 项目名 yingce，入口仅 127.0.0.1:13100。
原 PostgreSQL 17、Redis、持久化路径和宝塔 Nginx/HTTPS 保持原样。

~~~bash
dc() {
  /usr/local/bin/docker-compose -p yingce --env-file /opt/yingce/.env \
    -f /opt/yingce/docker-compose.yml \
    -f /opt/yingce/docker-compose.override.yml \
    -f /opt/yingce/operations/agent-stop-repair-r1/agent-init.override.yml "$@"
}
~~~

第三份 overlay 必须持续携带；文件内容为：

~~~yaml
services:
  yingce-agent:
    init: true
~~~

省略它后重建 Agent 会重新出现 Node PID 1 不响应 TERM 的问题。当前正常停止不需要 SIGKILL。
首发仅对已核实空闲的旧 Agent 使用过一次人工批准的 SIGKILL；该一次性例外已经使用，不能照抄重试。
备份门禁仍拒绝非正常 137/OOM，不把强制结束伪装成干净备份。
Compose 的 migrate 服务配置随 Backend 使用同一 digest；历史退出的迁移容器保持旧 ID/镜像、exit 0，未重建或执行。

后续仅在获准窗口对 Agent、Backend、Web 使用 --no-deps、--pull never、--no-build。
不要全项目 up、down、删卷、清理旧镜像、重装数据库或重新生成 .settings-key。
.env 为 root:root 0600；不得把文件内容、连接串或恢复私钥写入仓库或 CI。

## 备份与数据保留

最终备份：/opt/yingce/backups/final-kivao-r1-20261103T042004Z-8af57a52。
此前副本：/opt/yingce/backups/phase2-20261102T101603Z，保持保留。
旧 Agent 元信息密文位于 /opt/yingce/operations/agent-stop-repair-r1/LEGACY-INSPECT-20261103T041827Z-393dd94e.cms。
生产成功记录：/opt/yingce/operations/agent-stop-repair-r1/KIVAO-CUTOVER-SUCCESS.json。

最终 8 份加密归档覆盖 PG 逻辑快照、data/隐藏 key/插件/媒体、完整 Web、部署/Nginx/证书、
原生 Redis RDB、验证元信息和原官方镜像。备份目录 0700、密文 0600，受控 SSH/SFTP 离机传输。
控制端保存可恢复密文与私钥；私钥未上传生产，备份、凭据及原始敏感报告不进入 Git。
这里只记录位置、发布身份及验证摘要，不收录业务数据。

跨存储一致性来自应用停写共同静默区间、同一 PG MVCC 快照以及文件/表前后指纹检查。
没有复制活动 PGDATA 或 AOF，没有暂停/重启 Redis；使用一次原生 RDB 流直接加密。
后续新版本仍须制作新最终备份，不能拿首发快照覆盖之后的写入。
在新的可恢复副本、回滚资源和离机副本获核实且人工明确批准清理前，不删除上述备份或旧镜像。
业务 PG/data/Redis/Web、原 key、插件与媒体持续保留；key 的受控恢复副本不能跟随镜像淘汰，
也不能只保留同一生产主机上的唯一副本。具体保留期限另由所有者决定，本轮未执行任何清理。

## 已通过与未覆盖

| 项目 | 实际证据边界 |
| --- | --- |
| 最终 PG17 恢复 | 独立新数据库恢复，130 表计数/指纹全部匹配，无生产连接或应用 Worker |
| 原 key / 加密配置 | 32 字节 key 精确保留；副本原生解密 11 个真实加密值，生产 key 再做精确比对 |
| 文件归档 | 4,403 个普通文件的冻结期清单一致，密文认证/结构/权限验证通过 |
| 渠道/模型/定价 | 5 渠道、44 模型行（40 未删除）、31 价格档 |
| 积分/账单/配置 | 3 账户、22 总账行、8 账单、7 系统设置、5 历史支付配置版本；12 张保护表指纹保持 |
| 真实浏览器 | 管理员原密码登录、12 条真实路由渲染，包含图片/视频/画布、配置后台和设置入口 |
| 媒体 | 原 9 条媒体物理文件及管理员文件 API 的字节 SHA-256 匹配 |
| SSE | 既有终态文本任务连接及 Last-Event-ID/after 重连；没有生产正增量样本 |
| Agent | 实际 Pi Runtime 回环 Stub：1 模型响应、3 事件、1 session snapshot、settled，结束 active=0 |
| Schema / 其他项目 | Schema 77、账本及完整 DDL 不变；PG/Redis/migrate 与其他 15 容器保持原状态 |

未做真实付费模型生成、真实支付/充值、通知发送、活跃生成中的 SSE 正增量测试。
浏览器拦截了非认证写请求；页面渲染通过不等于编辑、保存、生成写流程通过。
普通用户角色的插件可见性也尚未在生产验收，应在下一轮独立夹具中复现。
3 笔历史 pending 为所有者确认未付款的测试订单，保留状态；已有 epay HTTP 查询错误未在本次修复。
这些边界不应在后续报告中被扩大为真实模型或支付已验收。

## 回滚路径

所有操作仍需对应窗口授权，正常应用回滚优先保留当前 PG/data/key/Redis，不覆盖公网重开后新增写入。
保留全量原 Web 密文与失败现场；认证解密后完整恢复 Web 目录，再重建 bind mount，不能只换 index.html。

- 当前 r1 的历史回滚锁：/opt/yingce/operations/agent-stop-repair-r1/rollback-images.env，指向原官方固定 digest。
- 回滚 Web 额外叠加 /opt/yingce/operations/agent-stop-repair-r1/rollback-web.override.yml，直接 nginx，绕过资源发布入口。
- Agent init overlay 在正常切换和回滚中都保留；原两个 Compose 不改。
- 原官方镜像分别以 bc144b58（Backend）、75e55e92（Web）、c2dc0101（Agent）开头的完整 digest 留存于回滚锁和加密镜像归档；执行时必须使用锁内完整引用。
- 回滚前后核实实际 digest、Schema、配置/积分/媒体；不启动 migrate，不恢复旧 .env 后解析浮动 tag。
- 覆盖数据库、替换 data/key、停止重建 Redis 或丢弃/合并新增写入，需要额外明确批准并先核清资金。
- 下一版 1.0.1 的默认回滚应回到本文件记录的 KIVAO r1 三镜像；原官方版本只作历史应急材料，不沿用为新版本默认回滚。

原始 FINAL-REPORT.md、FINAL-RESULT.json、PRODUCTION-OPERATIONS.md 位于控制端受限
.local/phase3b/retry-init-r1，摘要 SHA-256 已记录在机器清单。
完整副本包含受限路径和可能敏感的验证材料，不直接复制进仓库；新克隆仓库以本结项及生产受限记录为入口。

## 本次结项整理的验证

生产复核只读；GitHub refs/对应 SHA 的 CI 结果与上述快照一致。
清单已逐字段核对最终成功记录，并复算三个受限证据文件的 SHA-256；
新增文档链接、JSON 结构、敏感凭据标记检查和 git diff --check 通过。
产品源码、工作流、部署文件和发布工具相对 e19976f6 没有改动；其他待测专题保持原文。
本轮不运行产品测试或重新验收浏览器，不将已有 CI 成功表述为结项提交的新 CI。
该冻结分支没有纳入 docs/package.json，未运行文档站构建；链接检查不是文档站构建通过。
