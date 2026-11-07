# v54 验收报告：三维「跳过演出」强制收尾修复 + 干净环境完整全量

- 验收人：验牌（测试）
- 时间：2026-11-07
- 版本：`index.html:7517 BUILD='v54'`、`sw.js:3 CACHE='zmj-v54'`、`server.js:59 build:'v54'`、`index.html:3213 ?build=v54` —— 四处一致
- 被测改动：`index.html:3360-3362`，`threeSkip` 从 `skipOpening()` 改为 `skipOpening(true)`（强制跳过，未掷骰时也收尾）
- 前序：该修复的起因见 `reports\v53-validation.md` §4（`table-3d-ui` 第 7 组熔断）

## 1. 结论

| 项 | 结果 |
|---|---|
| 完整全量 `node tests/run-checks.js --browser` | **31 组运行 / 31 组完成 / `ok:false` 0 次 / 收尾句「全部检查通过。」1 次 / `FULL_EXIT=0`，总耗时 164.3s** |
| `table-3d-ui`（原失败组，在满载全量中） | **通过**，`"ok":true`，44 条断言全过，耗时 32s |
| `tile-legibility-ui`（v53 修复） | **通过**，耗时 1s |
| `table-3d-drag`（v52 真实牌模） | **通过**，耗时 14s |
| 测试文件全程未被改动 | **是**（跑前跑后哈希一致） |
| 是否可交付 | **本环境全量通过**；真机验收仍未做（见 §6） |

## 2. 跑的命令

```powershell
cd D:\mahjong\repo
node tests/run-checks.js --browser
# 日志：out\v54-full-browser-recheck.log
```

## 3. 哈希绑定（跑前 = 跑后，全程未变）

| 文件 | SHA256 前 16 位 | 跑前 | 跑后 |
|---|---|---|---|
| `index.html` | `B6CB0B0F4D6DE367` | ✓ | ✓ |
| `tests\table-3d-ui.html` | `1DDD1439743EB6F0` | ✓ | ✓ |
| `tests\tile-legibility-ui.html` | `4489FBD6DADDEC5E` | ✓ | ✓ |
| `assets\table3d\table3d.js` | `AA4636791C15CBFC` | ✓ | ✓ |
| `tests\run-checks.js` | `955CECBE433E26B8` | ✓ | ✓ |

**本次全量结果绑定上述确切文件版本，期间无人改动测试页或产品文件。**

## 4. 逐组耗时（31 组）

| 组 | 耗时 |
|---|---|
| `node --test`（101 条 Node 测试） | 28s |
| `server/test-ws.js` | 1s |
| `server/test-rooms.js` | 2s |
| `server/test-online.js` | 5s |
| `tests/no-build-check.js` | 0s（sw 缓存 `zmj-v54`） |
| `tests/smoke-server.js` | 3s |
| `pages-compat table-3d-ui` | **32s** |
| `pages-compat table-3d-drag` | 14s |
| `pages-compat persona-ui` | 3s |
| `pages-compat audio-ui` | 15s |
| `pages-compat account-ui --accounts` | 4s |
| `pages-compat connection-ui --accounts` | 2s |
| `pages-compat table-layout` | 1s |
| `pages-compat river-hover-ui` | 3s |
| `pages-compat hand-sort-ui` | 2s |
| `pages-compat mobile-ui` | 2s |
| `pages-compat tile-legibility-ui` | 1s |
| `pages-compat visual-ui` | 2s |
| `pages-compat training-ui` | 1s |
| `pages-compat training-release` | 3s |
| `pages-compat lesson-ui` | 1s |
| `pages-compat settlement-ui` | 1s |
| `pages-compat selection-ui` | 1s |
| `pages-compat online-response --hub` | 2s |
| `pages-compat worker-ui --hub` | 2s |
| `pages-compat coach-advice` | 2s |
| `pages-compat reconnect --hub` | 3s |
| `pages-compat atmosphere-ui` | 4s |
| `pages-compat music-ui` | 8s |
| `pages-compat`（默认页） | 7s |
| `tests/browser-online.js` | 10s |

## 5. 关于此前相互矛盾的数据——已查清

| 批次 | 跑的文件版本 | 时刻 | 结论 |
|---|---|---|---|
| 三维 14 次单跑（PASS 9 / FAIL 5，约 36%） | 原版 `1DDD1439…` | **21:53:15 之前** | 数据真实，但为小样本单跑环境 |
| 三维全量熔断（卡 dice） | 原版 `1DDD1439…` | 21:01–21:34 | 数据真实 |
| 验牌「1 过 6 红」 | 探针版 `FE2A31A7…` | 21:53:26 起 | **作废**（测试页已被插探针） |
| 验牌干净 8 连跑 | 原版 `1DDD1439…` | 22:55 后 | **8/8 全过**，有效 |
| **本次完整全量** | 原版 `1DDD1439…` | 23:14 后 | **31/31 全过**，有效 |

解释：三维那批 36% 的失败与其全量熔断，均发生在**单跑/并行的非满载条件**；本次在**完整满载全量**中 `table-3d-ui` 通过。因此「v54 引入稳定缺陷」**不成立**；但「非满载下偶发」这一点**仍未被解释**，属遗留风险，不代表已修复（见 §6）。

## 6. 未验范围与遗留

- **真机（真实手机 GPU、触屏）未验**，尤其三维动效与投屏。
- **非满载偶发未解释**：三维原版 14 次中 5 次失败（约 36%）与验牌 8 次全过，两者差异原因未查明（可能为并行负载、运行顺序或机器状态）。本次全量通过不构成「该偶发不存在」的证明。
- 探针取证方案已判失败（探针版单次拖到 200 秒以上并超时），`machinePhase=ready` 与 `machineBusy=1` 并存、「演出被起两次」等**仍为代码推理，无实测支撑**。
- 三维遗留待办（真机验收、长牌河/多副露帧率）仍在。

## 7. 证据清单

- 全量日志：`out\v54-full-browser-recheck.log`（31 运行 / 31 完成 / `ok:false` 0 / 收尾句 1 / 164.3s）
- 干净的 8 连跑：本轮实测 8/8 通过，每次 44 条断言全过、32～34s
- v53 修复证据：`reports\v53-validation.md`；截图 `out\v53-360-chosen.png`
- v52 三维拖牌证据：`reports\v52-validation.md`；截图 `out\v52-3d-drag-mid.png`
