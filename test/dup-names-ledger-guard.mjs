/**
 * 单测：scripts/check-dup-names-ledger.mjs（「去括号后同名」台账的门禁）。
 *
 * ## 为什么值得单独测
 *
 * 这条检查本身就是「防台账悄悄失效」的 —— 而**如果它自己永远 exit 0**，
 * 那它就是又一个「看着在守、其实没守」的假门禁（v0.145 / v0.146 / v0.154 /
 * v0.156 / v0.160~163 / v0.177~180 同一族）。⇒ 必须有一条测试**证明它真的会报红**。
 *
 * ## ⚠ 这条守卫**刻意不起子进程**
 *
 * 本机 node 起不了**任何**子进程（`spawnSync` 一律 EBUSY，v0.180 实测），
 * 所以 `test/*-guard.mjs` 那套 spawnSync 写法在本机**每条用例都红**、等于没测。
 * 这里直接 import 判据：`checkDupNamesLedger(tmp)`（显式传 root）。
 * ⚠ 代价：**入口判断**不在这条守卫覆盖内 ⇒ 靠手工跑一次确认
 *   （v0.181 已跑：`node scripts/check-dup-names-ledger.mjs` ⇒ exit 0）。
 *
 * ## 假语料
 *
 * tmp 里造两本 mini 书（真 slug 用不上，本门禁只读 data/，不碰原著）。
 * **基线状态全部带括号** —— 否则 L10（裸名重名）会在每条用例里恒红，把别的判据全盖住：
 *
 *   甲书：
 *     · 甲一「李四（甲）」+ 甲二「李四（乙）」  → 一组合法组
 *     · 乙一「王五（甲）」+ 乙二「王五（乙）」  → 一组合法组
 *     · 丙一「赵六」                          → 独苗，不该被当成组
 *   乙书：
 *     · 丁一「孙七（甲）」+ 丁二「孙七（乙）」  → 第二本书的一组合法组
 *
 * 裸名组（**没带括号**）在基线里**不存在**，只由第 3 节临时改出来测 L10。
 *
 * 用法：node test/dup-names-ledger-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDupNamesLedger } from '../scripts/check-dup-names-ledger.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-dupnames-'));
const DATA = path.join(tmp, 'data');
fs.mkdirSync(DATA, { recursive: true });
const LEDGER = path.join(DATA, 'dup-names-ok.json');

const BOOK_A = {
  meta: { slug: 'jia', chapters: 3 },
  characters: [
    { id: 'jia1', name: '李四（甲）' },
    { id: 'jia2', name: '李四（乙）' },
    { id: 'yi1', name: '王五（甲）' },
    { id: 'yi2', name: '王五（乙）' },
    { id: 'bing', name: '赵六' },
  ],
  relations: [], events: [], places: [],
};
const BOOK_B = {
  meta: { slug: 'yi', chapters: 2 },
  characters: [
    { id: 'ding1', name: '孙七（甲）' },
    { id: 'ding2', name: '孙七（乙）' },
  ],
  relations: [], events: [], places: [],
};
const writeA = (book) => fs.writeFileSync(path.join(DATA, 'jia.json'), JSON.stringify(book, null, 2) + '\n', 'utf8');
const writeB = (book) => fs.writeFileSync(path.join(DATA, 'yi.json'), JSON.stringify(book, null, 2) + '\n', 'utf8');
writeA(BOOK_A);
writeB(BOOK_B);

const WHY = '这两个人连阵营都不同，一处是本部将佐、一处是外姓人，原著里各写各的，确系重名';
const mk = (book, base, members, extra = {}) => ({ book, base, members, why: WHY, ...extra });
/** 三组合法组全登记（都带括号、成员与数据一致）⇒ 正常态 0 处问题 */
const GOOD = [
  mk('jia', '李四', ['jia1', 'jia2']),
  mk('jia', '王五', ['yi1', 'yi2']),
  mk('yi', '孙七', ['ding1', 'ding2']),
];
/** 少登记孙七那一组 ⇒ 专门喂 L9 */
const ALL_BUT_YI = GOOD.slice(0, 2);

