'use strict';
/**
 * v56 阶段二 2b：「本次第 N 次摸牌」口径的 node 断言（Chief 定的公式，不靠人眼看截图）
 *
 * 公式：本局第 N 次摸牌 = max(1, (head - head0) + tail)
 *   head0 = 发牌完成后 wallDraws.head 的初值，在 createHand 里随 wallDraws 写入，渲染处不硬编码 52
 *   墙头摸牌 head 递增；杠补尾摸 tail 递增（drawFor 已先 tail++），两者共用同一口径
 *   下限 1：还没摸过牌时不该显示「第 0 次」
 *
 * 背景：2b 首版把墙头写成固定 0（永远"第 1 张"），aria-label 另有一份同样的错；
 * 这类"可视化文案"逻辑当时门禁抓不到，只能靠人看截图，而人看截图正好会挑到对的那一次。
 * 另：本文件必须登记在 tests/run-checks.js 的 --test 清单里，否则全量门禁不会执行它。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('(function (root, factory) {');
const end = html.indexOf('</script>', start);
assert.ok(start >= 0 && end > start, 'inline core must be present');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(html.slice(start, end), sandbox, { filename: 'mahjong-core.js' });
const ZMJ = sandbox.module.exports;

const H = (head, head0, tail) => ({ wallDraws: { head, head0, tail }, gangDraw: tail > 0 });

test('drawNthOf 已导出（界面与门禁共用同一个函数）', () => {
  assert.equal(typeof ZMJ.drawNthOf, 'function', 'ZMJ.drawNthOf 必须挂到导出上');
});

test('未摸过牌时 = 1（有下限，不显示第 0 次）', () => {
  assert.equal(ZMJ.drawNthOf(H(52, 52, 0)), 1);
});

test('首摸后 = 1（head 已由 52 增到 53）', () => {
  assert.equal(ZMJ.drawNthOf(H(53, 52, 0)), 1);
});

test('第二摸 = 2', () => {
  assert.equal(ZMJ.drawNthOf(H(54, 52, 0)), 2);
});

test('头摸十次后杠补 = 11（头尾同一口径，不是只数尾部）', () => {
  assert.equal(ZMJ.drawNthOf(H(62, 52, 1)), 11);
});

test('杠补不能只数尾部（回归防线）', () => {
  assert.notEqual(ZMJ.drawNthOf(H(62, 52, 1)), 1, '旧口径只看 tail 会得 1，必须不同');
});

test('head0 才是基准，不写死 52（发牌规则若变也跟得上）', () => {
  assert.equal(ZMJ.drawNthOf(H(61, 60, 0)), 1, 'head0=60 时首摸应为 1');
  assert.equal(ZMJ.drawNthOf(H(62, 60, 0)), 2);
});

test('createHand 写入 head0，且等于发牌后的 head 初值', () => {
  assert.match(html, /wallDraws:\s*\{\s*head:\s*52,\s*head0:\s*52,\s*tail:\s*0\s*\}/,
    'createHand 必须在 wallDraws 里写入 head0');
});

test('缺字段时不抛错', () => {
  assert.equal(ZMJ.drawNthOf({}), 1);
  assert.equal(ZMJ.drawNthOf(null), 1);
  assert.equal(ZMJ.drawNthOf({ wallDraws: {} }), 1);
});
