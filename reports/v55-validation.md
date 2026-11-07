# v55 验收报告：测试临时目录泄漏修复 + 干净环境连跑

> **说明**：本报告的「v55」指**迭代轮次编号**，不是产品版本。产品 `BUILD` 仍为 **`v54`**、`index.html=B6CB0B0F…`，本轮只改测试基础设施，产品代码零改动。

- 验收人：验牌（测试）
- 时间：2026-11-08
- 版本：`BUILD='v54'`、`sw.js CACHE='zmj-v54'`（产品未升版；本轮只改测试基础设施）

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| 测试临时目录泄漏 | **已修复**（两处脚本，见 §2） |
| `run-checks.js` 环境前置检查 | **已落地并双向实测**（`0FC90B20…`，见 §2.2） |
| 干净环境连跑 `table-3d-ui` 10 次 | **10/10 通过**，33～35s/次，产物已落盘 11 个文件 |
| **完整全量 `--browser` 连续 3 轮** | **三轮全干净**（31/31、`ok:false` 0、收尾句在、五指纹未变），见 §3.2 |
| Node 断言总数 | **101 → 109**（新增 8 条**按差额推断**，用例名由单独运行该文件佐证） |
| 产品代码改动 | **零**（见 §5） |
| 磁盘满是否为红率主因 | **高度可能，未证实**（见 §4） |
| 今晚更早的所有对照数据 | **全部作废**（见 §4） |
| 真机（手机 GPU/触屏）验收 | **未取得** |
| `syncTable3D` p95 性能 | **未取得**（缺 `?perf=1` 探针） |

## 2. 临时目录泄漏修复

根因：`tests/pages-compat.js` 与 `tests/browser-online.js` 每次运行用 `mkdtempSync` 建 Edge 用户配置目录，进程退出时不删除。实测累计 **915 个 `zmj-pages-test-*` 目录、约 39.2 GB**，把 C 盘写满至 0 GB（出现 `ENOSPC: no space left on device`）。

修复（两处同构）：
- 启动时扫描 `os.tmpdir()`，删除超过 1 天（24h）的同前缀旧目录；
- `PROFILE` 本身在 `process.on('exit')` 与 `SIGINT/SIGTERM/SIGBREAK` 时删除；
- 删除带重试：Edge 子进程被 kill 后句柄不会立即释放，单次 `rmSync` 会静默失败，改为最多 20 次 × 100ms 的同步重试。

**最终哈希**（以实测为准）：
```
tests\pages-compat.js   CEC41AE65AF5925E → E372C4F1C392A8AD
tests\browser-online.js                → 16EA343F8B5F2325
```

验证：跑前 `%TEMP%\zmj-*` = 0，跑一次门禁后仍 = 0（此前每次跑都会残留一个约 15MB 目录）。

残留清理：`zmj-*` 共 65 个（1.86 GB）全部删除，0 失败；C 盘剩余由 0 GB 恢复到 **47.65 GB**。

### 2.2 `run-checks.js` 环境前置检查（防止同类事故复发）

新增在任何测试启动之前：C 盘剩余 **<20 GB** 或 `%TEMP%\zmj-*` 数量 **>0** 时，打印原因并 `exit 1` 拒跑（拒跑≠通过）。残留目录会标注**创建时间**，并探测是否有 `pages-compat/browser-online/run-checks` 进程在跑：有则提示「正在使用中，不是泄漏，请等其结束，不要删别人的配置目录」，没有才提示可安全删除。

```
tests\run-checks.js  955CECBE433E26B8 → BD2FCEA9043FA3F2 → 0FC90B20DEAACF33（最终）
```
（中间版本 `BD2FCEA9` 增补了「创建时间 + 运行中判定」，`0FC90B20` 再把 `tests\wall-slot-map.test.js` 加入 Node 清单。）

双向实测：干净环境首行打印「环境检查通过」，随后整套 Node 组全过、退出码 0；人为造残留目录后打印原因并 `exit 1`。

## 3. 干净环境连跑：单组 10 次 + 全量 3 轮

命令：
```powershell
cd D:\mahjong\repo
node tests/pages-compat.js table-3d-ui   # 连跑 10 次，逐次落盘
```

