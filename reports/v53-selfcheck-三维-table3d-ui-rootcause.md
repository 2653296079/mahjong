# v53 自测记录（实施方自测，非验收报告）：table-3d-ui 第 7 组熔断根因定性

落笔：三维（渲染）。本文件为实施方自测记录，按调度新规不占用 `reports\v53-validation.md`。
本文件只读代码与现场，**未起任何 pages-compat 进程，未动 8171，未改任何文件**。

## 结论（一句话）

不是 A（状态问题），也不是 B（投影少一张）。是 **测试侧「跳过演出」在未掷骰时被静默拒绝，而 `machineBusy` 被另一条路径归零，导致等待条件用旧局的 14 张去等一个新局**，于是永远等不到。

## 证据链（行号以当前文件为准）

### 1. 跳过按钮在未掷骰时返回 false，是设计如此

- `index.html:3360`
  `$('threeSkip').onclick=function(){if(table3D.api&&!table3D.api.skipOpening())netToast('请庄家先掷骰，再跳过动画');};`
- `table3d.js:805-808`
  `skipOpening(force=false){ if (machineRun && !machineRun.rolled && !force) return false; finishMachine(); return true; }`

### 2. 页面处于「发牌中 / 等待掷骰」阶段，`onBusy(false)` 照样把忙碌清掉

- `table3d.js:566`：`const doFinish=()=>{ if (machineRun && notify) callbacks.onBusy?.(false); ... }`
  最终收尾**无条件**回调 `onBusy(false)`（`finishMachine` 头部第 551 行已先把 `machineBusy` 置 `'0'`）。
- `index.html:3188`：`busy:false; document.body.classList.remove('machineBusy'); $('threeSkip').classList.add('hidden');`

所以：`machineBusy==='0'` 归零 → 按钮被隐藏 → 跳过**永远不会被真正执行**（`handlePhase` 里只在 `!visible` 之外才点击），而等待条件的左半边已经成立。

### 3. 左半边成立、右半边不成立 = 100% 超时

- `tests/table-3d-ui.html:112`（验牌引用的 114-115 是旧行号，当前版判定在此行）
  `await until(()=>stage.dataset.machineBusy==='0' && d.querySelectorAll('[data-three-projected]').length===expectedCount);`
- `expectedCount` = `newHand.players[humanSeat].concealed.reduce(...)`，`newHand` = **点跳过那一刻**的 `__zmjGame.hand`（刚 `startHand()` 建好，人庄家 14 张）。
- 跳过实际没执行 → 三维还在旧局循环里推牌 → `onProject` 吐出的仍是**旧局 13 张**的投影区。

故 13 ≠ 14，永久超时。现场 `handCount=13`、`riverCount=2`、`round=1:2:0` **正是旧局**（1 局 2 巡、河里 2 张），所以这组现场数据本身没有矛盾——是**两份不同局的数据被放在同一个判定里**。

### 4. 满负载才红的原因

发牌循环跑得快时，`machineRun.rolled` 在测试点击前就已成 true → 跳过成功 → 该判定通过（单跑 34s 通过、连跑 4 次 3 过 1 红）。负载高、SwiftShader 抢 CPU 导致发牌帧率掉下来，点击落在 `await-roll`/`deal` 初期，于是命中本缺陷。这解释了「为什么只有满载红」，不是渲染慢。

## 我的修复建议（未实施，等调度批）

1. **产品侧**（最小、最有说服力）：`skipOpening` 的拒绝应改为**可见失败**——未掷骰时点跳过，把按钮保持可见或给出明确提示，且**不得**让 `machineBusy` 在演出未结束时归零；`onBusy(false)` 只在真正 `finishMachine()` 收尾时发。
2. **测试侧**（不改断言强度）：等待条件改为同时校验 `dealCounts` 四位都 ≥ 12（即发牌完成），或用 `dealFaceCount` 已清空作为「演出确实结束」的证据；仍是 `===` 严格相等，不放宽、不加 nudge、不删断言。

约束遵守情况：未放宽 `===`、未调大上限、未加 nudge、未删断言、未改任何产品代码。
