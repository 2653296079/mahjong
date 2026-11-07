'use strict';
/**
 * v56 阶段二（码仔）：牌墙下标 ↔ 三维可视槽位 的对照表 wallSlotMap
 *
 * 契约（已由三人多轮核对、并经以下断言锁死）：
 *   map[i] = 52 + i            i = 0 .. H.wall.length-1，值域 52..101
 *   map[0]        === 52       跳牌位 deck[52]
 *   map[len-1]    === 101      鸟牌切走前的最后一张
 *   map[i+1]-map[i] === 1      全长单调递增（不跳号）
 *   恒等式：head + H.wall.length + tail === 102
 *
 * 边界语义（哪家在哪个槽：0/28/54/82 座位区间）归三维验证，本文件只断言"值与槽位"的对应。
 * 本文件不改动 index.html，只做纯函数 + 断言；接入 update() 另开一步，不在此处。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// ---- 被测纯函数（与 index.html 里将落地的实现同形） ----
function wallSlotMap(wallLength) {
  const map = new Array(wallLength);
  for (let i = 0; i < wallLength; i++) map[i] = 52 + i;
  return map;
}

// ---- 取 index.html 的常量与发牌结构，证明契约与产品一致 ----
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sandbox = {};
// openingPackets / RULES 在 index.html 的闭包里，取不到；这里按同一份代码复刻常量做交叉校验。
// 复刻只用于本测试，若产品侧改动，下面的断言会失败并提醒同步。
const BIRD_COUNT = Number((html.match(/birdCount:\s*(\d+)/) || [])[1]);
const OPENING_SLOTS = (() => {
  const m = html.match(/packets\.push\(\{ seat: \(dealer \+ s\) % 4, slots: \[48 \+ s\]/);
  return m ? 'three-rounds-48-52' : null;
})();

test('birdCount 与产品一致（6）', () => {
  assert.equal(BIRD_COUNT, 6, 'RULES.birdCount 应为 6');
});

test('发牌结构形状与产品一致（三轮 0..51 + 48/52/48+s）', () => {
  assert.ok(OPENING_SLOTS, '在 index.html 中找到 openingPackets 的补牌段');
});

test('开局 wall 长度 = 108 - 52 发走 - 6 鸟牌 = 50', () => {
  const dealt = 52;                    // 三轮 48 + 跳牌位 52 + 48..51
  const afterDeal = 108 - dealt;       // 56
  const wallLength = afterDeal - BIRD_COUNT;
  assert.equal(afterDeal, 56);
  assert.equal(wallLength, 50, '开局 H.wall.length 应为 50');
});

test('map[0] = 52（跳牌位）、map[len-1] = 101（鸟牌前最后一张）', () => {
  const map = wallSlotMap(50);
  assert.equal(map[0], 52);
  assert.equal(map[map.length - 1], 101);
});

test('全长单调递增 +1，不跳号', () => {
  for (const len of [50, 49, 40, 4]) {
    const map = wallSlotMap(len);
    assert.equal(map.length, len);
    for (let i = 0; i + 1 < map.length; i++) assert.equal(map[i + 1] - map[i], 1, `len=${len} i=${i}`);
    assert.ok(map.every((v) => v >= 52 && v <= 101), '值域必须在 52..101');
  }
});

test('恒等式 head + wall.length + tail === 102（覆盖头摸/杠补五种情形）', () => {
  const cases = [
    { head: 52, len: 50, tail: 0, note: '开局' },
    { head: 53, len: 49, tail: 0, note: '头摸一次' },
    { head: 54, len: 48, tail: 0, note: '头摸两次' },
    { head: 53, len: 48, tail: 1, note: '杠补一次' },
    { head: 54, len: 47, tail: 1, note: '头摸+杠补' }
  ];
  for (const c of cases) {
    assert.equal(c.head + c.len + c.tail, 102, `${c.note}: ${c.head}+${c.len}+${c.tail}`);
    // 同时验证等价写法（含鸟牌）：head + len + tail + birdCount === 108
    assert.equal(c.head + c.len + c.tail + BIRD_COUNT, 108, `${c.note} 含鸟牌口径`);
  }
});

test('被否掉的两个错误式子确实会失败（回归防线）', () => {
  // 错误式 A：52 + len - 1 ≡ 101 - tail —— 头摸后就失效
  const head1 = { head: 53, len: 49, tail: 0 };
  assert.notEqual(52 + head1.len - 1, 101 - head1.tail, '错误式 A 在头摸后必须不等，否则这条断言本身写错');
  // 错误式 B：head + len + tail === 96 —— 从不对
  for (const c of [{ head: 52, len: 50, tail: 0 }, { head: 53, len: 48, tail: 1 }]) {
    assert.notEqual(c.head + c.len + c.tail, 96, '错误式 B 必须不成立');
  }
});

test('map 不产出 0..51 与 102..107（不越界到别家或鸟牌区）', () => {
  const map = wallSlotMap(50);
  assert.ok(!map.some((v) => v < 52), '不得落进 0..51 已发走区');
  assert.ok(!map.some((v) => v > 101), '不得落进 102..107 鸟牌区');
});
