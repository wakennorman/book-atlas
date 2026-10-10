/**
 * `check-relation-actors-ledger.mjs`（行为人审计台账门禁）的守卫测试。
 *
 * ## 为什么不用子进程
 *
 * 本仓库其余 `*-guard.mjs` 原先靠 `spawnSync(process.execPath, [SCRIPT])` 来跑"脚本 + 看退出码"，
 * 但**本机 node 起不了任何子进程**（EBUSY）⇒ 那批守卫在本机**恒失败**。
 * 所以这里照 v0.177/v0.178 的做法：**直接 import 被导出的判据函数**，在 tmp 里造一份
 * 最小 `data/` + 一份假原著，逐条断言 `problems`。
 *
 * ## 夹具
 *
 * 书名叫 `three-kingdoms`（**故意用真 slug**）—— 因为原著文件名由
 * `scripts/lib/book-sources.mjs` 的 `BOOK_TXT` 按 slug 查，用假 slug 就永远"缺原著"，
 * 测不到 B/C 两级。假原著只有两句话，够放两条引文。
 *
 *   甲甲 ──父子── 乙乙     事件：「他独自上路…『风大雪紧，明日再走』」   ⇒ A（代词无主）
 *   甲甲 ──师徒── 丙丙     事件：「丁丁替他收拾行装，甲甲叮嘱…『路上小心，早早回来』」 ⇒ B（丁丁在场）
 *   甲甲 ──父子── 丁丁     事件：「甲甲教丁丁识字…」（无引号）           ⇒ 干净，不该被报
 *
 * 用法：`node test/relation-actors-ledger-guard.mjs`
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRelationActorsLedger, LEDGER_REL } from '../scripts/check-relation-actors-ledger.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-actors-guard-'));
const DATA = path.join(tmp, 'data');
const SRC = path.join(tmp, 'src');
const EMPTY_SRC = path.join(tmp, 'no-source');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(SRC, { recursive: true });
fs.mkdirSync(EMPTY_SRC, { recursive: true });

/* ── 假原著（flat 后必须包含那两条引文）── */
fs.writeFileSync(path.join(SRC, '三国演义.txt'),
  ['第一回', '话说甲甲年少，风大雪紧，明日再走，遂行。', '第二回', '丁丁随行，路上小心，早早回来，勿念。'].join('\n'),
  'utf8');

/* ── 假书 ── */
const BOOK = {
  meta: { schemaVersion: 2, chapters: 2 },
  characters: [
    { id: 'jia', name: '甲甲', gender: 'm' },
    { id: 'yi', name: '乙乙', gender: 'm' },
    { id: 'bing', name: '丙丙', gender: 'm' },
    { id: 'ding', name: '丁丁', gender: 'm' },
  ],
  relations: [
    {
      from: 'jia', to: 'yi', type: '父子', style: 'solid', kin: 'blood',
      events: [{ text: '他独自上路，一路只说「风大雪紧，明日再走」。', chapter: '第1章', evidence: 'quote' }],
    },
    {
      from: 'jia', to: 'bing', type: '师徒', style: 'solid',
      events: [{ text: '丁丁替他收拾行装，甲甲叮嘱了几句，说的是「路上小心，早早回来」。', chapter: '第2章', evidence: 'quote' }],
    },
    {
      from: 'jia', to: 'ding', type: '父子', style: 'solid', kin: 'blood',
      events: [{ text: '甲甲教丁丁识字，父子二人在灯下抄书。', chapter: '第2章', evidence: 'paraphrase' }],
    },
  ],
};
fs.writeFileSync(path.join(DATA, 'three-kingdoms.json'), JSON.stringify(BOOK, null, 2) + '\n', 'utf8');

const WHY = '回原著读过：这不是挂错人，理由是……（守卫夹具）';
const GOOD = [
  { book: 'three-kingdoms', from: 'jia', to: 'yi', flags: ['A'], why: WHY },
  { book: 'three-kingdoms', from: 'jia', to: 'bing', flags: ['B'], why: WHY },
];
/* ⚠ 必须用门禁导出的 `LEDGER_REL` 拼路径，**不能**在这里写死文件名：
 * 门禁读的是 `root + LEDGER_REL`，若哪天台账改名而这里写死旧名，
 * 门禁会因"文件不存在"走"可选文件"分支 ⇒ 0 处问题 ⇒ **假绿**。 */
const LEDGER_FILE = path.join(tmp, LEDGER_REL);
const writeLedger = (v) => fs.writeFileSync(LEDGER_FILE,
  typeof v === 'string' ? v : JSON.stringify(v, null, 2) + '\n', 'utf8');
const run = (dir = SRC) => checkRelationActorsLedger(tmp, { dir });

console.log('\n▶ 0. 夹具自检：两条边各被报出预期的级别');
{
  writeLedger(GOOD);
  const r = run();
  ok(r.problems.length === 0, `正常台账 ⇒ 0 处问题（实际 ${r.problems.length}：${r.problems.join(' / ')}）`);
  ok(r.checked === 2 && r.unchecked === 0, `核了 ${r.checked} 条、未核 ${r.unchecked} 条（应为 2 / 0）`);
}

console.log('\n▶ 1. L1 顶层与 JSON');
{
  writeLedger('{ 这不是 JSON');
  ok(run().problems.some((p) => p.startsWith('L1')), '坏 JSON ⇒ L1');
  writeLedger('{"book":"x"}');
  ok(run().problems.some((p) => /L1 .*顶层必须是数组/.test(p)), '顶层是对象 ⇒ L1');
  fs.rmSync(LEDGER_FILE);
  const r = run();
  ok(r.problems.length === 0 && r.notes.some((n) => /跳过/.test(n)), '台账不存在 ⇒ 0 处问题（可选文件）');
}

