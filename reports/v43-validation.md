# v43 验证：牌墙拖拽摸牌

日期：2026-11-07
范围：`index.html` 二维摸牌手势、`sw.js` 缓存、`tests/selection-ui.html`、`server.js` 版本
版本：`BUILD v43`、`CACHE zmj-v43`、`/healthz build v43`。未推送、未部署。

## 验收

- [x] 轮到自己时，按住中央「牌墙 N 张 · 摸牌」拖动会生成牌背影子。
- [x] 靠近手牌列时手牌列亮起金色落点；在手牌列上松手完成摸牌，第 14 张翻开。
- [x] 拖到别处松手取消，不会摸牌；点牌墙/「从牌墙摸牌」旧路径保留。
- [x] 桌面 1280×800 与手机 390×844 实跑：拖动中 `ghost=true`、`target=true`，松手后 14 张、按钮收起。
- [x] 不改变引擎、联机、3D 接牌逻辑。

## 实现摘要

- `#wallInfo` 增加 pointerdown/move/up：超过 8px 进入拖动，创建 `.draw-ghost` 牌背；`overRow()` 以手牌列矩形外扩 10/18px 作为落区；松手在落区调用 `acceptDrawnTile()`。
- 拖动后设置 `suppressClick`，避免松手合成的 click 再摸一次；`pointercancel` 清理影子与高亮。点击/键盘 Enter 的旧行为不变。
- CSS：`.tile.draw-ghost` 固定跟随、`#seat0 .handRow.draw-target` 金色落点、`#wallInfo.dragging` 手型。

## 测试

```text
node tests/pages-compat.js selection-ui      exit 0（新增 2 条牌墙拖拽断言；点按/拖拽出牌无回归）
node tests/no-build-check.js                 exit 0（zmj-v43、3 内联、0 外链）
node --test tests/offline.test.js            exit 0（3 项）
node tests/run-checks.js                     exit 0（101 Node + 9/16/10 服务端）
node tests/run-checks.js --browser           exit 0（22 组，0 失败）
```

截图：

- `out/v43-wall-drag-desktop.png`（拖动中：牌背影子 + 手牌列金色落点）
- `out/v43-wall-drop-desktop.png`（松手后 14 张）
- `out/v43-wall-drag-mobile.png`（390×844 拖动中）

## 遗留

- 牌墙拖拽目前由 `selection-ui` 的真实指针断言覆盖，没有单独的整页流程。
- 长手牌拖墙时不会自动横向滚动手牌列。
