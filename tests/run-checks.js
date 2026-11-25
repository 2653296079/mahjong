'use strict';
// 发布前运行：node tests/run-checks.js --browser
const { spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..');

// ---- 环境前置检查：不达标直接拒跑，不带着脏环境出结果 ----
// 背景：历史上页面测试的 Edge 临时配置目录泄漏，曾把 C 盘写满至 0GB，
// 磁盘满会让页面写入失败、渲染中断，跑出一整晚不可信的“卡住/崩溃/超时”。
// 因此盘余 <20GB 或 %TEMP%\zmj-* 仍有残留时，直接拒绝运行并说明原因。
const MIN_FREE_GB = 20;
const TEMP_PREFIX = 'zmj-';

// ---- 指纹前置检查：BOM 与清单登记必须是预期状态，否则拒跑 ----
// 背景：2026-11-08 一晚上 BOM 被踩了三次（洗掉、写进去、再洗掉），
// 靠群里互相提醒守不住，改成机器判定，不达标直接拒跑并指出是哪一项。
const BOM = [0xEF, 0xBB, 0xBF];
const FINGERPRINTS = [
  { file: 'index.html', bom: true },
  { file: 'sw.js', bom: true },
  { file: 'server.js', bom: true },
  { file: 'assets/table3d/table3d.js', bom: false },
];
function hasBom(buf) {
  return buf.length >= 3 && buf[0] === BOM[0] && buf[1] === BOM[1] && buf[2] === BOM[2];
}
function fingerprintProblems() {
  const problems = [];
  for (const spec of FINGERPRINTS) {
    const full = path.join(root, spec.file);
    if (!fs.existsSync(full)) { problems.push(spec.file + ' 不存在'); continue; }
    const buf = fs.readFileSync(full);
    const actual = hasBom(buf);
    if (actual !== spec.bom) {
      problems.push(spec.file + ' 的 BOM 应为 ' + spec.bom + '，实际 ' + actual + '（' + buf.length + ' 字节）');
    }
  }
  return problems;
}
function manifestProblems(jobs) {
  const nodeTests = new Set(jobs.filter(([command]) => command === '--test').flatMap((job) => job.slice(1)));
  return [
    'tests/draw-nth.test.js',
    'tests/wall-slot-map.test.js',
    'tests/companions-v64.test.js',
    'tests/startup-v64.test.js',
    'tests/v64-interaction.test.js',
  ].filter((file) => !nodeTests.has(file)).map((file) => '清单缺少 ' + file);
}

function envProblems() {
  const problems = [];
  if (process.argv.includes('--room-pack') && (!process.env.BLENDER_BIN || !process.env.ROOM_PACK_FIXTURE)) {
    problems.push('--room-pack 需要设置 BLENDER_BIN 和 ROOM_PACK_FIXTURE；集成测试不会以跳过结果冒充通过');
  }
  try {
    const freeGB = (() => {
      const disk = process.platform === 'win32' ? 'C:/' : root;
      const stat = fs.statfsSync(disk);
      return (stat.bavail * stat.bsize) / (1024 ** 3);
    })();
    if (Number.isFinite(freeGB) && freeGB < MIN_FREE_GB) {
      problems.push('C 盘剩余 ' + freeGB + 'GB，低于 ' + MIN_FREE_GB + 'GB 下限');
    }
  } catch (e) {
    problems.push('读取磁盘余量失败（' + String(e.message || e).slice(0, 120) + '）');
  }
  try {
    const stale = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(TEMP_PREFIX));
    if (stale.length) {
      // 列出创建时间，便于区分「刚建出来正在用」与「昨天的残留」
      const detail = stale.slice(0, 8).map((n) => {
        let at = '时间未知';
        try { at = fs.statSync(path.join(os.tmpdir(), n)).birthtime.toLocaleString('zh-CN', { hour12: false }); } catch (e) {}
        return n + '（建于 ' + at + '）';
      }).join(', ');
      problems.push('%TEMP% 仍有 ' + stale.length + ' 个 ' + TEMP_PREFIX + '* 目录：'
        + detail + (stale.length > 8 ? ' …' : ''));
      if (browserTestsRunning()) {
        problems.push('检测到 pages-compat/browser-online/node tests 进程正在运行，'
          + '这些目录大概率「正在使用中」，不是泄漏 —— 请等其结束再跑，不要删别人的配置目录');
      } else {
        problems.push('未检测到相关测试进程，判定为残留，可安全删除后重试');
      }
    }
  } catch (e) {
    problems.push('扫描临时目录失败（' + String(e.message || e).slice(0, 120) + '）');
  }
  return problems;
}