console.log('\n▶ 2. L2 / L3 字段与理由长度');
{
  writeLedger([{ from: 'jia', to: 'yi', flags: ['A'], why: WHY }]);
  ok(run().problems.some((p) => /L2 .*book 必须是/.test(p)), '缺 book ⇒ L2');
  writeLedger([{ book: 'three-kingdoms', from: 'jia', to: 'yi', flags: ['A'] }]);
  ok(run().problems.some((p) => /L2 .*why 必须是字符串/.test(p)), '缺 why ⇒ L2');
  writeLedger([{ book: 'three-kingdoms', from: 'jia', to: 'yi', flags: ['A'], why: '太短了' }]);
  ok(run().problems.some((p) => p.startsWith('L3')), 'why 只有 3 字 ⇒ L3');
  writeLedger([{ ...GOOD[0], why: ' 有 效 的 理 由 八 个 字 ' }, GOOD[1]]);
  ok(run().problems.length === 0, 'why 去空白后满 8 字 ⇒ 通过（空白不算字）');
}

console.log('\n▶ 3. L4 flags 的闭集与去重');
{
  const mk = (flags) => [{ book: 'three-kingdoms', from: 'jia', to: 'yi', flags, why: WHY }];
  writeLedger(mk([]));
  ok(run().problems.some((p) => /L4 .*非空数组/.test(p)), 'flags 为空 ⇒ L4');
  writeLedger(mk(['D']));
  ok(run().problems.some((p) => /L4 .*非法值/.test(p)), 'flags 含 D（尚未实现的级别）⇒ L4');
  writeLedger(mk(['A', 'A']));
  ok(run().problems.some((p) => /L4 .*重复/.test(p)), 'flags 重复 ⇒ L4');
}

console.log('\n▶ 4. L5 / L6 / L7 引用完整性');
{
  writeLedger([{ book: 'no-such-book', from: 'jia', to: 'yi', flags: ['A'], why: WHY }]);
  ok(run().problems.some((p) => p.startsWith('L5')), '书不存在 ⇒ L5');
  writeLedger([{ book: 'three-kingdoms', from: 'jia', to: 'nobody', flags: ['A'], why: WHY }]);
  ok(run().problems.some((p) => /L6 .*to「nobody」/.test(p)), 'to 不是人物 id ⇒ L6');
  writeLedger([{ book: 'three-kingdoms', from: 'yi', to: 'jia', flags: ['A'], why: WHY }]);
  ok(run().problems.some((p) => p.startsWith('L7')), '方向反了（不存在 yi→jia）⇒ L7');
  writeLedger([{ book: 'three-kingdoms', from: 'jia', to: 'ding', flags: ['A'], why: WHY }]);
  const rd = run();
  ok(rd.problems.some((p) => p.startsWith('L9')),
    'jia→ding 存在但审计不报它 ⇒ L9 漂移（不是静默通过）');
  ok(rd.problems.some((p) => p.startsWith('L10') && p.includes('jia|yi')),
    '同时 L10 报出真正被审计报过、却没登记的 jia→yi');
}

console.log('\n▶ 5. L8 重复键');
{
  writeLedger([GOOD[0], { ...GOOD[0] }]);
  ok(run().problems.some((p) => p.startsWith('L8')), '同一 (book,from,to) 两条 ⇒ L8');
}

console.log('\n▶ 6. L9 台账漂移（记的级别与审计现在报的不符）');
{
  writeLedger([{ book: 'three-kingdoms', from: 'jia', to: 'yi', flags: ['B'], why: WHY },
    GOOD[1]]);
  ok(run().problems.some((p) => /L9 台账漂移/.test(p)), 'jia→yi 审计报 A、台账记 B ⇒ L9');
}

console.log('\n▶ 7. L10 未登记（新冒出来的必须读过）');
{
  writeLedger([GOOD[0]]);
  const r = run();
  ok(r.problems.some((p) => /L10 未登记/.test(p) && p.includes('jia|bing')), '漏掉 jia→bing ⇒ L10');
  ok(!r.problems.some((p) => p.includes('jia|ding')), '干净的边（jia→ding）不该被 L10 报出来');
}

console.log('\n▶ 8. 缺原著：B/C 变成「未核」而不是「有问题」');
{
  writeLedger(GOOD);
  const r = run(EMPTY_SRC);
  ok(r.problems.length === 0, `缺原著时不该报红（实际 ${r.problems.length}：${r.problems.join(' / ')}）`);
  ok(r.checked === 1 && r.unchecked === 1, `A 级仍核（checked=${r.checked}）、B 级转为未核（unchecked=${r.unchecked}）`);
  ok(r.notes.some((n) => /只核 \*\*A 级\*\*/.test(n)), '必须打印"只核 A 级"（门禁不打印跳过了什么 = 装饰品）');
}

console.log('\n▶ 9. 恢复后仍然一致');
{
  writeLedger(GOOD);
  const r = run();
  ok(r.problems.length === 0 && r.checked === 2, '恢复 ⇒ 0 处问题、核 2 条');
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${fail === 0 ? '✓' : '✗'} 行为人审计台账守卫　通过：${pass}  失败：${fail}`);
process.exit(fail === 0 ? 0 : 1);
