'use strict';
const { isMainThread, parentPort } = require('node:worker_threads');
const { loadCore } = require('./rooms');

// 只从决策时的公开局面比较基础牌效；不使用未来摸牌或对手暗牌来评分。
function analyze(record, seat, actions) {
  const core = loadCore(), states = core.replayStates(record, seat);
  const manual = new Set((actions || []).filter(a => a.seat === seat && a.act === 'discard').map(a => a.eventIndex));
  const out = { discards: 0, same: 0, shantenLoss: 0, outsLoss: 0, tenpaiTurn: null, tenpaiOuts: null, gangs: 0, auto: 0 };
  for (const a of actions || []) if (a.seat === seat && a.act === 'auto') out.auto++;
  record.events.forEach((e, i) => {
    if (e.s !== seat) return;
    if (e.t === 'g') out.gangs++;
    if (e.t !== 'x' || !manual.has(i)) return;
    const choices = core.evaluateDiscards(core.stateAsHand(states[i], seat), seat);
    const best = choices[0], own = choices.find(c => c.kind === e.k);
    if (!best || !own) return;
    out.discards++;
    if (core.sameEfficiency(own, best)) out.same++;
    out.shantenLoss += Math.max(0, own.shanten - best.shanten);
    if (own.shanten === best.shanten) out.outsLoss += Math.max(0, best.ukeire - own.ukeire);
    if (own.shanten === 0 && out.tenpaiTurn === null) { out.tenpaiTurn = e.n; out.tenpaiOuts = own.ukeire; }
  });
  return out;
}
if (!isMainThread) parentPort.on('message', job => {
  try { parentPort.postMessage({ id: job.id, metrics: job.players.map(p => ({ seat: p.seat, value: analyze(job.record, p.seat, job.actions) })) }); }
  catch (e) { parentPort.postMessage({ id: job.id, error: 'analysis_failed' }); }
});
module.exports = { analyze };
