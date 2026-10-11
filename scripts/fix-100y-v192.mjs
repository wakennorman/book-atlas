#!/usr/bin/env node
/**
 * v0.192 · 把「何塞·阿尔卡蒂奥（第五代）↔ 阿玛兰妲·乌尔苏拉」这条兄妹线
 * **从推导边升成手写边**，并就地删掉那条过期的推导边。
 *
 * ## 用户报的现象与真正的根因
 *
 * 用户：「何塞·阿尔卡蒂奥（第五代）和阿玛兰妲·乌尔苏拉之间**居然没有关系线**。」
 *
 * 数据里其实**有**这条线，但它是一条 `derived: true` 的**推导边**。而前端有一个
 * 「族谱补全：显示/隐藏」开关（`js/app.js` 的 `state.showDerived`，
 * `relVisible = (r) => !isDerived(r) || state.showDerived`）——
 * **关掉它，所有推导边一起消失**。用无头浏览器实测（新建 profile、默认设置）：
 *
 * | 设置 | 这两人的线 | 另两对兄妹的线 |
 * |---|---|---|
 * | 族谱补全：**显示** | ✓ `姐弟（推导）` | ✓ `姐弟` / `姐妹`（手写） |
 * | 族谱补全：**隐藏** | **✗ 一条都没有** | ✓ 仍在 |
 *
 * ⇒ 奥雷里亚诺第二的三个孩子里，**两对的兄妹线是手写的、只有这一对是推导的**。
 *   这不是"开关坏了"，是**数据不一致**：同一层关系，两对是第一手、一对是自动补的。
 *   用户看到的就是这个形状。
 *
 * ## 顺带逮到的一处**错标签**：`姐弟` 应为 `兄妹`
 *
 * 那条推导边写的是 `阿玛兰妲·乌尔苏拉 —姐弟→ 何塞·阿尔卡蒂奥（第五代）`，
 * 即"姐姐 + 弟弟"。**反了**：何塞·阿尔卡蒂奥（第五代）是奥雷里亚诺第二的
 * **头生子**（第 10 章原文），阿玛兰妲·乌尔苏拉是最小的女儿（第 14 章原文
 * 「梅梅就多了一个新生的小妹妹」）。
 *
 * 根因不在数据、在 `scripts/kin-terms.mjs`：同辈（`gap === 0`）的长幼是
 * `elder = f.da <= f.db ? aId : bId` —— 同辈时 `f.da === f.db`，于是
 * **谁在参数里排前面谁就是"兄/姐"**；而 `derive-kin.mjs` 传进来的两个 id
 * 是**按字符串排序**的（`amaranta-ursula` < `jose-arcadio-5`）⇒ 长幼等于
 * **id 的字母序**。这是一处**独立的缺陷**，本脚本只负责把这一对升成手写边。
 *
 * ## ⚠ 那处缺陷**本轮没修**（别以为它被顺手带掉了）
 *
 * 实测（v0.192，当场跑数）：三本书里 `type` 以 `兄妹/姐弟` 结尾的**推导**边共
 * **19 条**，**全部在三国**，且**两端都有 `birthRank` 的：0 条** ——
 * 也就是说这 19 条的「兄/姐 vs 弟/妹」**全是 id 字典序猜的**。
 * 证据是它们与 id 序**逐条吻合**（`cao-guiren < cao-pi` ⇒ 姐弟、
 * `cao-hou < cao-zhi` ⇒ 姐弟、`cao-zhi < qinghe-gongzhu` ⇒ 兄妹…），
 * 于是同一份数据里 曹植 既是 曹侯 的「弟」、又是 清河公主 的「兄」。
 *
 * 按 `kin-terms.mjs` 自己文件头的原则（「数据里没有排行时**不能瞎猜**」，
 * 长辈侧就为此输出了「伯叔」这个中性词），这里本该输出中性词而不是「兄妹/姐弟」。
 * **为什么没顺手改**：改生成器就要同时重写那 19 条**已落盘的**推导边，
 * 而 `derive-kin.mjs --write` 是整体重排（见下），得另写一支定点补丁；
 * 且"中性词该用哪个"是个**产品选择**（兄弟姐妹 / 同胞 / 干脆不带方向）。
 * ⇒ 记在 CHANGELOG v0.192 的「已知缺陷（未修）」里，留给独立一轮。
 *
 * ## 为什么是"手写 + 删推导"而不是改推导
 *
 * ① 另两对兄妹边本来就是手写的（`梅梅→何塞·阿尔卡蒂奥（第五代）姐弟`、
 *    `梅梅→阿玛兰妲·乌尔苏拉 姐妹`）⇒ 这一对跟着走，数据才一致；
 * ② 手写边**不受「族谱补全」开关影响**，这才是用户要的"有线"；
 * ③ 手写边能挂上**章号与原文依据**，推导边只能写"由某某边推导"。
 *
 * ## 为什么不跑 `derive-kin.mjs --write`
 *
 * 它用 `JSON.stringify(book, null, 2) + '\n'` **整体重写**，而本文件的排版
 * **不是**它的产物（事件的 `chars` 一律写成单行）⇒ 实测会带进 7 处 / 42 行
 * 与本次改动无关的格式 diff（见 CHANGELOG v0.191 §四.5）。就地删那一条即可。
 *
 * ## 依据（全部逐字核过；原著 txt 不进版本库 ⇒ 这是**手工步骤**）
 *
 *   · 第 10 章：「他走进卧室去看自己的**头生子**」—— 何塞·阿尔卡蒂奥（第五代）是长子
 *   · 第 14 章：「转过年来梅梅就多了一个**新生的小妹妹**」—— 阿玛兰妲·乌尔苏拉是幼女
 *   · 第 18 章：「但无论是远在布鲁塞尔的**阿玛兰妲·乌尔苏拉**还是罗马的**何塞·阿尔卡蒂奥**，
 *     对这些琐碎的不幸都毫不知情」＋「她本来已习惯根据**儿女们**预定的归期来数算日日月月」
 *     —— 费尔南达一句里同时把这两个人称作自己的「儿女们」⇒ 两人同为她的子女 ⇒ 兄妹
 *
 * 用法：
 *   node scripts/fix-100y-v192.mjs          # 演练（不落盘）
 *   node scripts/fix-100y-v192.mjs --write  # 落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bookSourcePath } from './lib/book-sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'one-hundred-years-of-solitude.json');
const WRITE = process.argv.includes('--write');
const SLUG = 'one-hundred-years-of-solitude';

/* ⚠ 直接读**原著 txt 原文**，不走 `loadBookSource()` —— 后者会做 flat（删空白/间隔号），
 *   而 `loadBookSource` 那条链在**原文缺失时会静默降级**（见铁律 1）。这里就是要它逐字。 */
