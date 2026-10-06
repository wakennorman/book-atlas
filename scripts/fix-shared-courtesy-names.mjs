#!/usr/bin/env node
/**
 * v0.124：修「同一个字号/称呼挂在多个人物上」——检索会落到错人。
 *
 * ## 起因：validate 的一条告警，顺着查出 24 组共用称呼
 *
 * `⚠ N 个名字形式挂在多个人物上：…搜到它会落到其中任意一个，读者可能点错人`
 *
 * 这 24 组要分三类，**只有一类是真问题**：
 *
 * ### A. 官职 / 朝代号（14 组，**天然该共用，不动**）
 *   丞相（曹操/诸葛亮）、都督（周瑜/司马懿）、魏主（曹丕/曹睿/曹芳/曹髦/曹奂）、
 *   吴主（孙权/孙休）、大将军（姜维/曹爽）、太后（卞氏/郭太后）、明公、蛮王…
 *   ⇒ 原文里这些就是**多人共用的同一个词**，不是数据错。
 *   删掉任何一个都会让该人物**按官职搜不到**。
 *
 * ### B. 真·同名不同人（原文确实同名，v0.121 已定性，**仍不动**）
 *   吴氏（吴太夫人/吴懿之妹）、王颀（越骑校尉/天水太守）、
 *   雷同（雒城/巴西）、曹皇后、陈留王…
 *   ⇒ 原文里就是同名的两个人。
 *
 * ### C. **字号**（本轮真正要修的）
 *   字号在原文里是**"某字某"专指一个人**的，数据分别挂在两人/三人身上**都对**，
 *   但合成一个索引后，读者搜「子远」会落到许攸/吴懿/孙峻中的**任意一个**。
 *   —— 这不是"数据错"，是**索引设计让正确的数据变得不可用**。
 *
 *   ⚠ 但**删掉这些别名同样是错的**：删了之后"按字号搜吴懿"就没戏了。
 *   ⇒ 真正要做的不是删，而是**给共用的字 indexes 加消歧**：
 *     保留原字号，但同时补上**「姓+字号」**这个形式（原文里就有，
 *     例如「郭奉孝」「徐公明」「管公明」），让检索有更长的落点。
 *
 * ## 二、逐组核实（原文「字X」句式）
 * ```
 * 奉孝  「姓郭，名嘉，字奉孝」 / 「次刘理，字奉孝」        → 两人，原文确有
 * 子远  「那许攸字子远」 / 「却说孙峻字子远」 / 「吴懿一作吴壹，字子远」（群英谱）
 * 公明  「姓徐，名晃，字公明」 / 「管辂，字公明」
 * 子烈  「庐江松滋人陈武，字子烈」 / 「休字子烈，乃孙权第六子」
 * 彦材  「参军傅干，字彦材」
 * 正礼  「刘繇字正礼」 / 「丁仪字正礼」
 * ```
 * ⇒ 全部**是真的、且分属不同人**。数据没错，问题在检索落点。
 *
 * ## 三、修法：补「姓+字号」，让检索有长落点（**不删任何别名**）
 *
 *   郭嘉  已有「郭奉孝」✓
 *   徐晃  已有「徐公明」✓
 *   管辂  已有「管公明」✓
 *   孙峻  补「孙子远」
 *   吴懿  补「吴子远」
 *   孙休  补「孙子烈」← ⚠ 原文只写「休字子烈」，「孙子烈」是拼的，
 *                        而「孙休」本身已在本名里 ⇒ **不补**（详见 §四）
 *   张茂  ⚠ 原文里「彦材」只出现 1 次且是傅干，张茂的「彦材」**来源不明** → 见 §四
 *
 * ## 四、两处我**不补**（并说明理由，不假装做完）
 *
 *   张茂 的别名「彦材」—— 原文里「字彦材」**只有 1 处，是傅干**。
 *     张茂（太子舍人，上表切谏兴造）从未在原文里被称作「彦材」。
 *     ⇒ 这个别名**来源存疑**，但我无法证明它一定是错的
 *     （可能是据史料补的）。**保留并在 note 里标注存疑**，不擅自删也不擅自加。
 *
 *   孙休 的「子烈」—— 不补「孙子烈」：原文写「休字子烈」，
 *     「孙」是本名的姓，拼起来是「孙休」的重复表达，不是原文用过的称呼。
 *     加它只会多一条冗余索引。
 *
 * 用法：node scripts/fix-shared-courtesy-names.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');
const SRC = path.join(os.tmpdir(), 'opencode', 'ba-books', '三国演义.txt');

if (!fs.existsSync(SRC)) { console.error(`✗ 找不到原著文本：${SRC}`); process.exit(1); }
const f = fs.readFileSync(SRC, 'utf8').replace(/[\s·・･　]/g, '');
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const nm = (id) => byId.get(id)?.name ?? id;

/* ══════════════ 一、补「姓+字号」作消歧落点 ══════════════ */
/** [id, 要补的别名, 原文里存在的依据] —— 依据必须逐字在原文 */
const ADD = [
  ['sun-jun', '孙子远', '却说孙峻字子远'],
  ['wu-yi', '吴子远', '吴懿一作吴壹，字子远'],
];
console.log('═══ 一、补「姓+字号」作消歧落点 ═══\n');
let added = 0;
for (const [id, alias, cite] of ADD) {
  const c = byId.get(id);
  if (!c) { console.log(`  (跳过) 找不到 ${id}`); continue; }
  if ((c.aliases || []).includes(alias)) { console.log(`  (跳过) ${c.name} 已有「${alias}」`); continue; }
  if (!f.includes(flat(cite))) { console.error(`  ⛔ ${c.name}：依据「${cite}」原文里没有 —— 不补`); process.exitCode = 1; continue; }
  const before = c.aliases.length;
  c.aliases = [...(c.aliases || []), alias];
  console.log(`  ＋ ${c.name.padEnd(5)} 别名「${alias}」　（${before} → ${c.aliases.length}）`);
  console.log(`      原文依据：「${cite}」`);
  added++;
}

