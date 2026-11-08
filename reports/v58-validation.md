# v58 验收报告（阶段二 2b 真抽：亲手从牌墙抓牌）

- 验收人：验牌（门禁判读与报告；不改产品代码）
- 时间：2026-11-08 04:19 前后（本机 Asia/Hong_Kong）
- 范围：v58 = v57 + **A 方案真抽**（`manualDrawNow` 接线、`renderActions` 新增 `draw` 分支、二维牌墙六处换新谓词、`aiStep`/`autoPlaySeat` 补 `draw` 推进）

---

## 1. 结论（可说的）

> 在 `index.html=4353CAAFA488F935`（605309B，BOM=True）、`assets\table3d\table3d.js=DE04C30DB5FA8AFE`（51760B）、`sw.js=zmj-v58`、`server.js=build:'v58'`、`tests\run-checks.js=485194EC2B7D0E1C`（7849B）这套文件上，全量 `--browser` **单轮 31/31 全绿、`ok:false` 0、收尾句「全部检查通过。」、`FULL_EXIT=0`**，同版本 Node `pass 118 / fail 0`，**v58 全量通过成立**。

**关键前提：同一版本。** Node r5、两组单跑、这轮全量，三者测的都是 `4353CAAF`，中途无人改盘。今晚此前 r1/r2 作废的根因正是"跨版本"。

---

## 2. 命令与日志（本机 `out\`，不入库）

```
node tests/run-checks.js                       → out\v58-node-r5.log
node tests/pages-compat.js training-release    → out\v58-single-training-release-2.log
node tests/pages-compat.js table-3d-ui         → out\v58-single-table-3d-ui-2.log
node tests/run-checks.js --browser             → out\v58-full-r3.log
```

| 证据 | 大小 | 改时 | 结果 |
|---|---|---|---|
| `v58-node-r5.log` | 50444B | 04:14:49 | `# tests 118 / # pass 118 / # fail 0`，首页体积 `605309 → 236586`（自证测的是 4353CAAF） |
| `v58-single-training-release-2.log` | 899B | 04:15:33 | `{"ok":true,"errors":[]}`，16 步（含「整局测验通过真实点击弃牌完成一局」） |
| `v58-single-table-3d-ui-2.log` | 2799B | 04:16:05 | `{"ok":true,"errors":[]}` |
| `v58-full-r3.log` | **68403B** | **04:19:08** | 运行 31 / 完成 31 / `ok:false` 0 / 收尾句 1、`ok:true` 25、`FULL_EXIT=0` |

**判据的硬证据：日志自证测的是哪份文件。** 每份门禁日志里都有一行「首页压缩体积：<源字节> → <压缩后>」，起点字节数就是被测 `index.html` 的实际大小：

```
v58-node-r5.log    首页压缩体积：605309 → 236586   ← index.html 4353CAAF 正是 605309B
v58-full-r3.log    首页压缩体积：605309 → 236586   ← 同一份
（反例：v58-node-r4.log 是 605286、node-r3 是 603726、node-r2 是 603156，分别对应已作废的 5665DFDC / 01E4E389 / CB40426E）
```

**这比"大小 + 改时"更硬**：改时只能说明文件什么时候被写，字节数能证明这一轮**真的读到并压了那一份**。

---

## 3. 八文件指纹（跑前 vs 跑后，零漂移）

```
index.html                 4353CAAF  605309B  BOM=True   04:14:08
sw.js                      43C4D09B   2453B  BOM=True   04:02:01
server.js                  648C8614   6574B  BOM=True   04:02:01
tests\run-checks.js        485194EC   7849B  BOM=False  03:26:35
assets\table3d\table3d.js  DE04C30D  51760B  BOM=False  03:57:16
tests\table-3d-ui.html     1DDD1439  12846B  BOM=False  11-07
tests\pages-compat.js      E372C4F1   5465B  BOM=False  01:45:05
tests\training-release.html 0A303377   5432B  BOM=False  10:19:15   ← 测试文件一字未改
```
版本链四处：`?build=v58` / `BUILD='v58'` / `zmj-v58` / `build:'v58'`。收尾环境 `8171=0`、`%TEMP%\zmj-*`=0。

---

