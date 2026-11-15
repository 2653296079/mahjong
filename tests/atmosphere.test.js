'use strict';
/**
 * atmosphere.test.js —— 气质增强（牌友头像 / 背景音乐 / 教练短句）的静态契约
 *
 * 运行时仍是单个自包含 index.html：头像用 Canvas 参数绘制、音乐用 WebAudio 合成、
 * 教练短句是纯数据表。这里只做静态与纯函数断言；浏览器行为见 tests/atmosphere-ui.html
 * 与 tests/music-ui.html。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('(function (root, factory) {');
const end = html.indexOf('</script>', start);
const engine = html.slice(start, end);
const game = html.slice(end);

function tag(id) { return html.indexOf('id="' + id + '"'); }
function between(a, b) { return html.slice(a, b); }
function evalLiteral(src, re) {
  const m = re.exec(src);
  assert.ok(m, '找不到可求值的纯数据字面量：' + re);
  return new Function('return (' + m[1] + ');')();
}

const COACH_LINES = evalLiteral(html, /var COACH_LINES = (\{[\s\S]*?\n  \});/);
const MUSIC_SCORE = evalLiteral(html, /var MUSIC_SCORE = (\{[\s\S]*?\n  \});/);
const avatarHashSrc = /function avatarHash\(text\) \{[\s\S]*?\n  \}/.exec(html)[0];
const avatarParamsSrc = /function avatarParams\(name, isMe\) \{[\s\S]*?\n  \}/.exec(html)[0];
const coachPickSrc = /function coachPick\(cat, handNo, turn\) \{[\s\S]*?\n  \}/.exec(html)[0];
const avatarParams = new Function(avatarHashSrc + '\n' + avatarParamsSrc + '\nreturn avatarParams;')();
const coachPick = new Function('COACH_LINES', avatarHashSrc + '\n' + coachPickSrc + '\nreturn coachPick;')(COACH_LINES);

const avatarSection = between(html.indexOf('---------- 程序化牌友头像'), html.indexOf('function renderScores'));
const musicSection = between(html.indexOf('---------- 原创背景音乐'), html.indexOf('// 用引擎 record.events'));
const coachSection = between(html.indexOf('教练短句：原创文案库'), html.indexOf('function renderCoach'));

test('4 个新设置键写进 cfg 默认值，刷新后按显式白名单恢复', () => {
  assert.match(html, /avatar: 'on', music: 'off', musicVolume: 40, coach: 'on'/);
  // audio.test.js:138 的连续子串必须原样保留
  assert.match(html, /persona: 'off', voice: 'off', sfxVolume: 100, voiceVolume: 80/);
  assert.match(html, /if \(savedCfg\.avatar === 'on' \|\| savedCfg\.avatar === 'off'\) cfg\.avatar = savedCfg\.avatar;/);
  assert.match(html, /if \(savedCfg\.music === 'on' \|\| savedCfg\.music === 'off'\) cfg\.music = savedCfg\.music;/);
  assert.match(html, /if \(savedCfg\.coach === 'on' \|\| savedCfg\.coach === 'off'\) cfg\.coach = savedCfg\.coach;/);
  assert.match(html, /if \(Number\.isFinite\(savedCfg\.musicVolume\) && savedCfg\.musicVolume >= 0 && savedCfg\.musicVolume <= 100\) cfg\.musicVolume = savedCfg\.musicVolume;/);
  // 既有音量白名单数组不得被扩写（audio.test.js:141 逐字锁定）
  assert.match(html, /\['sfxVolume', 'voiceVolume'\]/);
  assert.doesNotMatch(html, /\['sfxVolume', 'voiceVolume',/);
});

test('设置面板有四个新控件，且都带 aria-label', () => {
  ['setAvatar', 'setMusic', 'setMusicVolume', 'setCoach'].forEach(function (id) {
    assert.ok(tag(id) > 0, '缺少设置项 #' + id);
    assert.match(html, new RegExp('id="' + id + '"[^>]*aria-label='), id + ' 需要 aria-label');
  });
  assert.match(html, /cfg\.avatar = \$?\('?setAvatar'?\)?\.value === 'on'/);
  assert.match(html, /cfg\.coach = this\.value === 'on' \? 'on' : 'off'/);
});

test('二维头像保持程序绘制；三维只加载对应动物的本地头像', () => {
  assert.match(game, /document\.createElement\('canvas'\)/);
  assert.match(avatarSection, /aria-hidden/);
  assert.match(avatarSection, /function avatarParams\(name, isMe\)/);
  assert.match(avatarSection, /function drawAvatar\(canvas, p, cssPx\)/);
  assert.match(avatarSection, /function insertSeatAvatar\(nameEl, pl, isMe\)/);
  assert.match(html, /window\.__zmjAvatar = \{ version: 1, params: avatarParams/);
  assert.doesNotMatch(avatarSection, /Math\.random/);
  assert.doesNotMatch(avatarSection, /toDataURL/);
  assert.doesNotMatch(avatarSection, /<img\b/i);
  assert.doesNotMatch(avatarSection, /data:image/i);
  assert.doesNotMatch(avatarSection, /\.(?:png|jpe?g|gif|webp|svg)\b/i);
  assert.doesNotMatch(html, /<img\b/i);
  assert.equal((html.match(/new Image\s*\(/g)||[]).length, 1, '图片构造仅用于三维动物头像');
  assert.match(html, /companions\/portraits\/.*\.png\?build=v62/);
  assert.match(html, /if\(document\.body\.classList\.contains\('table3d'\)\)/);
  assert.equal((html.match(/<script\b/gi) || []).length, 3, '全页仍 3 个内联 script');
  assert.ok(engine.length > 20000);
});

test('头像参数：7 组值域、确定性、长辫不配胡须', () => {
  const p = avatarParams('阿湘', false);
  ['face', 'hair', 'beard', 'glasses', 'hat', 'accent'].forEach(function (k) {
    assert.equal(typeof p[k], 'number', k + ' 必须是数字');
  });
  assert.ok(p.face >= 0 && p.face <= 2);
  assert.ok(p.hair >= 0 && p.hair <= 5);
  assert.ok(p.beard >= 0 && p.beard <= 3);
  assert.ok(p.glasses >= 0 && p.glasses <= 2);
  assert.ok(p.hat >= 0 && p.hat <= 4);
  assert.ok(p.accent >= 0 && p.accent <= 5);
  assert.deepEqual(avatarParams('阿湘', false), p, '同一名字必须同一张脸');
  assert.notEqual(p.stamp, '');
  assert.equal(avatarParams('我', true).stamp, '我');
  for (let i = 0; i < 1000; i++) {
    const q = avatarParams('牌友' + i, i % 4 === 0);
    if (q.hair === 3) assert.equal(q.beard, 0, '长辫强制无胡须');
    assert.ok(q.accent >= 0 && q.accent <= 5);
  }
  // 空名 / 座位 N / 电脑 N 必须有稳定结果，不得抛错
  ['', '座位1', '电脑2', '<b>乙</b>', '😀昵称超长的名字'.repeat(3)].forEach(function (name) {
    const r1 = avatarParams(name, false), r2 = avatarParams(name, false);
    assert.deepEqual(r1, r2);
    assert.ok(r1.stamp.length >= 1);
  });
});

test('头像按名字盐化：四个座位不应撞参数组合', () => {
  const sets = ['阿湘', '老陈', '小敏', '阿伯'].map(function (n) {
    const p = avatarParams(n, false);
    return [p.face, p.hair, p.beard, p.glasses, p.hat, p.accent].join(',');
  });
  assert.equal(new Set(sets).size, 4, '四个默认牌友的参数组合必须互不相同');
});

test('音乐总线：MUSIC_GAIN 排在 SFX_GAIN 之后，音量默认 0.36，音效链路一字不动', () => {
  const iSfx = html.indexOf('SFX_GAIN = AC.createGain()');
  const iMusic = html.indexOf('MUSIC_GAIN = AC.createGain()');
  assert.ok(iSfx > 0 && iMusic > iSfx, 'MUSIC_GAIN 必须在 SFX_GAIN 之后创建（audio-ui:236 gains[0]）');
  assert.match(html, /function musicGainBase\(\) \{ return Math\.max\(0, Math\.min\(1, \(cfg\.musicVolume \/ 100\) \* 0\.9\)\); \}/);
  assert.match(html, /MUSIC_GAIN\.gain\.value = musicGainBase\(\)/);
  // 既有音效契约（audio.test.js:56-61）逐字保留
  assert.match(html, /SFX_GAIN\.gain\.value = Math\.max\(0, Math\.min\(1, cfg\.sfxVolume \/ 100\)\)/);
  assert.match(html, /function sfxBus\(a\) \{ return SFX_GAIN \|\| a\.destination; \}/);
  assert.match(html, /function sfx\(kind, info\) \{\s*if \(!cfg\.sound \|\| pageHidden\(\)\) return false;/);
  // 音乐独立于音效设置值
  assert.doesNotMatch(musicSection, /cfg\.sfxVolume/);
  assert.doesNotMatch(musicSection, /cfg\.sound\s*=/);
});

test('乐谱：8 小节、三声部、五声音级、结算短句齐全', () => {
  assert.ok(Array.isArray(MUSIC_SCORE.lead) && MUSIC_SCORE.lead.length > 20);
  assert.ok(Array.isArray(MUSIC_SCORE.bass) && MUSIC_SCORE.bass.length === 8);
  assert.ok(MUSIC_SCORE.perc && Array.isArray(MUSIC_SCORE.perc.calm) && Array.isArray(MUSIC_SCORE.perc.tense));
  ['win', 'lose', 'drawGame'].forEach(function (k) {
    assert.ok(Array.isArray(MUSIC_SCORE.cadence[k]) && MUSIC_SCORE.cadence[k].length >= 2, '缺少结算短句 ' + k);
  });
  const bars = new Set();
  MUSIC_SCORE.lead.concat(MUSIC_SCORE.bass).forEach(function (n) {
    assert.ok([1, 2, 3, 5, 6].indexOf(n.deg) >= 0, '五声音级之外：' + n.deg);
    assert.ok([0, 1, -1].indexOf(n.oct) >= 0, '八度越界：' + n.oct);
    assert.ok(n.beat >= 1 && n.beat <= 4, '拍号越界：' + n.beat);
    assert.ok(n.len > 0);
    bars.add(n.bar);
  });
  assert.equal(bars.size, 8, '必须正好覆盖 8 小节');
  MUSIC_SCORE.lead.forEach(function (n) { assert.ok(n.oct === 0 || n.oct === 1, '旋律八度只能是 0/1'); });
});

test('音乐只读公开信息：绝不读取向听/进张/放铳等隐藏字段', () => {
  assert.doesNotMatch(musicSection, /concealed|shanten|ukeire|dealIn|risk|opponents|handExtra/);
  assert.match(musicSection, /game\.drawsLeft\(\)/);
  assert.match(musicSection, /melds/);
  assert.match(musicSection, /left <= 4/);
});

test('音乐合成只用音频桩支持的节点与参数', () => {
  assert.doesNotMatch(musicSection, /setTargetAtTime|cancelScheduledValues|setValueCurveAtTime/);
  assert.doesNotMatch(musicSection, /\.detune|setPeriodicWave|createDynamicsCompressor/);
  assert.doesNotMatch(musicSection, /createConvolver|createWaveShaper|createStereoPanner|createDelay/);
  assert.match(musicSection, /MUSIC_GAIN/);
  assert.match(musicSection, /setInterval\(musicTick, 200\)/);
  assert.match(musicSection, /window\.__zmjMusic = \{ version: 1, score: MUSIC_SCORE/);
  assert.match(musicSection, /function duckMusic\(on, chars\)/);
  assert.match(musicSection, /base \* 0\.35/);
  // 不 duck 音效：音乐代码段不出现 SFX/hit/tone 调用
  assert.doesNotMatch(musicSection, /\bsfx\(|\bhit\(a|\btone\(a/);
});

test('页面不引入任何音频/图片/外链资源', () => {
  assert.doesNotMatch(html, /<\s*audio\b/i);
  assert.doesNotMatch(html, /\.(?:mp3|wav|ogg|m4a|aac|flac)\b/i);
  assert.doesNotMatch(html, /data:audio/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(html, /\brequire\s*\(/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'package.json')), false);
});

test('教练短句：5 类各 14 条、id/text 唯一、长度 8–18 字', () => {
  const cats = ['wait', 'wrong', 'risk', 'bird', 'review'];
  const ids = new Set(), texts = new Set();
  let total = 0;
  cats.forEach(function (cat) {
    const list = COACH_LINES[cat];
    assert.ok(Array.isArray(list), '缺少分类 ' + cat);
    assert.equal(list.length, 14, cat + ' 应为 14 条，实际 ' + list.length);
    list.forEach(function (line) {
      total++;
      assert.ok(line.id && !ids.has(line.id), 'id 重复：' + line.id);
      ids.add(line.id);
      assert.ok(line.text && !texts.has(line.text), 'text 重复：' + line.text);
      texts.add(line.text);
      const len = Array.from(line.text).length;
      assert.ok(len >= 8 && len <= 18, line.id + ' 长度 ' + len + ' 越界：' + line.text);
      assert.equal(typeof line.say, 'boolean', line.id + ' say 必须是布尔');
    });
  });
  assert.equal(total, 70, '五类合计应为 70 条');
});

test('可念短句（say:true）不含数字与提示性禁词', () => {
  const FORBIDDEN = /建议|推荐|牌效|向听|风险|概率|%|\d/;
  let overLen = 0;
  ['wait', 'wrong', 'risk', 'bird', 'review'].forEach(function (cat) {
    COACH_LINES[cat].forEach(function (line) {
      const len = Array.from(line.text).length;
      if (len > 14) { overLen++; assert.equal(line.say, false, line.id + ' 超过 14 字必须只可视'); return; }
      if (!line.say) return;
      assert.doesNotMatch(line.text, FORBIDDEN, line.id + ' 可念句含禁词：' + line.text);
      assert.ok(len >= 6 && len <= 14, line.id + ' 可念句长度 ' + len);
    });
  });
  assert.equal(overLen, 20, '>14 字只可视的短句应为 20 条，实际 ' + overLen);
});

test('教练文案与新增代码不含 APK 台词/角色/统计表', () => {
  const lines = Object.keys(COACH_LINES).map(function (k) {
    return COACH_LINES[k].map(function (l) { return l.text; }).join('\n');
  }).join('\n');
  ['时间就是金钱', '我等的花儿', '谢谢老板', '老板', '发财', '梭哈', '血战', '赢回来',
    '回本', '翻倍', '干就完了', '666', '必胡', '稳赢', '牛'].forEach(function (w) {
    assert.equal(lines.includes(w), false, '教练短句出现禁用词：' + w);
  });
  const newCode = avatarSection + musicSection + coachSection;
  ['AvatarSample', 'HairSample', 'Darkness Shibu', 'VRM', 'QPC2', 'chars.js', 't3-chars'].forEach(function (w) {
    assert.equal(newCode.includes(w), false, '新增代码出现 APK 标识：' + w);
  });
  ['TEN', 'DEAL', 'PWIN', 'WIN_AVG', 'CFG'].forEach(function (w) {
    assert.doesNotMatch(newCode, new RegExp('\\b' + w + '\\b'), '新增代码出现 APK 统计表标识：' + w);
  });
});

test('教练短句选取是确定性纯函数', () => {
  const a = coachPick('wait', 3, 7), b = coachPick('wait', 3, 7);
  assert.ok(a && a.id);
  assert.equal(a.id, b.id, '同一 (cat,handNo,turn) 必须选同一条');
  assert.ok(COACH_LINES.wait.indexOf(a) >= 0);
  assert.equal(coachPick('nope', 1, 1), null);
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(coachPick('risk', 1, i).id);
  assert.ok(seen.size > 3, '不同回合应能轮换到不同短句');
});

test('落点安全：教练短句不进 #hint / #miniHint / #announce / #log', () => {
  const hintFn = between(html.indexOf('function renderHint'), html.indexOf('function renderMiniHint'));
  assert.doesNotMatch(hintFn, /COACH_LINES|coachPick|coachLine/);
  const hintEl = between(tag('hint'), tag('situation'));
  const miniEl = between(tag('miniHint'), tag('miniHint') + 300);
  [hintEl, miniEl].forEach(function (block) {
    assert.equal(block.includes('COACH_LINES'), false);
    assert.equal(block.includes('coachLine'), false);
  });
  const announceRegion = between(tag('announce'), tag('announce') + 400);
  ['建议', '推荐', '牌效', '向听', '风险', '概率'].forEach(function (w) {
    assert.equal(announceRegion.includes(w), false, '#announce 区域出现 ' + w);
  });
  assert.equal(html.includes('logCoach'), false, '教练短句不写 #log');
  // 不新增 speak 调用：教练短句本轮纯文本
  assert.equal((game.match(/\.speak\(/g) || []).length, 1, '全页只保留一处 speak(u)');
});

test('教练短句只在等待分支与反馈分支出现，结算用 textContent 写入独立节点', () => {
  const coachFn = between(html.indexOf('function renderCoach'), html.indexOf('function renderActions'));
  assert.match(coachFn, /coachLine\('wait'\)/);
  assert.match(coachFn, /coachLine\('risk'\)/);
  assert.match(coachFn, /coachLine\('wrong'\)/);
  assert.match(coachFn, /上一手复盘/);
  const settleFn = between(html.indexOf('function showSettlement'), html.indexOf('function showTileArt'));
  assert.match(settleFn, /'settleCoach'/);
  assert.match(settleFn, /'reviewCoach'/);
  assert.match(settleFn, /el\.textContent = line\.text;/, '结算教练行必须用 textContent 写入');
  assert.match(settleFn, /el\.className = 'coachLine';/);
  assert.doesNotMatch(settleFn, /html \+= '<div class="coachLine"/, '不得用 innerHTML 拼教练行');
  // 结算只加两个 div，不加表格行
  assert.equal((settleFn.match(/'settleCoach'/g) || []).length, 1);
  assert.equal((settleFn.match(/'reviewCoach'/g) || []).length, 1);
});

test('教练短句避重与 duck 释放：同类不连续重复、speak 抛错立即恢复音乐', () => {
  const coachFn = between(html.indexOf('function coachNextIndex'), html.indexOf('function renderCoach'));
  assert.match(coachFn, /coachLastIdx\[cat\]/);
  assert.match(coachFn, /\(i \+ 1\) % list\.length/);
  assert.match(html, /function resetCoachLines\(\) \{ coachLast = \{ cat: '', id: '', line: null \}; coachLastAt = 0; coachLastIdx = \{\}; \}/);
  assert.match(html, /\} catch \(e\) \{ TTS\.speaking = false; TTS\.until = 0; duckMusic\(false\); return false; \}/);
  // 行为：同一 (cat,handNo,turn) 连续取到同一索引时必须顺延一位
  const nextSrc = /function coachNextIndex\(cat, handNo, turn\) \{[\s\S]*?\n  \}/.exec(html)[0];
  const state = {};
  const coachNext = new Function('COACH_LINES', 'coachLastIdx', avatarHashSrc + '\n' + nextSrc + '\nreturn coachNextIndex;')(COACH_LINES, state);
  const i1 = coachNext('wait', 3, 7), i2 = coachNext('wait', 3, 7);
  assert.notEqual(i1, i2, '连续两次必须避开同一条');
  assert.equal(i2, (i1 + 1) % COACH_LINES.wait.length);
  // 第三次回到哈希基准位（仍与上一次不同），保证任何相邻两次都不重复
  assert.equal(coachNext('wait', 3, 7), i1);
});

test('3D 早退键包含头像设置，≤820 侧家头像按窄屏策略隐藏', () => {
  assert.match(html, /game\.online\?NET\.status\+':'\+!!NET\.pendingAction:'solo',cfg\.avatar,avatarCssPx\(\)\]/);
  assert.match(html, /@media\(max-width:820px\)\{\.seatName\{--seat-avatar:22px\}body:not\(\.table3d\) #seat1 \.seatAvatar,body:not\(\.table3d\) #seat3 \.seatAvatar\{display:none\}\}/);
});

test('引擎切片仍是零浏览器 API 的纯逻辑，服务端抽取契约不变', () => {
  assert.ok(engine.length > 20000);
  assert.match(engine, /\(function \(root, factory\)/);
  assert.doesNotMatch(engine, /\bAudioContext\b|\bspeechSynthesis\b|\bSpeechSynthesisUtterance\b/);
  assert.doesNotMatch(engine, /\bdocument\.|\bwindow\.|\blocalStorage\b/);
  assert.match(game, /window\.__zmjGame = game/);
  // 头部结构：首个 script 之前不新增 script
  assert.ok(html.indexOf('<script id="mahjongCore">') > 0);
  assert.ok(html.indexOf('<script id="mahjongCore">') < start);
});