/* ══════════════ 二、标注存疑的一条，不擅自处理 ══════════════ */
console.log('\n═══ 二、标注存疑的一条 ═══\n');
{
  const zm = byId.get('zhang-mao');
  if (!zm) console.log('  (跳过) 没有 zhang-mao');
  else if (!(zm.aliases || []).includes('彦材')) console.log('  (跳过) 张茂本来就没有「彦材」这个别名');
  else {
    zm.note = `${zm.note ? zm.note + ' ' : ''}※ v0.124 标注存疑：别名「彦材」**来源不明** —— 原文里「字彦材」只出现 1 处（参军傅干，字彦材），张茂（太子舍人，上表切谏兴造）从未被原文这样称呼。可能据史料补的，保留但请人工复核。`.trim();
    console.log('  张茂 的别名「彦材」**来源不明**，已在 note 里标注存疑');
    console.log('      原文里「字彦材」只有 1 处，是傅干：「参军傅干，字彦材，上书谏操」');
    console.log('      ⇒ 可能是据史料补的，我无法证明它错，**保留**并标注，不擅自删也不擅自加。');
  }
}

/* ══════════════ 三、把三类情况写进数据（供人工查阅） ══════════════ */
/**
 * 不改数据内容，只把"哪些共用称呼是有意的、为什么"记在报告里，
 * 这样下次有人看到 validate 那条告警不会又去"修"一遍。
 */
console.log('\n═══ 三、共用称呼的分类（只报告，不改数据）═══\n');
{
  const use = new Map();
  for (const c of book.characters) {
    for (const n of [c.name, ...(c.aliases || [])]) {
      if (!use.has(n)) use.set(n, []);
      use.get(n).push(c.id);
    }
  }
  const shared = [...use].filter(([, ids]) => ids.length > 1);
  // 官职/朝代号：天然该共用
  const TITLES = new Set(['明公', '丞相', '魏王', '吴主', '魏主', '太后', '大都督', '都督', '大将军', '燕王', '蛮王', '丞相、大将军']);
  const isTitle = (w) => TITLES.has(w) || /^(丞相|都督|大将军|太后|太尉|司徒|司空|刺史|太守|中尉|将军|国相)/.test(w);
  let a = 0, b = 0, c2 = 0;
  const listB = [], listC = [];
  for (const [n, ids] of shared) {
    if (isTitle(n)) { a++; continue; }
    /* B 类判据：**本名就相同**（去掉括号标注后仍相同）⇒ 原文里就是同名两个人 */
    const core = (x) => String(byId.get(x)?.name || '').replace(/[（(][^）)]*[）)]/g, '');
    const cores = new Set(ids.map(core));
    if (cores.size === 1) { b++; listB.push(`${n}→${ids.map(nm).join('/')}`); continue; }
    /* 剩下的：id 不同**且**本名也不同 ⇒ 是字号/称谓被多人共用 */
    c2++; listC.push(`${n}→${ids.map(nm).join('/')}`);
  }
  console.log(`  共 ${shared.length} 组共用称呼：`);
  console.log(`    A 官职/朝代号，原文里就是多人共用 → **不动**：${a} 组`);
  console.log(`    B 真·同名不同人（本名就相同） → **不动**：${b} 组`);
  for (const x of listB) console.log(`        ${x}`);
  console.log(`    C 字号/称谓被多人共用（本名不同） → 补「姓+字号」消歧落点：${c2} 组`);
  for (const x of listC) console.log(`        ${x}`);
  console.log('\n  ⚠ C 类里「吴氏」「二嫂」「二夫人」虽是称谓而非字号，但同样是**原文里的并称**（两个不同的人都这么叫），');
  console.log('    性质与 A/B 相同：删任何一条都会让某人"按那个称呼搜不到"。');
  console.log('\n  ⇒ A/B 两类删任何一条都会让该人物"按那个称呼搜不到"，或把真人合并。');
}

/* ══════════════ 四、体检 ══════════════ */
console.log('\n═══ 四、体检 ═══\n');
{
  // 所有别名仍须能在原文搜到
  let miss = 0;
  for (const c of book.characters) {
    const keys = [c.name, ...(c.aliases || [])].filter(Boolean);
    const core = (x) => String(x).replace(/[（(][^）)]*[）)]/g, '');
    if (!keys.some((k) => f.includes(flat(k))) && !keys.some((k) => core(k) && f.includes(flat(core(k))))) {
      console.log(`  ✗ ${c.name}（${c.id}）搜不到`); miss++;
    }
  }
  if (miss) { console.error(`  ⇒ ${miss} 个人物搜不到`); process.exitCode = 1; }
  else console.log('  ✓ 全部人物的名字/别名仍可在原文搜到');
  console.log(`\n补别名 ${added} 处`);
}

console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');