# v42 验证：二维手动摸牌

日期：2026-11-07
范围：`index.html` 二维摸牌交互、`sw.js` 缓存版本、`tests/selection-ui.html`、`tests/river-hover-ui.html`、`server.js` 版本
版本：`BUILD v42`、`CACHE zmj-v42`、`/healthz build v42`。未推送、未部署。

## 验收

- [x] 轮到自己时，摸入张先不出现；手牌 13 张。
- [x] 中央牌墙 pill 变为「牌墙 N 张 · 摸牌」，可点击/键盘 Enter；操作栏同时出现「从牌墙摸牌」。
- [x] 点牌墙或按钮后，第 14 张翻开到手牌最右侧并高亮；按钮与可点状态收起。
- [x] 摸牌前点手牌或拖牌只轻提示，不会误出牌；拖拽出牌仍走 v41 的 `commitDiscard`。
- [x] 回合超时自动摸牌后继续原自动出牌逻辑。
- [x] 二维已摸过的牌切到三维不再要求「接牌」；三维原接牌流程保留。
- [x] 桌面 1280×800 与手机 390×844 实跑通过（手机走点牌墙路径）。

## 实现摘要

- `handArrange` 增加 `revealed`，与三维 `received` 分离：2D 以 `revealed` 放行出牌，3D 仍以 `received` 接牌；两者在新摸牌时一起重置。
- `drawPending2D()` 统一判断「二维 + 真人回合 + 有摸入张 + 未翻开」；牌墙、操作栏、计时器、教练、提示、局势分析、手机摘要都按这个分支显示「先摸牌」。
- `acceptDrawnTile()` 翻开后定向刷新手牌/中央/操作栏/计时/提示，并播音效；2D 保留摸入张在右侧 `drawn` 高亮，3D 接牌后仍清除 `.drawn`。
- 摸牌前的手牌点击/拖动被 `nudgeDraw()` 拦下；超时由 `autoAct()` 先自动摸牌。

## 测试

```text
node tests/pages-compat.js selection-ui      exit 0（新增 5 条摸牌断言；原 15 条无回归）
node tests/pages-compat.js river-hover-ui    exit 0（先摸牌再逐张讲解）
node tests/pages-compat.js table-3d-ui       exit 0（49 条；掷骰点击可重试，超时放宽 180s）
node tests/pages-compat.js table-3d-drag     exit 0（7 条；二维摸牌后切三维再拖）
node tests/run-checks.js                     exit 0（101 Node + 9/16/10 服务端）
node tests/run-checks.js --browser           exit 0（22 组：21 pages-compat + browser-online）
node tests/no-build-check.js                 zmj-v42、3 内联、0 外链
```

为适配 v42 摸牌门禁，audio/account/atmosphere/music/online-response/pages-compat/worker/visual/training-release/connection 等旧浏览器流程在出牌前先点「从牌墙摸牌」；原有断言未删弱，新增的是前置摸牌步骤。
```

## 浏览器实跑（Tabbit，种子 20261016）

| 状态 | 手牌 | `.drawn` | 摸牌按钮 | 牌墙可点 |
| --- | --- | --- | --- | --- |
| 桌面/手机 摸牌前 | 13 | 0 | 有 | 是 |
| 桌面/手机 摸牌后 | 14 | 1 | 无 | 否 |

截图：`out/v42-draw-pending-desktop2.png`（教练文案已改为「先从牌墙摸一张」）、`out/v42-draw-revealed-desktop.png`、`out/v42-draw-pending-mobile.png`、`out/v42-draw-revealed-mobile.png`。

## 遗留

- 还不能从牌墙「拖」到手里（本轮是点按/键盘）；牌墙拖动是下一步。
- 摸牌前「我的牌况」仍显示 13 张手牌的静态向听；没有把 14 张的分析藏起来。
- 三维「接牌」与二维「摸牌」文案尚未统一。
