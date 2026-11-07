# v51 验收报告：窄屏牌面可读性（≤400px）

- 验收人：验牌（测试）
- 时间：2026-11-07
- 代码版本：`index.html:7514 var BUILD='v51'` 之后的 v52 代码库（BUILD 已推进到 v52，v51 的样式规则仍在 `index.html:880-888`）
- 被测改动：`index.html:880` 注释「v51 窄屏牌面可读性：≤400px 去掉牌间空隙、把牌加高、选中牌放大预览（不引入横向滚动，避免与拖拽抢手势）」
- 核对产物：`sw.js:3 CACHE='zmj-v52'`、`index.html:3212` 三维动态导入 `?build=v52`（版本链一致，见 v52 报告）

## 1. 结论（先说结果）

| 项 | 结果 |
|---|---|
| 窄屏尺寸类断言（14 条中的 13 条） | **通过**，数值稳定 |
| 选中牌放大 ≥12% 断言 | **不稳定，判为红**：连续 10 次单跑 **7 红 3 绿** |
| 是否已入门禁 | 已加入 `tests/run-checks.js` 浏览器清单（`mobile-ui` 之后，浏览器第 11 位） |
| 在门禁里的表现 | 全量跑到它即红，门禁当场熔断，其后 14 组未跑（见 v52 报告 §2.1） |
| 建议 | 交「码仔」修 `index.html` 或稳定测试时序；**本验收不放宽断言值** |

红断言原文（`tests/tile-legibility-ui.html:34`）：
```js
check(cb.width>=b.width*1.12,'选中牌宽度放大 ≥12%（'+b.width.toFixed(1)+' → '+cb.width.toFixed(1)+'）');
```

## 2. 跑过的命令

```powershell
# 单跑（正式验收页，带 --touch-events=enabled）
cd D:\mahjong\repo
node tests/pages-compat.js tile-legibility-ui
```

门禁清单改动（测试基础设施，断言一条未动）：
```diff
   ['tests/pages-compat.js', 'mobile-ui'],
+  ['tests/pages-compat.js', 'tile-legibility-ui'],
   ['tests/pages-compat.js', 'visual-ui'],
```

## 3. 每条断言的实际数值

绿的那次（`--touch-events=enabled`，全部通过，原文摘录）：

| 断言 | 要求 | 实际 |
|---|---|---|
| 360 摸牌后手牌张数 | =14 | 14 |
| 360 单张牌宽 | ≥23.4px | **23.6** |
| 360 单张牌高 | ≥45px | **46.8** |
| 360 牌面图形宽 | ≥19.3px | **19.6** |
| 360 的 14 张牌都落在手牌区内 | 不裁切 | 通过 |
| 360 手牌区无隐藏溢出 | scrollWidth≤clientWidth+1 | 通过 |
| 点选后选中态牌数 | =1 | 1 |
| 选中牌宽度放大 | ≥12% | **26.5（+12.5%）通过** |
| 选中牌高度同步放大 | ≥12% | 52.6（+12.4%） |
| 放大后不压到上方区域 | top≥rr.top-2 | 通过 |
| 选中只是预览，不出牌 | 仍 14 张 | 通过 |
| 390 手牌数量 | ≥13 | 14 |
| 390 单张牌宽 | ≥25.4px | **29.8** |
| 390 单张牌高 | ≥48px | **58.0** |
| 390 无横向溢出 | ≤390 | 通过 |

红的那次（每次失败都精确落在同一个值上）：

```
"选中牌宽度放大 ≥12%（23.6 → 25.9）"
Error: 选中牌宽度放大 ≥12%（23.6 → 25.9）
    at check (http://127.0.0.1:8171/tests/tile-legibility-ui.html:5:37)
    at http://127.0.0.1:8171/tests/tile-legibility-ui.html:34:3
```

25.9 / 23.6 = **1.0975，即 +9.8%**，差 2.2 个百分点到线。

## 4. 失败率统计（可复现）

```powershell
cd D:\mahjong\repo
$p=0;$fl=0
for($i=1;$i -le 10;$i++){
  $o = node tests/pages-compat.js tile-legibility-ui 2>&1 | Out-String
  if($o -match '"ok":true'){$p++}else{$fl++}
}
"PASS=$p FAIL=$fl"
```

