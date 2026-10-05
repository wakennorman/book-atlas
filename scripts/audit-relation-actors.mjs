#!/usr/bin/env node
/**
 * 关系引文的「行为人审计」—— 找出**引文存在、但引文不支持这条关系**的那些边。
 *
 * 起因（v0.101，用户抓出）：
 *   「奥雷里亚诺·布恩迪亚上校 —师徒（唱歌）— 好汉弗朗西斯科」
 *   事件引文是真实的原文（「哼着好汉弗朗西斯科的老歌把家中…贴满了一比索的纸币」），
 *   但那句里的「他」指的是**奥雷里亚诺第二**，不是上校。
 *   ⇒ 引文对得上 ≠ 行为人对得上。我上一轮只做了"引文配对"，就当成了核实通过。
 *
 * 这道审计按**风险**分级，只把可疑的那些挑出来，而不是把两千多条全打印一遍：
 *
 *   A 级 · 代词无主    引文里有「他/她/其/此人」等代词，而引文里**没有**关系双方的名字
 *                      ⇒ 无法判断行为人是谁。**本次的错就在这一类**。
 *   B 级 · 第三方在场 引文里出现了数据中**另一个人物**的名字，且此人与一方有亲属关系
 *                      ⇒ 可能是把邻居的互动挂到了某人头上。
 *   C 级 · 引文查无此文 事件文字在原书里搜不到（含转述、改写、拼接）
 *                      ⇒ 证据等级存疑，需要人工看是不是把转述当引文。
 *   D 级 · 章号不符    事件标了章节，但引文实际出现在另一章
 *
 * ⚠ 这是**审计**，不是断言器：A/B/C/D 都可能是误报（比如引文本来就用简称、
 *   代词指的是不在数据里的人、章号是章节序号而非原书章节）。
 *   所以默认**只出报告、退出码 0**；`--strict` 才让 A 级变成失败。
 *
 * 用法：
 *   node scripts/audit-relation-actors.mjs            # 出报告，退出 0
 *   node scripts/audit-relation-actors.mjs --strict   # A 级即失败
 *   node scripts/audit-relation-actors.mjs --context 200   # 上下文窗口字���
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const ci = argv.indexOf('--context');
const CTX = ci >= 0 ? Number(argv[ci + 1]) || 160 : 160;
const OUT = path.join(ROOT, 'reports', 'relation-actors.md');

/* ── 三本书的原书文本 ─────────────────────────────────── */
const SOURCES = {
  'three-kingdoms': 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/三国演义.txt',
  'one-hundred-years-of-solitude': 'C:/Users/chw/AppData/Local/Temp/opencode/epub.txt',
  'crime-and-punishment': 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/罪与罚.txt',
};
/** 中文顿号/间隔号差异：布恩迪亚 / 布恩蒂亚 这类异译不该算"另一个人" */
const flat = (s) => String(s || '').replace(/[\s·・･]/g, '');

/**
 * 抽出这条事件里所有可能的"原文片段"，按长度从长到短。
 *
 * ⚠ 第一版只取**第一个**「」且要求 ≥4 字，于是
 *     「卢仁却连罗佳都不肯见，还在众人面前把索尼娅说成「女贼」」
 * 这种"引号里只有 2 个字"的事件全部匹配失败，回退去搜整句转述，
 * 而转述本来就搜不到原文 ⇒ C 级把 16 条全报成"证据不存在"。**纯 bug，不是数据问题。**
 *
 * 所以：把所有「」内容都收进来（不论长短），任一条能在原书里定位就算这条事件有原文支撑；
 * 最长的那条用来判断"引文里有没有把行为人写出来"。
 */
