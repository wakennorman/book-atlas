/**
 * 单测：scripts/check-ui-notes.mjs（「内部措辞不进 UI」门禁）。
 *
 * ## 为什么值得单独测
 *
 * 这条门禁本身就是为了防「施工台账渲染给读者」—— 而如果它自己**永远 exit 0**，
 * 它就是又一个假门禁（入口判断写错、模式全是永假正则、发现机制失灵…
 * 本仓库同一族踩过 v0.145~162 一串）。⇒ 必须证明它**真的会报红**，
 * 且（同样重要）**不会乱报**。
 *
 * ## 判据重点
 *
 *   红：note / meta.note / relations events text / annotations note 里的
 *       版本号、本轮施工、带日期用户报告、TODO、id= 引用…
 *   不红（假阳性防护，v0.213 逐条实测过）：
 *     ① `solid＝支撑派生` 里含 `id＝` 子串 —— `\b` 边界防住；
 *     ② annotations `body` 里的 `（e-3-1）` —— 行内引用锚点，
 *        annoBody() 会换成「事件短名」按钮（v0.141/v0.174 既有设计）；
 *     ③ `relations[].basis`、`events[].id`、`chars`、anno 的 events 字符串数组
 *        —— 机器键容器，不渲染；
 *     ④ annotations `title` 里的 id —— **要红**（title 走 esc()，不链接化）。
 *
 * 用法：node test/ui-notes-guard.mjs
 * ⚠ BOOKATLAS_ROOT 必须在 import 之前设好（模块级常量）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-uin-'));
const DATA = path.join(tmp, 'data');
const ANNO = path.join(DATA, 'annotations');
fs.mkdirSync(ANNO, { recursive: true });

const cleanBook = () => ({
  meta: { slug: 'demo', type: '叙事类', note: '剧透尺度＝顺序回目', style: '写作规范：① 先写全名（solid＝支撑派生）' },
  characters: [
    { id: 'jia', name: '甲人', title: '甲官', desc: '好人之仁', fate: '善终', note: '原文：「甲人者，仁人也」' },
    { id: 'yi', name: '乙人', desc: '…', fate: '…' },
  ],
  relations: [
    { from: 'jia', to: 'yi', type: '友', events: [{ text: '甲乙相会，斗酒十千', chapter: '第1章' }] },
  ],
  events: [{ id: 'e-1-1', name: '甲乙相会', ch: 1, summary: '…', chars: ['jia', 'yi'] }],
});
const cleanAnno = () => ({
  schema: 1, slug: 'demo', note: '拆书条目的依据是 events，body 里的行内引用可点开核对。',
  items: [{ ch: 1, title: '第一回拆解', body: '甲乙相会（e-1-1），一见如故。', events: ['e-1-1'], chars: ['jia'], basis: '原文依据' }],
  global: [],
});

const writeBook = (o) => fs.writeFileSync(path.join(DATA, 'demo.json'), JSON.stringify(o, null, 2) + '\n', 'utf8');
const writeAnno = (o) => fs.writeFileSync(path.join(ANNO, 'demo.json'), JSON.stringify(o, null, 2) + '\n', 'utf8');
const writeRegistry = (o) => fs.writeFileSync(path.join(DATA, 'books.json'), JSON.stringify(o, null, 2) + '\n', 'utf8');

/* ⚠ 环境变量必须在 import 之前设好（lib 的 ROOT/DATA 是模块级常量） */
process.env.BOOKATLAS_ROOT = tmp;
const { checkUiNotes } = await import('../scripts/check-ui-notes.mjs');
const run = () => checkUiNotes();

console.log('══ scripts/check-ui-notes.mjs 的守卫 ══\n');

writeRegistry({ books: [{ slug: 'demo' }] });
writeBook(cleanBook());
writeAnno(cleanAnno());
ok(run().length === 0, '干净的正常态 ⇒ 0 处问题（含 solid＝ 这种含 id＝ 子串的合法文案）');

