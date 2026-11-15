# KIVAO GitHub 仓库整理准备

本轮只做本地修复和远端只读核对。未推送、合并、删除分支或标签，未发布镜像，也未连接生产环境。以下是 2026-11-15 的核对快照，实际执行整理前需重新确认远端没有变化。

## 当前关系

| 对象         | 核对结果                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| GitHub 仓库  | `xzaowu/kivao-app`，Private，默认分支 `main`                                                             |
| 远端 main    | `82fc5c03233c33380a5335146c50bb507deb5692`                                                               |
| 本地开发分支 | `dev/kivao-upstream-baseline-3979305c`，尚未推送                                                         |
| 新上游基线   | `3979305c1413be231cbaef242e50afc67f553c5e`；其后已单独接入三项 Turnstile 上游提交，再保留必要 KIVAO 修复 |
| 旧定制参考   | `dev/kivao-ecommerce-agent@a17dc6a08a2ad26f7b10545b45dd81d7ff2d9a62`                                     |
| 远端引用     | 16 个分支、6 个 KIVAO 发布标签；GitHub Releases 列表为空                                                 |
| 生产历史记录 | `kivao-1.0.5-21fc78c84404-r1`，源码 `21fc78c844040e34977eeec77d028422da2e02b5`，Schema 79                |
| 回滚历史记录 | `kivao-1.0.4-aae0d4aa4590-r1`                                                                            |

GitHub compare 确认：`main@82fc5c03` 是新上游基线的祖先，`3979305c` 比它多 282 个提交，没有反向独有提交。因此新开发分支可以经过正常 PR 合入，不需要清空仓库、替换 Git 历史或强推 main。旧生产分支与 main 则已分叉（27 / 14 个独有提交），不能直接拿旧生产分支覆盖 main。