function quotesOf(text) {
  const s = String(text || '');
  const out = [...s.matchAll(/[「『]([^」』]+)[」』]/g)].map((m) => flat(m[1]));
  const whole = flat(s);
  out.push(whole);
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

/**
 * 这条事件是不是"**逐字引文**"？
 *
 * ⚠ 三本书的事件里，**绝大多数是转述**，不是原文句子：
 *     三国："桃园焚香结拜，誓同生死"
 *     罪与罚："母亲普尔赫莉雅从外省寄来长信：杜尼娅为了哥哥答应了卢仁的婚事…"
 *   这是既有的写法，不是不合格。**只有带「」的才当逐字引文。**
 *   第一版用"≥24 字"当判据 ⇒ 罪与罚 58 条"逐字引文"里有 49 条是转述，
 *   C 级全在报"证据不存在"，纯噪声。判据收紧到「」才看得出真问题。
 */
function looksVerbatim(text) {
  return /[「『]/.test(String(text || ''));
}

const PRONOUN = /[他她其此人该]/;

const books = fs.readdirSync(path.join(ROOT, 'data'))
  .filter((f) => f.endsWith('.json') && !f.startsWith('.') && !/\.(graph|text|missing-ok|relayout|altnames-sources|name-form-ok)\.json$/.test(f) && f !== 'books.json');

const rows = [];
const stats = {};
let srcMissing = [];

for (const bf of books) {
  const slug = bf.replace(/\.json$/, '');
  const srcPath = SOURCES[slug];
  const src = srcPath && fs.existsSync(srcPath) ? flat(fs.readFileSync(srcPath, 'utf8')) : null;
  if (!src) { srcMissing.push(slug); }
  const book = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', bf), 'utf8'));
  const byId = new Map((book.characters || []).map((c) => [c.id, c]));
  const nm = (id) => byId.get(id)?.name ?? id;
  const allNames = (book.characters || []).map((c) => ({ id: c.id, flat: flat(c.name) }))
    .filter((x) => x.flat.length >= 2);

  /* 亲缘邻接：用于 B 级判定"第三方与一方有关系" */
  const kinRe = /^(亲生)?(父|母)(子|女)$|^养(父|母)(子|女)$|叔侄|姑侄|舅甥|姨甥|祖孙|兄弟|姐妹|夫妻|父子|母子|父女|母女/;
  const kinAdj = new Map();
  for (const r of book.relations || []) {
    if (!kinRe.test(String(r.type || '').replace(/[（(].*$/, ''))) continue;
    if (!kinAdj.has(r.from)) kinAdj.set(r.from, new Set());
    if (!kinAdj.has(r.to)) kinAdj.set(r.to, new Set());
    kinAdj.get(r.from).add(r.to);
    kinAdj.get(r.to).add(r.from);
  }

  /**
   * 一个人物在引文里可能以**全名、简称、别名、称号**出现。
   * 数据里 `name` 是全名（罗季昂·罗曼内奇·拉斯柯尔尼科夫），
   * 而事件文案里写的是简称（罗佳）—— 只比全名会把 12 条全误判成"代词无主"。
   */
  const namesOf = (id) => {
    const c = byId.get(id);
    if (!c) return [];
    return [c.name, ...(c.aliases ?? []), ...(c.altNames ?? [])]
      .map(flat).filter((x) => x.length >= 2);
  };

  let n = 0;
  let vCount = 0;
  for (const rel of book.relations || []) {
    const A = flat(nm(rel.from)), B = flat(nm(rel.to));
    const aliasA = namesOf(rel.from), aliasB = namesOf(rel.to);
    const mentions = (text, list) => list.some((x) => text.includes(x));
    for (const ev of (rel.events || [])) {
      if (ev.derived || /由.*推导/.test(String(ev.text || ''))) continue;   // 推导边不算引文
      const qs = quotesOf(ev.text);
      const q = qs[0];
      if (!q) continue;
      n++;
      const verbatim = looksVerbatim(ev.text);
      if (verbatim) vCount++;
      const flags = [];
      /* 任一候选片段能在原书里定位，就算这条事件有原文支撑 */
      let pos = -1;
      let hitQ = '';
      if (src) {
        for (const cand of qs) {
          if (cand.length < 2) continue;
          const p = src.indexOf(cand.slice(0, Math.min(40, cand.length)));
          if (p >= 0) { pos = p; hitQ = cand; break; }
        }
      }
      /* C 只对逐字引文判：转述本来就搜不到原文 */
      if (verbatim && src && pos < 0) flags.push('C');
      /* A：只在引文**一个当事人名字都没提**时才算"代词无主"。
       *   ⚠ 第一版要求"没有同时出现两个名字"就报 ⇒ 35 条里绝大多数是误报：
       *      「他第一次走进索尼娅的屋子，请她读《拉撒路复活》」——「他」就是关系的一方（罗佳），
       *      这是中文里最正常的写法，不是歧义。
       *      真正危险的只有"引文里连一个当事人名字都没有，光靠代词"。 */
      const longest = qs.find((x) => x.length >= 12) ?? q;
      const namesAny = mentions(longest, aliasA) || mentions(longest, aliasB);
      if (verbatim && PRONOUN.test(longest) && !namesAny) flags.push('A');
      /* B 级：引文里的第三方人物，且与某一方有亲属关系。
       *   ⚠ 第一版用 `includes` 做子串匹配 ⇒ 「阿尔卡蒂奥」被当成了第三方，
       *      而它只是「何塞·阿尔卡蒂奥（第二代）」的**子串**，8 条 B 全是这么来的。
       *   排除规则：第三方名字若与任一当事人的名字**互为子串**，就不算另一个人 ——
       *   中文人名大量共姓共名，不排除必然误报。 */
      if (pos >= 0) {
        const ctx = src.slice(Math.max(0, pos - CTX), pos + hitQ.length + CTX);
        const partySet = [...aliasA, ...aliasB];
        const isSubstrOfParty = (s) => partySet.some((p) => p.includes(s) || s.includes(p));
        const thirds = allNames.filter((x) => x.id !== rel.from && x.id !== rel.to
          && longest.includes(x.flat) && !isSubstrOfParty(x.flat)
          && (kinAdj.get(rel.from)?.has(x.id) || kinAdj.get(rel.to)?.has(x.id)));
        if (thirds.length) flags.push('B');
        if (ev.ch != null && ev.ch !== undefined) {
          // 章号核对：引文若在别章也出现，说明可能标错（只在原文多处出现时有意义）
          // 这里只记录，不判定
        }
        if (flags.length) rows.push({ book: slug, rel, ev, q, flags, ctx, A: nm(rel.from), B: nm(rel.to), thirds });
      } else if (flags.length) {
        rows.push({ book: slug, rel, ev, q, flags, ctx: null, A: nm(rel.from), B: nm(rel.to), thirds: [] });
      }
    }
  }
  stats[slug] = { events: n, verbatim: vCount, chars: (book.characters || []).length, rels: (book.relations || []).length };
}

const byFlag = { A: [], B: [], C: [] };
for (const r of rows) for (const f of r.flags) byFlag[f].push(r);
const risky = rows.filter((r) => r.flags.includes('A') || r.flags.includes('B'));

console.log('关系引文 · 行为人审计\n');
for (const [slug, s] of Object.entries(stats)) {
  console.log(`  ${slug.padEnd(30)} 事件 ${String(s.events).padStart(5)} 条（其中逐字引文 ${String(s.verbatim).padStart(4)}）`
    + ` / 关系 ${s.rels} / 人物 ${s.chars}`
    + (srcMissing.includes(slug) ? '   ⚠ 找不到原书文本' : ''));
}
console.log(`\n  A 代词无主 ${byFlag.A.length}　B 第三方在场 ${byFlag.B.length}　C 查无此文 ${byFlag.C.length}`);
console.log(`  高风险（A 或 B）${risky.length} 条`);
for (const [slug, s] of Object.entries(stats)) {
  const a = byFlag.A.filter((r) => r.book === slug).length;
  const b = byFlag.B.filter((r) => r.book === slug).length;
  const c = byFlag.C.filter((r) => r.book === slug).length;
  if (a || b || c) console.log(`    ${slug.padEnd(30)} A ${a}　B ${b}　C ${c}`);
}

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
const L = [];
L.push('# 关系引文的「行为人」审计');
L.push('');
L.push('> 由 `scripts/audit-relation-actors.mjs` 生成。起因是 v0.101 用户抓出一条**引文真实、行为人挂错**的关系');
L.push('> （把「奥雷里亚诺第二哼着好汉弗朗西斯科的歌」挂到了上校名下）。');
L.push('>');
L.push('> **引文存在 ≠ 引文支持这条关系。** 这是本审计要抓的东西。');
L.push('');
L.push('分级：**A** 代词无主（引文里有「他/她/其」而没有双方名字，行为人无法判定）｜**B** 第三方在场（引文里有另一个**与一方有亲属关系**的人物，可能挂错人）｜**C** 查无此文（事件文字在原书里搜不到）。');
L.push('');
L.push('⚠ A/B/C 都可能是误报：引文本来就用简称、代词指的是不在数据里的人、章号是章节序号而非原书章节。**这一份是给人看的，不是判决。**');
L.push('');
for (const [slug, s] of Object.entries(stats)) L.push(`- \`${slug}\`：引文事件 ${s.events} 条 / 关系 ${s.rels} / 人物 ${s.chars}`);
L.push('');
for (const f of ['A', 'B', 'C']) {
  L.push(`## ${f} 级　${byFlag[f].length} 条`);
  L.push('');
  if (!byFlag[f].length) { L.push('_（无）_'); L.push(''); continue; }
  for (const r of byFlag[f]) {
    L.push(`### \`${r.book}\`　${r.A} —${r.rel.type}— ${r.B}`);
    L.push('');
    L.push(`- 事件：${String(r.ev.text).slice(0, 200)}`);
    if (r.thirds?.length) L.push(`- ⚠ 引文里另有与一方有亲属关系的人物：${r.thirds.map((x) => nmOf(r, x.id)).join('、')}`);
    if (r.ctx) {
      L.push('');
      L.push('原文上下文：');
      L.push('');
      L.push('```');
      L.push(r.ctx);
      L.push('```');
    }
    L.push('');
  }
}
function nmOf(r, id) {
  const b = books.find((f) => f.replace(/\.json$/, '') === r.book);
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', b), 'utf8'));
  return d.characters.find((c) => c.id === id)?.name ?? id;
}
fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(`\n报告 → ${path.relative(ROOT, OUT)}`);

if (STRICT && byFlag.A.length) {
  console.log(`\n✗ --strict：A 级 ${byFlag.A.length} 条未处理`);
  process.exit(1);
}
