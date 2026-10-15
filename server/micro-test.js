'use strict';
/**
 * micro-test.js —— 40 行零依赖测试跑器。
 * 为什么不用 node:test：跑器在被测代码留下悬挂句柄（探针 socket / 监听端口）时不会退出，
 * 批处理里会把整条命令挂死。这里跑完强制 exit，输出也保持简洁。
 * 用法：test('名字', async () => { ... }) … 末尾 run()
 */
const cases = [];
function test(name, fn) { cases.push({ name: name, fn: fn }); }
async function run() {
  let pass = 0, fail = 0;
  const t0 = Date.now();
  for (const c of cases) {
    try {
      await c.fn();
      pass++; console.log('  ok    ' + c.name);
    } catch (e) {
      fail++;
      const msg = String((e && e.message) || e).split('\n').map((l) => '        ' + l).join('\n');
      console.log('  FAIL  ' + c.name + '\n' + msg);
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total  (' + (Date.now() - t0) + 'ms)');
  process.exit(fail ? 1 : 0);
}
module.exports = { test, run };
