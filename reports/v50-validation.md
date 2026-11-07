# v50 验证报告：矮横屏触控

日期：2026-11-07。BUILD `v50`。范围：手机横放/分屏（视口高度 ≤500px）的触控目标与布局；竖屏 v49 规则不变。

## 问题

v49 之后，844×390 这类矮横屏命中 `@media(max-height:660px) and (min-width:681px)` 与 `max-height:500px` 分支，顶栏按钮被压到 28px、操作栏按钮 31–35px，低于 44px 触控目标。

## 实现

- 新增 `@media(max-height:500px)`：
  - `.tools>.mini`、`.toolsMenu summary`、`.toolsPopover .mini`、`.act`、`#btnDrawTile`、`#btnReceiveTile` 统一 `min-height:44px`；
  - `#wallInfo.drawable` 维持 32px 外观与 `::after{inset:-7px -9px}` 命中扩展（矮横屏下该药丸由既有布局隐藏，见下）；
  - `#actionbar` `min-height:56px`，上下 6px。
- 不改变桌面与竖屏规则；不改动任何游戏逻辑。

## 实测（844×390，二维）

| 项目 | v49 | v50 |
| --- | --- | --- |
| 顶栏主按钮高度 | 28px | 44/44/44/44/44 |
| 摸牌按钮高度 | 31–35px | 44px |
| 操作栏高度 | 43px | 56px |
| 牌墙药丸 | 隐藏（0×0） | 仍隐藏（矮横屏按既定策略走按钮摸牌） |
| 横向溢出 | 无 | 无（scrollWidth=844） |

390×844 与 360×844 的 v49 断言全部保持通过。

## 测试

```text
node tests/pages-compat.js mobile-ui     exit 0（25 项断言）
node tests/pages-compat.js visual-ui     exit 0
node tests/pages-compat.js table-layout  exit 0
node tests/pages-compat.js atmosphere-ui exit 0
node tests/pages-compat.js selection-ui  exit 0
node tests/pages-compat.js river-hover-ui exit 0
node tests/pages-compat.js hand-sort-ui  exit 0
node tests/pages-compat.js table-3d-ui   exit 0
node tests/run-checks.js                 exit 0（全部检查通过）
node tests/run-checks.js --browser       exit 0（24 组 = 23 组 pages-compat + browser-online，0 失败）
```

最终门禁日志：`out/v50-node.log`、`out/v50-browser.log`，`"ok":false` 计数 0，`mobile-ui` 返回 `"ok":true`（含 844×390 全部横屏断言）。

`mobile-ui` 新增的横屏断言：844×390 顶栏 5 个按钮均 ≥44px、摸牌按钮 ≥44px、牌墙药丸在矮横屏隐藏（摸牌走按钮）、无横向溢出、操作栏位于视口内。

## 浏览器实跑截图

- `out/v50-landscape-844x390.png`：844×390 二维对局，顶栏与底部摸牌按钮 44px、操作栏 56px、13 张手牌与牌河完整可见。

截图方法说明：Tabbit 在该视口下对游戏画面截图会卡在 `waiting for fonts`（首页可截、进桌后卡住，CDP `fromSurface:false` 被拒），改用无头 Edge `--screenshot` + 临时 iframe 包装页自动点「开始练习」完成实拍；包装页与一次性服务器均已删除。

## 已知限制

- 矮横屏（≤500px 高）的牌墙药丸仍隐藏，玩家只能点底部按钮或（竖屏下）点药丸摸牌；如需横屏拖墙摸牌需重新设计中央区布局。
- 安全区仅 `env()` 兜底，真机未验证。
- 360 单张手牌约 22px 宽的可读性仍未处理。
