/**
 * 单测：`scripts/lib/prose-bold.mjs`（「散文的 `**` 渲染不渲染」，v0.218）。
 *
 * ## 为什么值得单独测
 *
 * 这条判据本身是为了防「读者看到字面星号」—— 而如果它自己**永远 exit 0**，
 * 它就是又一个假门禁（本仓库同一族踩过 v0.145~162 一串）。⇒ 既要证明它**会报红**
 * （故障注入：把一处 `escBold` 改回 `esc` ⇒ 必须报），也要证明它**不乱报**
 * （`esc(unbold(…))` 与 `meta.style` 都是合法写法）。
 *
 * ## 判据（全部来自 lib，本文件只负责"跑"与"注入"）
 *   A1 两个出口都定义了、都被用到；
 *   A2 散文字段不许直接进 `esc()`（漏一处 = 那个面上的星号又露出来，且没有别的测试会响）；
 *   A3 每个散文字段至少有一处走 `escBold()`；
 *   A4 属性 / canvas 这些纯文本面里**不许**出现 `escBold`（会冒出标签），
 *      且该用 `unbold` 的地方确实用了；
 *   A5 小程序数据包（WXML 纯文本）里那三个字段没有 `**`；
 *   A6 真数据的 `**` 全部落在"会渲染的面"或 `meta.style`（内部规范，不上界面）里。
 *
 * 用法：node test/prose-bold-guard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROSE_FIELDS, findDirectEscUses, boldUsage, fieldsWithoutBold, findBoldInPlainText,
  tallyBoldByField, strayBoldFields, unpairedBoldStrings,
} from '../scripts/lib/prose-bold.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

/* ⚠ 仓库路径含空格与 `+` ⇒ 必须走 fileURLToPath（手搓 URL 反解会把 %20 留在里面）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const slugs = JSON.parse(read('data/books.json')).books.map((b) => b.slug);

const app = read('js/app.js');

console.log('══ 散文的 ** 渲染守卫 ══\n');

/* ── A1 两个出口 ── */
ok(/const escBold = \(s\) =>/.test(app), 'A1a escBold() 已定义');
ok(/const unbold = \(s\) =>/.test(app), 'A1b unbold() 已定义');
{
  const u = boldUsage(app);
  ok(u.escBold >= 10, `A1c escBold() 真在用（${u.escBold} 处）`);
  ok(u.unbold >= 4, `A1d unbold() 真在用（${u.unbold} 处）`);
}

/* ── A2 / A3 / A4 ── */
{
  const direct = findDirectEscUses(app);
  ok(direct.length === 0, `A2 散文字段没有直接进 esc()（${direct.length} 处${direct.length ? '：' + direct.join('、') : ''}）`);
  const miss = fieldsWithoutBold(app);
  ok(miss.length === 0, `A3 每个散文字段都至少走了一次 escBold()（缺 ${miss.length} 个${miss.length ? '：' + miss.join('、') : ''}）`);
  const plain = findBoldInPlainText(app);
  ok(plain.length === 0, `A4 属性/canvas 里没有 escBold（${plain.length} 处${plain.length ? '：' + plain.join('、') : ''}）`);
  ok(/wrapText\(ctx, unbold\(c\.desc\)/.test(app), 'A4b canvas 简介走 unbold()');
  ok(/esc\(unbold\(e\.summary\)\)/.test(app), 'A4c data-tip-full 属性走 esc(unbold(…))');
}

/* ── A5 小程序：WXML 是纯文本 ⇒ 必须由渲染层去记号（不是数据包） ── */
{
  const idx = read('miniprogram/pages/index/index.js');
  ok(/const noBold = \(s\) =>/.test(idx), 'A5a 小程序有 noBold()（渲染层去记号）');
  ok(/desc: noBold\(c\.desc\)/.test(idx), 'A5b 人物面板简介走 noBold()');
  ok(/: noBold\(c\.fate\)/.test(idx), 'A5c 人物面板结局走 noBold()');
  ok(/summary: noBold\(e\.summary\)/.test(idx), 'A5d 事件简述走 noBold()');
  /* ⚠ 反向不变量：数据包必须**原样**（在构建时去记号会让 check-packs-sync 报红，
   *   「包＝数据」比"顺手在构建时改数据"重要）。 */
  const drift = [];
  for (const slug of slugs) {
    const f = path.join(ROOT, 'miniprogram', 'data', `${slug}.js`);
    if (!fs.existsSync(f)) { drift.push(`${slug}：包不存在`); continue; }
    const pack = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^module\.exports = /, '').replace(/;\s*$/, ''));
    const src = JSON.parse(read(`data/${slug}.json`));
    const marks = (o) => JSON.stringify(o).match(/\*\*/g)?.length || 0;
    if (marks(pack.characters) !== marks(src.characters)) drift.push(`${slug}：characters 与源数据不一致`);
    if (marks(pack.events) !== marks(src.events)) drift.push(`${slug}：events 与源数据不一致`);
  }
  ok(drift.length === 0, `A5e 数据包与源数据的 ** 数量一致（构建时没动数据）（${drift.length} 处${drift.length ? '：' + drift.join('、') : ''}）`);
}

