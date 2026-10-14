/* 「简体 → 繁体」守卫 —— v0.219 新增。
 *
 * 守三件事，外加两条纪律：
 *   H1 漏字   语料里每个汉字都要有交代（在 `chars` 里转、或在 `same` 里"繁简同形"）。
 *             这是本项目最怕的静默故障：某个生僻字没登记，繁中模式下它就悄悄保持简体，
 *             页面看着"对"，但那一个字露馅。
 *   H2 死条目 表里有、语料里一次都没出现的字或词组 —— 防表随改随涨、最后大到没法人工审。
 *   H3 歧义   同一个字在语料里产出 **≥2 种**繁体形的，说明它需要词组表钉死；
 *             只靠默认形会误伤少数派（「只」既是「只」也是「隻」）。
 *   D1 幂等   `conv` 必须**只过一次**。简繁转换不幂等（实测 17,468 条语料里有 14 条
 *             会二次变形：「范晔」→「範曄」、「并州」→「幷州」、「标致」→「標緻」），
 *             所以散文出口只有一个（`escBold` / `unbold`），任何"渲染完再扫一遍 DOM"的
 *             方案都会二次转换 —— D1 盯着这条不许被绕开。
 *   D2 单一收口 散文字段必须走 `escBold(`／`unbold(`（它们内部已含 `conv`），
 *             不许另外自己调 `conv(` —— 两个出口就等于转两次。
 *
 * 判据在 `scripts/lib/s2t.mjs`（生成器与本守卫共用，抄两份必漂）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectCorpus, corpusCharCounts, corpusCharTotal,
  deadDictEntries, makeConverter, uncoveredChars, ambiguousChars,
} from '../scripts/lib/s2t.mjs';
import { PHRASE_BLIND, PROTECT_PHRASES, PHRASE_FIX } from '../scripts/lib/s2t-overrides.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let fails = 0;
let n = 0;
const ok = (cond, label, detail = '') => {
  n++;
  if (cond) console.log(`  ✓ ${label}`);
  else { fails++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
};

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readText = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return null; } };

console.log('── data/s2t.json 基本形状 ──');
const dict = readJson('data/s2t.json');
ok(dict.schema === 's2t/1', `schema 是 s2t/1（实际 ${dict.schema}）`);
ok(Object.keys(dict.chars || {}).length > 500, `字表非空（${Object.keys(dict.chars || {}).length} 条）`);
ok(Object.keys(dict.phrases || {}).length > 300, `词组表非空（${Object.keys(dict.phrases || {}).length} 条）`);
ok(typeof dict.same === 'string' && dict.same.length > 500, `same 是同形字串（${(dict.same || '').length} 字）`);

const conv = makeConverter(dict);
const books = readJson('data/books.json').books;
const corpus = collectCorpus(books, readJson, readText);
const counts = corpusCharCounts(corpus);
console.log(`\n── 语料 ${corpus.length} 条 / ${corpusCharTotal(counts).toLocaleString('en-US')} 字 / ${counts.size} 个去重汉字 ──`);

console.log('\n── H1 漏字 ──');
const miss = uncoveredChars(counts, dict);
ok(miss.length === 0, `语料里每个字都有交代（漏 ${miss.length} 个）`,
  miss.length ? `漏：${miss.join('')}` : '');
const missSame = [...counts.keys()].filter((c) => !(dict.chars || {})[c] && !dict.same.includes(c));
const trad = new Set([...Object.values(dict.chars || {}), ...Object.values(dict.phrases || {})].join(''));
const missAll = missSame.filter((c) => !trad.has(c));
ok(missAll.length === 0, `每个字都有交代：chars / same / 已是繁体（${missAll.length} 个没交代）`,
  missAll.length ? `漏：${missAll.join('')}` : '');

console.log('\n── H2 死条目 ──');
/* 人工词表（`PHRASE_FIX`）是留给将来新书的通用词条，本书没用到不算死；
   本检查只管**派生规则** —— 那些是语料推出来的，语料一改就可能失效。 */
const dead = deadDictEntries(corpus, dict, Object.keys(PHRASE_FIX));
ok(dead.length === 0, `派生规则里没有语料用不到的（死条目 ${dead.length} 个）`,
  dead.length ? `死：${dead.join(' ')}` : '');
const unusedManual = Object.keys(PHRASE_FIX).filter((k) => !corpus.some((c) => c.text.includes(k)));
console.log(`    （人工词表 ${Object.keys(PHRASE_FIX).length} 条，其中本书没用到 ${unusedManual.length} 条 —— 留给新书，不算死）`);

console.log('\n── H3 歧义没覆盖 ──');
/** 词组表能不能钉死：某个字产出 ≥2 种时，少数派那一支必须由**词组表**产出。 */
const split = ambiguousChars(corpus, dict);
/* 「有人管过」= 三种之一：
     ① 有一条**以它开头**的词组规则（「只看」这种）；
     ② 它在 `PHRASE_BLIND` 里（词组层闭嘴 ⇒ 只可能走字表那一支）；
     ③ 有一条人工词条**包含**它 —— 少数派可以来自别的字开头的规则：
        「复苏→復甦」就让「苏」在那个词里产出了「甦」，那是**对的**，不该报红。
   ⚠ `PHRASE_BLIND` 是 **Set**，得用 `[...PHRASE_BLIND]`；写 `Object.keys(Set)` 会返回
     空数组，这条检查就会永远误报（v0.219 当场踩过）。 */
