'use strict';
// 保留旧入口，改用支持 HTTPS/WSS 的只读探针；不再加入或启动固定的 8888 房间。
require('../evaluation/check-connection').main(process.argv.slice(2));