// 是否有人的页面测试正在跑（用来区分「正在用」与「真残留」）
function browserTestsRunning() {
  try {
    if (process.platform !== 'win32') {
      const out = execSync('ps -A -o args=', { encoding: 'utf8', timeout: 15000 });
      return /pages-compat\.js|browser-online\.js|run-checks\.js/.test(out);
    }
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" '
      + '| ForEach-Object { $_.CommandLine }"',
      { encoding: 'utf8', timeout: 20000 });
    return /pages-compat\.js|browser-online\.js|run-checks\.js/.test(out || '');
  } catch (e) {
    return false;
  }
}
const jobs = [
  ['--test', 'tests/online-service.test.js', 'tests/accounts.test.js', 'tests/river.test.js', 'tests/core.test.js', 'tests/multi.test.js', 'tests/training.test.js', 'tests/decision.test.js', 'tests/progress.test.js', 'tests/lessons.test.js', 'tests/settlement.test.js', 'tests/server-limits.test.js', 'tests/evaluation.test.js', 'tests/connection-check.test.js', 'tests/offline.test.js', 'tests/personas.test.js', 'tests/audio.test.js', 'tests/atmosphere.test.js', 'tests/wall-slot-map.test.js', 'tests/draw-nth.test.js', 'tests/companions-v64.test.js', 'tests/startup-v64.test.js', 'tests/v64-interaction.test.js'],
  ['server/test-ws.js'], ['server/test-rooms.js'], ['server/test-online.js'],
  ['tests/no-build-check.js'], ['tests/smoke-server.js']
];
if (process.argv.includes('--room-pack')) jobs.push(['--test', 'tests/room-pack.test.js']);
if (process.argv.includes('--browser')) jobs.push(
  ['tests/pages-compat.js', 'table-3d-ui'], ['tests/pages-compat.js', 'table-3d-drag'],
  ['tests/pages-compat.js', 'retry-3d'], ['tests/pages-compat.js', 'retry-3d', '--dependency'],
  ['tests/pages-compat.js', 'persona-ui'],
  ['tests/pages-compat.js', 'audio-ui'],
  ['tests/pages-compat.js', 'account-ui', '--accounts'],
  ['tests/pages-compat.js', 'connection-ui', '--accounts'],
  ['tests/pages-compat.js', 'table-layout'],
  ['tests/pages-compat.js', 'river-hover-ui'],
  ['tests/pages-compat.js', 'hand-sort-ui'],
  ['tests/pages-compat.js', 'mobile-ui'],
  ['tests/pages-compat.js', 'tile-legibility-ui'],
  ['tests/pages-compat.js', 'visual-ui'],
  ['tests/pages-compat.js', 'training-ui'], ['tests/pages-compat.js', 'training-release'],
  ['tests/pages-compat.js', 'lesson-ui'],
  ['tests/pages-compat.js', 'settlement-ui'],
  ['tests/pages-compat.js', 'selection-ui'], ['tests/pages-compat.js', 'online-response', '--hub'],
  ['tests/pages-compat.js', 'worker-ui', '--hub'],
  ['tests/pages-compat.js', 'coach-advice'], ['tests/pages-compat.js', 'reconnect', '--hub'],
  ['tests/pages-compat.js', 'atmosphere-ui'],
  ['tests/pages-compat.js', 'music-ui'],
  ['tests/pages-compat.js'], ['tests/browser-online.js']
);

const problems = envProblems().concat(fingerprintProblems(), manifestProblems(jobs));
if (problems.length) {
  process.stderr.write('发布检查前置条件未通过：\n');
  for (const problem of problems) process.stderr.write('  - ' + problem + '\n');
  process.exit(1);
}
process.stdout.write('环境检查通过（C 盘可用、%TEMP%\\zmj-* 无残留）\n');
if (!process.argv.includes('--room-pack')) {
  process.stdout.write('Blender room-pack 集成未运行（使用 --room-pack 显式启用）\n');
}

for (const args of jobs) {
  process.stdout.write('\n运行 node ' + args.join(' ') + '\n');
  const started = Date.now();
  const roomPack = args.includes('tests/room-pack.test.js');
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', timeout: roomPack ? 900000 : 300000 });
  if (result.error || result.status !== 0) {
    if (result.error) process.stderr.write(result.error.message + '\n');
    process.exit(result.status || 1);
  }
  process.stdout.write('完成（' + Math.round((Date.now() - started) / 1000) + 's）\n');
}
process.stdout.write('\n全部检查通过。\n');
