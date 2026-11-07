'use strict';
/**
 * personas.test.js —— 对手性格系统（默认关闭）的验收
 *
 * 金样来自 t4 实测冻结：默认 6 局牌谱签名 25be8c97；
 * 每个性格在 seed 2024、v2 三席、6 局下的 discardHash / 副露 / 和牌向量。
 * 性格只调倾向，不消耗牌墙 RNG、不改规则；默认（不传 personas）必须逐字保持原行为。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Z = require(path.join(__dirname, '..', 'server', 'rooms')).loadCore();

function fnv1a(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function runHands(G, hands) {
  G.fastForward = true;
  const out = [];
  for (let r = 0; r < hands; r++) {
    G.startHand();
    let steps = 0;
    while (!G.hand.over && steps++ < 800) {
      if (G.hasPendingResolve()) G.resolvePending();
      else if (!G.aiStep()) break;
    }
    out.push(steps);
  }
  return out;
}

function signature(opts) {
  const G = Z.createGame(Object.assign({ seed: 101, rotate: false }, opts || {}));
  const parts = [];
  G.fastForward = true;
  for (let r = 0; r < 6; r++) {
    G.startHand();
    let steps = 0;
    while (!G.hand.over && steps++ < 800) {
      if (G.hasPendingResolve()) G.resolvePending();
      else if (!G.aiStep()) break;
    }
    const events = (G.hand.record && G.hand.record.events) || [];
    parts.push('H' + r + ':' + events.map(function (e) {
      return [e.t, e.s, e.k, e.f == null ? '-' : e.f, e.y || '-'].join('.');
    }).join(';'));
    const res = G.lastResult || {};
    parts.push('R:' + [res.type, (res.winners || []).join('+'), res.loser == null ? '-' : res.loser,
      (res.birds || []).length].join(','));
  }
  return fnv1a(parts.join('|'));
}

function summary(opts) {
  const G = Z.createGame(Object.assign({ seed: 2024, rotate: false, aiStyleV2: [1, 2, 3] }, opts || {}));
  let peng = 0, gang = 0, zimo = 0, discardWins = 0, draws = 0, discardKinds = [];
  G.fastForward = true;
  for (let r = 0; r < 6; r++) {
    G.startHand();
    let steps = 0;
    while (!G.hand.over && steps++ < 800) {
      if (G.hasPendingResolve()) G.resolvePending();
      else if (!G.aiStep()) break;
    }
    const ev = (G.hand.record && G.hand.record.events) || [];
    ev.forEach(function (e) {
      if (e.t === 'p') peng++;
      if (e.t === 'g') gang++;
      if (e.t === 'x') discardKinds.push(e.k);
    });
    const res = G.lastResult || {};
    if (res.type === 'zimo') zimo++;
    else if (res.type === 'discard') discardWins++;
    else draws++;
  }
  return { discardHash: fnv1a(discardKinds.join(',')), peng, gang, zimo, discardWins, draws };
}

// 冻结的行为金样（seed 2024 / v2 三席 / 6 局）。改性格参数必须同步更新这里。
const EXPECTED = {
  neutral: { discardHash: 'a5a86648', peng: 19, gang: 2, zimo: 2, discardWins: 4, draws: 0 },
  steady:  { discardHash: '6c05696a', peng: 10, gang: 2, zimo: 2, discardWins: 4, draws: 0 },
  raider:  { discardHash: 'abfcef8a', peng: 31, gang: 1, zimo: 2, discardWins: 4, draws: 0 },
  turtle:  { discardHash: '7c26410b', peng: 19, gang: 3, zimo: 0, discardWins: 4, draws: 2 },
  gambler: { discardHash: 'db199446', peng: 32, gang: 2, zimo: 2, discardWins: 4, draws: 0 },
  mimic:   { discardHash: '7d6e378c', peng: 19, gang: 6, zimo: 2, discardWins: 4, draws: 0 },
  schemer: { discardHash: '19540db9', peng: 23, gang: 3, zimo: 2, discardWins: 3, draws: 1 }
};

test('六种性格：id/标签唯一，参数都在方案范围内', () => {
  assert.equal(Z.PERSONAS.length, 6);
  const ids = Z.PERSONAS.map(p => p.id);
  const labels = Z.PERSONAS.map(p => p.label);
  assert.equal(new Set(ids).size, 6);
  assert.equal(new Set(labels).size, 6);
  labels.forEach(l => assert.ok(l.length <= 4, '标签不超过 4 个字：' + l));
  assert.deepEqual(Z.PERSONA_IDS, ids);
  for (const p of Z.PERSONAS) {
    assert.ok(p.desc && p.desc.length > 0);
    assert.ok(p.riskMul >= 0.4 && p.riskMul <= 1.6, p.id + ' riskMul');
    assert.ok([-1, 0, 1].includes(p.pengBias), p.id + ' pengBias');
    assert.equal(typeof p.huPass, 'boolean');
    assert.ok(Number.isInteger(p.huNeed) && p.huNeed >= -2 && p.huNeed <= 1, p.id + ' huNeed');
    assert.equal(typeof p.fold, 'boolean');
    assert.equal(typeof p.follow, 'boolean');
    assert.ok(Number.isInteger(p.defenseFrom) && p.defenseFrom >= 4 && p.defenseFrom <= 14, p.id + ' defenseFrom');
    assert.ok(p.paceMul >= 0.4 && p.paceMul <= 2.0, p.id + ' paceMul');
    const copy = Z.personaParams(p.id);
    assert.equal(copy.id, p.id);
    assert.equal(copy.riskMul, p.riskMul);
    assert.equal(Z.personaMeta(p.id).label, p.label);
  }
});

test('默认关闭：不传 personas 时座席没有 persona 属性，签名等于基线 25be8c97', () => {
  assert.equal(signature({}), '25be8c97');
  assert.equal(signature({ personas: null }), '25be8c97');
  const G = Z.createGame({ seed: 101 });
  G.seats.concat(G.queue).forEach(function (p) {
    assert.equal(Object.prototype.hasOwnProperty.call(p, 'persona'), false, p.name + ' 不该有 persona');
  });
  const seats = Z.createGame({ seed: 101, rotate: false }).seats;
  seats.forEach(function (p) {
    assert.equal(Object.prototype.hasOwnProperty.call(p, 'persona'), false);
  });
});

test('分配规则：classic 固定三人组、random 姓名哈希稳定、数组显式指定', () => {
  const classic = Z.createGame({ seed: 101, rotate: false, personas: 'classic' });
  assert.equal(classic.seats[1].persona, 'steady');
  assert.equal(classic.seats[2].persona, 'raider');
  assert.equal(classic.seats[3].persona, 'turtle');
  assert.equal(Object.prototype.hasOwnProperty.call(classic.seats[0], 'persona'), false, '真人座席永远无性格');
  classic.queue.forEach(function (p, i) {
    assert.equal(p.persona, ['steady', 'raider', 'turtle'][i % 3]);
  });

  const r1 = Z.createGame({ seed: 101, rotate: false, personas: 'random' });
  const r2 = Z.createGame({ seed: 101, rotate: false, personas: 'random' });
  r1.seats.slice(1).forEach(function (p, i) {
    assert.ok(Z.PERSONA_IDS.includes(p.persona), 'random 必须是合法 id');
    assert.equal(p.persona, r2.seats[i + 1].persona, '同名字同性格');
    assert.equal(p.persona, Z.personaForName(p.name));
  });

  const arr = Z.createGame({ seed: 101, rotate: false, personas: ['steady', 'raider', 'bogus', null] });
  assert.equal(arr.seats[1].persona, 'raider');
  assert.equal(Object.prototype.hasOwnProperty.call(arr.seats[2], 'persona'), false, '非法 id 静默忽略');
  assert.equal(Object.prototype.hasOwnProperty.call(arr.seats[3], 'persona'), false);
  arr.queue.forEach(function (p) {
    assert.equal(Object.prototype.hasOwnProperty.call(p, 'persona'), false, '数组模式不覆盖等待区');
  });
});

test('零 RNG 消耗：classic 与默认同 seed 的骰子、开口、牌墙、四家起手完全一致', () => {
  const A = Z.createGame({ seed: 101, rotate: false });
  const B = Z.createGame({ seed: 101, rotate: false, personas: 'classic' });
  A.startHand(); B.startHand();
  assert.deepEqual(Array.from(A.hand.opening.dice), Array.from(B.hand.opening.dice));
  assert.equal(A.hand.opening.startSlot, B.hand.opening.startSlot);
  assert.equal(A.hand.opening.breakSeat, B.hand.opening.breakSeat);
  assert.deepEqual(Array.from(A.hand.wall), Array.from(B.hand.wall));
  assert.deepEqual(Array.from(A.hand.birds), Array.from(B.hand.birds));
  for (let s = 0; s < 4; s++) {
    assert.deepEqual(Array.from(A.hand.players[s].concealed), Array.from(B.hand.players[s].concealed));
    assert.deepEqual(Array.from(A.hand.dealtHands[s]), Array.from(B.hand.dealtHands[s]));
  }
  assert.equal(A.hand.record.initial.map(String).join('|'), B.hand.record.initial.map(String).join('|'));
});

test('任一性格组合都能在 800 步内结束，四家收支零和', () => {
  const cases = [{ personas: 'classic' }, { personas: 'random' }];
  Z.PERSONA_IDS.forEach(id => cases.push({ personas: [null, id, id, id] }));
  cases.push({ personas: [null, 'raider', 'turtle', 'gambler'], aiStyle: 'ev', aiStyleV2: [1, 2, 3] });
  cases.push({ personas: [null, 'mimic', 'schemer', 'steady'], aiStyleV2: [], aiStyleV3: [1, 2, 3] });
  cases.forEach(function (opts) {
    const G = Z.createGame(Object.assign({ seed: 101, rotate: false, aiStyleV2: [1, 2, 3] }, opts));
    const steps = runHands(G, 6);
    steps.forEach((n, i) => assert.ok(n < 800, JSON.stringify(opts) + ' 第 ' + (i + 1) + ' 局未结束'));
    assert.equal(G.seats.reduce((sum, p) => sum + p.score, 0), 0, JSON.stringify(opts) + ' 必须零和');
    assert.ok(G.hand.over);
  });
});

test('六种性格的打法向量互不相同，且 raider 副露多于 turtle', () => {
  const neutral = summary({});
  assert.deepEqual(neutral, EXPECTED.neutral, '中性向量漂移：默认 AI 行为被改动了');
  const seen = new Set([JSON.stringify(neutral)]);
  const vectors = {};
  for (const id of Z.PERSONA_IDS) {
    const got = summary({ personas: [null, id, id, id] });
    assert.deepEqual(got, EXPECTED[id], id + ' 行为向量与冻结金样不一致');
    const key = JSON.stringify(got);
    assert.equal(seen.has(key), false, id + ' 与其它性格/中性完全同构，性格不可观察');
    seen.add(key);
    vectors[id] = got;
  }
  assert.ok(vectors.raider.peng + vectors.raider.gang > vectors.turtle.peng + vectors.turtle.gang,
    '猛攻的副露次数应多于龟缩');
  assert.ok(vectors.raider.peng > neutral.peng, '猛攻应更常碰');
  assert.ok(vectors.steady.peng < neutral.peng, '稳健应更少碰');
});

test('setAiStyle 与性格互不影响；personaOf 返回参数副本', () => {
  const G = Z.createGame({ seed: 101, rotate: false, personas: 'classic' });
  G.setAiStyle(2, 'v3');
  assert.equal(G.seats[2].aiStyle, 'v3');
  assert.equal(G.seats[2].persona, 'raider');
  const a = G.personaOf(2), b = G.personaOf(2);
  assert.deepEqual(a, b);
  assert.notEqual(a, b, '每次返回副本，调用方改不到共享表');
  a.riskMul = 99;
  assert.notEqual(Z.personaParams('raider').riskMul, 99, '共享表不能被调用方改到');
  assert.equal(Z.personaParams('raider').riskMul, Z.PERSONAS.find(p => p.id === 'raider').riskMul);
  assert.equal(typeof Z.RULES.riskWeight, 'number');
});

test('setPersona 只改合法 id；真人座席与非法 id 都被清理，不抛错', () => {
  const G = Z.createGame({ seed: 101, rotate: false, personas: 'classic' });
  assert.equal(G.setPersona(1, 'gambler'), true);
  assert.equal(G.seats[1].persona, 'gambler');
  assert.equal(G.setPersona(1, 'bogus'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(G.seats[1], 'persona'), false, '非法 id 清除性格');
  assert.equal(G.setPersona(0, 'raider'), false, '真人座席不能有性格');
  assert.equal(Object.prototype.hasOwnProperty.call(G.seats[0], 'persona'), false);
  assert.equal(G.setPersona(9, 'raider'), false);
  assert.equal(Z.personaParams('bogus'), null);
  assert.equal(Z.personaMeta('bogus'), null);
});

test('性格不引入暗牌读取：隐藏对手手牌后分析仍可用', () => {
  const G = Z.createGame({ seed: 101, rotate: false, personas: [null, 'raider', 'turtle', 'gambler'] });
  G.startHand();
  const H = G.hand;
  Object.defineProperty(H.players[1], 'concealed', { get: function () { throw new Error('hidden opponent tiles'); } });
  Object.defineProperty(H.players[2], 'concealed', { get: function () { throw new Error('hidden opponent tiles'); } });
  Object.defineProperty(H.players[3], 'concealed', { get: function () { throw new Error('hidden opponent tiles'); } });
  const opts = Z.evaluateDiscards(H, 0);
  assert.ok(opts.length > 0);
  const sit = Z.analyzeSituation(H, 0, { worlds: 8, seed: 1 });
  assert.equal(sit.worlds, 8);
});

test('联机 roster 不因性格改变：不传 personas 时服务端座席没有 persona', () => {
  const roster = [
    { id: 'a', name: '甲', isHuman: true },
    { id: 'b', name: '乙', isHuman: true },
    { id: 'bot1', name: '阿湘', isHuman: false, style: 'v2' },
    { id: 'bot2', name: '老陈', isHuman: false, style: 'v2' }
  ];
  const G = Z.createGame({ seed: 7, roster: roster });
  G.seats.forEach(function (p) {
    assert.equal(Object.prototype.hasOwnProperty.call(p, 'persona'), false, p.name + ' 联机座席没有性格');
  });
  // 服务端显式送 persona 时才生效（本轮不启用），且真人依旧不分配
  const G2 = Z.createGame({ seed: 7, roster: roster.map(function (p, i) {
    return Object.assign({}, p, { persona: i === 2 ? 'mimic' : 'raider' });
  }) });
  assert.equal(G2.seats[2].persona, 'mimic');
  assert.equal(Object.prototype.hasOwnProperty.call(G2.seats[0], 'persona'), false);
});
