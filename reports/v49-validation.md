# v49 验证报告：手机触控与安全区

日期：2026-11-07。BUILD `v49`。范围：竖屏手机的触控目标尺寸与四边安全区；规则、联机、三维渲染逻辑未改动。

## 实现摘要

- **44px 触控目标**（`@media(max-width:680px)`）：
  - 顶栏 `.tools>.mini`、`.toolsMenu summary`、更多菜单 `.toolsPopover .mini` 统一 `min-height:44px`，内容 `inline-flex` 居中；
  - `.act`、`#btnDrawTile`、`#btnReceiveTile` 统一 `min-height:44px`；
  - 牌墙药丸 `#wallInfo.drawable` 视觉高度 32px，`::after{inset:-7px -9px}` 把可点区域扩展，实测有效命中高度 ≥44px，点药丸即可摸牌。
- **安全区**：`#topbar` 接 `safe-area-inset-top/left/right`，`#actionbar` 与 `#side` 接 left/right，`#table` 边距用 `max(7px,env(safe-area-inset-left/right))`；底部原本已有 `inset-bottom`。
- 布局不变：仍走 v48 的「缩放全部可见」手牌策略，不引入横向滚动。

## 实测数据（390×844，二维）

| 目标 | 改前 | 改后 |
| --- | --- | --- |
| 顶栏主按钮高度 | 32px | 44/44/44/44/44 |
| 摸牌按钮高度 | 40px | 44px |
| 牌墙药丸 | 23px（非可摸态） | 32px 外观 + ≥44px 有效命中 |
| 更多菜单按钮 | 40px | 44px ×10 |
| 文档横向溢出 | 无 | 无（scrollWidth=390） |

360×844 同样满足，`scrollWidth=360`；844×390 横屏无横向溢出、操作栏在视口内。

## 测试

```text
node tests/pages-compat.js mobile-ui     exit 0（22 项断言）
node tests/pages-compat.js visual-ui     exit 0
node tests/pages-compat.js table-layout  exit 0
node tests/pages-compat.js atmosphere-ui exit 0
node tests/pages-compat.js selection-ui  exit 0
node tests/pages-compat.js river-hover-ui exit 0
node tests/pages-compat.js hand-sort-ui  exit 0
node tests/pages-compat.js music-ui      exit 0
node tests/pages-compat.js table-3d-ui   exit 0
node tests/run-checks.js                 exit 0
node tests/run-checks.js --browser       exit 0（24 组：23 组 pages-compat + browser-online，0 失败）
```

最终门禁日志：`out/v49-node.log`、`out/v49-browser.log` 均为「全部检查通过。」，`"ok":false` 计数 0；`table-3d-ui` 42s、`mobile-ui` 全项通过。

`mobile-ui` 覆盖：摸牌前药丸可摸；390/360 顶栏按钮与摸牌按钮 ≥44px；药丸逐像素探测有效命中高度 ≥44px；更多菜单按钮 ≥44px；无横向溢出；操作栏贴底不压手牌；样式含上/左/右安全区；点药丸完成摸牌并得到 14 张；844×390 横屏不溢出。

## 浏览器实跑截图

- `out/v49-mobile-390.png`：390×844 主界面，顶栏按钮与摸牌按钮加高，牌墙药丸可摸。
- `out/v49-more-menu.png`：更多菜单展开，10 个按钮均为 44px。

## 已知限制

- 横屏 844×390 命中 `max-height:660px & min-width:681px` 分支，顶栏按钮仍 28–40px；触控设备横屏的 44px 需要单独媒体条件，留待后续。
- 360 下单张手牌约 22px 宽，牌面可读性仍待评估。
- 安全区只做了 `max(…, env(...))` 兜底，真机刘海/手势条未实测（无真机）。

## 本轮修正记录

- `mobile-ui` 首版用固定 20px 偏移探测药丸命中区，360 下被相邻药丸遮挡误判 → 改为从中心逐像素向上/下探测并计算有效高度（含中心像素），断言更准确。
- 命中区初版 `inset:-6px` 实测有效 42–43px，改为 `-7px` 后 ≥44px；这是补齐规格，不是放宽断言。
