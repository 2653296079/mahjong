# v58 自测记录（实施方自测，非验收报告）：牌墙拾取接口 `pickWallSlot`

落笔：三维。**本文件不是验收报告**，验收以 `reports\v58-validation.md`（验牌落笔）为准。

## 1. 交付内容

`assets\table3d\table3d.js`，唯一改动文件，**全程冻结未动**：

```
51760B   BOM=False   SHA256 = DE04C30DB5FA8AFE…   改时 03:57:16
```

新增两个对外只读接口（挂在 `table3D.api` 的返回对象上，与 `tileDragTarget()` 并列）：

| 接口 | 作用 |
|---|---|
| `pickWallSlot(clientX, clientY)` | 射线拾取牌墙牌背，返回 `{ instanceId, segment, wallIndex, legal, slot }`，**纯数字，不含牌种** |
| `wallSlotCount()` | 返回槽位总数 `108` |

（`wallSlotAt(index)` / `wallSlotInfo()` 是 v55/1b 已有，本版未改。）

## 2. 五条边界逐条落实（附行号）

```
:806  if (host.dataset.machineBusy !== '0') return null;        ⑤ 演出期间不可拾取
:822  const mainCount = Math.max(0, 102 - tail - head);         实例下标 → 墙下标换算
:828  const legal = segment === 'main' && (fromTail
        ? (tail > 0 && wallIndex === 101 - tail)                ① 杠补只许墙尾
        : instanceId === 0);                                    ① 平时只许墙头
:843  if (drag.moved < 8 || overview) return;                   ④ <8px 才算点击（不转视角）
:850  if (drag && drag.moved < 8 && event && event.clientX != null) {
:852  if (slot) callbacks.onWallPick?.(slot);                    只报槽号，不决定拿哪张
```

| # | 边界 | 落实方式 |
|---|---|---|
| ① | 只有合法槽可抽 | `legal` 按 `snapshot.gangDraw` 分方向：杠补只许 `101 - tail`，否则只许 `instanceId === 0` |
| ② | 鸟牌区（`segment === 'birds'`）可拾取但一律无效 | 该段 `wallIndex = null`、`legal = false` |
| ③ | 无效点击不给"最近槽"提示 | 返回结构里没有任何"最近槽"概念，只有点中那个实例的信息 |
| ④ | `pointerDown` 已被拖视角占用，<8px 才算点击 | `pointerMove` 累计 `moved`，`>= 8` 时既不转视角也不拾取 |
| ⑤ | 演出期间不可拾取 | `machineBusy !== '0'` 直接 `return null`；**待抽态无演出、`machineBusy` 恒 `'0'`，天然放行** |

## 3. 映射依据（已验证）

```js
// table3d.js:306-317 paintBacks()
306  function paintBacks(transforms) {
307    lastBacks = transforms;
310    transforms.slice(0, 160).forEach((pose, i) => { … 314: batch.setMatrixAt(i, matrix); });
```

`setMatrixAt(i, …)` 的 `i` 就是 `transforms` 的下标，因此 **`intersection.instanceId` = `paintBacks` 数组下标**。而数组 = `[主段 0..(102-tail-head-1)] + [尾部鸟牌区 6 张]`，故：

- `instanceId < mainCount` → 主段，墙下标 = `head + instanceId`；
- 否则 → 鸟牌区（`102..107`），不可抽。

`batch.count = Math.min(len, 160)`，牌墙最多 108 槽不会截断。`lastBacks` 在发牌动画期间逐帧被覆盖，这正是边界⑤存在的原因。

## 4. A 方案下三维侧为何无需改动

待抽态下引擎不执行 `drawFor`，`wallDraws.head` 不变，`wallRemainder()`（`:424` 的 `wall.slice(head, 102 - tail)`）的第 0 项就是该抽那张 → `legal` 的 `instanceId === 0` 自然命中。

**墙头那张是真的留在墙上，不是靠补假牌背顶着**——这是 A 优于 B+ 的根本原因。

## 5. 本次改动的适用范围（必须如实写）

- **只影响单机人类座位的抽牌时序**；联机、回放、AI、托管走原路；
- 三维侧**没有改取牌规则**：`H.wall` 的 `shift/pop` 一字未动，`pickWallSlot` 只回报槽号；
- **没有改动任何渲染结构**：牌背仍是 `InstancedMesh`，`drawCalls` 未增加；
- **没有改动任何测试文件**。

## 6. 未取得 / 未验证（不得写成通过）

1. **`syncTable3D` 单次 p95 未取得**——无 `?perf=1` 探针，未采样；
2. **`drawCalls` 门槛保留但本版未实测对比**——1b 与 v58 均未增加渲染对象，预期不涨，但没有本次的前后对照数据；
3. **真机未验**——GPU、触屏、多人同桌的实机表现均未测试；
4. **拾取在真实设备上的命中率未验**——<8px 阈值、牌背在触屏上的可点面积，都只在 headless 下验证过逻辑，**没有真手感数据**；
5. **`table-3d-ui` 历史满载偶发根因未定位**——与本版无直接关系，但结论里必须并列。

## 7. 验收归属

**v58 的唯一最终验收是用户亲手从牌墙抽出一张牌。** 本文件、门禁绿灯、单跑全绿，都不能替代那一步。

若用户试后仍认为"不真实"，按既定回退线退回 B（只保留 `onWallPick` 做翻开动画），并如实记录「A 尝试失败、已退 B」。
