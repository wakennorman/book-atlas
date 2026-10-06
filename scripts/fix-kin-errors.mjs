#!/usr/bin/env node
/**
 * v0.127：修 3 条**填错的 kin** ＋ 删 1 条**真重复**的并行边。
 *
 * ## 起点：validate 那 63 条「type 看着像 X 但标的是 Y」
 *
 * 这批告警**绝大部分是启发式误报**，但混着几条真错。逐条定性如下。
 *
 * ### A. 三条真错（本轮要改）
 *
 * #### A1. 彻里吉 —君臣→ 雅丹  标了 `kin=blood` —— **纯错，这条根本不是亲属边**
 *   原文第 94 回：「却说西羌国王彻里吉……手下有一文一武：
 *                  **文乃雅丹丞相**，武乃越吉元帅。」
 *   ⇒ 雅丹是**丞相**，文臣；与国王的关系是君臣。原文没有一处说他们是亲属。
 *   ⇒ 不是"该标哪个 kin"，是 **kin 整个不该有**。删掉。
 *
 * #### A2. 关羽 —养父子→ 关平  标了 `kin=sworn`（结义）
 *   type 自己写着「**养**父子」，kin 却标结义 —— 字段自相矛盾。
 *   原文第 28 回：「**关定命关平拜关公为父**」（过房为子）
 *   原文第 73 回：「此关公**义子**关平也」
 *   第 120 回注释：「**关平为养子**」
 *   ⇒ "义子"在古代汉语里就是养子，不是结义干亲。**应为 adoptive。**
 *
 * #### A3. 孙策 —赐姓收养→ 孙河  标了 `kin=sworn`（结义）
 *   type 自己写着「赐姓**收养**」，kin 却标结义。
 *   原文第 82 回：「其父名河，本姓俞氏，**孙策爱之，赐姓孙**，因此亦系吴王宗族」
 *   ⇒ 全文没有一处说两人结拜。**应为 adoptive。**
 *   ⚠ 附带一提：这个"孙河"跟 v0.121 记过的另一条别名问题是同一处原文 ——
 *     孙河的别名「俞氏」已删（那是他**本姓**，指错人），本轮只改 kin。
 *
 * ### B. 一条真重复边（本轮要删）
 *
 * **孙权 ↔ 孙桓 之间有两条边，指向同一种关系，措辞矛盾**：
 * ```
 * 孙权 --族叔侄--> 孙桓   kin=adoptive   events: 第82回「孙桓请兵破蜀，孙权许之」
 * 孙桓 --叔侄  --> 孙权   kin=blood      events: 第83回「孙桓困于彝陵…」
 * ```
 * 原文第 82 回孙权亲口叫孙桓「**侄**」：「权曰：侄虽英勇，争奈年幼」
 * ⇒ 就是**叔侄**一种关系。且它的 `kin=adoptive` 也错 ——
 *   收养发生在**孙策→孙河**那一代（孙河被赐姓），孙桓是孙河的**亲生儿子**
 *   （数据里 `孙河 --父子→ 孙桓 kin=blood` 已经是对的），孙权没有收养孙桓。
 *
 * ★ 但这**不是**"同一对人只能有一条边" —— 全书有 278 对人物之间有多条边，
 *   那是本项目**明确支持**的设计（并行边，v0.xx 专门加的）。
 *   区别在这里：**这两条边的 type 是同义反复（叔侄 vs 族叔侄），
 *   而且 kin 互相矛盾**，等于把同一件事画了两遍还说了两种性质。
 *   像「甘宁↔凌统」那样 3 条边是**杀父之仇/同袍/生死之交**三种不同关系 —— 那是正常的。
 *
 * ### C. 其余全是启发式误报，**不动**
 *
 * | 告警 | 为什么是误报 |
 * | |---|
 * | `族叔侄`/`同宗`/`汉室同宗` 被判"像血缘" | `同宗` 确实是血亲；`族叔侄` 里的"叔"字命中了血缘正则 |
 * | `义叔侄`/`义伯侄` 被判"像血缘" | "义"是结义不是血缘，但正则只看到"叔侄" |
 * | `情同兄弟`/`义同兄弟` 被判"像血缘" | 里面那个"兄/弟"字命中了血缘正则 |
 * | `君臣姻亲（国舅）` 被判"像血缘" | 里面"姻"字…… 实为 `姻亲` 未列入 inlaw 正则，`君臣`又含"臣" |
 * | `君臣` 标了 kin=blood（彻里吉那条） | ← **这条是真错，见 A1** |
 * | `zhuge-feng→zhuge-liang` type「先祖与后裔」 | 确实是血亲，但 `先祖/后裔` 不在血缘正则里 |
 * | `cao-teng→cao-ang` 等「养曾祖孙」判收养 | **这是 v0.111 用户裁定的结果**：路径含养亲边就标 adoptive 并在称谓上加"养"。有意为之 |
 *
 * ⇒ 最后一类占了这 63 条里的 30 多条。**它们不是错误，是推导规则的有意输出。**
 *   要消它们得改 `guessKin` 的正则或 kin 规范，那是改判据不是改数据。
 *
 * 用法：node scripts/fix-kin-errors.mjs [--write]
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
const nm = new Map(book.characters.map((c) => [c.id, c.name]));

/* ══════════════ 一、原文核验 ══════════════ */
console.log('═══ 一、原文核验（逐条从原文文件切出）═══\n');
/* ⚠ 这五条第一版我都写成"读起来通顺"的话，4 条原文查不到：
 *   「遂以他事陷蔡邕」「操曾祖曹节，字元伟」这类省字/注释标记的坑这轮又踩。
 *   ⇒ 每条都取**最短无歧义片段**，避开省略字与注释标记。 */