/* ── A6 真数据 ── */
{
  const tally = {};
  for (const slug of slugs) {
    for (const [k, v] of Object.entries(tallyBoldByField(JSON.parse(read(`data/${slug}.json`))))) {
      tally[k] = (tally[k] || 0) + v;
    }
  }
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const prose = total - (tally['.meta.style'] || 0);
  console.log(`  ℹ 真实数据里的 ** 共 ${total} 个：${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('、')}`);
  const stray = strayBoldFields(tally);
  ok(stray.length === 0, `A6 ** 只落在会渲染的面或 meta.style（${stray.length} 处${stray.length ? '：' + stray.join('、') : ''}）`);
  ok(prose > 200, `A6b 数据里确实有要渲染的粗体（散文面 ${prose} 个，>200）`);
  /* A6c 落单：奇数个 `**` 的那个记号在 escBold 的正则下匹配不上 ⇒ 会露成字面星号 */
  const odd = [];
  for (const slug of slugs) odd.push(...unpairedBoldStrings(JSON.parse(read(`data/${slug}.json`))).map((p) => `${slug}${p}`));
  ok(odd.length === 0, `A6c 没有落单的 **（奇数个记号）（${odd.length} 处${odd.length ? '：' + odd.slice(0, 5).join('、') : ''}）`);
}

/* ── 故障注入：判据必须真的会红 ── */
console.log('\n▶ 故障注入（证明判据不是永假）');
{
  /* 把一处 escBold 改回 esc ⇒ A2 必须报 */
  const broken = app.replace('${escBold(c.note)}', '${esc(c.note)}');
  const hits = findDirectEscUses(broken);
  ok(hits.length === 1 && hits[0].includes('c.note'), `注入① escBold(c.note)→esc(c.note) ⇒ A2 报红（${hits.join('、') || '没报'}）`);
}
{
  /* 在属性里用 escBold ⇒ A4 必须报 */
  const broken = app.replace('data-tip-full="${esc(unbold(e.summary))}"', 'data-tip-full="${escBold(e.summary)}"');
  const hits = findBoldInPlainText(broken);
  ok(hits.length === 1, `注入② 属性里塞 escBold ⇒ A4 报红（${hits.join('、') || '没报'}）`);
}
{
  /* 删掉某字段的全部 escBold 用法 ⇒ A3 必须报 */
  const broken = app.replace(/escBold\(c\.fate/g, 'esc(c.fate');
  ok(fieldsWithoutBold(broken).includes('c.fate'), '注入③ 把 escBold(c.fate) 全部退回 esc ⇒ A3 报红');
}
{
  /* 数据里冒出一个"不会渲染的面"带 ** ⇒ A6 必须报 */
  ok(strayBoldFields({ '.characters[].desc': 2, '.places[].note': 4 }).length === 1
    && strayBoldFields({ '.characters[].desc': 2, '.meta.style': 4 }).length === 0,
  '注入④ 不在清单里的面带 ** ⇒ A6 报红；meta.style ⇒ 豁免（内部规范，不上界面）');
}
{
  /* ⚠ 假阳性防护：认可的两种写法都不许被判成违规 */
  ok(findDirectEscUses('x = escBold(c.desc); y = esc(unbold(e.summary)); z = esc(e.name);').length === 0,
    '注入⑤ escBold(…) 与 esc(unbold(…)) 都合法（不误报）');
  ok(PROSE_FIELDS.length === 10 && PROSE_FIELDS.includes('c.note') && !PROSE_FIELDS.includes('c.title'),
    '注入⑥ 散文字段清单含 c.note、不含短标签 c.title');
}
{
  /* 落单的那个 `**` 在 escBold 的正则下匹配不上 ⇒ 必须单独报出来 */
  const doc = { characters: [{ id: 'a', note: '**成对的**' }, { id: 'b', note: '**落单的' }] };
  const odd = unpairedBoldStrings(doc);
  ok(odd.length === 1 && odd[0] === '.characters[1].note', `注入⑦ 数据里一个落单的 ** ⇒ A6c 报红（${odd.join('、') || '没报'}）`);
}

console.log(`\n${fail === 0 ? '✓ 全部通过' : '✗ 有失败'}：${pass} 过 / ${fail} 挂`);
process.exit(fail === 0 ? 0 : 1);