/* ── 该红的 ── */
const RED = [
  ['note 里带版本号', (b) => { b.characters[0].note = '※ v0.128 title 留空：通篇无官职'; }, 'characters[0].note'],
  ['note 里带本轮施工', (b) => { b.characters[1].note = '本轮补上马遵那次。'; }, 'characters[1].note'],
  ['note 里带带日期的用户报告', (b) => { b.characters[0].note = '用户 2026-10-04 报"搜不到"的人之一'; }, 'characters[0].note'],
  ['note 里带 TODO 待办', (b) => { b.characters[0].note = '待填'; }, 'characters[0].note'],
  ['meta.note（页脚渲染）泄漏', (b) => { b.meta.note = 'v0.206 新增'; }, 'meta.note'],
  ['relations events text 带 id= 引用', (b) => { b.relations[0].events[0].text = '与「王颀」（id=wang-qi）同名'; }, 'relations[0].events[0].text'],
  ['desc 里带旧字段引用', (b) => { b.characters[0].desc = '原 desc 写错了'; }, 'characters[0].desc'],
];
for (const [label, mutate, where] of RED) {
  const b = cleanBook(); mutate(b); writeBook(b); writeAnno(cleanAnno());
  const ps = run();
  ok(ps.length === 1 && ps[0].includes(where), `${label} ⇒ 报红（${where}）`);
}
/* annotations 顶层 note 的红（另一个文件，book 保持干净） */
{
  const a = cleanAnno(); a.note = '本项目 data/xxx.json 里核对过'; writeAnno(a);
  const b = cleanBook(); writeBook(b);
  const ps = run();
  ok(ps.length === 1 && ps[0].includes('.note'), 'annotations 顶层 note 泄漏 ⇒ 报红（.note）');
}

/* ── 不该红的（假阳性防护） ── */
const FP = [
  ['annotations body 里的行内引用（e-1-1）', (b, a) => { a.items[0].body = '甲乙相会（e-1-1）、再会（e-1-2），一见如故。'; }],
  ['solid＝ 含 id＝ 子串', (b) => { b.meta.style = 'style 表性质（solid＝支撑派生，dashed＝对立驳斥）'; }],
  ['relations[].basis 是审计痕迹（不渲染）', (b) => { b.relations[0].basis = 'e-1-1 summary：「甲乙相会」'; }],
  ['events[].id / chars 是机器键', (b) => { b.events[0].id = 'e-9-9'; }],
];
for (const [label, mutate] of FP) {
  const b = cleanBook(); const a = cleanAnno(); mutate(b, a);
  writeBook(b); writeAnno(a);
  ok(run().length === 0, `${label} ⇒ 不红`);
}
{
  /* anno 的 events 字符串数组（id 列表）不扫 */
  const a = cleanAnno(); a.items[0].events = ['e-1-1', 'e-1-2']; writeAnno(a);
  const b = cleanBook(); writeBook(b);
  ok(run().length === 0, 'annotations items[].events 字符串数组（id 列表）⇒ 不红');
}
{
  /* annotations title 里的 id ⇒ 要红（title 走 esc() 不链接化） */
  const a = cleanAnno(); a.items[0].title = '第一回拆解（e-1-1）'; writeAnno(a);
  const b = cleanBook(); writeBook(b);
  ok(run().some((p) => p.includes('.items[0].title')), 'annotations title 里的裸 id ⇒ 报红（title 不链接化）');
}

/* ── 发现机制失灵也要红 ── */
writeBook(cleanBook()); writeAnno(cleanAnno());
writeRegistry({ note: 'x' });
ok(run().length === 1, 'books.json 缺 books[] ⇒ 报红（形状变了不能静默放过）');
writeRegistry({ books: [{ slug: 'no-such-book' }] });
ok(run().some((p) => p.includes('no-such-book')), '注册了不存在的书 ⇒ 报红');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✓ 全部通过' : '✗ 有失败'}：${pass} 过 / ${fail} 挂`);
process.exit(fail === 0 ? 0 : 1);
