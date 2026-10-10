/**
 * 单测：scripts/check-name-form-ledger.mjs（「采用名字台账」的引用完整性检查）。
 *
 * ## 为什么值得单独测一条「检查脚本」
 *
 * 这条检查本身就是为了防「台账在，人却不查了」—— 而**如果它自己永远 exit 0**
 * （比如入口判断写成 `import.meta.url.endsWith(process.argv[1])`，
 *   而本仓库目录名带空格、路径里的空格是 %20 编码的 ⇒ 两边永远不相等 ⇒ 主流程一次都不跑），
 * 那它就是又一个「看着在守、其实没守」的假门禁 —— 正是本项目反复踩的那一族
 * （v0.145 门禁只守 1/N、v0.146 判据存在但从不触发、v0.154 注释吹牛、v0.156 恒 exit 0）。
 * ⇒ 必须有一条测试**证明它真的会报红**，否则它随时可能悄悄退化成空转。
 *
 * ## 怎么测：造一个**临时目录**，把 ROOT 指过去
 *
 * 脚本支持 `BOOKATLAS_ROOT` 环境变量（只给测试用），所以这里在 tmp 里写一份最小
 * `data/demo.json` + `data/demo.name-form-ok.json`，逐场景跑、断言**判据函数返回的问题条数**。
 * **全程不碰真实仓库** —— 注入测试如果直接改 data/ 下的真文件，一旦中途崩了，
 * 仓库就被留在脏状态里（这类测试不该有这种副作用）。
 *
 * ## v0.180：从「起子进程看退出码」改成「直接 import 判据函数」
 *
 * 原先靠 `spawnSync(process.execPath, [SCRIPT]).status` 断言退出码，可是
 * **本机 node 起不了任何子进程**（EBUSY）⇒ `status` 恒为 `null` ⇒
 * `null === 0` 与 `null === 1` **全都为假** ⇒ 这个文件里**每一条**用例都红
 * （跑出来是「✗ 10 条不符合预期」，其实**一条都没测到**）—— 守卫自己成了假门禁。
 * 改成 `await import(...)` 拿导出的 `checkNameFormLedgers()`，断言 `problems.length`。
 *
 * ⚠ `process.env.BOOKATLAS_ROOT` **必须在 import 之前**设好：
 *   `lib/data-files.mjs` 的 `ROOT` / `DATA` 是**模块级常量**，import 之后再设就晚了。
 * ⚠ 入口那段（`pathToFileURL` 判断 + `process.exit`）不在这里测 ——
 *   改由 `test/guard-hygiene.mjs` **静态**守着（不起子进程也能守住）。
 *
 * 用法：node test/name-form-ledger-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-nfl-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA);
const LEDGER = path.join(DATA, 'demo.name-form-ok.json');

/* 最小书：一个人物的主名「无名氏」本身就是"非原书原样字"那种人（用来说明台账存在的理由），
 * 别名「某甲」用来演示 E2。 */
fs.writeFileSync(path.join(DATA, 'demo.json'), JSON.stringify({
  meta: { slug: 'demo' },
  characters: [
    { id: 'a', name: '无名氏', aliases: ['某甲'] },
    { id: 'b', name: '有名字', aliases: [] },
  ],
  relations: [],
}, null, 2) + '\n', 'utf8');

const writeLedger = (obj) => fs.writeFileSync(LEDGER, JSON.stringify(obj, null, 2) + '\n', 'utf8');

/* ⚠ 环境变量必须在 import 之前设好（见文件头） */
process.env.BOOKATLAS_ROOT = tmp;
const { checkNameFormLedgers } = await import('../scripts/check-name-form-ledger.mjs');
const run = () => checkNameFormLedgers();

const GOOD = { _说明: ['演示'], 申报条数: 1, 明细: [{ name: '无名氏', why: '演示理由' }] };

console.log('══ scripts/check-name-form-ledger.mjs 的守卫 ══\n');

writeLedger(GOOD);
ok(run().length === 0, '正常态（键 = 真实主名）⇒ 0 处问题');

const RED = [
  ['E1 键既不是主名、也不是别名', { _说明: ['x'], 申报条数: 1, 明细: [{ name: '查无此人', why: 'r' }] }],
  ['E2 键只出现在别名里（申报不生效）', { _说明: ['x'], 申报条数: 1, 明细: [{ name: '某甲', why: 'r' }] }],
  ['E3 申报条数 ≠ 明细条数', { _说明: ['x'], 申报条数: 9, 明细: [{ name: '无名氏', why: 'r' }] }],
  ['E4 why 为空', { _说明: ['x'], 申报条数: 1, 明细: [{ name: '无名氏', why: '   ' }] }],
  ['E5 name 重复', { _说明: ['x'], 申报条数: 2, 明细: [{ name: '无名氏', why: 'r' }, { name: '无名氏', why: 'r2' }] }],
  ['E6 台账在、对应的书不在（孤儿台账）', null],   // 见下：要先造 ghost 文件
  ['E7 既不是数组、也没有 明细 数组', { _说明: ['x'], 申报条数: 3 }],
];
for (const [label, obj] of RED) {
  if (obj) { writeLedger(obj); }
  else {
    writeLedger(GOOD);
    fs.writeFileSync(path.join(DATA, 'ghost.name-form-ok.json'),
      JSON.stringify({ 明细: [{ name: 'x', why: 'y' }] }, null, 2) + '\n', 'utf8');
  }
  ok(run().length > 0, `${label} ⇒ 报红`);
  const ghost = path.join(DATA, 'ghost.name-form-ok.json');
  if (fs.existsSync(ghost)) fs.unlinkSync(ghost);
}

/* 形状兼容：纯数组（没有 `明细` 包裹）也要能收 —— 消费方那边为这事崩过一次。 */
writeLedger([{ name: '无名氏', why: 'r' }]);
ok(run().length === 0, '纯数组形状（没有 `明细` 包裹）也能收 ⇒ 0 处问题');

writeLedger(GOOD);
ok(run().length === 0, '还原后 ⇒ 0 处问题');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过（含 7 条「期望报红」场景）`}`);
process.exit(fail ? 1 : 0);