const CITES = {
  雅丹是丞相: '文乃雅丹丞相，武乃越吉元帅',
  关平拜父: '关平为养子',
  关平义子: '此关公义子关平也',
  孙河赐姓: '其父名河，本姓俞氏，孙策爱之，赐姓孙',
  孙权称侄: '侄虽英勇，争奈年幼',
};
let citeOk = true;
for (const [k, v] of Object.entries(CITES)) {
  const hit = f.includes(flat(v));
  console.log(`  ${hit ? '✓' : '✗'} ${k.padEnd(12)} 「${v}」`);
  if (!hit) citeOk = false;
}
if (!citeOk) { console.error('\n  ⛔ 定位短语核验不过 —— 中止'); process.exit(1); }

/* ══════════════ 二、修 3 条填错的 kin ══════════════ */
console.log('\n═══ 二、修 kin ═══\n');

/** 找一条边（不分方向，按 type 精确匹配） */
function findRel(a, b, type) {
  return book.relations.find((r) => r.type === type
    && ((r.from === a && r.to === b) || (r.to === a && r.from === b)));
}

const KIN_FIX = [
  {
    id: 'A1', a: 'che-li-ji', b: 'ya-dan', type: '君臣', to: null,
    why: '雅丹是西羌**丞相**，与国王彻里吉是君臣。原文「手下有一文一武：文乃雅丹丞相」'
       + '—— 文臣与国王并列，不是亲属。这条根本不该有 kin。',
    cite: CITES.雅丹是丞相,
  },
  {
    id: 'A2', a: 'guan-yu', b: 'guan-ping', type: '养父子（关羽收关平为义子）', to: 'adoptive',
    why: 'type 自己写着「养父子」，kin 却标结义 —— 自相矛盾。'
       + '原文「关平为养子」「此关公义子关平也」；古代汉语里"义子"就是养子。',
    cite: `${CITES.关平拜父}／${CITES.关平义子}`,
  },
  {
    id: 'A3', a: 'sun-ce', b: 'sun-he-orig', type: '赐姓收养', to: 'adoptive',
    why: 'type 自己写着「赐姓收养」，kin 却标结义。'
       + '原文「孙策爱之，赐姓孙，因此亦系吴王宗族」—— 全文无一处说结拜。',
    cite: CITES.孙河赐姓,
  },
];

let kinFixed = 0;
for (const it of KIN_FIX) {
  const rel = findRel(it.a, it.b, it.type);
  console.log(`── ${it.id}  ${nm.get(it.a)} —${it.type}→ ${nm.get(it.b)}`);
  if (!rel) { console.log('   (跳过) 没找到这条边\n'); continue; }
  console.log(`   kin: ${rel.kin}  →  ${it.to ?? '(删除)'}`);
  console.log(`   ${it.why}`);
  console.log(`   原文依据：${it.cite}`);
  if (it.to === null) delete rel.kin;
  else rel.kin = it.to;
  kinFixed++;
  console.log();
}