const ruleKeys = [...Object.keys(dict.phrases), ...PHRASE_BLIND, ...Object.keys(PHRASE_FIX)];
const uncovered = [];
for (const s of split) {
  if (Object.keys(s.forms).length < 2) continue;
  if (!ruleKeys.some((k) => k.includes(s.ch))) uncovered.push(`${s.ch}→${Object.keys(s.forms).join('/')}`);
}
ok(uncovered.length === 0, `每个多义字都有词组表或人工覆盖兜底（${uncovered.length} 个没兜住）`,
  uncovered.length ? `没兜住：${uncovered.join(' ')}` : '');
console.log(`    （实测多义字 ${split.length} 个，词组表 ${Object.keys(dict.phrases).length} 条）`);

console.log('\n── D1 幂等：conv 只许过一次 ──');
let nonIdem = 0; const badSamples = [];
for (const { src, text } of corpus) {
  const once = conv(text);
  const twice = conv(once);
  if (once !== twice) { nonIdem++; if (badSamples.length < 6) badSamples.push(`${src}：${once.slice(0, 34)} → ${twice.slice(0, 34)}`); }
}
ok(nonIdem <= 40, `二次转换基本不变（17,468 条里 ${nonIdem} 条会变）`,
  nonIdem > 40 ? `超阈值：${badSamples.join(' | ')}` : '');
/* 这一条是"为什么不许渲染后再扫一遍 DOM"的根据 —— 存在会变的样本，就说明二次转换有代价。 */
ok(nonIdem > 0, `二次转换**确有**变形样本（${nonIdem} 条）—— D1 不是空谈`);

console.log('\n── D2 单一收口 ──');
const app = readText('js/app.js') || '';
const ownConv = (app.match(/\bconv\((?!\s*$)/g) || []).length;
ok(!/escBold\(conv\(/.test(app), 'escBold 内不再套 conv()（会与内层的转两次）');
ok(!/unbold\(conv\(/.test(app), 'unbold 内不再套 conv()');
ok(/const escBold = \(s\) => esc\(conv\(s\)\)/.test(app), 'escBold 走的是 esc(conv(s))');
ok(/const unbold = \(s\) => conv\(/.test(app), 'unbold 内部含 conv()');
/* 散文字段**只许**经 escBold / unbold（它们内部已含 conv），直接调 conv() 就是第二次转换。
 * ⚠ 判据只覆盖**散文字段**（`PROSE_FIELDS`：`desc`/`fate`/`note`/`summary`/`impact`/`text`…）——
 *   `c.name` / `e.name` / `c.title` / `e.chapter` 这些走的是 `esc()`，**不经过** escBold，
 *   所以它们必须单独 `esc(conv(x))`，那是**对**的（v0.219 加守卫时把这条也拦了，当场改对）。 */
const PROSE_ONLY = /\.(desc|fate|note|summary|impact|text)\b/;
const SKIP_LINE = /function conv|const conv|conv\(s\)|conv\(t\)|conv\(now\)|conv\(isTheoryBook|conv\(el\.textContent|conv\(dark|conv\(fs\)|conv\(state|conv\(raw|=== conv|applyCharFix|fixEntries/;
const convOnProse = [];
for (const line of app.split('\n')) {
  if (!/conv\(/.test(line) || SKIP_LINE.test(line)) continue;
  /* ⚠ 必须**逐个 conv(…) 调用**看参数，不能按行匹配 —— 一行里常同时有
   *   `escBold(e.text)` 和别处的 `conv(...)`，按行判会把没问题的行一起报红。 */
  for (const m of line.matchAll(/conv\(([^()]*)\)/g)) {
    if (PROSE_ONLY.test(m[1])) convOnProse.push(`conv(${m[1]})  ←  ${line.trim().slice(0, 66)}`);
  }
}
ok(convOnProse.length === 0, `散文字段没有被直接喂给 conv()（${convOnProse.length} 处）`,
  convOnProse.length ? convOnProse.join('\n      ') : '');
console.log(`    （app.js 里 conv() 共出现 ${ownConv} 次，含函数定义与内部实现）`);

console.log('\n── 转换表与人工覆盖的一致性 ──');
const charFix = readText('scripts/lib/s2t-overrides.mjs') || '';
ok(charFix.includes('export const PHRASE_BLIND'), 's2t-overrides.mjs 导出 PHRASE_BLIND');
ok(!/NEVER_CONVERT/.test(charFix), '旧的 NEVER_CONVERT 已并入 PHRASE_BLIND（别留两个开关）');
ok(PROTECT_PHRASES.length > 10, `专名保护名单非空（${PROTECT_PHRASES.length} 条）`);
const gen = readText('scripts/make-s2t-dict.mjs') || '';
ok(gen.includes('--check'), '生成器支持 --check（门禁可校验新鲜度）');
ok(gen.includes("from './lib/s2t.mjs'"), '生成器复用判据库，不另抄一份语料逻辑');

console.log(`\n${fails ? '✗' : '✓'} ${n} 条断言，${fails} 条不通过`);
process.exit(fails ? 1 : 0);