'use strict';
// 发布前运行：node tests/run-checks.js --browser
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
const jobs = [
  ['--test', 'tests/core.test.js', 'tests/multi.test.js', 'tests/training.test.js', 'tests/decision.test.js', 'tests/progress.test.js', 'tests/offline.test.js'],
  ['server/test-ws.js'], ['server/test-rooms.js'], ['server/test-online.js'],
  ['tests/no-build-check.js'], ['tests/smoke-server.js']
];
if (process.argv.includes('--browser')) jobs.push(
  ['tests/pages-compat.js', 'training-ui'], ['tests/pages-compat.js', 'training-release'],
  ['tests/pages-compat.js', 'coach-advice'], ['tests/pages-compat.js', 'reconnect', '--hub'],
  ['tests/pages-compat.js'], ['tests/browser-online.js']
);
for (const args of jobs) {
  process.stdout.write('\n运行 node ' + args.join(' ') + '\n');
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', timeout: 150000 });
  if (result.error || result.status !== 0) {
    if (result.error) process.stderr.write(result.error.message + '\n');
    process.exit(result.status || 1);
  }
}
process.stdout.write('\n全部检查通过。\n');
