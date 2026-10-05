/**
 * 按「从原著出发」核实并清理：只存在于史书、《三国演义》原文里没有的人物。
 *
 * 铁律：人物必须**在《三国演义》原文里出现过**才能进数据。
 *   史书（《三国志》）里有、演义里没有的，是另一本书的人物 —— 放进来会让
 *   读者以为演义里有这个人。宁可少一个，不可多一个假的。
 *
 * 5 个待查：
 *   荀绲 xun-gun        —— 注意：演义里**确实有「荀绲」**（曹操推荐荀彧之侄），
 *                          这条要单独核实，别跟着一起删
 *   陶商 tao-shang      —— 陶谦两个儿子之一，原书只说「二子」
 *   陶应 tao-ying       —— 同上
 *   戴陵 dai-ling       —— 张郃部下，原书 0 次
 *   公孙晃 gongsun-huang —— 公孙渊之子，原书只写公孙康、未提其子
 *
 * 用法：node scripts/purge-history-only.mjs          # 预览
 *      node scripts/purge-history-only.mjs --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');
const NOVEL = 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/三国演义.txt';
const WRITE = process.argv.includes('--write');

const CANDIDATES = ['荀绲', '陶商', '陶应', '戴陵', '公孙晃'];
/**
 * 原文里确实出现、**不许删**的。
 *
 * ⚠ 关键教训：**"全名 0 次" 不等于 "这个人不在原著里"**。
 *   第一版只按 `全名出现次数 === 0` 判定，把戴陵也列进删除名单。
 *   回原文一查，第100回司马懿派张郃劫寨那一段写的是——
 *     「张、戴二人自纵马视之，只见数百辆草车横截去路」
 *     「不独张、戴二人所不料，亦今日读者所不料」
 *   ⇒ **这个人就在原著里，只是原文只写姓氏「戴」，不写全名「戴陵」**
 *   （全名出自《三国志·张郃传》，但"名字从史书来"≠"人只存在于史书"）。
 *   他 note 里原来写的「原书未出现此人」是**错的**，这次一并改正。
 *
 *   荀绲：原文 1 次 ⇒ 保留。
 */
const KEEP_IN_NOVEL = new Set(['荀绲', '戴陵']);

/** note 写错了的人物：删人之外还要顺手改正依据。 */
const FIX_NOTE = new Map([
  ['戴陵', '原书**有此人**，第100回司马懿派兵劫寨时写的是「张、戴二人自纵马视之，'
    + '只见数百辆草车横截去路」「不独张、戴二人所不料」——'
    + '**只写姓氏「戴」，全名「戴陵」0 次**（全名见《三国志·张郃传》）。'
    + '⚠ 原 note 写「原书未出现此人」是错的：查的是全名，不是这个人在不在。'],
]);

const novel = fs.existsSync(NOVEL) ? fs.readFileSync(NOVEL, 'utf8') : null;
if (!novel) console.warn(`⚠ 找不到原文 ${NOVEL}，无法核实！不执行删除。\n`);
const count = (k) => (novel ? novel.split(k).length - 1 : -1);

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const nm = (id) => book.characters.find((c) => c.id === id)?.name ?? id;

console.log('=== 原著核实（《三国演义》全文逐字计数）===');
const drop = [];
for (const name of CANDIDATES) {
  const c = book.characters.find((x) => x.name === name);
  const n = count(name);
  const keep = KEEP_IN_NOVEL.has(name);
  console.log(`  ${name.padEnd(6)} 全名出现 ${String(n).padStart(4)} 次   ${keep ? '★ 保留' : (n === 0 ? '原文没有 ⇒ 应删' : '★ 需人判断')}`);
  if (c && !keep && n === 0) drop.push(c);
}

if (!novel) { console.log('原文缺失，退出。'); process.exit(1); }

console.log(`\n=== 待删 ${drop.length} 人 ===`);
for (const c of drop) {
  const rels = book.relations.filter((r) => r.from === c.id || r.to === c.id);
  console.log(`\n  ${c.name}（${c.id}）  关系 ${rels.length} 条`);
  for (const r of rels) {
    console.log(`    ${nm(r.from)} —${r.type}— ${nm(r.to)}   事件 ${(r.events ?? []).length} 条`);
    for (const e of (r.events ?? [])) console.log(`        ${e.text.slice(0, 96)}`);
  }
}

// 顺带查：有没有别处还引用这些人（events[].chars、别名、旁挂的放行清单）
console.log('\n=== 别处的残留引用 ===');
const ids = new Set(drop.map((c) => c.id));
/* events 是**顶层数组**（不在 book.books 里），每条有 chars: [id]。 */
for (const ev of book.events ?? []) {
  const hit = (ev.chars ?? []).filter((x) => ids.has(x));
  if (!hit.length) continue;
  console.log(`  事件 ${ev.id}（第${ev.ch}章「${ev.name}」）的 chars 里挂着：${hit.map((x) => nm(x)).join('、')}`);
  for (const kw of drop.map((c) => c.name)) {
    if (String(ev.summary ?? '').includes(kw) || String(ev.impact ?? '').includes(kw)) {
      console.log(`      ⚠ 文案里还出现「${kw}」，删人后这句得改`);
    }
  }
}
for (const c of book.characters) {
  const a = (c.aliases ?? []).filter((x) => drop.some((d) => d.name === x));
  if (a.length) console.log(`  ⚠ ${c.name} 的别名含：${a.join('、')}`);
}
/* 放行清单里提到他们 —— 那是"这些搜不到但确认存在"的记录，删人后要同步 */
for (const f of ['three-kingdoms.missing-ok.json', 'three-kingdoms.name-form-ok.json']) {
  const p = path.join(ROOT, 'data', f);
  if (!fs.existsSync(p)) continue;
  const t = fs.readFileSync(p, 'utf8');
  const h = drop.map((c) => c.name).filter((n) => t.includes(n));
  if (h.length) console.log(`  ${f} 里还提到：${h.join('、')} ⇒ 删人后要同步清理`);
}

if (WRITE) {
  // ① 先改正写错的 note（保留者也可能有错依据）
  for (const [name, note] of FIX_NOTE) {
    const c = book.characters.find((x) => x.name === name);
    if (!c) continue;
    console.log(`\n  改正 ${name} 的 note（原依据说"原书未出现"，是按全名查的）`);
    c.note = note;
  }
  if (drop.length) {
    book.characters = book.characters.filter((c) => !ids.has(c.id));
    const rBefore = book.relations.length;
    book.relations = book.relations.filter((r) => !ids.has(r.from) && !ids.has(r.to));
    let evFixed = 0;
    for (const ev of book.events ?? []) {
      if (!Array.isArray(ev.chars)) continue;
      const n = ev.chars.length;
      ev.chars = ev.chars.filter((x) => !ids.has(x));
      if (ev.chars.length !== n) evFixed++;
    }
    fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
    console.log(`\n写入 ${path.relative(ROOT, FILE)}`);
    console.log(`  删 ${drop.length} 人：${drop.map((c) => c.name).join('、')}`);
    console.log(`  删 ${rBefore - book.relations.length} 条关系`);
    console.log(`  修 ${evFixed} 条事件的 chars`);
  } else {
    console.log('\n没有要删的人，只改 note；如需落盘加 --write');
  }
} else {
  console.log('\n（预览模式，加 --write 才落盘）');
}
