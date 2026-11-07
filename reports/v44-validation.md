# v44 验证：出牌落桌命中反馈

日期：2026-11-07
范围：`index.html` 二维牌河落桌动效、`sw.js` 缓存、`tests/selection-ui.html`、`server.js` 版本
版本：`BUILD v44`、`CACHE zmj-v44`、`/healthz build v44`。未推送、未部署。

## 验收

- [x] 二维每次新出牌，中央牌河最新一张有短促落桌回弹（缩放 + 金色描边）。
- [x] 桌面同时轻顿 220ms；不影响出牌时机、不改变牌局状态。
- [x] 原有按座位方向的 `riverArrival` 滑入保留。
- [x] 三维不加桌面轻顿，继续用自身出牌动画。
- [x] `prefers-reduced-motion` 下不播放。

## 实现摘要

- `renderRiver()` 在 `last` 增大时给最新 `.riverEntry` 加 `.impact`，并给 `#table` 加 `discard-impact`（240ms 后移除）。
- CSS：`riverLand`（1.16→0.97→1 缩放 + 金色描边）与 `tableKnock`（±1px 轻顿），放在 `prefers-reduced-motion:no-preference` 内。
- 只在 `body:not(.table3d)` 时加桌面轻顿；牌河回弹不依赖引擎。

## 测试

```text
node tests/pages-compat.js selection-ui      exit 0（新增「落桌有命中反馈」；牌墙拖拽/点按无回归）
node tests/no-build-check.js                 exit 0（zmj-v44、3 内联、0 外链）
node --test tests/offline.test.js            exit 0（3 项）
node tests/run-checks.js                     exit 0（101 Node + 9/16/10 服务端）
node tests/run-checks.js --browser           exit 0（22 组，0 失败）
```

## 浏览器实跑（Tabbit，种子 20261016）

拖动出牌后立即读取：桌面/手机均 `impact=true`、`table=true`，`document.getAnimations()` 含 `tableKnock`、`riverArrival`、`riverLand`；随后把 `riverLand` 暂停在 80ms 截图。

截图：`out/v44-impact-desktop.png`、`out/v44-impact-mobile.png`。

## 遗留

- 落桌音效仍复用既有 `discard` 声，没有单独的闷响层。
- 3D 未加额外桌面轻顿。
