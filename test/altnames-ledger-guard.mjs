/**
 * 单测：scripts/check-altnames-ledger.mjs（「又译出处台账」与数据的双向一致性检查）。
 *
 * ## 为什么值得单独测一条「检查脚本」
 *
 * 这条检查本身就是为了一份**没有任何消费者**的台账 —— 而**如果它自己永远 exit 0**
 * （入口判断写成 `import.meta.url.endsWith(process.argv[1])` 就够了：
 *   本仓库目录名带空格，路径里的空格是 %20 编码，两边永远不相等 ⇒ 主流程一次都不跑，
 *   而退出码还是 0 —— "检查通过"其实是"检查没执行"），
 * 那它就是又一个「看着在守、其实没守」的假门禁（v0.145 / v0.146 / v0.154 / v0.156 / v0.160 同一族）。
 * ⇒ 必须有一条测试**证明它真的会报红**。
 *
 * ## 怎么测：造一个**临时目录**，把 ROOT 指过去
 *
 * 脚本支持 `BOOKATLAS_ROOT` 环境变量（只给测试用），所以这里在 tmp 里写一份最小
 * `data/demo.json` + `data/demo.altnames-sources.json`，逐场景跑、断言**判据函数返回的问题条数**。
 * **全程不碰真实仓库**。
 *
 * ⚠ 顺带钉住一条**被否掉的判据**：不检查「`已拒绝的候选` 里的又译不得出现在数据里」——
 *   真实数据里就有一条 `小邦迪亚／邦迪亚上校`，拒绝理由是"S1 已给出、**不重复登记**"，
 *   也就是说它**本来就在数据里**。「拒绝」在这里指"不再登记进 `明细`"，不等于"不进数据"。
 *
 * ## v0.180：从「起子进程看退出码」改成「直接 import 判据函数」
 *
 * 原先靠 `spawnSync(process.execPath, [SCRIPT]).status` 断言退出码，可是
 * **本机 node 起不了任何子进程**（EBUSY）⇒ `status` 恒为 `null` ⇒
 * `null === 0` 与 `null === 1` **全都为假** ⇒ 这个文件里**每一条**用例都红
 * （跑出来是「✗ 12 条不符合预期」，其实**一条都没测到**）—— 守卫自己成了假门禁。
 * 改成 `await import(...)` 拿导出的 `checkAltnamesLedgers()`，断言 `problems.length`。
 *
 * ⚠ `process.env.BOOKATLAS_ROOT` **必须在 import 之前**设好：
 *   `lib/data-files.mjs` 的 `ROOT` / `DATA` 是**模块级常量**，import 之后再设就晚了。
 * ⚠ 入口那段（`pathToFileURL` 判断 + `process.exit`）不在这里测 ——
 *   改由 `test/guard-hygiene.mjs` **静态**守着（不起子进程也能守住）。
 *
 * 用法：node test/altnames-ledger-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-anl-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA);
const BOOK = path.join(DATA, 'demo.json');
const LEDGER = path.join(DATA, 'demo.altnames-sources.json');

fs.writeFileSync(BOOK, JSON.stringify({
  meta: { slug: 'demo' },
  characters: [
    { id: 'a', name: '甲', altNames: ['甲A'], aliases: [] },
    { id: 'b', name: '乙', altNames: [], aliases: [] },
  ],
  relations: [],
}, null, 2) + '\n', 'utf8');

const GOOD = {
  _说明: ['演示'],
  'altNames 计数': 1,
  来源: { S1: { title: '演示来源', where: 'https://example.invalid' } },
  明细: [{ 人物: '甲', 又译: ['甲A'], 出处: 'S1' }],
  已拒绝的候选: [{ 又译: '甲B', 页面挂在: '甲', 拒绝理由: '演示理由' }],
};
const writeLedger = (o) => fs.writeFileSync(LEDGER, JSON.stringify(o, null, 2) + '\n', 'utf8');

/* ⚠ 环境变量必须在 import 之前设好（见文件头） */
process.env.BOOKATLAS_ROOT = tmp;
const { checkAltnamesLedgers } = await import('../scripts/check-altnames-ledger.mjs');
const run = () => checkAltnamesLedgers();

console.log('══ scripts/check-altnames-ledger.mjs 的守卫 ══\n');

writeLedger(GOOD);
ok(run().length === 0, '正常态（明细与数据逐人一致）⇒ 0 处问题');

const RED = [
  ['B1 顶层没有 `明细` 数组', { _说明: ['x'], 'altNames 计数': 1 }],
  ['B2 `明细[].人物` 不是数据里的人物', { ...GOOD, 明细: [{ 人物: '丙', 又译: ['丙A'], 出处: 'S1' }] }],
  ['B3 数据里有 altName、台账没登记', { ...GOOD, 明细: [{ 人物: '甲', 又译: ['甲甲'], 出处: 'S1' }] }],
  ['B4 台账登记了、数据里没有', { ...GOOD, 明细: [{ 人物: '甲', 又译: ['甲A', '甲C'], 出处: 'S1' }] }],
  ['B5 `altNames 计数` 与数据不符', { ...GOOD, 'altNames 计数': 7 }],
  ['B6 `出处` 不在 `来源` 里', { ...GOOD, 明细: [{ 人物: '甲', 又译: ['甲A'], 出处: 'S9' }] }],
  ['B7 `明细` 里人物重复', { ...GOOD, 明细: [{ 人物: '甲', 又译: ['甲A'], 出处: 'S1' }, { 人物: '甲', 又译: ['甲A'], 出处: 'S1' }] }],
  ['B8 `已拒绝的候选` 缺 `拒绝理由`', { ...GOOD, 已拒绝的候选: [{ 又译: '甲B', 页面挂在: '甲', 拒绝理由: '  ' }] }],
];
for (const [label, obj] of RED) { writeLedger(obj); ok(run().length > 0, `${label} ⇒ 报红`); }

/* 反向：数据里有人带 altNames 却完全不在明细里（另一个人） */
writeLedger({ ...GOOD, 明细: [{ 人物: '乙', 又译: ['乙A'], 出处: 'S1' }] });
fs.writeFileSync(BOOK, JSON.stringify({
  meta: { slug: 'demo' },
  characters: [
    { id: 'a', name: '甲', altNames: ['甲A'], aliases: [] },
    { id: 'b', name: '乙', altNames: ['乙A'], aliases: [] },
  ],
  relations: [],
}, null, 2) + '\n', 'utf8');
ok(run().length > 0, 'B9 数据里「甲」有 altNames 但明细里没有这个人 ⇒ 报红');

/* 孤儿台账：书不存在 */
fs.writeFileSync(path.join(DATA, 'ghost.altnames-sources.json'),
  JSON.stringify({ 明细: [] }, null, 2) + '\n', 'utf8');
writeLedger(GOOD);
fs.writeFileSync(BOOK, JSON.stringify({
  meta: { slug: 'demo' }, characters: [{ id: 'a', name: '甲', altNames: ['甲A'], aliases: [] }], relations: [],
}, null, 2) + '\n', 'utf8');
ok(run().length > 0, 'B10 台账在、对应的书不在（孤儿台账）⇒ 报红');
fs.unlinkSync(path.join(DATA, 'ghost.altnames-sources.json'));

writeLedger(GOOD);
ok(run().length === 0, '还原后 ⇒ 0 处问题');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过（含 10 条「期望报红」场景）`}`);
process.exit(fail ? 1 : 0);
