# v41 验证与交付：仿真拖拽出牌

日期：2026-11-07
范围：`index.html` 手牌交互、`sw.js` 缓存版本、`tests/selection-ui.html`、`tests/offline.test.js`
版本：页面 `BUILD = v41`，离线缓存 `zmj-v41`。未推送 GitHub、未重启公网服务。

## 1. 目标与验收

用户新增「仿真麻将」主线：尽量还原真人操作，例如从牌墙拿牌、把手牌打到牌河。本轮先做**拖拽出牌**，验收条件：

- [x] 轮到自己时，手牌可拖出牌列；中央牌河作为明确落区。
- [x] 拖到落区时牌河亮起金色边框和「松手打到牌河」提示，并显示跟随指针的实体牌影。
- [x] 在落区松手 = 直接出牌；牌进入中央牌河，落点高亮与牌影清除。
- [x] 在手牌列内拖动仍是理牌；点选二次确认（触屏/三维）不变。
- [x] 联机与单机共用 `commitDiscard` 出牌路径，没有另写一套发包逻辑。
- [x] 三维接牌未完成时，拖拽/落河不会绕过接牌流程。
- [x] 桌面 1280×800 与手机 390×844 均实跑通过。
- [x] 三维牌桌有独立拖拽断言（`tests/table-3d-drag.html`）。

## 2. 实现摘要

- 手牌指针事件：原 `pointerdown/move/up` 只做理牌；新增超过 8px 后创建 `drag-ghost` 实体牌影、标记 `drag-source`，并在指针进入落区时切换 `drop-ready`。
- 落区：二维使用 `#center`（中央牌河区域）；三维的 `#center` 是整屏 HUD，不能直接当落区，因此三维使用视口中央矩形（横向 24%–76%、纵向 16%–70%），高亮加在 `#threeStage` 上，避免「整屏都能出牌」。
- 松手：若在落区内，调用 `commitDiscard(kind, tileId)`；否则回退到原理牌目标计算。拖拽后设置 `suppressClick`，避免随后合成的 click 再触发一次选择/出牌。
- 出牌路径：从 `onDiscardClick` 拆出 `commitDiscard`，点选确认、键盘 Enter、拖拽落河都走同一条路径；联机 `NET.pendingAction`、`pendingReviews`、三维 `noteDiscard` 原样复用。
- 视觉：`#center.drop-ready` 金色落点边框；2D 提示在中央底部空白处，3D 在舞台上部；手机端缩小提示条。`prefers-reduced-motion` 与既有减弱动效路径不受影响（拖拽本身无长动画）。

## 3. 命令证据

```text
node tests/pages-compat.js selection-ui
  {"ok":true,"steps":[...,"可打状态下拿到一张可拖拽手牌","拖到中央时牌河亮起落点","松手后这张牌真正进入牌河","出牌后清除牌河落点高亮"],"errors":[]}
  exit 0

node tests/pages-compat.js table-3d-drag
  {"ok":true,"steps":["三维摸牌后出现接牌按钮","接牌后手牌可操作","三维拖到中央时舞台亮起落点","三维拖动时显示实体牌影","三维松手后这张牌真正进入牌河","三维出牌后清除落点高亮"],"errors":[]}
  exit 0

node tests/pages-compat.js table-3d-ui
  {"ok":true,"steps":[49 条，含"接牌后可整理和出牌"、"第二次点击通过原规则真正出牌，进入公开牌河"、"390×844 / 844×390 / 1366×768 点击区"],"errors":[]}
  exit 0

node tests/run-checks.js
  # tests 101 / # pass 101 / # fail 0
  9 passed, 0 failed (WS)
  16 passed, 0 failed (房间)
  10 passed, 0 failed (真实联机)
  内联 script：3 个，外链：0 个
  sw 缓存：zmj-v41，资源 4 项
  全部检查通过。 exit 0

node tests/run-checks.js --browser
  22 组浏览器流程（原 21 组 + table-3d-drag）全部通过
  pages-compat 21 组 + browser-online 1 组
  全部检查通过。 exit 0

GET /healthz
  {"status":"ok","app":"zhuanzhuan-mahjong","build":"v41",...}

node --test tests/offline.test.js   → 3 pass / 0 fail
node tests/no-build-check.js        → 通过（zmj-v41、3 内联、0 外链、56 js）
```

## 4. 浏览器实跑

Tabbit 真实运行；固定种子 `20261016`，配置 `sound:false, analyze:false`，桌面 1280×800、手机 390×844：

| 指标 | 二维桌面 | 二维手机 | 三维 1366×850 |
| --- | --- | --- | --- |
| 拖动中落点 `drop-ready` | true | true | true（`#threeStage`） |
| 拖动中 `.drag-ghost` | true | true | true |
| 拖动中 `#table.drag-active` | true | true | true |
| 松手后 `discards` | 0 → 1 | 0 → 1 | 0 → 1 |
| 松手后 `lastDiscard` | seat 0 / kind 5 | seat 0 / kind 5 | 实际座位出牌 |
| 松手后高亮/牌影 | 均清除 | 均清除 | 均清除 |

改前 v40 与改后 v41 在相同种子下均为 14 张手牌、桌面布局一致；v41 仅新增拖拽状态样式与提示。手机端提示条从顶部移到底部空白处，避免压住「牌墙/轮到你」胶囊。

截图：

- `out/v41-before-v40-desktop.png`（v40 基准）
- `out/v41-after-desktop.png`（v41 静置）
- `out/v41-drag-mid-desktop2.png`（拖动中：金色落点 + 牌影，提示在底部）
- `out/v41-dropped-desktop.png`（松手后：六万进中央牌河）
- `out/v41-mobile-idle.png`
- `out/v41-drag-mid-mobile2.png`（手机拖动中）
- `out/v41-dropped-mobile.png`

## 5. 发布集成与遗留

- `index.html`：`BUILD` v40 → v41，三维模块查询串同步 v41。
- `sw.js`：`CACHE` zmj-v40 → zmj-v41；`tests/offline.test.js` 假缓存与期望删除数组补 `zmj-v40`。
- 测试：新增 `tests/table-3d-drag.html` 并接入 `tests/run-checks.js --browser`；浏览器流程由 21 组增至 22 组。
- 文档：`README.md` 增「仿真拖拽出牌（v41）」；`三维试玩说明.md` 增拖拽说明；`实施记录.md` 增第十九轮。
- 未做：从牌墙摸牌的二维版本（三维已有「接牌」按钮/点选）；长手牌拖动时自动滚动；拖回手牌列取消出牌。