实测输出：
```
1 pass 26.5
2 fail 25.9
3 fail 25.9
4 fail 25.9
5 fail 25.9
6 fail 25.9
7 pass 26.5
8 fail 25.9
9 fail 25.9
10 pass 26.5
PASS=3 FAIL=7
```

结论：**不是偶发噪音，是两个稳定值（26.5 / 25.9）之间的双峰现象，红的一侧占多数。**

## 5. 取证截图

| 文件 | 内容 | 实测读数 |
|---|---|---|
| `out\v51-360-hand.png` | 360×780 摸牌后手牌 | 14 张，牌 23.6×46.8 |
| `out\v51-360-chosen.png` | 360×780 点选选中态 | 选中牌 27.3×54.3（此帧走的是按钮路径，见下节说明） |
| `out\v51-390-hand.png` | 390×844 摸牌后手牌 | 14 张，牌 25.7×50.0 |
| `out\v51-360-chosen-notouch.png` | 无触屏标志下点手牌 | **没有选中态，直接出牌**（中央牌河出现 4 张），佐证选中态强依赖触屏判定 |

## 6. 已定位的可疑根因（交码仔，不作为验收结论）

选中态是否出现由 `index.html:5777` 决定：
```js
if ((isTouch || document.body.classList.contains('table3d')) && (!selectedTile || ...)) { ... 只加 .chosen ... }
```
而 `isTouch`（`index.html:2988-2990`）= `matchMedia('(hover: none)')` ‖ `'ontouchstart' in window` ‖ `maxTouchPoints > 0`。

- 探针实测：**不带** `--touch-events=enabled` 时该环境为 `hover:none=false, touch=false, mtp=0`，此时点手牌**直接出牌、永不选中**（截图 `v51-360-chosen-notouch.png` 已证实）。所以这个用例完全依赖 `tests/pages-compat.js:65` 的 `--touch-events=enabled`。
- 带标志时进入选中分支，但宽度在 26.5 / 25.9 之间摆动。放大规则是 `.tile.clickable{transition:transform .12s cubic-bezier(0,0,.2,1),box-shadow .12s}`（`index.html:363`）+ `#seat0 .handRow .tile.chosen{...scale(1.16)...}`（`index.html:887`），而测试点选后只等 2 帧就测（`paint()`）；另外 `:active{transform:translateY(-2px) scale(.97)}`（`index.html:364`）与合成 click 的 `:active` 状态在不同运行中残留与否，会把 1.16 的实测值往下拉。
- 也就是说：**要么让测量等到过渡结束（测试侧），要么让选中放大在过渡起点就满足 ≥12%（产品侧）；改 1.12 这个阈值属于放宽门禁，不做。**

## 7. 给开发的可复现步骤

1. `cd D:\mahjong\repo`
2. `node tests/pages-compat.js tile-legibility-ui`，连跑 ≥5 次
3. 观察日志中「选中牌宽度放大 ≥12%（23.6 → ?）」，出现 25.9 即复现

### 7.1 补充实测（2026-11-07 追加，供码仔定位）

用同构探针页（`node tests/pages-compat.js _probe-chosen-final`，未列入触屏名单）连跑 3 次，读数完全一致：

```
env: hover:none=false  ontouchstart=false  mtp=0
基宽=23.56  2帧后 chosen=无  400ms后 chosen=无
computed transform=none   transition=all/0s
```

读法：**探针页没带 `--touch-events=enabled`，环境里三项触屏信号全为 false，于是点手牌永远不产生 `.chosen`（连 400ms 后也没有）——不是等太短，是根本不进选中分支。** 只有 `pages-compat.js:65` 名单里的页面（含 `tile-legibility-ui`）才会带上该标志。

因此给码仔的定位修正：
- 「多等几帧」不一定是解法——先确认带触屏标志时的过渡终值是多少；探针页无标志测不到这一支，定终值时要在**带 `--touch-events=enabled` 的正式页**里读 `getComputedStyle(...).transform` 的 matrix，别只看 2 帧的 getBoundingClientRect。
- 若终值本身就是 1.16（理论 27.33），那 25.9/26.5 都是**过渡中途值**，产品侧要保证「选中态不走 transform 过渡」或过渡起点即达标；若终值只有约 1.10，那是产品放大真的不够，必须改产品。

## 8. 未验范围

- 真机（真实手机 GPU / 浏览器）窄屏效果未验，仅在 Edge headless + 360/390 视口验过。
- 本报告未改任何产品代码；只改了 `tests/run-checks.js`（加一行清单）。
