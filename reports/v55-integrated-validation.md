# v55 验收报告：牌墙槽位映射接入 + 版本链升 v55

- 验收人：验牌（测试）
- 时间：2026-11-08
- 产品版本：**`v55`**（`BUILD='v55'`、`?build=v55`、`sw.js CACHE='zmj-v55'`、`server.js build:'v55'` 四处一致）
- 本报告依据：盘上日志逐份读盘核验，**不采信任何人的自述**

## 1. 结论

| 项 | 结果 |
|---|---|
| 全量 `--browser` 在 v55 上连跑 3 轮 | **三轮全绿**（每轮 31/31、`ok:false` 0、收尾句在、Node 109、八指纹零变化） |
| **v55 无回归** | **成立**（仅限 `index.html=752F7D893…` + `table3d.js=DC220FF6…` 这一套文件） |
| 版本链四处 | **一致**：`?build=v55`(3213) / `BUILD='v55'`(7538) / `zmj-v55` / `build:'v55'` |
| `table-3d-ui` 耗时 | 三轮 34s / 35s / 34s，**未变慢** |
| 真机（手机 GPU/触屏） | **未取得** |
| `syncTable3D` p95 | **未取得**（无 `?perf=1` 探针） |
| 玩家侧是否真正用上 | **部分**：`wallSlotMap` 已进 `update()` 载荷；抓牌交互（2b/2c/2d）未做 |

## 2. 本轮改动

1. **接入**：`wallSlotMap` 接入 `update()`，带缓存键 `round+handNo+head+tail+wallCount`（`map[i]=52+i` 直接作为可视槽下标传入 `wallSlotAt`，不再二次旋转）。
2. **四处版本链同升 v55**：`index.html:3213 ?build=v55`、`index.html:7538 BUILD='v55'`、`sw.js:3 CACHE='zmj-v55'`、`server.js:59 build:'v55'`。
3. **三维侧接口未变**：`table3d.js` 仍为 `DC220FF6B1CD8581`（48561B），`wallSlotAt`/`wallSlotCount` 原样。

## 3. 三轮全量实测

| 轮 | 日志 | 运行/完成/`ok:false`/收尾句 | Node | 首/尾句 | 浏览器组 |
|---|---|---|---|---|---|
| r1 | `out\v55-integrated-r1.log` 88432B（03:14:50） | 31/31/0/1 | pass 109 | ✓/✓ | 全部 `ok:true` |
| r2 | `out\v55-integrated-r2.log` 88436B（03:18:05） | 31/31/0/1 | pass 109 | ✓/✓ | 全部 `ok:true` |
| r3 | `out\v55-integrated-r3.log` 88436B（03:21:17） | 31/31/0/1 | pass 109 | ✓/✓ | 全部 `ok:true` |

> 日志路径为本机 `out\`，**不入库**；关键数字已内嵌本报告正文。

三轮 `table-3d-ui` 耗时：**34s / 35s / 34s**（1b 期为 42/36/35，更早基线 36s）——接入未带来性能退化。

## 4. 八指纹（三轮全程零变化）

| 文件 | SHA256 前 8 位 | 大小 |
|---|---|---|
| `index.html` | `752F7D89` | 596602B |
| `sw.js` | `212DDC60` | 2453B |
| `server.js` | `9D99572C` | 6574B |
| `assets\table3d\table3d.js` | `DC220FF6` | 48561B |
| `tests\run-checks.js` | `0FC90B20` | 6333B |
| `tests\table-3d-ui.html` | `1DDD1439` | 12846B |
| `tests\pages-compat.js` | `E372C4F1` | 5465B |
| `tests\wall-slot-map.test.js` | `660CAF91` | 4490B |

跑完最终复核：**指纹变化数 = 0**。

## 5. 编码完整性取证（BOM 经过，写它是为了让哈希可解释）

改动过程中发生过一次偏差：**`index.html` / `sw.js` / `server.js` 三份文件的 BOM 曾被洗掉**（编辑工具所致），随后以字节方式补回。这不是功能问题，但会让哈希多出无关变化，因此逐项取证：

- **BOM 状态**：三份均 `BOM=True`（与改动前一致）；`table3d.js` 原本无 BOM，未变。
- **换行未被重写**：三份均 `CRLF=0`、全 LF（`index.html` 7710 行、`sw.js` 43、`server.js` 123）。
- **`sw.js` 与 git HEAD(v54) 逐字节比对**：两者均 2453B、`BOM=True`，**字节差异位置数 = 1**（第 200 字节，`ACHE = 'zmj-v54` → `ACHE = 'zmj-v55`）。即除版本号那 1 个字节外，长度、BOM、换行、其余字节完全一致——**这趟来回未留下痕迹**。
- **`server.js`**：6574B，与改动前尺寸一致，仅第 59 行版本号变化。
- **`index.html`**：595415B → 596602B（**+1187B**），与新增的 `wallSlotMap` + memo + 调用 + 版本号字符量级相符，非整体重编码。

## 6. 可以说 / 不可以说

**可以说**：在 `index.html=752F7D893…`（596602B）、`table3d.js=DC220FF6…`（48561B）、`sw.js zmj-v55`、`server.js build:'v55'` 这一套文件上，全量 `--browser` 连续 3 轮全绿，**v55 无回归成立**。

**不可以说**：
- 真机未验——**升版后真机验收前必须先清缓存**，否则验的是旧模块；
- `syncTable3D` p95 仍为「未取得」；
- **玩家侧还没有真正用上 `wallSlotMap`**：它只是进了 `update()` 的载荷，抓牌交互（阶段二 2b/2c/2d）未做；
- 旧基线（`index.html=B6CB0B0F…`、`sw.js 217055BF…`、`server.js 3BBADC5B…`）的结论**不继承**（硬规矩第 1 条）。

## 7. 引用约定

- 1b 的中间验收见 `reports\v55-1b-validation.md`，**引用时只能带「仅限 `DC220FF6`、玩家侧未接入」**，不得当版本验收。
- 版本级验收以本报告为准。
