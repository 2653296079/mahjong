const test=require('node:test');
const assert=require('node:assert/strict');
const {probabilityMetrics,publicProjection}=require('../evaluation/metrics');
const {runRisk}=require('../evaluation/run-risk');
const {summary}=require('../evaluation/performance');
const Z=require('../server/rooms').loadCore();
test('Brier and probability bins agree with directly calculated examples',()=>{
  const result=probabilityMetrics([{p:0,y:0},{p:0.5,y:1},{p:1,y:1},{p:0.5,y:0}]);
  assert.equal(result.brier,0.125);assert.equal(result.observedRate,0.5);assert.equal(result.meanPredicted,0.5);
  assert.equal(result.bins.reduce((s,b)=>s+b.count,0),4);
  assert.equal(result.bins[4].count,3);
  assert.equal(probabilityMetrics([]).brier,null);
  assert.throws(()=>probabilityMetrics([{p:1.2,y:0}]));
  assert.deepEqual(summary([5,1,3,2,4]),{count:5,medianMs:3,p95Ms:5,maxMs:5});
});
test('public projection traps hidden access and the evaluation pipeline finishes deterministic games',()=>{
  const G=Z.createGame({seed:101});G.startHand();
  const view=publicProjection(G.hand,0);assert.throws(()=>view.players[1].concealed,/hidden/);
  assert.deepEqual(view.players[0].concealed,G.hand.players[0].concealed);
  const result=runRisk({hands:3,worlds:12,seed:9021,stride:12});
  assert.equal(result.hands.length,3);assert.ok(result.decisions>0);assert.ok(result.dealIn.count>result.decisions);
  assert.deepEqual(result.byStyle.map(s=>s.style),['v1','v2','v3']);
  assert.ok(result.dealIn.brier>=0&&result.dealIn.brier<=1);
  assert.match(result.engineSha256,/^[a-f0-9]{64}$/);
});
