# v57 验收（简短版）

- 验收人：验牌 · 时间 2026-11-08
- 范围：v57 = v56 + 一处改动（`acceptDrawnTile()` 内加 1.5 秒 toast「本次第 N 次摸牌」+ 一段 CSS，取牌逻辑未动）
- 口径：用户要求“门禁不要压过开发”，故按 **单轮通过** 定版，**不追三轮**。

## 1. 结论

> 在 `index.html=93786AA6EFCA4807`（600133B）、`sw.js=DDA93FCAB680F206`（zmj-v57）、`server.js=80A07A42E4C55B4B`（build:'v57'）、`tests\run-checks.js=485194EC2B7D0E1C`、`assets\table3d\table3d.js=DC220FF6B1CD8581` 这套文件上，全量 `--browser` 单轮全绿、Node `pass 118 / fail 0`，**v57 定为内测可用版**。

**必须一并写清的六句（缺一即失真）**：

1. **首轮 `r1` 曾红**：`out\v57-r1.log` 52310B / 03:45:22 / 运行 7 完成 6 / 中断在第 7 组 `table-3d-ui`，日志不完整，**不算一次全量**。
2. **现场签名与 v54 老偶发一致**：`machinePhase="deal"`、`dealCounts="8,4,4,4"`、`phases=[shuffle,lift,await-roll,dice,deal]`、`errors:["等待超时"]`。
3. **单跑 10/10 绿**：`out\v57-occ\run01..run06.log`（各 2801B）+ 后续各次，`table-3d-ui` 单组连续全绿。
4. **根因未定位**。
5. **不得写「v57 稳定」**；正确措辞是「单轮通过，但存在低频满载偶发，未定位」。
6. 计数：`r1` 记失败；`r1b` 通过（=新一串第 1 轮）；**r2/r3 按用户指示停止，未跑**。

## 2. 通过轮次数据

```
out\v57-r1b.log  90630B  03:54:10  已停写
运行 31 / 完成 31 / ok:false 0 / 收尾句「全部检查通过。」1
TAP：# tests 118 / # pass 118 / # fail 0
table-3d-ui      {"ok":true,"errors":[],48 条 steps 全过}
browser-online   {"ok":true,"errors":[],"结论：通过"}
```
（`90630B` 与 v56 的 r1 同大小，佐证 v57 只多了 toast 与 CSS。）

## 3. 五指纹（r1b 全程未变）

```
index.html                93786AA6EFCA4807
sw.js                     DDA93FCAB680F206   zmj-v57
server.js                 80A07A42E4C55B4B   build:'v57'
tests\run-checks.js       485194EC2B7D0E1C
assets\table3d\table3d.js DC220FF6B1CD8581
```
四处版本链：`?build=v57` / `BUILD='v57'` / `zmj-v57` / `build:'v57'`。

## 4. 不能说 / 未做

1. **真机未验**（升版后先清缓存）。
2. **`syncTable3D` p95 未取得**（无 `?perf=1` 探针）。
3. **toast 截图未取得**——未在真实画面里确认过「第 1 次 → 第 2 次」两张中间帧；**用户试玩反馈比截图更权威**。
4. **旧基线一律不继承**（`B6CB0B0F`/`752F7D89`/`0FC90B20` 等）。
5. 回退点：`1678678`（v56 代码 + 完整缺陷记录）。v57 若出问题退此提交。

## 5. 门禁策略调整（依用户指示）

- 每版只跑 **一次 Node + 一次全量**；不再默认三轮、不再默认 10 次单跑；
- 纯 `assets\table3d\table3d.js` 改动只跑三维 4 组（`table-3d-ui` / `table-3d-drag` / `tile-legibility-ui` / `river-hover-ui`）；
- 只有真出现红灯才做满量对照。
