/**
 * 给所有浏览器测试补上 CDP 挂死保护（一次性脚本，v0.100 用过即弃）。
 *
 * 为什么要补：`new WebSocket(null)` 会抛，"连不上"不抛；下面那个
 *   `await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; })`
 * 在 ws 既没 open 也没 error 时**永远不 settle** ⇒ 进程静默挂死：
 * stdout / stderr 0 字节、没有退出码，看起来像"卡在某个断言上"，
 * 其实一条断言都还没开始跑。实测在门禁里撞过两次，每次要等十几分钟超时。
 *
 * 两道防线：
 *   ① url 拿不到 ⇒ 立刻报错退出（并清理，别把 Edge 和 profile 留着）
 *   ② url 拿到了但 WS 连不上 ⇒ 10 秒后 reject
 *
 * 同样的洞在 16 个文件里（test/lock.mjs 上次只修了它自己那一个）。
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'test';
const SKIP = new Set(['lock.mjs', 'core.mjs', 'e2e.mjs', 'smoke.mjs', 'kin-terms.mjs', 'relations.mjs']);
const WRITE = process.argv.includes('--write');

/* 不走 CDP 的测试：e2e 有自己的 http 服务，core/smoke/kin-terms 是纯 node */
const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && !SKIP.has(f));

const GUARD = (hasRelease) => `/* ⚠ 连不上 CDP 时必须**在这里**报错退出，不能往下走。
 *
 * 下面是 \`new WebSocket(url)\` 加一个只监听 onopen/onerror 的 promise ——
 * url 拿不到时它是 null，连不上时那个 promise **永远不 settle**，
 * 于是进程静默挂死：stdout / stderr **0 字节**，没有异常、没有退出码，
 * 看起来像"卡在某个断言上"，其实一条断言都还没开始跑。
 * 实测在门禁里撞过两次，每次要等十几分钟超时才发现。
 * （v0.100 把这道防线补齐到所有走 CDP 的测试文件。）
 */
if (!url) {
  console.error('  ✗ Edge 起来后连不上 CDP 端点 —— 这是**环境/负载**问题，不是断言失败。');
  console.error('    多半是刚借到的临时端口被别的进程抢走了（借出到 Edge 抢占之间有个毫秒级窗口，');
  console.error('    见 test/_free-port.mjs 的说明）—— 重跑一次通常就好。');
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }${hasRelease ? '\n  releaseProfile(profile);' : ''}
  process.exit(1);
}`;

let changed = 0;
for (const f of files) {
  const p = path.join(DIR, f);
  let s = fs.readFileSync(p, 'utf8');
  const orig = s;

  const hasRelease = /releaseProfile\(/.test(s);
  const wsLine = s.split('\n').findIndex((l) => /^\s*(?:const\s+)?ws\s*=\s*new WebSocket\(url\)/.test(l));
  if (wsLine < 0) { console.log(`  · 跳过 ${f}（没有 ws = new WebSocket(url) 这一行）`); continue; }

  // ① url 空值守卫（已有就跳过）
  const before = s.split('\n').slice(0, wsLine).join('\n');
  if (!/if \(!url\)/.test(before)) {
    const lines = s.split('\n');
    lines.splice(wsLine, 0, GUARD(hasRelease), '');
    s = lines.join('\n');
  }

  // ② WS 打开加超时
  const raceOld = s.match(/^(\s*)await new Promise\(\(res, rej\) => \{ ws\.onopen = res; ws\.onerror = [^}]*\}\);\s*$/m);
  if (raceOld) {
    const ind = raceOld[1];
    /* ⚠ 必须去掉行尾的 `;` —— 它要变成 `Promise.race([ … ])` 的一个**数组元素**，
     *   带着分号就成了「语句 + 逗号」，语法错：
     *     await new Promise(…);   ← 多了个分号
     *     ,
     *   第一版没去掉，14 个文件全被改坏（node --check 直接报 Unexpected token ';'）。 */
    const body = raceOld[0].trim().replace(/;$/, '');
    const replacement = [
      `${ind}await Promise.race([`,
      `${ind}  ${body},`,
      `${ind}  new Promise((_, rej) => setTimeout(() => rej(new Error('CDP WebSocket 10 秒内没连上')), 10000)),`,
      `${ind}]);`,
    ].join('\n');
    s = s.replace(raceOld[0], replacement);
  }

  if (s !== orig) {
    if (WRITE) fs.writeFileSync(p, s, 'utf8');
    changed++;
    console.log(`  ${WRITE ? '已改' : '将改'} ${f}`);
  } else {
    console.log(`  · ${f} 已符合`);
  }
}
console.log(`\n共 ${changed} 个文件${WRITE ? '已修改' : '待修改（加 --write）'}`);
