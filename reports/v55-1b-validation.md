# 1b 中间验收报告：牌墙槽位只读接口（`wallSlotAt` / `wallSlotCount`）

> **这是迭代内的中间验收，不是版本验收。** 产品 `BUILD` 仍为 **`v54`**，`index.html=B6CB0B0F…`；1b 只在 `assets\table3d\table3d.js` 上新增两个纯查询方法，**玩家侧尚未接入**（二维 `wallSlotMap` 还没进 `update()`）。本报告**不构成版本验收**，不得据此宣称版本已交付或已通过。

- 验收人：验牌（测试），数据来自三维执行的三轮全量，**逐份读盘独立核验**（非采信自述）
- 时间：2026-11-08
- 被测对象：`assets\table3d\table3d.js` `DC220FF6B1CD8581`（48561B），改前基线 `AA4636791C15CBFC`（47023B）

## 1. 结论

| 项 | 结果 |
|---|---|
| 在 `table3d.js=DC220FF6` 上全量 `--browser` 连跑 3 轮 | **三轮全绿**（每轮 31/31、`ok:false` 0、收尾句在、Node 109、五指纹未变） |
| **1b 无回归** | **成立**（仅限 `DC220FF6`，旧基线 `AA463679` 的稳定性结论**不继承**） |
| `drawCalls` 门槛 | **保留未动**；1b 为纯查询、不改渲染批次，本轮无上涨 |
| `syncTable3D` p95 | **未取得**（缺 `?perf=1` 探针），不写成通过 |
| 真机（手机 GPU/触屏） | **未取得** |
| v55 版本 | **未升**，`BUILD` 仍为 `v54` |

## 2. 被测改动内容

在 `table3d.js` 的 `return { ... }` 中新增两个方法，写法参照 `tileDragTarget()`：

```js
wallSlotAt(index)   // → { physical, seat, pos, column, layer, upper }，无 kind（不传牌种）
wallSlotCount()     // → 108
```

- 纯查询、O(1)、**不触发 `schedule()`**，不改渲染结构；
- `index` 是**可视槽下标**（0..107）；内部按 `((index + startSlot) % 108)` 还原物理槽后再反查；
- 读取 `snapshot?.opening`：无 snapshot 时 `startSlot` 按 0 处理（写单测时不可据此断言 startSlot 分支）。

## 3. 三轮全量实测（同一份 `table3d.js`）

| 轮 | 日志 | 运行/完成/`ok:false`/收尾句 | Node | 首/尾句 | 五指纹 |
|---|---|---|---|---|---|
| r1 | `out\v55-1b-full-browser.log` 88482B（03:02:50） | 31/31/0/1 | 109·109·0 | ✓/✓ | 5/5 未变 |
| r2 | `out\v55-1b-r2.log` 88448B（03:06:17） | 31/31/0/1 | 109·109·0 | ✓/✓ | 5/5 未变 |
| r3 | `out\v55-1b-r3.log` 88448B（03:09:34） | 31/31/0/1 | 109·109·0 | ✓/✓ | 5/5 未变 |

三份日志各有 25 条浏览器组 `ok` 结果行，**`ok:false` 0 条**。

五指纹（三轮全程）：
```
index.html                  B6CB0B0F4D6DE367
assets\table3d\table3d.js   DC220FF6B1CD8581   ← 1b 新版
tests\run-checks.js         0FC90B20DEAACF33
tests\table-3d-ui.html      1DDD1439743EB6F0
tests\pages-compat.js       E372C4F1C392A8AD
```

## 4. 耗时观察（`table-3d-ui` 抖动排查）

Chief 关注该组是否被拖慢，逐轮从日志读出：

```
table-3d-ui      r1=42s   r2=36s   r3=35s    （基线 AA463679 时 36s）
table-3d-drag    r1=16s   r2=16s   r3=16s
river-hover-ui   r1=3s    r2=3s    r3=3s
tile-legibility  r1=2s    r2=2s    r3=1s
```

**结论：42s 是单次噪声，不是递增趋势**——r2、r3 回到 36s/35s，与基线持平。1b 是纯查询、不在渲染帧内，数据与实现相符。

## 5. 未验范围

- **真机（真实手机 GPU / 触屏）未验**：本报告全部数据来自本机 headless + swiftshader。
- **`syncTable3D` p95 未取得**：需要 `?perf=1` 探针（改 `index.html`），本轮未做，**不写成通过**。
- **玩家侧接入未做**：`wallSlotMap` 尚未进入 `update()`，因此本报告不代表任何用户可感知的变化。
- 版本未升：`BUILD='v54'`、`sw.js CACHE='zmj-v54'`。升 v55 将与「接入」同一次完成，届时需按新 `index.html` 哈希重新登记验收基线。
