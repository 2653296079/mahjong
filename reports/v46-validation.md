# v46 验证：二维副露聚拢反馈

日期：2026-11-07
范围：`index.html` 副露渲染与动效、`sw.js` 缓存、`tests/selection-ui.html`、`server.js` 版本
版本：`BUILD v46`、`CACHE zmj-v46`、`/healthz build v46`。未推送、未部署。

## 验收

- [x] 二维新出现碰/杠时，新增的最后一组副露做一次收拢回弹（放大 → 收紧 → 落定）并带金边。
- [x] 已有副露不重排、不重播；只标记数量增加的那一组。
- [x] 三维不标记 `.fresh`，继续用自身副露摆放/出牌动画。
- [x] `prefers-reduced-motion` 下不播放。
- [x] 不改变规则、发牌、联机协议。

## 实现摘要

- `renderSeat` 用 `lastMeldCounts[seat]` 记录上一帧副露数；增加时给最后一组 `meldEl(..., fresh)` 加 `.fresh`。
- CSS `meldGather` 260ms：1.18 → 0.96 → 1 缩放 + 金色外圈；放在 `prefers-reduced-motion:no-preference` 内。
- 仅在 `!body.table3d` 时标记，避免影响三维隐藏层。

## 测试

```text
node tests/pages-compat.js selection-ui      exit 0（新增「碰牌副露有聚拢反馈」）
node tests/no-build-check.js                 exit 0（zmj-v46、3 内联、0 外链）
node --test tests/offline.test.js            exit 0（3 项）
node tests/run-checks.js                     exit 0（101 Node + 9/16/10 服务端）
node tests/run-checks.js --browser           exit 0（22 组，0 失败）
```

## 浏览器实跑（Tabbit，种子 20261016）

合成一组碰牌并触发 resize 后：`.meld.fresh` 数量 = 1，`document.getAnimations()` 含 `meldGather`；将 `meldGather` 暂停在 80ms 截图。

截图：`out/v46-meld-gather-desktop.png`、`out/v46-meld-gather-mobile.png`。

## 遗留

- 目前是副露原位的聚拢回弹，还没有把被取走的牌从牌河真实滑到副露区。
- 三维副露未加这一层。
