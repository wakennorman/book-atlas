#!/usr/bin/env node
/**
 * 逐条核验数据里的引号片段，给出 evidence，并把**真问题**单独拎出来。
 *
 * ## 走过的弯路，别再走（这一节是本脚本存在的理由）
 *
 * v0.103 的判据是"引号内文字能在原书里逐字定位" —— 26/30 通过，看着很干净。
 * 实际是**四类东西被混成一类**。第二版我按"原文自己有没有加引号"重分，又误报 22 条：
 *
 *   绰号「巨人」、叫「叔叔」     → 我标"装饰引号"。**错。** GB/T 15834 明确规定
 *                                   引号用于绰号，这是正确用法，不是缺陷。
 *   原文：「到了星期二，佩特洛尼奥…」 → 我标"装饰引号"。**错。** 原文那段是叙述不是对白，
 *                                   本来就没有引号；我们标了"原文："，是正当的**转引**。
 *   「吃闲饭」（原文 `'你这个吃闲饭的人…'`） → 我标"截短/伪造"。**错。** 中文引文节略是常规，
 *                                   不算伪造。
 *
 * ⇒ 教训与 audit-relation-actors 一样：**"形态可疑" ≠ "有缺陷"**。
 *   自动分类器只能标"形态"，判"缺陷"必须回到原文去读。
 *   所以这里只做两件事：给 evidence 分档 + 把两种**确定是缺陷**的形态报出来。
 *
 * ## 六档（只有第一档能升成 quote）
 *
 *   quote    原文用引号包住的就是这整段，逐字一致        → evidence: 'quote'
 *   partial  引文是原文引号内文字的节略（中文常规）        → 'paraphrase'
 *   epithet  绰号/称谓引号（GB/T 15834 正确用法）          → 'paraphrase'
 *   indirect 我们明写"原文："的转引                       → 'paraphrase'
 *   ⚠ negated  逐字对得上，但原文是**否定式**（"不是我杀的"） → 真缺陷，报出来
 *   ✗ unlocated 逐字根本找不到                              → 真缺陷，报出来
 *
 * ⚠ 不自动改写文案。negated / unlocated 要不要改、怎么改，由你定。
 *
 * 用法：node scripts/verify-quotes.mjs [--write] [--only=slug]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '').slice(7);

const SOURCES = {
  'three-kingdoms': 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/三国演义.txt',
  'one-hundred-years-of-solitude': 'C:/Users/chw/AppData/Local/Temp/opencode/epub.txt',
  'crime-and-punishment': 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/罪与罚.txt',
};

const flat = (s) => String(s || '').replace(/[\s·・･　]/g, '');
const trimTail = (s) => flat(s).replace(/[。，、！？…；：,.!?;:]+$/u, '');

/** 我们数据里的引号对 */
const OUR_PAIRS = [[0x300c, 0x300d], [0x300e, 0x300f]];
/** 源文本实测三本全是 `“”` / `‘ ’`，没有一本用 `「」` */
const SRC_PAIRS = [[0x201c, 0x201d], [0x2018, 0x2019]];

/** 否定词：命中它的后一位就是把话说反了 */
const NEG = new Set([...'不无非未没莫别弗勿毋否甭'].map((c) => c.codePointAt(0)));

/** 我们文案里"这个引号是绰号/称谓"的提示词 */
const EPITHET_CUE = /绰号|外号|昵称|小名|又叫|人称|管.{0,6}叫|称作|称为/;

function spansOf(src, pairs) {
  const spans = [];
  for (const [open, close] of pairs) {
    const O = String.fromCodePoint(open), C = String.fromCodePoint(close);
    let i = 0;
    for (;;) {
      const a = src.indexOf(O, i);
      if (a < 0) break;
      const b = src.indexOf(C, a + 1);
      if (b < 0) break;
      spans.push(src.slice(a + 1, b));
      i = b + 1;
    }
  }
  return spans;
}

/**
 * @param quote    我们写的引号内容
 * @param ourFull  我们那条完整文案（用来判断绰号引号 / 转引）
 * @param flatSrc  原书去空白全文
 * @param spans    原书所有引号跨度的内容
 */
