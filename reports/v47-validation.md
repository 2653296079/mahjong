# v47 验证：牌河飞向副露

日期：2026-11-07
范围：`index.html` 副露/牌河动效、`sw.js` 缓存、`tests/selection-ui.html`、`server.js` 版本
版本：`BUILD v47`、`CACHE zmj-v47`、`/healthz build v47`。未推送、未部署。

## 验收

- [x] 新碰/杠出现时，从中央牌河位置飞出一张同名牌的牌影，落到新增副露上并淡出。
- [x] 副露自身的 `meldGather` 收拢回弹保留；已有副露不重排、不重播。
- [x] 仅二维生效；三维继续用自身副露/出牌动画。
- [x] `prefers-reduced-motion` 下不播放；不改变规则、发牌、联机协议。

## 实现摘要

- `renderSeat` 在 `freshMeld` 时调用 `flyMeldFromRiver(kind, lastMeldEl)`；起点 `#riverTiles` 中心，终点副露矩形中心。
- `element.animate` 300ms 弧线（中点抬升 18px）+ 缩放 + 淡出；`onfinish`/520ms 兜底移除 `.meld-fly`。
- 目标副露在 DOM 挂载后再取矩形；只在 `!body.table3d` 触发。

## 测试

```text
node tests/pages-compat.js selection-ui      exit 0（新增「被碰的牌从牌河飞向副露」）
node tests/no-build-check.js                 exit 0（zmj-v47、3 内联、0 外链）
node --test tests/offline.test.js            exit 0（3 项）
node tests/run-checks.js                     exit 0（101 Node + 9/16/10 服务端）
node tests/pages-compat.js river-hover-ui    exit 0（修复后单跑复验）
node tests/run-checks.js --browser           exit 0（22 组，0 失败）
```

### 全量首轮失败与修复

全量首轮在第 8 组 `river-hover-ui` 失败：`1366×900 碰杠留在所属座位范围[1]`。

- **根因：** v46 的 `.meld.fresh` 聚拢动画从 `scale(1.18)` 开始、持续 260ms，测试注入副露后仅等两帧就量 `getBoundingClientRect`，量到的是动画瞬态的包围盒越界；牌桌静态布局本身没有溢出。
- **修复：** `tests/river-hover-ui.html` 在注入副露后先等「副露渲染完成 → 聚拢动画收尾 → 飞行残影移除」再进入四档尺寸测量，断言与阈值一字未改。
- **复验：** 单跑 `river-hover-ui` exit 0；全量复跑 22 组 0 失败，末行「全部检查通过。」

## 浏览器实跑（Tabbit，种子 20261016）

合成一组碰牌并触发 resize 后：`.meld-fly` = 1、`.meld.fresh` = 1；将牌影动画暂停在 100ms 截图。

截图：`out/v47-meld-fly-desktop.png`、`out/v47-meld-fly-mobile.png`。

## 遗留

- 起点是牌河区域中心，不是被取走那张牌的精确像素位置。
- 3D 未加这一层。