const writeL = (o) => fs.writeFileSync(LEDGER, typeof o === 'string' ? o : JSON.stringify(o, null, 2) + '\n', 'utf8');
const rmL = () => { try { fs.unlinkSync(LEDGER); } catch { /* 忽略 */ } };
const run = () => checkDupNamesLedger(tmp);

console.log('══ scripts/check-dup-names-ledger.mjs 的守卫 ══\n');

/* ── 0. 先验假语料本身 ── */
{
  rmL();
  const { problems, notes } = run();
  const l9 = problems.filter((p) => /L9/.test(p));
  ok(l9.length === 3,
    `没有台账 ⇒ 三组都算「没登记」（L9 × 3）—— 实测 ${l9.length} 条`);
  ok(!problems.some((p) => /L10/.test(p)), '基线数据全带括号 ⇒ L10 不报（否则每条用例都会被它盖住）');
  ok(notes.some((n) => /按\*\*空台账\*\*继续判/.test(n)),
    '⚠ 缺台账时**必须打印**它在按空台账判 —— 不能静默当“没问题”');
}

/* ── 1. 正常态 ── */
writeL(GOOD);
ok(run().problems.length === 0, '正常态（3 组全登记、成员与数据一致、都带括号）⇒ 0 处问题');
{
  const { notes } = run();
  ok(notes.some((n) => /台账 3 条；数据里当前 3 组/.test(n)), `计数打印正确 —— ${notes[0]}`);
}

/* 明细形状（{_说明, 申报组数, 明细}）也收 */
writeL({ _说明: ['x'], 申报组数: 3, 明细: GOOD });
ok(run().problems.length === 0, '另一种形状（{_说明, 申报组数, 明细}）⇒ 同样 0 处问题');

/* ── 2. 每条判据各造一个反例 ── */
const RED = [
  ['L1 顶层既不是数组也没有 明细', { 说明: 'x' }],
  ['L2 条目不是对象', ['x']],
  ['L2 book 为空', [mk('  ', '李四', ['jia1', 'jia2']), ...GOOD.slice(1)]],
  ['L2 base 为空', [mk('jia', '', ['jia1', 'jia2']), ...GOOD.slice(1)]],
  ['L2 members 不是数组', [mk('jia', '李四', 'jia1'), ...GOOD.slice(1)]],
  ['L2 members 少于 2 个（一组至少两个人）', [mk('jia', '李四', ['jia1']), ...GOOD.slice(1)]],
  ['L2 members 里有空 id', [mk('jia', '李四', ['jia1', '']), ...GOOD.slice(1)]],
  ['L2 members 里有重复 id', [mk('jia', '李四', ['jia1', 'jia1']), ...GOOD.slice(1)]],
  ['L2 why 不是字符串', [mk('jia', '李四', ['jia1', 'jia2'], { why: 42 }), ...GOOD.slice(1)]],
  ['L3 why 为空', [mk('jia', '李四', ['jia1', 'jia2'], { why: '   ' }), ...GOOD.slice(1)]],
  ['L3 why 不足 8 字', [mk('jia', '李四', ['jia1', 'jia2'], { why: '太短' }), ...GOOD.slice(1)]],
  ['L3 why 用空白凑长度（去空白后仍不足 8 字）', [mk('jia', '李四', ['jia1', 'jia2'], { why: 'a b c d' }), ...GOOD.slice(1)]],
  ['L4 书不存在', [mk('ghost', '李四', ['jia1', 'jia2']), ...GOOD.slice(1)]],
  ['L5 数据里没有这一组（组被合并/改名了）', [mk('jia', '钱九', ['jia1', 'jia2']), ...GOOD.slice(1)]],
  ['L6 台账指向组外的人', [mk('jia', '李四', ['jia1', 'bing']), ...GOOD.slice(1)]],
  ['L7 台账少记一个人', [mk('jia', '李四', ['jia1']), ...GOOD.slice(1)]],
  ['L7 台账多记一个人（同组实际已换成三人）', [mk('jia', '李四', ['jia1', 'jia2', 'bing']), ...GOOD.slice(1)]],
  ['L8 同一 (book, base) 重复登记', [...GOOD, mk('jia', '李四', ['jia1', 'jia2'], { why: '另一条理由，同样够八个字' })]],
  ['L9 数据里有未登记的组（台账只覆盖一半）', ALL_BUT_YI],
  ['申报组数 ≠ 明细条数', { 申报组数: 99, 明细: GOOD }],
];
const RED_COUNT = RED.length;
for (const [label, obj] of RED) {
  writeL(obj);
  const ps = run().problems;
  ok(ps.length > 0, `${label} ⇒ 报红（${ps.length} 处）${ps.length ? '' : ' —— ⚠ 没报红！'}`);
}