产物目录：**`out\v55-occ\clean-20261108-023140\`**，共 **11 个文件**：`run01.json` … `run10.json`（各约 4524B）+ `summary.json`（665B）。

逐次结果：
```
run 1 pass  33s 盘余=47.64GB zmj=0
run 2 pass  34s 盘余=47.63GB zmj=0
run 3 pass  35s 盘余=47.67GB zmj=0
run 4 pass  35s 盘余=47.67GB zmj=0
run 5 pass  34s 盘余=47.66GB zmj=0
run 6 pass  34s 盘余=47.66GB zmj=0
run 7 pass  34s 盘余=47.66GB zmj=0
run 8 pass  34s 盘余=47.66GB zmj=0
run 9 pass  34s 盘余=47.66GB zmj=0
run10 pass  35s 盘余=47.66GB zmj=0
PASS=10  FAIL=0
```

`summary.json` 跑前 / 跑后哈希对照（完全一致）：
```
index.html            B6CB0B0F4D6DE367  /  B6CB0B0F4D6DE367
assets\table3d\table3d.js AA4636791C15CBFC  /  AA4636791C15CBFC
tests\table-3d-ui.html    1DDD1439743EB6F0  /  1DDD1439743EB6F0
tests\pages-compat.js     E372C4F1C392A8AD  /  E372C4F1C392A8AD
终态：freeGBAtEnd=47.66，zmjDirsAtEnd=0
```

**口径说明**：这是「测试基础设施修好之后的单轮连跑 10 次」，证明的是**在磁盘充裕、泄漏已修的条件下该组稳定通过**，不等于历史所有门禁数据都可信（见 §4）。

### 3.2 完整全量 `--browser` 连续 3 轮（同一套文件、同一环境）

命令：`node tests/run-checks.js --browser`，连跑三轮，每轮跑前跑后各核对一次五个指纹。

| 轮 | 日志 | 运行/完成/`ok:false`/收尾句 | Node | 退出码 | 耗时 | 五指纹 |
|---|---|---|---|---|---|---|
| r1 | `out\v56-full-browser-baseline2.log` | 31/31/0/1 | 109·109·0 | 0 | 187.7s | 5/5 未变 |
| r2 | `out\v54-baseline-r2.log` | 31/31/0/1 | 109·109·0 | 0 | 181.2s | 5/5 未变 |
| r3 | `out\v54-baseline-r3.log` | 31/31/0/1 | 109·109·0 | 0 | 179.3s | 5/5 未变 |

每轮首行为「环境检查通过（C 盘可用、%TEMP%\zmj-* 无残留）」，尾行为「全部检查通过。」。

五个指纹（三轮全程 UNCHANGED）：
```
tests\run-checks.js          0FC90B20DEAACF33
tests\wall-slot-map.test.js  660CAF915252534C
index.html                   B6CB0B0F4D6DE367
assets\table3d\table3d.js    AA4636791C15CBFC
tests\pages-compat.js        E372C4F1C392A8AD
```

**Node 断言条数的口径（重要）**：总数 **101 → 109**，含 `# pass 109 / # fail 0`。**新增 8 条为「按差额推断」**——`run-checks.js` 跑 Node 组时是聚合输出，全量日志中 `wall-slot-map` 仅出现 1 次（清单命令行），**8 个用例名并不出现在全量日志里**；用例名由单独运行 `node --test tests\wall-slot-map.test.js`（`# tests 8 / # pass 8 / # fail 0`）佐证。**不得写成「全量日志里单列」。**

**可以说**：v54 基线在本机 headless + swiftshader 环境、同一份文件下**连续 3 轮全量干净**。

**不可以说**：这不等于门禁在任何环境下稳定；**真机（手机 GPU/触屏）未验**；`syncTable3D` p95 因缺 `?perf=1` 探针**未取得**；`drawCalls` 门槛保留且本轮未涨，但没有单独的 p95 体检。

## 4. 今晚更早的数据：全部作废

以下数据**时间上均落在磁盘被写满的区间**，无法排除假象，**一律不得当结论**：
- 基线组 10 次：1 过 9 红（分布 A/B/C 三种形态）
- flag 组（四条防节流 flag）：第 1 条仍出现 `document.hidden` 168/190，另见 `bodyCls` 变空
- 压制组（`Emulation.setFocusEmulationEnabled`）：8 过 2 红
- 更早的「干净 8/8 全过」：当时只有终端输出、**盘上无任何产物**，按「未取得证据」处理

**关于「磁盘满是否为红率主因」**：本报告只能给出**高度可能、未证实**。理由：修好泄漏后同一套文件从「红率显著」变为 10/10 全过；但此前的对照组全部跑在磁盘吃紧区间，缺少干净对照组，故不能把 `document.hidden`、WebGL 上下文丢失等现象反过来判为「磁盘满的派生症状」并下定论。

## 5. 产品零改动

```
index.html              B6CB0B0F4D6DE367   （未动）
assets\table3d\table3d.js AA4636791C15CBFC   （未动）
tests\table-3d-ui.html    1DDD1439743EB6F0   （未动）
```
本轮仅修改测试基础设施两个文件（§2），未触碰 `index.html`、`table3d.js`、任何测试页断言。

## 6. 未验范围与后续

- **真机（真实手机 GPU / 触屏）验收仍未做**——本报告所有数据均来自本机 headless + swiftshader 环境。
- **`syncTable3D` p95 未取得**：需要 `?perf=1` 探针（该探针要改 `index.html`），本轮未做，**不写成通过**。
- `drawCalls` 门槛保留（防回归用途），本轮未出现上涨，但未做独立性能体检。
- 已完成项：`tests/run-checks.js` 环境前置检查（§2.2）；完整全量连续 3 轮（§3.2）。
- 后续（Chief 已定顺序）：三维做 v55 阶段一 1b（`wallSlotAt()`/`wallSlotCount()` 纯查询、O(1)、不含 `kind`），码仔在其落地后接 `update()` 与缓存键 `round+handNo+head+tail+wallCount`；1b 改完必须重跑全量对照。
