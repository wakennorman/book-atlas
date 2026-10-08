/* 拆书内容体检 —— v0.141；v0.143 扩到全部书
 *
 * 上一轮写完三国 120 回（198 条 + 24 条全局），但校验器只验「引用的 id 真实存在」，
 * 不验「body 里那句话说的是不是那个事件」。本脚本补这一层。
 *
 * ⚠ v0.143 修的两处写死（和 v0.142 修 app.js 正则是同一个病）：
 *   ① `BOOK = 'three-kingdoms'` 写死 ⇒ 《罪与罚》《百年孤独》写完后**从没被体检过**；
 *      改成扫描 data/annotations/*.json，有几本体检几本。
 *   ② id 提取正则写死三国形态 e-NN-N ⇒ 另两本（e1 / e01）的行内引用一个都抓不到；
 *      改成形态无关（见下面的 ID_RE，注释里不能写出带星号斜杠闭合的正则字面量）。
 *   另：LATIN_OK 补 summary|impact|quote —— basis 里**有意**写的字段名不是残留英文
 *      （v0.141 就发现过这个假阳性，当时只当个案记下，这里一次性关掉）。
 *
 * 能机械验的（这里做）：
 *   A1 body 里每个行内 id 是否真实存在、是否在该条目的 events[] 里
 *   A2 events[] 里有没有 body 从未引用的（可能是凑数）
 *   A3 body 引用了章号 ≠ 本条目章号的事件（跨章引用，必须逐条确认是否有意）
 *   A4 全局条目里的每个行内 id 是否真实存在
 *   B1 排版垃圾：繁体字 / 残留英文 / 未闭合的 ** / 重复标点 / 空格异常
 *
 * 不能机械验的（要人读）：
 *   C  body 的判断有没有超出该事件的 name / summary / impact —— 由整理者逐条读
 *
 * 本脚本**只报告、exit 0**（不在门禁里）—— 分类里仍有已知假阳性，供人工核。
 */
import fs from 'node:fs';

const BOOKS = fs.readdirSync('data/annotations')
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));
if (!BOOKS.length) { console.log('data/annotations/ 下没有标注文件'); process.exit(0); }

const TRAD = '個裏爲說這麼沒對會開後還現經實應過從來發們時樣點兒體與內';
const LATIN_OK = /^(basis|global|items|chars|events|title|body|schema|slug|note|three|kingdoms|ok|meta|type|summary|impact|quote)$/i;
/* ⚠ 形态无关的行内 id —— 三本书是 e-1-3 / e1 / e01 三种形态，写死一种另外两本就全漏。 */
const ID_RE = /e-?\d[\w-]*/g;
const ID_OK = /^e-?\d[\w-]*$/;

const problems = [];
const note = (kind, where, msg) => problems.push({ kind, where, msg });
let nItems = 0, nGlobal = 0, nChapters = 0;

for (const BOOK of BOOKS) {
  const A = JSON.parse(fs.readFileSync(`data/annotations/${BOOK}.json`, 'utf8'));
  const B = JSON.parse(fs.readFileSync(`data/${BOOK}.json`, 'utf8'));
  const evById = new Map(B.events.map((e) => [e.id, e]));
  const chOf = (id) => {
    const e = evById.get(id);
    if (!e) return null;
    const m = String(e.chapter ?? '').match(/\d+/) ?? String(e.ch ?? '').match(/\d+/);
    return m ? Number(m[0]) : null;
  };
  const P = (s) => `《${BOOK}》${s}`;
  nItems += (A.items || []).length;
  nGlobal += (A.global || []).length;
  nChapters += new Set((A.items || []).map((i) => i.ch)).size;

  // ── A1 / A2 / A3 ──
  for (const it of A.items || []) {
    const tag = P(`ch${it.ch}「${it.title}」`);
    const declared = new Set(it.events || []);
    const cited = [...String(it.body).matchAll(ID_RE)].map((m) => m[0]);

    for (const id of new Set(cited)) {
      if (!evById.has(id)) { note('A1-事件不存在', tag, id); continue; }
      if (!declared.has(id)) note('A1-body 引用了但未列入 events[]', tag, `${id}「${evById.get(id).name}」`);
    }
    for (const id of declared) {
      if (!evById.has(id)) { note('A1-events[] 里的 id 不存在', tag, id); continue; }
      if (!cited.includes(id)) note('A2-events[] 列了但 body 没引用', tag, `${id}「${evById.get(id).name}」`);
      const ec = chOf(id);
      if (ec !== null && ec !== it.ch) {
        note('A3-跨章引用（需人工确认是否有意）', tag, `${id}「${evById.get(id).name}」是第 ${ec} 回事件，本条是第 ${it.ch} 回`);
      }
    }
  }

  // ── A4 ──
  for (const g of A.global || []) {
    const tag = P(`全局「${g.title}」`);
    for (const m of new Set([...String(g.body).matchAll(ID_RE)].map((x) => x[0]))) {
      if (!evById.has(m)) note('A4-全局引用的事件不存在', tag, m);
    }
  }

  // ── B1 排版垃圾 ──
  for (const it of [...(A.items || []).map((x) => ({ tag: P(`ch${x.ch}`), o: x })), ...(A.global || []).map((x) => ({ tag: P(`全局「${x.title}」`), o: x }))]) {
    const texts = [['title', it.o.title], ['body', it.o.body], ['basis', it.o.basis]].filter(([, v]) => typeof v === 'string');
    for (const [field, s] of texts) {
      const trad = [...new Set([...s].filter((c) => TRAD.includes(c)))];
      if (trad.length) note('B1-繁体字', it.tag, `${field}：${trad.join(' ')}`);
      for (const m of s.matchAll(/[A-Za-z]{3,}/g)) {
        if (!LATIN_OK.test(m[0]) && !ID_OK.test(m[0])) note('B1-残留英文', it.tag, `${field}：${m[0]}`);
      }
      const bold = (s.match(/\*\*/g) || []).length;
      if (bold % 2 !== 0) note('B1-粗体标记不闭合', it.tag, `${field}：${bold} 个 **`);
      if (/[，。；：、]{2,}/.test(s)) note('B1-重复标点', it.tag, field);
      if (/\s{2,}/.test(s)) note('B1-连续空格', it.tag, field);
      if (/[，。；：、] /.test(s)) note('B1-中文标点后有多余空格', it.tag, field);
    }
    if (it.o.basis && !/整理者推断|原文依据/.test(it.o.basis)) note('B1-basis 措辞异常', it.tag, it.o.basis);
  }
}

// ── 汇总 ──
const byKind = new Map();
for (const p of problems) {
  if (!byKind.has(p.kind)) byKind.set(p.kind, []);
  byKind.get(p.kind).push(p);
}
console.log(`体检对象：${BOOKS.join(' / ')}（共 ${nItems} 条章节条目 / ${nChapters} 章 + ${nGlobal} 条全局）\n`);
if (!problems.length) {
  console.log('✓ 机械可验的部分全部通过（0 处问题）');
} else {
  for (const [kind, list] of byKind) {
    console.log(`── ${kind}：${list.length} 处 ──`);
    for (const p of list.slice(0, 40)) console.log(`   ${p.where}  ${p.msg}`);
    if (list.length > 40) console.log(`   …另有 ${list.length - 40} 处`);
    console.log('');
  }
  console.log(`合计 ${problems.length} 处（A3 与 C 需要人工逐条确认）`);
}
console.log(`\n（供人工核的量：${byKind.get('A3-跨章引用（需人工确认是否有意）')?.length || 0} 处跨章引用）`);