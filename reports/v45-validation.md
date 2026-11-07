# v45 验证：二维落桌闷响

日期：2026-11-07
范围：`index.html` 音效表与二维牌河触发、`sw.js` 缓存、`server.js` 版本
版本：`BUILD v45`、`CACHE zmj-v45`、`/healthz build v45`。未推送、未部署。

## 验收

- [x] 二维新牌进河约 150ms 后触发 `land`，与 `discard` 点击声分层。
- [x] 程序合成，无音频文件；走既有「音效」总开关和页面隐藏判断。
- [x] 三维不额外加这一层。
- [x] 不改变出牌时机、牌局状态或联机协议。

## 实现摘要

- `SFX_KINDS` 增 `land`；`sfx()` 的 `land` = 760Hz 噪声冲击 + 150Hz 正弦短闷响；`SFX_PRIORITY` 增 `land:2`。
- `renderRiver()` 在二维 impact 分支 `setTimeout(function(){sfx('land');},150)`。
- 关闭音效、页面隐藏或没有 AudioContext 时 `sfx()` 直接返回，不抛错。

## 测试

```text
node --test tests/audio.test.js              exit 0（land 已接线；种类 ≥10）
node tests/pages-compat.js audio-ui          exit 0
node tests/pages-compat.js selection-ui      exit 0
node tests/no-build-check.js                 exit 0（zmj-v45、3 内联、0 外链）
node --test tests/offline.test.js            exit 0（3 项）
node tests/run-checks.js                     exit 0（101 Node + 9/16/10 服务端）
node tests/run-checks.js --browser           exit 0（22 组，0 失败）
```

## 说明

- 无新增视觉截图；落桌动画沿用 v44 的 `out/v44-impact-desktop.png` / `out/v44-impact-mobile.png`。
- 闷响音量与点击声的平衡尚未按真机扬声器细调。