function classify(quote, ourFull, flatSrc, spans) {
  const q = trimTail(quote);
  if (!q) return { kind: 'partial' };
  if (flatSrc.indexOf(flat(quote).slice(0, Math.min(40, flat(quote).length))) < 0) {
    return { kind: 'unlocated' };
  }
  const hit = spans.find((s) => trimTail(s) === q);
  if (hit) return { kind: 'quote', span: trimTail(hit) };

  /* 节略：我们的引文落在某个原文引号跨度内 */
  for (const s of spans) {
    const t = trimTail(s);
    const at = t.indexOf(q);
    if (at < 0) continue;
    /* 前面紧挨着一个否定词 ⇒ 原文是反话，这最严重 */
    if (at > 0 && NEG.has(t.codePointAt(at - 1))) return { kind: 'negated', span: t.slice(0, 70) };
    return { kind: 'partial', span: t.slice(0, 70) };
  }

  /* 逐字找得到但不在任何引号跨度里 */
  if (EPITHET_CUE.test(ourFull)) return { kind: 'epithet' };
  if (/^\s*(?:原文|原书)[：:]/.test(ourFull)) return { kind: 'indirect' };
  return { kind: 'epithet' };   // 默认按绰号引号看待：不报缺陷，但也不升 quote
}

const LABEL = {
  quote: '✓ 完整原文引文',
  partial: '· 节略引文（中文常规，不算缺陷）',
  epithet: '· 绰号/称谓引号（GB/T 15834 正确用法）',
  indirect: '· 转引（原文是叙述，本无引号）',
  negated: '⚠⚠ 确定缺陷：原文是否定式，我们把话说反了',
  unlocated: '✗⚠ 确定缺陷：原文里逐字找不到',
};
const ORDER = ['quote', 'partial', 'epithet', 'indirect', 'negated', 'unlocated'];
const SET = { quote: 'quote' };
const DEFECT = new Set(['negated', 'unlocated']);

const n = Object.fromEntries(ORDER.map((k) => [k, 0]));
const defects = [];

for (const [slug, srcPath] of Object.entries(SOURCES)) {
  if (ONLY && slug !== ONLY) continue;
  const file = path.join(ROOT, 'data', `${slug}.json`);
  if (!fs.existsSync(srcPath)) { console.log(`  (跳过 ${slug}：没有源文本)`); continue; }
  const raw = fs.readFileSync(srcPath, 'utf8');
  const flatSrc = flat(raw);
  const spans = spansOf(raw, SRC_PAIRS);
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));

  const visit = (ev, where) => {
    if (ev.evidence === 'derived' || ev.derived) return;
    const s = String(ev.text || '');
    const qs = spansOf(s, OUR_PAIRS);   /* 复用 spansOf 提取我们文案里的引号内容 */
    if (!qs.length) return;
    /* 一条文案里可能既有真引文又有绰号引号：取"最像引文"的那条 */
    const best = qs
      .map((q) => ({ q, r: classify(q, s, flatSrc, spans) }))
      .sort((a, b) => ORDER.indexOf(a.r.kind) - ORDER.indexOf(b.r.kind))[0];
    n[best.r.kind]++;
    ev.evidence = SET[best.r.kind] || 'paraphrase';
    if (DEFECT.has(best.r.kind)) {
      defects.push({ slug, where, kind: best.r.kind, q: best.q, span: best.r.span, text: s.slice(0, 110) });
    }
  };

  for (const rel of book.relations ?? []) for (const ev of rel.events ?? []) visit(ev, `relation ${rel.from}→${rel.to}`);
  for (const ev of book.events ?? []) visit(ev, `event ${ev.id}`);
  console.log(`  ${slug}：已扫（原书 ${spans.length} 个引号跨度）`);
  if (WRITE) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
}

console.log('\n=== 引号片段分类 ===');
for (const k of ORDER) console.log(`  ${LABEL[k].padEnd(40, '　')} ${n[k]}`);

console.log(`\n=== 确定是缺陷的 ${defects.length} 条 ===`);
if (!defects.length) console.log('  （无）');
for (const d of defects) {
  console.log(`\n  [${d.slug}] ${d.where}`);
  console.log(`    ${LABEL[d.kind]}`);
  console.log(`    我们写的：${d.q}`);
  if (d.span) console.log(`    原文是：  ${d.span}`);
  console.log(`    整条文案：${d.text}`);
}

if (WRITE) {
  console.log('\n=== 落盘后 evidence 分布 ===');
  for (const slug of Object.keys(SOURCES)) {
    const f = path.join(ROOT, 'data', `${slug}.json`);
    if (!fs.existsSync(f)) continue;
    const b = JSON.parse(fs.readFileSync(f, 'utf8'));
    const c = {};
    const all = [];
    for (const r of b.relations ?? []) for (const e of r.events ?? []) all.push(e);
    for (const e of b.events ?? []) all.push(e);
    for (const e of all) c[e.evidence || '(无)'] = (c[e.evidence || '(无)'] ?? 0) + 1;
    console.log(`  ${slug.padEnd(30)} ${JSON.stringify(c)}`);
  }
} else console.log('\n（预览模式，未落盘；加 --write 才写）');
