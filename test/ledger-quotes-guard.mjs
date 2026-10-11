/**
 * 单测：scripts/check-ledger-quotes.mjs（台账引文「印刷版逐字」的检查）。
 *
 * ## 为什么值得单独测
 *
 * 这条检查防的是 **v0.102 那一族**：把转述/改写装成「」当引文。
 * 而**如果它自己永远 exit 0**，它就成了又一个「看着在守、其实没守」的假门禁
 * （v0.145 / v0.146 / v0.154 / v0.156 / v0.160~163 / v0.177~181 同一族）。
 * ⇒ 必须有一条测试**证明它真的会报红**。
 *
 * ## ⚠ 这条守卫**刻意不起子进程**
 *
 * 本机 node 起不了**任何**子进程（`spawnSync` 一律 EBUSY，v0.180 实测），
 * 所以 `test/*-guard.mjs` 那套 spawnSync 写法在本机**每条用例都红**、等于没测。
 * 这里直接 import 判据：`checkLedgerQuotes(root, {sourceDir})`。
 * ⚠ 代价：**入口判断**不在这条守卫覆盖内 ⇒ 靠手工跑一次确认（v0.182 已跑：exit 0）。
 *
 * ## 假语料
 *
 * tmp 里造 `data/`（一本 mini 书 + 两份台账）与一份假三国 txt：
 *   - 甲（mini）  : `dup-names-ok.json`，引文点名「甲一」
 *   - 乙（mini）  : `cross-chapter-ok.json`（**主语是事件 id** ⇒ 判据不适用）
 *   - 假 txt 里有「甲一在此」与「甲乙丙丁在此」
 *
 * 用法：node test/ledger-quotes-guard.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkLedgerQuotes, LEDGERS } from '../scripts/check-ledger-quotes.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-ledgerq-'));
const DATA = path.join(tmp, 'data');
const TXT = path.join(tmp, 'txt');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(TXT, { recursive: true });

/* 假原著：故意在「甲一」中间插一个脚注标记，复刻真数据里 [202] 那个坑 */
const LINES = ['第一回甲甲甲', '甲一[202]在此，甲乙丙丁在此。', '第二回甲乙', '无事。'];
fs.writeFileSync(path.join(TXT, '三国演义.txt'), LINES.join('\n'), 'utf8');

fs.writeFileSync(path.join(TXT, '百年孤独.txt'), '何塞·阿尔卡蒂奥在此。', 'utf8');