const SRC = bookSourcePath(SLUG);
if (!fs.existsSync(SRC)) {
  console.error(`✗ 找不到原著：${SRC}`);
  console.error('  这一步要原著 txt（不进版本库）⇒ 是**手工步骤**。');
  process.exit(1);
}
const RAWBOOK = fs.readFileSync(SRC, 'utf8').replace(/\s+/g, '');
const hasQuote = (q) => RAWBOOK.includes(String(q).replace(/\s+/g, ''));

const problems = [];
const need = (q, why) => { if (!hasQuote(q)) problems.push(`原文里查不到（${why}）：「${q}」`); };

/* ── 依据 ── */
const SIB_SRC = [
  '他走进卧室去看自己的头生子',                 // 第 10 章：长子
  '转过年来梅梅就多了一个新生的小妹妹',           // 第 14 章：幼女
  '但无论是远在布鲁塞尔的阿玛兰妲·乌尔苏拉还是罗马的何塞·阿尔卡蒂奥，对这些琐碎的不幸都毫不知情',  // 第 18 章
  '她本来已习惯根据儿女们预定的归期来数算日日月月',   // 第 18 章：「儿女们」把两人并列
];
for (const q of SIB_SRC) need(q, '兄妹依据');

/* 待删的那条推导边：三要素精确匹配（匹配数 != 1 就报错，绝不静默跳过）。 */
const DROP = { from: 'amaranta-ursula', to: 'jose-arcadio-5', type: '姐弟（推导）' };

/* 要插的手写边。方向与另两对一致：**长辈→晚辈**（兄 → 妹）。 */
const NEW_REL = {
  from: 'jose-arcadio-5',
  to: 'amaranta-ursula',
  type: '兄妹',
  style: 'dashed',
  events: [{
    text: '奥雷里亚诺第二与费尔南达的三个孩子：长子何塞·阿尔卡蒂奥（第五代）（第10章「他走进卧室去看自己的头生子」）、梅梅、幼女阿玛兰妲·乌尔苏拉（第14章「转过年来梅梅就多了一个新生的小妹妹」）。第18章费尔南达「根据儿女们预定的归期来数算日日月月」，她口中远行的两个「儿女们」正是布鲁塞尔的阿玛兰妲·乌尔苏拉与罗马的何塞·阿尔卡蒂奥。',
    chapter: '第18章',
    evidence: 'paraphrase',
  }],
  kin: 'blood',
};

if (problems.length) {
  console.error('✗ 依据核验没过 —— 一条都不改：');
  for (const p of problems) console.error('   · ' + p);
  process.exit(1);
}
console.log(`✓ ${SIB_SRC.length} 条依据全部在原著里逐字命中\n`);