## 4. 本轮修掉的真实缺陷（按发现顺序）

1. **`manualDrawNow()` 全树 0 个调用点**（死函数）——A 的"出手点"从未接线，就算按钮出现也没人调它。
2. **待抽态三重门全关**：`drawPending2D()` 要求 `type==='turn'` **且** `handArrange.drawn` 非空（待抽态 `drawn` 为 `null`），故牌墙不可点、按钮不出、提示不出——**是死局，不是"少一条入口"**。修法：**不动老谓词**，另起 `pendingDraw2D()`（靠 `H.pendingDraw`）→ `wallDrawable2D()` 取或 → `acceptWallDraw()` 分流（`manualDrawNow` 优先，`acceptDrawnTile` 兜底）。
3. **`aiStep` / `autoPlaySeat` 缺 `draw` 推进**——AI、托管、自动对局在牌墙前原地打转；`account-ui` 与 `training-release` 的红由此而来。
4. **`onWallPick` 调的是 `acceptDrawnTile` 且被 `drawPending2D()` 挡**——三维点对合法槽也不抽牌。

**三次否决，记录在案**（Chief 拍板，本报告确认）：①**不改任何测试文件**；②**不给 `draw` 造 `options:{canZimo:false,…}` 假字段**（崩是响的，假是哑的）；③不把产品缺陷当测试问题处理。

---

## 5. 过程事故（记入，不作追责）

- **同版本下的"边改边跑"导致作废**：v58 内部 `index.html` 落盘 5 次（`CB40426E` → `01E4E389` → `5665DFDC` → `2AFB0E23` → `4353CAAF`）→ **Node r4、两组首轮单跑、全量 r1/r2 全部作废**。
- **`sw.js` 未随 `index.html` 重升 CACHE**：现仍为 `zmj-v58`（04:02:01），而 `index.html` 在其后有多次落盘 → **带旧 `zmj-v58` 缓存的浏览器会拿到过期页面**。发布前必须先升 `CACHE`（v59 第一件事），**不在刚通过的版本上动刀**。
- 历史偶发：`table-3d-ui` 曾在满载条件下出现 `deal / 8,4,4,4` 超时（v56/v57 期），**根因仍未定位**；本次两轮均未复现。
- **快照机制（本轮确立的规矩）**：`out\v58-freeze-4353CAAFA488.html`（605309B，与线上 `4353CAAF` 逐字节一致）**成为后续 diff 的基准**。今晚之所以说不清"`5665DFDC → 4353CAAF` 那 23 字节改了啥"，正是因为 `5665DFDC` 没留副本；从这一版起，**每次定稿先存快照，再谈改动**。

---

## 6. 不能说的四条（一条不许省）

1. **真机未验**。全部数据来自本机 headless + swiftshader；真机是真实 GPU / 触屏，**升版后先清缓存再验**。
2. **`syncTable3D` p95 未取得**——没有 `?perf=1` 探针，不给性能结论。
3. **用户尚未亲手抽牌**。这是 v58 唯一的最终验收；门禁只证明"不崩、不回归"，**不证明"玩家真能顺手抓牌"**。
4. **旧基线一律不继承**。`5665DFDC`、`2AFB0E23`、`01E4E389`、`CB40426E`、`B6CB0B0F`、`752F7D89`、`0FC90B20` 等版本上的任何结论，都不适用于本版；中间态证据**一律不拼进这次通过**。

**因此本报告不写"已彻底完成"，只写：v58 全量在 `4353CAAF` 上通过。**

---

## 7. 已知缺口（留给后来人）

1. **可视化/交互类逻辑门禁覆盖薄**：本轮 `draw` 等待态"点了不动"就是例：断言测的是算法与流程，测不到"玩家手上是否真的抽到了牌"，最终仍靠人试用手。
2. **测试驱动器依赖"认识的等待类型"**：新增等待类型会打穿 `training-release.html:25`、`account-ui.html:12` 这类老驱动；**根因修在产品（入口接线），未改测试**。
3. **发布前必须升 `sw.js CACHE`**，否则老缓存用户拿到旧页面。
4. **`table-3d-ui` 满载偶发（`deal/8,4,4,4`）根因未定位**，只能记录、不能声称已修复。
