/**
 * 单测：scripts/check-cross-chapter-ledger.mjs（跨章声明台账的一致性检查）。
 *
 * ## 为什么值得单独测一条「检查脚本」
 *
 * 这条检查本身就是为了防"台账悄悄失效" —— 而**如果它自己永远 exit 0**，
 * 那它就是又一个「看着在守、其实没守」的假门禁（v0.145 / v0.146 / v0.154 / v0.156 /
 * v0.160~163 同一族）。⇒ 必须有一条测试**证明它真的会报红**。
 *
 * ## ⚠ 这条守卫**刻意不起子进程**
 *
 * 本机 node 起不了**任何**子进程（`spawnSync` 一律 EBUSY —— v0.174~v0.176 实测，
 * 见 CHANGELOG），所以 `test/*-guard.mjs` 里那套 `spawnSync(process.execPath, [SCRIPT])`
 * 在本机**每条用例都红**、等于没测。这里改用**导出的函数**：
 *
 *     checkCrossChapterLedger(root)   ← 显式传 root，在进程内直接跑
 *
 * 于是全部判据都能在本机验证。⚠ 代价：**入口判断**
 * （`import.meta.url === pathToFileURL(process.argv[1])`，本仓库目录名带空格，
 * 写错就"主流程一次都不跑、退出码还是 0"）不在这条守卫的覆盖范围内 ——
 * 那一点靠手工跑一次 `node scripts/check-cross-chapter-ledger.mjs` 确认
 * （v0.177 已跑：真实台账 ⇒ exit 0）。
 *
 * 用法：node test/cross-chapter-ledger-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCrossChapterLedger } from '../scripts/check-cross-chapter-ledger.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-cc-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(path.join(DATA, 'annotations'), { recursive: true });
const LEDGER = path.join(DATA, 'cross-chapter-ok.json');

/* demo 书：e1 在第 1 章、e2/e3 在第 2 章。
 * 第 2 章的条目声明了 [e2, e1] —— e1 是**跨章声明**（章 1 ≠ 章 2）。 */
fs.writeFileSync(path.join(DATA, 'demo.json'), JSON.stringify({
  meta: { slug: 'demo' }, characters: [], places: [], relations: [],
  events: [
    { id: 'e1', ch: 1, name: '第一章的事' },
    { id: 'e2', ch: 2, name: '第二章的事' },
    { id: 'e3', ch: 2, name: '第二章的另一件事' },
  ],
}, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(DATA, 'annotations', 'demo.json'), JSON.stringify({
  items: [
    { ch: 1, title: '第一章', body: '只有 e1', events: ['e1'] },
    { ch: 2, title: '第二章', body: '讲了 e2 和 e1', events: ['e2', 'e1'] },
  ],
}, null, 2) + '\n', 'utf8');

const GOOD = [{ book: 'demo', ch: 2, event: 'e1', why: '演示理由：正文引用了它，是有意的跨章对照' }];
const writeL = (o) => fs.writeFileSync(LEDGER, JSON.stringify(o, null, 2) + '\n', 'utf8');
const rmL = () => { try { fs.unlinkSync(LEDGER); } catch { /* 忽略 */ } };
const run = () => checkCrossChapterLedger(tmp);

console.log('══ scripts/check-cross-chapter-ledger.mjs 的守卫 ══\n');

writeL(GOOD);
ok(run().length === 0, '正常态（一条已核的跨章声明）⇒ 0 处问题');

rmL();
ok(run().length === 0, '没有台账文件 ⇒ 0 处问题（= 没有已核条目，不算错）');

/* ── 每条判据各造一个反例 ── */
const RED = [
  ['L1 顶层不是数组', { 说明: 'x' }],
  ['L2 条目不是对象', ['x']],
  ['L2 book 为空', [{ book: '  ', ch: 2, event: 'e1', why: '演示理由够八个字' }]],
  ['L2 ch 不是正整数', [{ book: 'demo', ch: '2', event: 'e1', why: '演示理由够八个字' }]],
  ['L2 event 为空', [{ book: 'demo', ch: 2, event: '', why: '演示理由够八个字' }]],
  ['L3 why 为空', [{ book: 'demo', ch: 2, event: 'e1', why: '   ' }]],
  ['L3 why 不足 8 字', [{ book: 'demo', ch: 2, event: 'e1', why: '太短' }]],
  ['L4 书不存在', [{ book: 'ghost', ch: 2, event: 'e1', why: '演示理由够八个字' }]],
  ['L5 该章没有条目', [{ book: 'demo', ch: 99, event: 'e1', why: '演示理由够八个字' }]],
  ['L6 事件不存在', [{ book: 'demo', ch: 2, event: 'e999', why: '演示理由够八个字' }]],
  ['L7 该章没有条目声明它（死条目）', [{ book: 'demo', ch: 2, event: 'e3', why: '演示理由够八个字' }]],
  ['L8 事件的章号就是台账的 ch（不再是跨章）', [{ book: 'demo', ch: 1, event: 'e1', why: '演示理由够八个字' }]],
  ['L9 同一 book|ch|event 重复', [GOOD[0], { ...GOOD[0], why: '另一条理由，也够八个字' }]],
  ['L10 数据里有跨章声明、台账里没有（未核）', []],
];
const RED_COUNT = RED.length;
for (const [label, obj] of RED) {
  writeL(obj);
  const ps = run();
  ok(ps.length > 0, `${label} ⇒ 报红（${ps.length} 处）${ps.length ? '' : ' —— ⚠ 没报红！'}`);
}

/* JSON 语法坏 */
fs.writeFileSync(LEDGER, '{ 这不是 JSON', 'utf8');
ok(run().length > 0, 'L1 JSON 解析失败 ⇒ 报红');

/* 正向：多条合法条目 + 一个非 demo 的书不参与 ⇒ 不误伤 */
writeL([
  GOOD[0],
  { book: 'demo', ch: 2, event: 'e2', why: '这一条不跨章，本该报 L8' },
]);
ok(run().length === 1 && /L8|不再是跨章/.test(run().join('')), 'L8 反向：只有"不跨章"的那条被报，合法的跨章条目不误伤');

writeL(GOOD);
ok(run().length === 0, '还原后 ⇒ 0 处问题');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过（含 ${RED_COUNT} 条「期望报红」场景 + 1 条 JSON 坏）`}`);
process.exit(fail ? 1 : 0);