/* ══════════════════════════════════════════════════════════════
 * 排版：按文件自己的样子生成片段
 * ══════════════════════════════════════════════════════════════ */
const raw = fs.readFileSync(FILE, 'utf8');
const j = (x) => JSON.stringify(x);
const EOL = raw.includes('\r\n') ? '\r\n' : '\n';

function relBlock(r, ind = '    ') {
  const L = [ind + '{'];
  L.push(ind + '  "from": ' + j(r.from) + ',');
  L.push(ind + '  "to": ' + j(r.to) + ',');
  L.push(ind + '  "type": ' + j(r.type) + ',');
  L.push(ind + '  "style": ' + j(r.style) + ',');
  L.push(ind + '  "events": [');
  r.events.forEach((e, i) => {
    L.push(ind + '    {');
    L.push(ind + '      "text": ' + j(e.text) + ',');
    L.push(ind + '      "chapter": ' + j(e.chapter) + ',');
    L.push(ind + '      "evidence": ' + j(e.evidence));
    L.push(ind + '    }' + (i < r.events.length - 1 ? ',' : ''));
  });
  /* ⚠ 非亲属关系是「整个 kin 字段不写」，不是 null 也不是 '-'（见 CHANGELOG v0.191 §四.1）。 */
  L.push(ind + '  ]' + (r.kin ? ',' : ''));
  if (r.kin) L.push(ind + '  "kin": ' + j(r.kin));
  L.push(ind + '}');
  return L.join(EOL);
}

/** 字符串感知的括号配对 */
function matchBracket(s, open, o = '[', c = ']') {
  let depth = 0, inStr = false, esc = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === o) depth++;
    else if (ch === c) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 在顶层 `relations` 里把手写边插到**第一条推导边之前**（`derive-kin` 按 `[...手写, ...推导]` 重建）。 */
function insertRelations(text, blocks) {
  const anchor = text.indexOf(EOL + '  ' + j('relations') + ': [');
  if (anchor < 0) throw new Error('找不到顶层数组 relations');
  const open = text.indexOf('[', anchor);
  const d = text.indexOf('"derived": true', open);
  if (d < 0) throw new Error('找不到任何推导边（本脚本预期它们存在）');
  const brace = text.lastIndexOf('{', d);
  const lineStart = text.lastIndexOf('\n', brace) + 1;
  if (!/^[ \t]*$/.test(text.slice(lineStart, brace))) {
    throw new Error(`推导边前的排版不认识（\`{\` 不在行首）：${JSON.stringify(text.slice(brace - 40, brace + 5))}`);
  }
  /* ⚠ 必须从**行首**切：从 `{` 的索引切会把这一行自己的 4 空格留下，
   *   插进去的第一块变成 8 空格、被顶下去的那条推导边丢缩进（深比对抓不到，见 assertLayout）。 */
  return text.slice(0, lineStart) + blocks.join(',' + EOL) + ',' + EOL + text.slice(lineStart);
}

/** 从顶层 relations 里整段删掉一条关系（from+to+type 精确匹配，匹配数 != 1 抛错）。 */
function removeRelBlock(text, from, to, type) {
  const needle = '"to": ' + j(to);
  const hits = [];
  for (let p = text.indexOf(needle); p >= 0; p = text.indexOf(needle, p + 1)) {
    const open = text.lastIndexOf('{', p);
    const close = matchBracket(text, open, '{', '}');
    const body = text.slice(open, close + 1);
    if (body.includes('"from": ' + j(from)) && body.includes('"type": ' + j(type))) hits.push({ open, close });
  }
  if (hits.length !== 1) {
    throw new Error(`删关系失败：from=${from} to=${to} type=${type} 匹配到 ${hits.length} 块（应为 1）`);
  }
  const { open, close } = hits[0];
  const lineStart = text.lastIndexOf('\n', open) + 1;
  if (!/^[ \t]*$/.test(text.slice(lineStart, open))) {
    throw new Error(`删关系失败：块的 \`{\` 不在行首：${JSON.stringify(text.slice(open - 30, open + 5))}`);
  }
  /* ⚠ 从**行首**起删，并连这一行自己的换行符一起删；否则会留下一行只有 4 空格。 */
  let s = lineStart;
  if (text[s - 2] === '\r' && text[s - 1] === '\n') s -= 2;
  else if (text[s - 1] === '\n') s -= 1;
  let e = close + 1;
  if (text[e] === ',') e += 1;
  else if (text[s - 1] === ',') s -= 1;
  else throw new Error(`删关系失败：from=${from} to=${to} 后面没逗号、前面也没有`);
  return text.slice(0, s) + text.slice(e);
}

