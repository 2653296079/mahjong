# v52 验收报告：三维拖牌改用真实牌模 + 门禁回归

- 验收人：验牌（测试）
- 时间：2026-11-07
- 代码版本：`index.html:7514 var BUILD='v52'`、`sw.js:3 CACHE='zmj-v52'`、`index.html:3212` 动态导入 `assets/table3d/table3d.js?build=v52` —— 三者一致
- 被测改动：`index.html:3139/3142` 三维拖牌走场景真实牌模（`tileDrag*`），不再生成二维 `.drag-ghost`；判定点在 `index.html:5133 table3D.api.tileDragTarget()`

## 1. 结论

| 项 | 结果 |
|---|---|
| `table-3d-drag` 单跑 | **通过**，17 条断言全绿，耗时 15.1s |
| `table-3d-ui` 单跑 | **通过**，45 条断言全绿，耗时 32.4s（未超时） |
| 全量 `--browser` | **未跑完即中止**：清单 24 组浏览器检查，实际只跑到第 17 位（浏览器第 11 位）`tile-legibility-ui` 就红退，**后面 13 组根本没跑**（见 §2.1） |
| v52 自身的三维改动 | **无不稳定、无回归**：三次跑（单跑 + 全量）断言值完全一致 |
| 版本链 | BUILD / sw CACHE / ?build= 全部 v52，一致 |

## 2. 跑过的命令与耗时

```powershell
cd D:\mahjong\repo
# 1) 三组单跑
node tests/pages-compat.js tile-legibility-ui   # 1.7s
node tests/pages-compat.js table-3d-drag        # 15.1s
node tests/pages-compat.js table-3d-ui          # 32.4s

# 2) Node 组
node tests/run-checks.js                        # 全部检查通过，6 组

# 3) 全量（Node + 浏览器）
node tests/run-checks.js --browser
```

全量逐组耗时（`out\v52-full-browser.log`）：

| 组 | 耗时 |
|---|---|
| `node --test`（101 条） | 29s |
| `server/test-ws.js`（9 条） | 1s |
| `server/test-rooms.js`（16 条） | 1s |
| `server/test-online.js`（10 条） | 5s |
| `tests/no-build-check.js` | 0s |
| `tests/smoke-server.js` | 3s |
| `pages-compat table-3d-ui` | **32s** |
| `pages-compat table-3d-drag` | **15s** |
| `pages-compat persona-ui` | 3s |
| `pages-compat audio-ui` | 15s |
| `pages-compat account-ui --accounts` | 4s |
| `pages-compat connection-ui --accounts` | 2s |
| `pages-compat table-layout` | 2s |
| `pages-compat river-hover-ui` | 3s |
| `pages-compat hand-sort-ui` | 2s |
| `pages-compat mobile-ui` | 2s |
| `pages-compat tile-legibility-ui` | **失败退出（红）** |

- 全量总耗时：**120.2s**，`FULL_EXIT=1`
- 全量期间 `index.html` SHA256 前后一致：`B09D7B63829993338680CAC50CEC830687101E63F5D7D125D49213E47B977F5F`（跑门禁时没人动产品文件）
- `table-3d-ui` 全量 32s / 单跑 32.4s，**不是超时问题**，无需按「先单跑再判」兜底

### 2.1 重要更正：全量是「熔断」，不是「跑完」

`run-checks.js:36-39` 任一组非零即 `process.exit`。日志实测：`运行 node` 行 17 个、`完成（` 行 16 个，没有一个 `完成（` 跟着 `tile-legibility-ui`——**它在第 17 位失败后门禁当场中断**。

清单里浏览器部分共 **25 组**（Node 6 组 + 浏览器 25 组），`tile-legibility-ui` 排在浏览器第 11 位，**它后面还有 14 组本轮一次都没跑，不能算通过**：

```
visual-ui / training-ui / training-release / lesson-ui / settlement-ui /
selection-ui / online-response --hub / worker-ui --hub / coach-advice /
reconnect --hub / atmosphere-ui / music-ui / pages-compat 默认页 / browser-online
```

