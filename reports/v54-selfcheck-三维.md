# v54 自测记录（实施方自测，非验收报告）：table-3d-ui 跳过演出修复

落笔：三维（渲染）。按调度新规，实施方自测记录不占用 `reports\vNN-validation.md`。

## 改动（经调度批准，方案 A）

**`index.html:3360`**：跳过演出按钮改为强制跳过。

改前：
```js
$('threeSkip').onclick=function(){if(table3D.api&&!table3D.api.skipOpening())netToast('请庄家先掷骰，再跳过动画');};
```
改后：
```js
// 跳过演出：未掷骰时也强制收尾。skipOpening(false) 在 machineRun.rolled===false 时静默返回 false，
// 而 finishMachine 仍会把 machineBusy 置 '0'，于是「按钮已藏、演出未结束、画面停在旧局」——强制跳过才符合按钮语义。
$('threeSkip').onclick=function(){if(table3D.api&&!table3D.api.skipOpening(true))netToast('三维牌桌未就绪，稍后再试');};
```

**根因**：`skipOpening(force=false)` 在 `machineRun.rolled===false` 时 `return false`（table3d.js:806），按钮静默失败；而 `finishMachine` 已经把 `machineBusy` 置 `'0'`（table3d.js:551）、`onBusy(false)` 又把跳过按钮隐藏（index.html:3188）。于是 `machineBusy==='0'` 左半边成立、投影还停在旧局 13 张右半不成立 → `length===expectedCount` 永久超时。强制跳过让 `finishMachine()` 正常收尾并 `applySnapshot(snapshot)` 按新局重建投影。

**快照方向已确认**：`beginMachine()` 在 table3d.js:511 执行 `applySnapshot(next)`，`snapshot` 是**新局**快照，不是旧局固化那份；`finishMachine()` 第 553 行用它重建 entries，第 566 行 `onBusy(false)` 在投影更新之后才触发。验牌提出的「A 只是把卡住位置换一下」风险不成立。

## 版本链（四处已对齐 v54）

- `index.html:7517` `var BUILD = 'v54';`
- `index.html:3213` `import('./assets/table3d/table3d.js?build=v54')`
- `sw.js` `var CACHE = 'zmj-v54';`
- `server.js` `build:'v54'`

index.html 改动前哈希 `1FE1F9046547167D…`，改动后 `B6CB0B0F4D6DE367…`。

## 测试侧：一行未动

`tests/table-3d-ui.html` 未改：`===expectedCount` 原样、等待上限原样、断言未删、无 nudge。修复完全靠产品码让断言真过。

## 实跑结果

1. `node tests/run-checks.js`：10/10 passed，no-build-check 通过（sw 缓存 zmj-v54，资源 4 项），smoke-server 通过，收尾「全部检查通过」。
2. `node tests/pages-compat.js table-3d-ui` 单跑：`"ok":true`，50 条断言全过，含「跳过演出直接继续本局，不重发、不丢牌」「结算续局清除旧模型和牌河，保留同桌和累计成绩」以及三个视口的点击区断言。
3. 连跑 5 次：`PASS=5 FAIL=0`（合计 6/6 全过）。修复前是「连跑 4 次 3 过 1 红」，现在是 6/6。
4. 其余三维组：`table-3d-drag` PASS、`tile-legibility-ui` PASS、`river-hover-ui` PASS。

## 全量 --browser（两次，必须分开读）

1. **本次自测的全量：未通过。** `out\v54-full-browser.log`：运行 7 / 完成 6 / `ok:false` 1 / 无收尾句，熔断在第 7 组 `table-3d-ui`（写入 21:30:15 → 21:34:02）。失败现场：`machinePhase=dice`、`machineBusy=1`、`dealTrace=["0,0,0,0"]`、`cupShake=0.00`，只过 2 条断言。
2. **验牌的独立复核全量：通过。** `out\v54-full-browser-recheck.log`：运行 31 / 完成 31 / `ok:false` 0 / 收尾句 1，`table-3d-ui` 满载下 `"ok":true`、44 条断言全过、32s。验牌哈希跑前跑后一致。

**验收结论以 `reports\v54-validation.md`（验牌落笔）为准**，本文件不代下全量结论。

## 遗留风险（未解释、不等于已修复）

1. `table-3d-ui` 在**非满载单跑**下存在偶发红。三维侧观测 14 次中 5 次红（约 36%）、验牌侧原版干净复核 8/8 全过、本次满载全量通过。三个样本结论不一致，**原因未查明**。我的 14 次运行没有逐次落盘时间戳，只能确认它们都在 21:53:15 探针插入之前、跑在原版文件上；**其起止时刻无文件级证据**。
2. 失败形态分两类，均**未定性**：
   - 类型一：卡 `dice`，`dealTrace=["0,0,0,0"]`，推进循环停；
   - 类型二：发牌跑完、`phases` 含 `deal>ready`，但 `machinePhase=ready` 且 `machineBusy=1` 并存，卡在第 111 行等 `collect`。
3. 「`update():419` 的 `finishMachine()` 先清 busy、421 行 `beginMachine()` 又置回 1，导致 ready 与 busy=1 并存」——**仅为代码推理，无实测**。`table3d.js` 全文件确实只有 `:535` 写 `'1'`、`:551` 写 `'0'`（我与验牌各自独立复核过），这个锚点成立，但没有采到运行时的写入序列。
4. **探针取证方案失败并已放弃**：用 `Object.defineProperty` 劫持 `stage.dataset.machineBusy`/`machinePhase` 的 setter 会让整组测试跑不动（3 次单跑均约 200s 超时；一次 10 连跑从 22:31 卡到 22:50 无输出）。测试页已还原至 `1DDD1439…`，还原后单跑 `ok=True, steps=44`。**该事故还污染了验牌一轮复核（21:53:26 起跑跨了 `1DDD1439…` 与 `FE2A31A7…` 两个版本），该轮数据作废。**
5. **真机未验**：GPU、触屏、多人同桌的实机表现均未测试。

## 流程教训

改 `tests\*.html` 或任何被测文件前，必须先在群里声明「改哪个文件 + 占用 8171 + 预计时长」，并确认没有人正在跑；跑完立刻还原并报回哈希。本次未预先声明即插入探针，导致他人一轮复核作废，责任在我。
