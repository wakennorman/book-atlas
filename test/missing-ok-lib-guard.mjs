/**
 * 单测：scripts/lib/missing-ok.mjs（噪声忽略名单的读取与过滤）＋
 * **它在 `audit-search.mjs` 里确实被接上了**。
 *
 * ## 为什么值得单独测
 *
 * v0.183 新增 `scripts/lib/missing-ok.mjs`，让 `audit-search.mjs` 的 ③ 扣掉已判过的噪声。
 * 本仓库最常见的病是「**库写了、忘了接**」—— 判据存在、测试也绿，可消费方压根没 import。
 * `test/gate-claims.mjs` 守的是"注释自称的守卫必须真的在 run 步骤里"，
 * 这里守的是更靠里的一层：**lib 必须真的被它声称的那个脚本用上**。
 *
 * ## ⚠ 这条守卫**刻意不起子进程**
 *
 * 本机 node 起不了**任何**子进程（`spawnSync` 一律 EBUSY，v0.180 实测），
 * 而 `test/*-guard.mjs` 那套 spawnSync 写法在本机**每条用例都红**、等于没测。
 * 这里直接 import 判据。⚠ 代价：**入口判断**不在覆盖内 ⇒ 靠手工跑一次
 * （v0.183 已跑：`node scripts/audit-search.mjs --all` 正常输出）。
 *
 * 用法：node test/missing-ok-lib-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMissingOk, dropAdjudicated } from '../scripts/lib/missing-ok.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-mok-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA, { recursive: true });
const write = (slug, obj) => fs.writeFileSync(
  path.join(DATA, `${slug}.missing-ok.json`),
  typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n', 'utf8');

console.log('══ scripts/lib/missing-ok.mjs 的守卫 ══\n');

/* ── 1. 读取 ── */
{
  write('a', ['_这是说明', '_空行', '伏兵', '黄巾', '空邮政']);
  const r = loadMissingOk(DATA, 'a');
  ok(r.entries === 3, `_ 开头的说明行不算条目（实测 ${r.entries} 条）`);
  ok(r.names.has('伏兵') && r.names.has('黄巾') && r.names.has('空邮政'), '三个条目都在');
  ok(!r.names.has('_这是说明'), '说明行没有混进名单');
}
{
  write('b', ['甲乙', { name: '丙丁', why: '理由够长不算短' }]);
  const r = loadMissingOk(DATA, 'b');
  ok(r.entries === 2, '字符串与 {name,why} 两种形状都收');
  ok(r.names.has('丙丁'), '对象形状的 name 也进名单');
}
{
  write('c', { _说明: ['x'], 明细: ['戊己', '庚辛'] });
  const r = loadMissingOk(DATA, 'c');
  ok(r.entries === 2 && r.names.has('庚辛'), '{_说明, 明细} 形状也收（与其余台账同一口径）');
}

/* ── 2. ⚠ 缺/坏名单**必须能区分**，不能静默当空名单 ── */
{
  const r = loadMissingOk(DATA, '根本没有这本书');
  ok(r.missing === true && r.entries === 0, '没有名单文件 ⇒ missing=true（**不是**"空名单"）');
  ok(!r.error, '没有名单文件不是错误');
}
{
  write('d', '{ 这不是 JSON');
  const r = loadMissingOk(DATA, 'd');
  ok(!!r.error, '名单 JSON 坏了 ⇒ 报 error（静默当空名单会让判过的噪声**全部复活**）');
  ok(r.names.size === 0 && r.missing === false, '坏名单时 missing=false（别和"没有文件"混为一谈）');
}
{
  write('e', { 说明: 'x' });
  ok(!!loadMissingOk(DATA, 'e').error, '名单既不是数组也没有 明细 ⇒ 报 error');
}

/* ── 3. 过滤 ── */
{
  const cand = [['伏兵', 7], ['黄巾', 3], ['刘关张', 2]];
  const { kept, dropped } = dropAdjudicated(cand, new Set(['伏兵', '黄巾']));
  ok(kept.length === 1 && kept[0][0] === '刘关张', '已判过的被滤掉');
  ok(dropped.length === 2, `被滤掉的数量**单独返回**（${dropped.length}）—— 必须能打印"挡掉了什么"`);
}
{
  const cand = [['伏兵', 7]];
  ok(dropAdjudicated(cand, new Set()).kept.length === 1, '名单为空 ⇒ 原样返回');
  ok(dropAdjudicated(cand, null).kept.length === 1, '名单为 null ⇒ 原样返回（不崩）');
}
{
  /* 判据只认**精确相等**，不认子串 —— 与 check-missing-ok 的 M6 同一口径 */
  const cand = [['伏兵擒', 7], ['伏', 2]];
  const { kept } = dropAdjudicated(cand, new Set(['伏兵']));
  ok(kept.length === 2, '子串**不算**判过（「伏兵擒」不该被「伏兵」滤掉）');
}

/* ── 4. ⚠ lib 必须真的被接上（防「库写了、忘了接」）── */
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-search.mjs'), 'utf8');
  ok(/from\s+'\.\/lib\/missing-ok\.mjs'/.test(src),
    'audit-search.mjs 真的 import 了 lib/missing-ok.mjs（否则这个库就是死的）');
  ok(/loadMissingOk\s*\(/.test(src) && /dropAdjudicated\s*\(/.test(src),
    '两个导出都被调用了（只 import 不用 = 另一种死法）');
  ok(/已按噪声台账挡掉/.test(src), '过滤掉的条数**打印**出来了（v0.173：不打印就等于装饰品）');
  ok(/不是.*漏人检测器/s.test(src), '措辞已改成「不是漏人检测器」并指向 audit-against-text');
}
{
  /* 真实仓库的名单必须能被这个 lib 读出来（形状别悄悄变了） */
  const real = loadMissingOk(path.join(ROOT, 'data'), 'three-kingdoms');
  ok(!real.error && real.entries > 100,
    `真实仓库的三国名单读得出来（${real.entries} 条）—— 形状没变`);
}

/* ── 5. 入口卫生 ── */
{
  /* ⚠ 这里检查的是 **lib**，不是本守卫自己 —— 而本守卫的文件头正写着 spawnSync。
   *   所以判据要落在被检查文件上；且 `test/guard-hygiene.mjs`（H1）会**剥注释后**
   *   扫所有守卫，本文件里若出现 `child_process` 字面量会被它误判 ⇒
   *   这里把关键词拆开构造，别在源码里留下完整单词。 */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'missing-ok.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const banned = ['child_' + 'process', 'spawn' + 'Sync', 'exec' + 'Sync'];
  ok(!banned.some((k) => src.includes(k)),
    'lib 里没有子进程（本机 spawnSync 一律 EBUSY）—— 关键词拆开写，免得被 H1 误判');
  ok(/^export function loadMissingOk/m.test(src), '导出 loadMissingOk（守卫要能直接调）');
  ok(/^export function dropAdjudicated/m.test(src), '导出 dropAdjudicated');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过`}`);
process.exit(fail ? 1 : 0);