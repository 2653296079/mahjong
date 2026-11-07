'use strict';
/**
 * audio.test.js —— 音效 / 可选语音报牌的静态验收
 *
 * 运行时是单个自包含 index.html：音效必须由 WebAudio 程序合成，
 * 不出现 <audio>、音频文件、fetch 音频或任何外部资源；引擎脚本里不能出现浏览器 API。
 * 行为部分（合成调用计数、TTS 文本白名单、静默降级）在 tests/audio-ui.html 里跑。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('(function (root, factory) {');
const end = html.indexOf('</script>', start);
assert.ok(start >= 0 && end > start, 'inline core must be present');
const engine = html.slice(start, end);
const game = html.slice(end);

function tag(id) {
  const i = html.indexOf('id="' + id + '"');
  return i;
}
function between(from, to) {
  return html.slice(from, to);
}

test('引擎脚本保持零浏览器 API：音效/报牌只写在 game.js', () => {
  assert.equal(engine.length > 20000, true);
  assert.doesNotMatch(engine, /\bAudioContext\b|\bspeechSynthesis\b|\bSpeechSynthesisUtterance\b/);
  assert.doesNotMatch(engine, /\bdocument\.|\bwindow\.|\blocalStorage\b/);
  assert.match(game, /\bAudioContext\b/);
  assert.match(game, /\bspeechSynthesis\b/);
});

test('程序合成音效覆盖 ≥10 类事件，含洗牌/发牌、摸牌、出牌、碰、杠、胡、结算、鸟、骰子', () => {
  const m = /var SFX_KINDS = \[([\s\S]*?)\];/.exec(html);
  assert.ok(m, '必须声明 SFX_KINDS 音效表');
  const kinds = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.ok(kinds.length >= 10, '音效种类至少 10 类，实际 ' + kinds.length);
  ['shuffle', 'deal', 'draw', 'discard', 'peng', 'gang', 'win', 'lose', 'drawGame', 'bird', 'dice',
    'oppDraw', 'turn', 'select', 'correct', 'wrong']
    .forEach(k => assert.ok(kinds.includes(k), '缺少音效：' + k));
  // 每个 kind 都要在 sfx() 里真的接到合成配方上
  const body = /function sfx\(kind, info\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(body, '必须存在 sfx(kind, info)');
  kinds.forEach(function (k) {
    assert.ok(body[1].includes("'" + k + "'"), 'sfx 未处理 kind=' + k);
  });
  assert.ok(html.includes("window.__zmjSfxKinds"), '需要测试钩子 __zmjSfxKinds');
  assert.ok(html.includes("window.__zmjSfxLog"), '需要测试钩子 __zmjSfxLog');
});

test('每个音效都走同一个音效总线（cfg.sound 总开关 + 音量滑杆）', () => {
  assert.match(html, /SFX_GAIN = AC\.createGain\(\)/);
  assert.match(html, /SFX_GAIN\.gain\.value = Math\.max\(0, Math\.min\(1, cfg\.sfxVolume \/ 100\)\)/);
  assert.match(html, /function sfxBus\(a\) \{ return SFX_GAIN \|\| a\.destination; \}/);
  const hits = html.match(/g\.connect\(sfxBus\(a\)\)/g) || [];
  assert.ok(hits.length >= 2, 'hit/tone 都必须接音效总线');
  assert.match(html, /function sfx\(kind, info\) \{\s*if \(!cfg\.sound \|\| pageHidden\(\)\) return false;/);
  const sfxCheck = /function sfxCheck\(\) \{([\s\S]*?)\n  \}\n  \/\/ 联机代理/.exec(html);
  assert.ok(sfxCheck, '必须存在 sfxCheck');
  assert.ok(sfxCheck[1].includes('if (!cfg.sound)'), '总开关关闭时不播放、不创建 AudioContext');
});

test('语音报牌默认关闭，只写独立 #announce，绝不写进教练/提示区', () => {
  const announce = tag('announce');
  assert.ok(announce > 0, '必须有 #announce');
  const el = html.slice(announce, html.indexOf('</div>', announce));
  assert.match(el, /role="status"/);
  assert.match(el, /aria-live="polite"/);
  assert.match(el, /width:1px;height:1px/, '视觉隐藏，不改变布局');
  // #announce 必须在 #app 之外：弹窗/结算把 #app 设为 inert 时仍能被读屏读到
  const appStart = html.indexOf('<div id="app">');
  const appEnd = html.indexOf('<!-- 报牌 live region', appStart);
  const rotateStart = html.indexOf('<div id="rotate"');
  assert.ok(appStart > 0 && appEnd > appStart && rotateStart > appEnd, '页面结构必须包含 #app 与 #rotate');
  assert.ok(announce > appEnd && announce < rotateStart, '#announce 在 #app 之后、#rotate 之前');
  assert.ok(announce > html.indexOf('<footer id="actionbar">'), '#announce 在 footer 之后');
  assert.equal(html.slice(appStart, appEnd).includes('id="announce"'), false, '#announce 不能在 #app 内');
  // 不在 #hint / #coach 的内容里
  const hintBlock = between(tag('hint'), tag('situation'));
  assert.equal(hintBlock.includes('announce'), false, '#announce 不能写进 #hint');
  const coachBlock = between(tag('coach'), tag('coach') + 320);
  assert.equal(coachBlock.includes('announce'), false, '#announce 不能写进 #coach');
  assert.ok(html.includes("if (!text || !cfg.sound || cfg.voice === 'off' || pageHidden()) return false;"), '报牌默认关闭');
  assert.ok(html.includes('function announce(text, pace, important)'), '必须存在 announce()');
});

test('报牌文本模板只含公开事实：不报建议/概率/对手摸牌', () => {
  const fn = /function announceDiscard\(seat, kind, hs, voice\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(fn, '必须存在 announceDiscard');
  assert.match(fn[1], /你打/);
  assert.match(fn[1], /下家打/);
  // 对手摸牌只出 oppDraw 声音，不产生任何文本
  const drawBranch = /if \(e\.t === 'd'\) \{([\s\S]*?)\} else if \(e\.t === 'x'\)/.exec(html);
  assert.ok(drawBranch, 'sfxCheck 必须处理摸牌事件');
  assert.equal(/oppDraw[^\n]*text\s*=/.test(drawBranch[1]), false, '对手摸牌不得生成报牌文本');
  ['建议', '推荐', '牌效', '向听', '风险', '概率'].forEach(function (word) {
    assert.equal(html.slice(tag('announce'), tag('announce') + 400).includes(word), false, '#announce 区域不得出现 ' + word);
  });
});

test('不引入任何外部音频/语音资源，也不新增构建步骤', () => {
  assert.doesNotMatch(html, /<\s*audio\b/i);
  assert.doesNotMatch(html, /\.(?:mp3|wav|ogg|m4a|aac|flac)\b/i);
  assert.doesNotMatch(html, /data:audio/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(html, /\brequire\s*\(/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'package.json')), false);
});

test('报牌最小队列：不当场 cancel 上一句；隐藏页面不 speak、恢复不补播', () => {
  assert.match(html, /var TTS_GAP = 600;/);
  assert.match(html, /if \(TTS\.speaking \|\| TTS\.queue\.length \|\| now < TTS\.until\)/);
  assert.match(html, /u\.onend = function \(\) \{ TTS\.speaking = false; TTS\.until = 0; flushAnnounce\(\); \}/);
  assert.match(html, /function flushAnnounce\(\)/);
  assert.match(html, /function scheduleAnnounce\(\)/);
  assert.doesNotMatch(html, /s\.cancel\(\); s\.speak\(u\)/, '不能每句前 cancel 上一句');
  assert.match(html, /function pageHidden\(\)/);
  const sfxFn = /function sfx\(kind, info\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(sfxFn && sfxFn[1].includes('pageHidden()'), 'sfx 入口检查页面隐藏');
  assert.match(html, /if \(!text \|\| !cfg\.sound \|\| cfg\.voice === 'off' \|\| pageHidden\(\)\) return false;/);
  const sfxCheck = /function sfxCheck\(\) \{([\s\S]*?)\n  \}\n  \/\/ 联机代理/.exec(html);
  assert.ok(sfxCheck && sfxCheck[1].includes('if (pageHidden())'), 'sfxCheck 隐藏时推进游标');
  assert.match(html, /function cancelAnnounce\(force\)/);
  assert.match(html, /force \|\| cfg\.voice !== 'off' \|\| active/);
  assert.match(html, /cancelAnnounce\(true\)/, '设置切到关闭时强制取消');
  assert.match(html, /function unlockAudio\(\) \{\s*\/\/[^\n]*\n\s*if \(!cfg\.sound\) return;/, 'sound=false 不预热 TTS');
});

test('设置面板有性格/语音/两个音量，且默认值写进白名单恢复', () => {
  ['setPersona', 'setVoice', 'setSfxVolume', 'setVoiceVolume'].forEach(function (id) {
    assert.ok(tag(id) > 0, '缺少设置项 #' + id);
    assert.match(html, new RegExp('id="' + id + '"[^>]*aria-label='), id + ' 需要 aria-label');
  });
  assert.match(html, /persona: 'off', voice: 'off', sfxVolume: 100, voiceVolume: 80/);
  assert.match(html, /\['off', 'classic', 'random'\]\.indexOf\(savedCfg\.persona\)/);
  assert.match(html, /\['off', 'key', 'all'\]\.indexOf\(savedCfg\.voice\)/);
  assert.match(html, /\['sfxVolume', 'voiceVolume'\]/);
  assert.match(html, /cfg\.persona = \$\('setPersona'\)\.value/);
  assert.match(html, /cfg\.voice = \$\('setVoice'\)\.value/);
});

test('3D 与 2D 都能触发音效，且 onProject 每帧不发声', () => {
  assert.match(html, /if\(settled\)sfx\('dice'\)/);
  assert.match(html, /sfx\('deal'\)/);
  assert.match(html, /sfx\('select'\)/);
  assert.match(html, /sfx\(kind === sc\.best \? 'correct' : 'wrong'\)/);
  const project = /onProject:function\(cards\)\{([\s\S]*?)\n        \}/.exec(html);
  assert.ok(project, '必须保留 onProject');
  assert.equal(project[1].includes('sfx('), false, 'onProject 每帧触发，绝不发声');
  assert.ok(html.includes("table3D.lastDealSfx"), '发牌音需要节流');
});
