# v53 验收报告：窄屏选中牌放大改用布局尺寸（修复 v51 不稳断言）

- 验收人：验牌（测试）
- 时间：2026-11-07
- 版本：`index.html:7515 BUILD='v53'`、`sw.js:3 CACHE='zmj-v53'`、`server.js:59 build:'v53'`、`index.html:3213 ?build=v53`，版本链四处一致
- 被验改动：`index.html:887-888` 窄屏 `.chosen` 由 `scale(1.16)` 改为 `width/height` 直接放大 16%（不再走 `.12s` transform 过渡），并用负 `margin-left/right` 抵消加宽，避免挤动相邻牌
- 修复对象：v51 的「选中牌宽度放大 ≥12%」断言（v51 报告记录为 7 红 3 绿的双峰）

## 1. 结论

| 项 | 结果 |
|---|---|
| `tile-legibility-ui` 单跑连跑 10 次 | **10/10 全过**，数值完全一致（宽 23.6→27.3、高 46.8→54.3） |
| 双峰是否消失 | **消失**，v51 的 25.9/26.5 两簇不再出现 |
| 测试页是否被改动凑绿 | **没有**：`tests\tile-legibility-ui.html` 哈希 `4489FBD6…` 与 v51 基线一致，仍是 `t[0].click(); await paint();` 等 2 帧，`b.width*1.12` 原样 |
| 视觉取证 | 已补 `out\v53-360-chosen.png`（360×800） |
| 完整全量 `--browser` | **未通过**：两次都在第 7 组 `table-3d-ui` 熔断（详见 §4），**不是本次改动引起，但本次不能判全量通过** |
| 总体 | **修复本身验收通过；版本整体不判全绿** |

## 2. 跑过的命令与实测数值

```powershell
cd D:\mahjong\repo
# 单跑连跑 10 次
for($i=1;$i -le 10;$i++){ node tests/pages-compat.js tile-legibility-ui }
```

10 次实测（每次都一样）：

```
1 pass 宽=27.3 高=54.3
2 pass 宽=27.3 高=54.3
3 pass 宽=27.3 高=54.3
4 pass 宽=27.3 高=54.3
5 pass 宽=27.3 高=54.3
6 pass 宽=27.3 高=54.3
7 pass 宽=27.3 高=54.3
8 pass 宽=27.3 高=54.3
9 pass 宽=27.3 高=54.3
10 pass 宽=27.3 高=54.3
PASS=10 FAIL=0
```

换算：宽 `27.3/23.56 - 1 = +15.7%`（阈值 12%），高 `54.3/46.8 - 1 = +16.0%`。两条都是余量充足地过线，不再是压在线上。

## 3. 视觉取证

`out\v53-360-chosen.png`（360×800，150706 B）：360 视口摸牌后点选第一张，图顶部读数 `360 选中态 牌=23.6x46.8 选中=27.3x54.3 放大=16.0% 张数=14`，最左「伍萬」抬起放大，手牌仍 14 张。

取证方式：独立静态服务 8179 + Edge headless `--touch-events=enabled`（**必须带这个标志，否则 `isTouch` 为 false，点手牌直接出牌、不出现选中态**）。抓图页为临时文件，用完已删，未入库。

## 4. 完整全量状态（未通过，如实记录）

两次 `node tests/run-checks.js --browser` 均**熔断在第 7 组 `table-3d-ui`**，日志 `out\v53-full-browser-recheck.log`（均只到 运行 7 / 完成 6，**不采信为通过**）：

1. 第一次：打出 `=== 超时 ===`，撞 `pages-compat.js` 的 200s 轮询上限。
2. 第二次：`"ok":false`，错误原文
   `等待超时：()=>stage.dataset.machineBusy==='0'&&d.querySelectorAll('[data-three-projected]').length===expectedCount`
   （`tests/table-3d-ui.html:114-115`）。失败快照里 `machinePhase=ready`、`machineBusy=0`、`view=overhead`、`handCount=13`，即三维阶段已就绪但投影牌数与手牌数不一致。

按既定坑位流程单跑复核：**34s 通过**（`out\v53-table3d-ui-single.log`）；随后连跑 4 次 **3 过 1 红**。

结论：`table-3d-ui` 是**满载下间歇红**，与 v53 的窄屏改动无因果关系，**不判为本次回归**；但**也不能算它通过**，版本整体因此不判全绿。建议交「三维」排查投影层刷新与 `machineBusy` 归零的先后顺序（未验证）。

另记：码仔自己那份 `out\v53-full-browser.log` 为 运行 31 / 完成 31 / `ok:false` 0 / 收尾「全部检查通过。」，写于 21:01:34（晚于 index.html 定稿 20:58:30），哈希 `1FE1F904…` 一致——**是其环境下的真实通过**，但在复核环境不可复现，不能替代本报告结论。

## 5. 证据清单

- 命令与 10 次数值：本报告 §2
- 全量失败证据：`out\v53-full-browser-recheck.log`（运行 7 / 完成 6，第 7 组 `"ok":false`）
- 单跑通过证据：`out\v53-table3d-ui-single.log`（34s，`"ok":true`）
- 截图：`out\v53-360-chosen.png`
- 版本链与哈希：`index.html` `1FE1F9046547167D…`（全量期间前后一致）；`tests\tile-legibility-ui.html` `4489FBD6…`（未变）

## 6. 未验范围

- 真机（真实手机 GPU）选定放大效果未验。
- 完整全量在复核环境未跑到收尾句，`visual-ui` 之后各组的本轮状态**未知**（因熔断未执行）。
