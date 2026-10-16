const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../server/rooms').loadCore();

test('legacy practice records migrate; invalid and future schemas do not poison progress', () => {
  const old = { attempts: 4, correct: 2, wrong: ['wide-1', 'wide-1', 'unknown'] };
  const progress = Z.readPracticeProgress(old);
  assert.equal(progress.version, 2);
  assert.equal(progress.attempts, 4);
  assert.deepEqual(progress.wrong, ['wide-1']);
  assert.deepEqual(Z.readPracticeProgress(JSON.parse(JSON.stringify(progress))), progress);
  for (const raw of [null, { ...old, attempts: -1 }, { ...old, correct: 5 }, { ...old, rulesVersion: 'other' }, { ...old, version: 999 }]) {
    assert.equal(Z.readPracticeProgress(raw).attempts, 0);
  }
});

test('mistake classification, correction and 1/3/7-day scheduling survive serialization', () => {
  const now = 1760000000000, day = 86400000;
  let p = Z.readPracticeProgress(null);
  const original = JSON.stringify(p);
  p = Z.recordPracticeAttempt(p, 'wide-1', 0, now);
  assert.equal(JSON.stringify(Z.readPracticeProgress(null)), original, 'input was not mutated');
  assert.deepEqual(p.wrong, ['wide-1']);
  assert.equal(p.cards['wide-1'].reason, '向听增加');
  assert.equal(p.cards['wide-1'].dueAt, now);
  for (const [i, interval] of [1, 3, 7].entries()) {
    p = Z.recordPracticeAttempt(Z.readPracticeProgress(JSON.parse(JSON.stringify(p))), 'wide-1', 26, now + i * day);
    assert.equal(p.cards['wide-1'].dueAt, now + (i + interval) * day);
    assert.deepEqual(p.wrong, []);
  }
  p = Z.recordPracticeAttempt(p, 'visible-2', 23, now);
  assert.equal(p.cards['visible-2'].reason, '进张损失');
  assert.equal(Z.recordPracticeAttempt(p, 'unknown', 0, now), null);
});

test('first attempts on transfer questions are counted once, independently of repeated drills', () => {
  const q = Z.practiceCases.find(q => q.assessment), H = Z.practiceHand(q.id);
  const opts = Z.evaluateDiscards(H, 0), wrong = opts.find(o => !Z.sameEfficiency(o, opts[0]));
  let p = Z.recordPracticeAttempt(Z.readPracticeProgress(null), q.id, wrong.kind, 100);
  assert.deepEqual(p.assessment, { attempts: 1, correct: 0 });
  p = Z.recordPracticeAttempt(p, q.id, opts[0].kind, 200);
  assert.deepEqual(p.assessment, { attempts: 1, correct: 0 });
  assert.equal(p.correct, 1);
});

test('36 questions cover 12 families with physically legal public tiles and consistent transformed answers', () => {
  const bases = Z.practiceCases.filter(q => !q.assessment);
  assert.equal(bases.length, 12);
  assert.equal(Z.practiceCases.length, 36);
  for (const q of bases) {
    const base = Z.evaluateDiscards(Z.practiceHand(q.id), 0);
    for (let v = 1; v <= 2; v++) {
      const H = Z.practiceHand(q.id + '-transfer-' + v), own = H.players[0].concealed;
      const seen = own.slice(); H.players[1].discards.forEach(k => seen[k]++);
      assert.ok(seen.every(n => n <= 4), q.id);
      const choices = Z.evaluateDiscards(H, 0);
      assert.equal(choices[0].shanten, base[0].shanten);
      assert.equal(choices[0].ukeire, base[0].ukeire);
      const map = k => ((Math.floor(k / 9) + v) % 3) * 9 + 8 - k % 9;
      assert.deepEqual(choices.filter(o => Z.sameEfficiency(o, choices[0])).map(o => o.kind).sort((a,b) => a-b),
        base.filter(o => Z.sameEfficiency(o, base[0])).map(o => map(o.kind)).sort((a,b) => a-b));
    }
  }
});