本地仓库仍有 shallow 边界；不能把本地 `merge-base` 查询失败理解为没有共同祖先。未来推送前补齐所需祖先链，再本地复核血统。本次远端判断依据 [上游 compare](https://github.com/ddcat-ai/open-ai-canvas/compare/82fc5c03233c33380a5335146c50bb507deb5692...3979305c1413be231cbaef242e50afc67f553c5e)。

## 先保留什么

- `main`、新开发分支，以及旧定制参考 `dev/kivao-ecommerce-agent`。旧定制参考尚未另行归档，不能只凭“新版已替代”删除。
- 全部六个 `kivao-*` 发布标签。标签只是很小的引用，删除它们不能有效节省镜像或备份空间。
- 暂时保留 `release/kivao-1.0.5` 与 `release/kivao-1.0.4`，分别用于当前生产历史及回滚定位。
- 当前生产和回滚镜像的固定 digest、成对镜像锁、生产备份及恢复私钥。Git 分支删除与 GHCR 镜像清理是两个操作；本次不清理 GHCR、Actions Artifact 或恢复资料。
- 其他工作区使用的分支不随本仓库远端整理删除，尤其仍被其他工作区占用的 `feat/kunrou-video-protocol`。

以下镜像身份来自既有本地验收记录，本轮没有重新连接生产或回拉 Registry，不能当作新的生产在线验收：

| 镜像仓库（前缀 `ghcr.io/xzaowu/`） | 1.0.5 生产记录                                                            | 1.0.4 回滚记录                                                            |
| ---------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `kivao-app-web`                    | `sha256:b2aaa111c18868888245cd250907f3469af600a7fabcf4fec83592bb93c220f2` | `sha256:daa8763de0b8d48a1a3f507f37b353442f08c442142b7bcf8edb9714e2a47c1d` |
| `kivao-app-backend`                | `sha256:98b75357f7e8d7a855df42a0d5112ccb994316a4512fbc2976f0666897c34842` | `sha256:7edf2c6871852896ebb7f8377ff663ac7f91925bd0469cad9ccd9908adae23e1` |
| `kivao-app-agent`                  | `sha256:86619d93d08090218c919e98146129b37cfc6a5b51e7b38c6cf8ddde6a6ddc8b` | `sha256:833cf05370c098030a562942b9b3a10b26f0e188e89cb399f63c9b2729be0727` |

私有恢复材料继续保留在 Git 忽略的 `.local/operations`，不加入提交。身份依据为既有 `releases/kivao-1.0.5/FINAL-STATE.json` 与 `published-locks/image-locks.json`；对应 [质量 CI](https://github.com/xzaowu/kivao-app/actions/runs/42386290165) 和 [发布 CI](https://github.com/xzaowu/kivao-app/actions/runs/42402114030) 均成功。

## 新基线合入后可整理的旧分支

以下只列候选，尚未删除。执行时比较最新远端 SHA 与本次记录；如果分支有新提交，重新检查其保留位置。

| 候选分支                            | 当前 SHA   | 保留依据                                                                                           |
| ----------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| `dev/kivao-next`                    | `befeefa4` | 已完整包含于保留的 `a17dc6a0`，远端 compare 已确认                                                 |
| `dev/kivao-ecommerce-minimal`       | `4af94fb5` | 已完整包含于保留的 `a17dc6a0`，远端 compare 已确认；本地同名分支与远端位置不同，不自动删除本地分支 |
| `docs/kivao-first-cutover-closeout` | `7593b6a2` | 已完整包含于 1.0.5 发布历史                                                                        |
| `dev/kivao-1.0.1-baseline`          | `6000d606` | 1.0.1 固定发布标签指向同一提交                                                                     |
| `release/kivao-baseline-eeccf718`   | `e19976f6` | 1.0.0 固定发布标签指向同一提交                                                                     |
| `release/kivao-1.0.2`               | `5cea268f` | 1.0.2 固定发布标签指向同一提交                                                                     |
| `release/kivao-1.0.3`               | `31ef5e69` | 1.0.3 固定发布标签指向同一提交                                                                     |

另有 5 个基于旧 main 的 Dependabot PR／分支。新基线合入后对照实际依赖版本再决定关闭或重新生成，不把旧补丁直接合入，也不把它们混进这次产品修复。

## 发布误触发保护

新基线原带上游 `.github/workflows/publish-images.yml`：推送 main、`v*` 标签或手动执行均可能发布 `open-ai-canvas-*` 镜像和 `latest`。本地已给全部六个 job 加入精确仓库条件，仅 `ddcat-ai/open-ai-canvas` 可执行，包含原本使用特殊状态条件的 publish / release job。

- KIVAO 仓库即使触发该 workflow，也不能运行其中的构建、推送或 Release 写入 job。
- 独立 `quality.yml` 的 PR 检查仍保留；普通开发分支 push 本身不等于已有 CI 通过，后续按正常 PR 运行质量检查。
- 该保护当前仅在本地，尚未应用到远端。旧分支仍携带各自版本的 workflow，不能据此认为所有旧标签都安全可推送。
- 远端现有 `KIVAO_101_PUBLISH_ENABLED=false`，没有临时授权变量，也没有排队、运行或等待中的 workflow。当前分支列表未显示分支保护；这是现状记录，不等于已具备独立审批保护。
- 不重用旧 1.0.1 授权记录或旧源码构建脚本。新的自有镜像发布适配留到获准发布时处理；继续禁止官方 latest／Host Updater 覆盖生产，并保留 Agent `init: true` overlay。

新增 `web/test/ci-repository-boundary.test.mjs` 直接读取真实 YAML，验证 fork 下所有发布 job 均拒绝、上游原路径保留及 PR 检查权限。此为本地门禁回归，不是 GitHub Actions 已运行的证明。

## 后续执行顺序

1. 保存本地修复；获准推送后刷新远端、补齐祖先，确认待推分支及 workflow 触发范围。若远端出现同名分支，按 `AGENTS.md` 同步其最新提交，不能 rebase 到旧生产定制分支。
2. 在干净工作区对最终提交运行 `bun scripts/verify-before-push.mjs` 默认范围。专项检查不是该推送前验证的替代。
3. 获准后仅推新开发分支，创建普通 PR；核对最终 SHA 的 CI 后，再按合并授权更新 main。不开发布标签，不因合并顺便部署。
4. 新主线和保留引用核实无误后，另按清理授权删除上述已确认候选引用，处理旧 Dependabot PR。保留发布标签、生产／回滚镜像和恢复资料。
5. 生产升级另行准备。新本地 Schema 104 与生产历史 Schema 79 不同，不能只换镜像后宣称可回滚；迁移、备份恢复与真实服务验收不属于仓库清理。

只读盘点快照保存在 Git 忽略的 `.local/cache/github-cleanup/inventory-20261115.json`。本计划不含账号、密钥、Token 或业务数据。