/* JSON 语法坏 */
writeL('{ 这不是 JSON');
ok(run().problems.length > 0, 'L1 JSON 解析失败 ⇒ 报红');

/* ── 3. L10：裸名重名必须报红 ── */
{
  /* ⚠ 先把台账恢复成正常态：上一节最后一条用例把台账写成了坏 JSON，
   *   而 readLedger 遇坏 JSON 会**提前返回** ⇒ 后面这些用例全测不到 L10。
   *   （守卫自己的状态泄漏，也是「没测到」的一种 —— v0.180 定的 H1 就是这类。） */
  writeL(GOOD);
  /* 王五（甲）/王五（乙） → 王五/王五（台账成员不变，只改数据侧的主名） */
  const bare = JSON.parse(JSON.stringify(BOOK_A));
  bare.characters[2].name = '王五';
  bare.characters[3].name = '王五';
  writeA(bare);
  const ps = run().problems;
  const l10 = ps.filter((p) => /L10/.test(p));
  ok(l10.length > 0,
    `L10 组内成员主名都没带括号（「王五」×2）⇒ 报红（${l10.length} 条 L10）${l10.length ? '' : ' —— ⚠ 没报红！'}`);
  ok(l10.some((p) => /王五/.test(p)), 'L10 点名了具体是哪个主名没带括号');

  /* 反向：一半带括号一半不带 ⇒ 仍报（这一条最容易被写歪）。
   * ⚠ 改的是 characters[2]（王五（甲）那一半），不是 [3] —— [3] 本来就是「王五（乙）」，
   *   改它等于没改（v0.181 第一次写这行时踩到：用例「没报红」其实是**根本没改到数据**）。 */
  const half = JSON.parse(JSON.stringify(BOOK_A));
  half.characters[2].name = '王五';
  writeA(half);
  const ps2 = run().problems;
  ok(ps2.some((p) => /L10/.test(p) && /王五/.test(p)),
    'L10 反向：一半带括号一半不带 ⇒ **仍然**报红（不能只看第一个成员）');

  /* L10 与台账无关：台账里什么都不写，裸名照样红 */
  rmL();
  ok(run().problems.some((p) => /L10/.test(p)), 'L10 反向：台账为空时裸名**照样**报红（它看的是数据，不看台账）');

  writeA(BOOK_A);
  writeL(GOOD);
  ok(run().problems.length === 0, 'L10 还原后 ⇒ 0 处问题');
}

/* ── 4. 反向：别误伤 ── */
{
  writeL(GOOD);
  const ps = run().problems;
  ok(ps.length === 0 && !ps.some((p) => /赵六/.test(p)),
    '反向：独苗人物「赵六」不进任何一组；两本书各自的组互不干扰');
}
{
  /* 全角与半角括号都算「带了括号」 */
  const half = JSON.parse(JSON.stringify(BOOK_A));
  half.characters[0].name = '李四(甲)';
  writeA(half);
  const ps = run().problems;
  ok(!ps.some((p) => /L10/.test(p)), '反向：半角括号「李四(甲)」也算带了括号 ⇒ L10 不报');
  writeA(BOOK_A);
}
{
  /* 三人的组（李丰那样）成员数 >2 也要能过 */
  const three = JSON.parse(JSON.stringify(BOOK_A));
  three.characters.push({ id: 'jia3', name: '李四（丙）' });
  writeA(three);
  writeL([mk('jia', '李四', ['jia1', 'jia2', 'jia3']), ...GOOD.slice(1)]);
  ok(run().problems.length === 0, '反向：三人的组（李丰那组）⇒ 0 处问题');
  writeA(BOOK_A);
}

writeL(GOOD);
ok(run().problems.length === 0, '最终还原后 ⇒ 0 处问题');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过（含 ${RED_COUNT} 条「期望报红」场景 + 1 条 JSON 坏 + 5 条反向）`}`);
process.exit(fail ? 1 : 0);