（查询命令：读 `tests/run-checks.js` 中 `['tests/pages-compat.js'…]` 与 `['tests/browser-online.js']` 两行，按数组位置切片，`tile-legibility-ui` 索引 10，其后 14 项。）

之前说「17 组 16 过 1 红」容易被读成「全量跑完了」，特此更正：**发布前必须重跑一次完整全量。**

## 3. v52 断言与实际数值（`table-3d-drag`，17 条原文）

```
二维摸牌后手牌 14 张
二维摸牌后切三维，同一手牌层可操作
三维点击层拿到可拖拽手牌
三维拖动时由场景里的真实牌模跟手（tileDrag=5:0）
拖到手牌上方时出现插入槽（tileInsert=14:0:b）
三维拖动不再生成二维牌图片
手牌区按拖动不点亮牌河
三维松手后手牌顺序按插入槽重排
被拖的牌按插入槽落在目标牌 左侧
理牌松手不出牌
松手后清空插入槽状态
三维拖到中央时舞台亮起落点
三维拖向牌河时仍是场景牌模跟手
离开手牌后插入槽收起
三维拖向牌河也不生成二维牌图片
三维松手后这张牌真正进入牌河
三维出牌后清除落点高亮
```

关键读数：
- `tileDrag=5:0` —— 场景数据集里确实挂着被拖牌 id，符合「真实牌模跟手」
- `tileInsert=14:0:b` —— 插入槽落在第 14 位之前（b=before）
- `document.querySelector('.drag-ghost') === null`，两次（理牌 / 出牌路径）都成立

静态核对：`index.html:824` 的 `.tile.drag-ghost` 规则与 `index.html:3142` 的 `tileEl(..., 'drag-ghost')` 仅剩旧路径代码，三维分支（`index.html:5133`）已改走 `table3D.api.tileDragTarget()`，与断言一致。

## 4. v52 相关回归（`table-3d-ui`，45 条全绿，摘关键几条）

| 断言 | 实际 |
|---|---|
| 真实 WebGL 牌桌及 GLB 载入完成 | 31 个 GLB |
| 3D 牌桌四座胶囊都有程序化头像 | 4 |
| 3D 头像尺寸在 17–27px 档位 | 通过 |
| 3D 下关闭头像即时归零 | 0 |
| 3D 下重新开启即时恢复 | 4（不是 3） |
| 原牌局的 14 张手牌与三维画面一致 | 14 |
| 其余三家只显示暗牌张数，不传入暗牌牌种 | 通过 |
| 抓牌途中与落手后使用自己的真实牌面模型 | 通过 |
| 390×844 / 844×390 / 1366×768 点击区在画面内 | 三档全通过 |

## 5. 取证截图

| 文件 | 内容 | 依据 |
|---|---|---|
| `out\v52-3d-drag-mid.png` | 1366×860 三维拖牌**中帧**：六萬被抬起，相邻牌让开插入槽 | 顶部读数 `tileDrag=5:0 tileInsert=14:0:b 二维ghost=无` |

用带指针模拟的临时抓帧页复刻 `table-3d-drag.html` 的拖动序列并停在中帧截图（抓帧页用完即删，未进仓库）。

## 6. 未验 / 遗留

- 三维拖拽**中帧截图**：已补，见上表 `out\v52-3d-drag-mid.png`。
- 真机 GPU、多人同桌 3D 流畅度、拖拽 38px 抬升与震动：**未验**（无真机）。
- 长牌河 / 多副露 3D 帧率记录：未做。
- 全量曾出现「首组无输出」的历史偶发本轮**未复现**。

## 7. 门禁状态一句话

v52 自身改动（真实牌模拖牌）**验过、全绿、无反例**；但整个 v52 版本**不能判为全绿发布**，因为新入清单的 v51 用例 `tile-legibility-ui` 是红的（7/10 失败），阻塞方是 `index.html:887` 的选中放大与测试测量时序，交码仔。