/* ══════════════ 三、删 1 条真重复边（孙权 ↔ 孙桓）════════════ */
console.log('═══ 三、删重复边：孙权 ↔ 孙桓 ═══\n');
let dupDropped = 0;
{
  /* 为什么删 `孙权 --族叔侄--> 孙桓` 而不是 `孙桓 --叔侄--> 孙权`：
   *   · 两条的 events 不同（第82回请兵破蜀 / 第83回彝陵被困），
   *     删任何一条都会丢掉一个事件 ⇒ 只能留信息更多、措辞更准的那条。
   *   · `叔侄` 是原文用词（第82回孙权亲口叫孙桓「侄」），保留。
   *   ⚠ 我**没有**把留下的边改成「长辈→晚辈」方向。查过：
   *     本数据 127 条旁系边里 83 条长辈→晚辈、**12 条晚辈→长辈**
   *     （手打的有 7 条与 generation 相反），方向本来就不统一 ——
   *     那是既有的更大一致性问题，**不该在这一轮顺手改**。
   *     而且 `generation` 在这里靠不住：孙权 gen=2、孙桓 gen=4，
   *     可孙权是孙桓的叔辈（辈分不是代数）。
   *   ⚠ 被删边的 events 记进 note，不假装它没存在过。 */
  const DROP = findRel('sun-quan', 'sun-huan', '族叔侄');
  const KEEP = findRel('sun-huan', 'sun-quan', '叔侄');
  if (!DROP || !KEEP) { console.log('  (跳过) 两条边没都找到'); }
  else {
    console.log('  两条边指向同一种关系，type 同义反复（族叔侄 / 叔侄）而 kin 互相矛盾：');
    console.log(`    删：孙权 --族叔侄--> 孙桓   kin=adoptive  ev=${DROP.events?.[0]?.text}`);
    console.log(`    留：孙权 ←叔侄--- 孙桓   kin=blood     ev=${KEEP.events?.[0]?.text}`);
    console.log('  原文依据：第82回孙权亲口叫孙桓「侄」——「权曰：侄虽英勇，争奈年幼」');
    console.log('  ⇒ 就是叔侄一种关系。且 kin=adoptive 也错：收养发生在孙策→孙河那一代，');
    console.log('     孙桓是孙河的**亲生儿子**，孙权没有收养他。\n');
    const evText = (DROP.events || []).map((e) => e.text).filter(Boolean).join('；');
    const c = book.characters.find((x) => x.id === 'sun-huan');
    c.note = `${c.note ? c.note + ' ' : ''}※ v0.127 原先与「孙权」之间有两条边（孙权—族叔侄→孙桓 / 孙桓—叔侄→孙权），`
      + `type 同义反复且 kin 矛盾（adoptive vs blood），等于把同一件事画两遍。已删前者。`
      + `被删边上记的事件：「${evText}」。`.trim();
    book.relations = book.relations.filter((r) => r !== DROP);
    dupDropped = 1;
    KEEP.kin = 'blood';
    console.log('  ✓ 已删「孙权 --族叔侄--> 孙桓」，保留「孙权 ←叔侄— 孙桓」kin=blood');
    console.log('  ✓ 被删边的事件已记进 孙桓 的 note，不当作没存在过');
    console.log(`  ✓ 孙权 note：${c.note.slice(0, 60)}…`);
  }
}

/* ══════════════ 四、体检 ══════════════ */
console.log('\n═══ 四、体检 ═══\n');
{
  // ① 目标三条已改
  console.log('  ① 目标 kin：');
  const chk = [
    ['che-li-ji', 'ya-dan', '君臣', '(无)'],      // 本该没有 kin
    ['guan-yu', 'guan-ping', '养父子（关羽收关平为义子）', 'adoptive'],
    ['sun-ce', 'sun-he-orig', '赐姓收养', 'adoptive'],
  ];
  let bad = 0;
  for (const [a, b, t, want] of chk) {
    const r = findRel(a, b, t);
    const got = r ? (r.kin ?? '(无)') : '(边不见了)';
    const ok = got === want;
    if (!ok) bad++;
    console.log(`     ${ok ? '✓' : '✗'} ${nm.get(a)}—${t}→${nm.get(b)}  kin=${got}`);
  }
  if (bad) process.exitCode = 1;

  // ② 孙权↔孙桓 只剩一条
  const hu = book.relations.filter((r) => (r.from === 'sun-quan' && r.to === 'sun-huan') || (r.from === 'sun-huan' && r.to === 'sun-quan'));
  console.log(`\n  ② 孙权↔孙桓 现在 ${hu.length} 条边：`);
  for (const r of hu) console.log(`     ${nm.get(r.from)} --${r.type}--> ${nm.get(r.to)} kin=${r.kin}`);
  if (hu.length !== 1) { console.error('     ✗ 不是 1 条'); process.exitCode = 1; } else console.log('     ✓ 同义重复已清掉，只剩一种关系');

  // ③ 关系总数
  console.log(`\n  ③ ${book.characters.length} 人 / ${book.relations.length} 关系`);
  console.log(`     （改前 2338；删 1 条重复边 ⇒ ${book.relations.length === 2337 ? '✓' : '✗ 预期 2337'}）`);

  // ④ 仍然存在"同一对多条边"的规模（说明并行边机制没被我误伤）
  const pairs = new Map();
  for (const r of book.relations) {
    const k = r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
    pairs.set(k, (pairs.get(k) || 0) + 1);
  }
  console.log(`\n  ④ 并行边仍在：${[...pairs.values()].filter((v) => v > 1).length} 对人物之间有多条边（本轮只删了同义反复那 1 对）`);

  // ⑤ 名字/别名仍可在原文搜到
  const core = (n) => String(n).replace(/[（(][^）)]*[）)]/g, '');
  let miss = 0;
  for (const c of book.characters) {
    const keys = [c.name, ...(c.aliases || [])].filter(Boolean);
    if (!keys.some((k) => f.includes(flat(k))) && !keys.some((k) => core(k) && f.includes(flat(core(k))))) { console.log(`     ✗ ${c.name}（${c.id}）`); miss++; }
  }
  console.log(miss ? `     ⇒ ${miss} 个搜不到` : '  ⑤ ✓ 全部人物的名字/别名仍可在原文搜到');
  if (miss) process.exitCode = 1;
}

console.log(`\n本轮：改 kin ${kinFixed} 条（其中 1 条是删除而非改值）；删重复边 ${dupDropped} 条`);
console.log('不做：那 30 多条「养X孙（推导）标收养」的告警 —— v0.111 用户裁定的有意输出，不是错误。');
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