/* mini 书：主名带括号，验「去括号后取主名」 */
fs.writeFileSync(path.join(DATA, 'three-kingdoms.json'), JSON.stringify({
  meta: { slug: 'three-kingdoms', chapters: 2 },
  characters: [
    { id: 'a1', name: '甲一（长安）' },
    { id: 'a2', name: '甲一（天水）' },
  ],
  relations: [], events: [], places: [],
}, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(DATA, 'one-hundred-years-of-solitude.json'), JSON.stringify({
  meta: { slug: 'one-hundred-years-of-solitude', chapters: 1 },
  characters: [
    { id: 'j2', name: '何塞·阿尔卡蒂奥（第二代）' },
    { id: 'j5', name: '何塞·阿尔卡蒂奥（第五代）' },
  ],
  relations: [], events: [], places: [],
}, null, 2) + '\n', 'utf8');
/* 不给 cross-chapter / relation-actors 造书：门禁会打印"算不出主语"并跳过 —— 那是另一条 note */

const WHY_OK = '两人相隔很远：第一位在原文「甲一[202]在此」，第二位在「甲乙丙丁在此」。';
const led = (rel, obj) => fs.writeFileSync(path.join(DATA, rel), JSON.stringify(obj, null, 2) + '\n', 'utf8');
const rm = (rel) => { try { fs.unlinkSync(path.join(DATA, rel)); } catch { /* 忽略 */ } };

const DUP = { book: 'three-kingdoms', base: '甲一', members: ['a1', 'a2'], why: '' };
const CROSS = { book: 'three-kingdoms', ch: 1, event: 'e1', why: '原文写「甲一[202]在此」。' };

const run = () => checkLedgerQuotes(tmp, { sourceDir: TXT });

console.log('══ scripts/check-ledger-quotes.mjs 的守卫 ══\n');

/* ── 0. 夹具自检 ── */
led('dup-names-ok.json', [{ ...DUP, why: WHY_OK }]);
led('cross-chapter-ok.json', [CROSS]);
{
  const { problems, stats } = run();
  ok(problems.length === 0,
    `正常态（引文逐字、含 [202] 那种脚注标记也认）⇒ 0 处问题 —— 实测 ${problems.length} 处`);
  ok(stats.checked > 0, `确实判到了 ${stats.checked} 条（不是"一条都没判"的假绿）`);
  ok(stats.notApplicable.includes('data/cross-chapter-ok.json'),
    'cross-chapter-ok 被判为「主语不是人」⇒ 记进 notApplicable（**不是**当成没问题）');
}

/* ── 1. 每条判据各造一个反例 ── */
const RED = [
  ['Q1 引文不是印刷版逐字（凭空写的）',
    [{ ...DUP, why: '第一位在原文「甲一[999]在此」。' }]],
  ['Q1 引文少了字（「甲一在此」但原文是「甲一[202]在此」）',
    [{ ...DUP, why: '第一位在原文「甲一在此」。' }]],
];
const RED_COUNT = RED.length;
for (const [label, entries] of RED) {
  led('dup-names-ok.json', entries);
  const ps = run().problems;
  ok(ps.some((p) => /Q1/.test(p)), `${label} ⇒ 报红（${ps.length} 处）${ps.some((p) => /Q1/.test(p)) ? '' : ' —— ⚠ 没报红！'}`);
}

/* JSON 坏 */
led('dup-names-ok.json', '{ 这不是 JSON');
ok(run().problems.length > 0, '台账 JSON 解析失败 ⇒ 报红');

/* 形状坏 */
led('dup-names-ok.json', { 说明: 'x' });
ok(run().problems.some((p) => /明细/.test(p)), '台账既不是数组也没有 明细 ⇒ 报红');

/* ── 2. Q2：节引（含 …）必须放过，且**打印计数** ── */
{
  led('dup-names-ok.json', [{ ...DUP, why: '第一位在原文「甲一…在此」。' }]);
  const { problems, stats, notes } = run();
  ok(problems.length === 0, 'Q2 含「…」的节引 ⇒ 放过（节引本就不可能逐字）');
  ok(stats.elided === 1, `Q2 节引被计数（${stats.elided} 条）—— 不能静默放过`);
  ok(notes.some((n) => /节引（Q2 放过）1 条/.test(n)), 'Q2 计数打印在 notes 里');
}

/* ── 3. 反向：别误伤 ── */
{
  /* 命名一个说法（不是引文）⇒ 不该判 */
  led('dup-names-ok.json', [{ ...DUP, why: '这两人不是同一人，合称「二人并立」，那个说法不是原文。' }]);
  const { problems, stats } = run();
  ok(problems.length === 0, '反向：引文只是**给说法命名**、原书里没有 ⇒ 不报（否则就是纯噪声门禁）');
  ok(stats.checked === 0, '反向：那种引文**根本不进判据**（没点名主语）');
}
{
  /* ⚠ v0.182 的关键一课：**④ 台账里所有成员共享同一个 base（按构造就是）**
     （王颀（长安）/王颀（天水）去括号后都是「王颀」）。
     ⇒ 判据**不能**靠"主语两侧不能是汉字"来区分"点名了主语"与"两个主语连写"：
     「甲一在此」右侧是动词「在」，「甲一甲二」右侧也是汉字，**分不开**。
     ⇒ 正确做法：只问"引文里有没有点名主语"，**不猜它是在命名还是在引用**；
     真要把一个非原文的说法写进台账，就**别给它加引号**（引号 = 声明这是原文）。
     这一条钉住这个取舍。 */
  led('dup-names-ok.json', [{ ...DUP, why: '这两人常被合称「甲一甲二」，那不是原文。' }]);
  const r = run();
  ok(r.problems.some((p) => /Q1/.test(p)),
    '「甲一甲二」仍被判红（引号 = 声明是原文）—— 命名说法请**不加引号**');
}
{
  /* 间隔号：引文写「何塞阿尔卡蒂奥」而原书写「何塞·阿尔卡蒂奥」⇒ 必须报红
     ⚠ 这正是 v0.182 抓到的两个真缺陷之一，别让它"看起来能跑过去"。 */
  led('dup-names-ok.json', [{ book: 'one-hundred-years-of-solitude', base: '何塞·阿尔卡蒂奥', members: ['j2', 'j5'], why: '原文作「何塞阿尔卡蒂奥」。' }]);
  const ps = run().problems;
  ok(ps.some((p) => /Q1/.test(p)),
    '反向：掉了间隔号的引文（「何塞阿尔卡蒂奥」）⇒ **仍然报红**（去间隔号后能查到不算数）');
}
{
  /* 点名主语的判定**要**容忍间隔号：引文写「何塞·阿尔卡蒂奥」且原书逐字如此 ⇒ 过 */
  led('dup-names-ok.json', [{ book: 'one-hundred-years-of-solitude', base: '何塞·阿尔卡蒂奥', members: ['j2', 'j5'], why: '原文作「何塞·阿尔卡蒂奥」。' }]);
  ok(run().problems.length === 0, '反向：引文与原书都带间隔号 ⇒ 过（点名主语那步会归一间隔号）');
}
{
  /* 缺原著 ⇒ 不报红、且必须打印"未判" */
  led('dup-names-ok.json', [{ ...DUP, why: WHY_OK }]);
  const r = checkLedgerQuotes(tmp, { sourceDir: path.join(tmp, '没有这个目录') });
  ok(r.problems.length === 0, '缺原著 ⇒ 不报红');
  ok(r.notes.some((n) => /未判/.test(n)),
    '⚠ 缺原著时**必须打印**「未判」—— 不能静默当成"没有问题"（v0.173 教训）');
  ok(r.stats.checked === 0, '缺原著时 checked=0 ⇒ "没判"是可从统计里看出来的');
}
{
  /* 台账不存在 ⇒ 跳过，不报红 */
  rm('dup-names-ok.json'); rm('cross-chapter-ok.json');
  const r = run();
  ok(r.problems.length === 0 && r.stats.ledgers === 0, '台账都不在 ⇒ 0 处问题（可选文件）');
}

/* 入口判断（pathToFileURL 形式）—— 静态断言，防止有人改成 endsWith */
{
  const src = fs.readFileSync(new URL('../scripts/check-ledger-quotes.mjs', import.meta.url), 'utf8');
  ok(/import\.meta\.url\s*===\s*pathToFileURL\(/.test(src),
    '入口判断是 pathToFileURL 形式（不是 endsWith(process.argv[1])）');
  ok(/process\.exit\(1\)/.test(src), '有 process.exit(1)（只打印不报红 = 假门禁）');
  ok(LEDGERS.some((l) => l.rel.includes('dup-names-ok')), 'LEDGERS 覆盖了 dup-names-ok');
}

led('dup-names-ok.json', [{ ...DUP, why: WHY_OK }]);
led('cross-chapter-ok.json', [CROSS]);
ok(run().problems.length === 0, '最终还原后 ⇒ 0 处问题');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过（含 ${RED_COUNT} 条「期望报红」场景 + 2 条坏台账 + 6 条反向）`}`);
process.exit(fail ? 1 : 0);