/** 排版自检（深比对只看 JSON 语义，缩进/空行它一律看不见）。 */
function assertLayout(t, expect) {
  const bad = [];
  t.split(EOL).forEach((l, i) => { if (l.length && !l.trim()) bad.push(`第 ${i + 1} 行只有空白字符`); });
  for (const [key, want] of Object.entries(expect)) {
    const anchor = t.indexOf(EOL + '  ' + j(key) + ': [');
    if (anchor < 0) { bad.push(`找不到顶层数组 ${key}`); continue; }
    const open = t.indexOf('[', anchor);
    const close = matchBracket(t, open);
    const got = (t.slice(open + 1, close).match(/\n {4}\{/g) || []).length;
    if (got !== want) bad.push(`${key}：缩进 4 空格的元素 ${got} 个，应为 ${want} 个（有元素缩进不对）`);
  }
  if (bad.length) {
    console.error('✗ 排版自检没过（JSON 语义可能没问题，但缩进被弄坏了）：');
    for (const b of bad) console.error('   · ' + b);
    process.exit(1);
  }
}

/* ══════════════════════════════════════════════════════════════
 * 应用（先在**对象**上改，再在**文本**上拼，最后深比对）
 * ══════════════════════════════════════════════════════════════ */
const log = [];
/* ⚠ 只需要 `next`（预期结果）。原来这里还多解析了一份 `const book`，**从头到尾没被读过** ——
 *   ESLint 的 `no-unused-vars` 报了它（本仓 `--max-warnings 0`，一条 warning 也算红）。
 *   确认过 `JSON.parse` 没有副作用 ⇒ 直接删掉，不是"把警告压下去"。 */
const next = JSON.parse(raw);          // 预期结果
const has = (r, o) => next.relations.some((x) => x.from === o.from && x.to === o.to && x.type === o.type);

let text = raw;

/* ① 删过期的推导边 */
if (has(DROP.from, DROP)) {
  next.relations = next.relations.filter((r) => !(r.from === DROP.from && r.to === DROP.to && r.type === DROP.type));
  text = removeRelBlock(text, DROP.from, DROP.to, DROP.type);
  log.push(`① 已删过期推导边：${DROP.from} → ${DROP.to}「${DROP.type}」`);
} else {
  log.push(`① 推导边已不在（跑过了），跳过：${DROP.from} → ${DROP.to}`);
}

/* ② 插手写边 */
if (has(NEW_REL.from, NEW_REL)) {
  log.push(`② 手写边已存在，跳过：${NEW_REL.from} → ${NEW_REL.to}`);
} else {
  /* ⚠ 插到**第一条推导边之前**，否则文件不再是 `derive-kin` 的不动点（见 insertRelations）。
   *   文本侧 `insertRelations` 也是插在第一条推导边那一行的行首 ⇒ 两边落点一致。 */
  const firstDerived = next.relations.findIndex((r) => r.derived === true);
  if (firstDerived < 0) throw new Error('找不到任何推导边（本脚本预期它们存在）');
  next.relations.splice(firstDerived, 0, { ...NEW_REL, events: NEW_REL.events.map((e) => ({ ...e })) });
  text = insertRelations(text, [relBlock(NEW_REL)]);
  log.push(`② 已插手写边：${NEW_REL.from} → ${NEW_REL.to}「${NEW_REL.type}」（插在第一条推导边之前）`);
}

console.log(log.join('\n'));

/* ── 排版自检（**在**深比对之前）── */
assertLayout(text, {
  characters: next.characters.length,
  relations: next.relations.length,
  events: next.events.length,
});

/* ── 深比对 ── */
let actual;
try { actual = JSON.parse(text); } catch (e) { console.error(`\n✗ 拼出来的文本不是合法 JSON：${e.message}`); process.exit(1); }
if (JSON.stringify(actual) !== JSON.stringify(next)) {
  console.error('\n✗ 拼出来的文本与预期对象**深比对不一致** ⇒ 拒绝落盘（不留半成品）');
  const A = JSON.stringify(actual), B = JSON.stringify(next);
  let i = 0; while (i < A.length && A[i] === B[i]) i++;
  console.error(`   第一处差异在第 ${i} 字符：\n   实得 …${A.slice(Math.max(0, i - 60), i + 60)}\n   预期 …${B.slice(Math.max(0, i - 60), i + 60)}`);
  process.exit(1);
}
console.log(`\n合计：角色 ${next.characters.length} · 关系 ${next.relations.length} · 事件 ${next.events.length}`);
console.log(`文本：${raw.length} → ${text.length} 字符（只增了 ${text.length - raw.length} 字符，其余字节未动）`);

if (!WRITE) {
  console.log('\n（预览模式，未落盘。加 --write 落盘）');
  process.exit(0);
}
fs.writeFileSync(FILE, text);
console.log(`\n✓ 已写入 ${path.relative(ROOT, FILE)}`);
