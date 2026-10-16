# 联机服务配置

需要 Node.js 22 或更高版本，无第三方依赖。项目根目录运行 `node server.js 8000`。默认监听 `0.0.0.0`，同时提供页面和 `/ws`。GitHub Pages 只能提供静态前端。

## 限制与健康检查

| 项目 | 默认值 | 配置方式 |
| --- | --- | --- |
| 监听地址 | `0.0.0.0` | `MAHJONG_HOST` |
| WebSocket 会话总数 | 128 | `MAHJONG_MAX_SESSIONS` |
| 内存房间总数 | 64 | `MAHJONG_MAX_ROOMS` |
| 每连接指令补充速度 | 每秒 20 条 | `MAHJONG_MESSAGE_RATE` |
| 每连接突发额度 | 60 条 | `MAHJONG_MESSAGE_BURST` |
| 单条／分片合计输入消息 | 16 KiB | `attach(server, {limits:{maxMessageBytes:…}})` |
| 每连接待发送数据积压 | 1 MiB | `attach(server, {limits:{maxPendingBytes:…}})` |

数字配置必须为 1–16777216 的整数，错误配置会使启动失败。达到会话上限时握手返回 HTTP 503；消息超限关闭码 1009，频率或接收积压超限关闭码 1008。应用只接受文本指令，二进制消息关闭码 1003。满房切换失败会保留玩家的原房间。

`GET /healthz` 或 `HEAD /healthz` 返回 200；JSON 包含规则、分析器、题库版本和会话／房间／玩家汇总，不含手牌、姓名或令牌。它只说明 HTTP 进程可响应，不证明整局联机、外网可达或容量达标。检查示例：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/healthz
```

## HTTPS 代理示例

同目录的 [Caddyfile.example](Caddyfile.example) 需要把示例域名换成自己的域名。Node 只监听回环地址，再由代理对外提供页面和 WebSocket。Caddy 的 `reverse_proxy` 支持 WebSocket 升级，域名与证书签发条件满足时可自动管理 HTTPS，参见官方 [反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) 和 [自动 HTTPS](https://caddyserver.com/docs/automatic-https) 文档。

PowerShell 启动 Node 示例：

```powershell
$env:MAHJONG_HOST='127.0.0.1'
$env:MAHJONG_MAX_SESSIONS='128'
$env:MAHJONG_MAX_ROOMS='64'
node server.js 8000
```

模板未安装或启动 Caddy，也未替用户创建域名、证书或公网服务。实际部署后，应从另一网络验证 HTTPS 页面、WSS 同桌、邀请、断线重连、健康检查和超限恢复。进程管理交给主机的服务管理器；收到 SIGINT／SIGTERM 后服务会关闭连接并退出，最长等待约 5 秒。

房间只在内存中；重启会丢失进行中的牌局。默认每人每手超时 60 秒后托管，终局约 30 秒后自动下一局，也允许玩家提前继续。终局才下发四家剩余手牌。上述上限是保护边界，尚无真实公网压力数据，不表示可稳定承载 128 位活跃玩家，也未实现按 IP 限制或分布式防护。

## 线路与资源诊断

文本资源在浏览器接受 gzip 时压缩，响应带 `Vary: Accept-Encoding`，图片保持原编码。反向代理应保留正常的编码协商与 WebSocket 升级；本仓库的 Caddy 示例尚未实际部署验收。

可运行 `node evaluation/check-connection.js https://域名:端口 --out reports/connection.json`，记录 HTTP 与连续 WebSocket ping。它不入房、不发游戏动作，不需要访问密钥；默认维持证书和主机名校验。旧的 `node tests/check-tunnel.js` 使用同一个只读流程。自签名诊断与本次真实样本见 [排查记录](../联机响应排查.md)。
