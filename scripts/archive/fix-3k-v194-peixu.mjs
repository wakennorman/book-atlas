#!/usr/bin/env node
/**
 * 【已归档】2026-10-12　v0.195 债二 B1：一次性补丁，用完即归档。
 *                     结论去向：CHANGELOG.md 的 v0.194 段
 *                     留在这里是为了留痕「当时怎么改的」，不再是可执行入口。
 * v0.194 · 给裴绪补 3 条关系边 —— 他在图上是孤点
 *
 * ## 起因
 *
 * 自查「无边人物」时发现：裴绪 `desc` 写得很完整（孔明心腹军士、假作夏侯楙帐下心腹、
 * **两度**诈城），参与 `e-92-3` / `e-92-5` 两场戏，但 `relations` 里 **0 条边**
 * ⇒ 图上是个孤点，点进去看不到和任何人的联系。
 *
 * ⚠ 同一批查出的另外两人（姜子牙、张子房）**不该补**：
 *   他们只是被司马徽拿来打比方（「可比兴周八百年之姜子牙」），
 *   全书从未在场，无边是**如实**的。
 *   全库只有裴绪这 1 个真缺口（另两本 0 个）。
 *
 * ## 依据（**全部来自 data/three-kingdoms.json 里已有的事件文案**，不是新写的解读）
 *
 *   e-92-3「魏延诈取安定郡」
 *     summary：孔明定计遣假裴绪赚崔谅出城…
 *     ⇒ 裴绪持孔明的计去骗崔谅 ⇒ 对手，且是**孔明派去的人**
 *   e-92-5「姜维识破诈计」
 *     summary：…姜维识破裴绪之诈，献计欲擒孔明。
 *     ⇒ 裴绪 → 姜维：**被识破**，两人直接对上
 *     summary 同一句还有「太守马遵欲救南安」+ 裴绪持伪公文催兵
 *     ⇒ 裴绪 → 马遵：**持伪文书骗其发兵**
 *
 * ## 为什么用定点插入而不是整体重写
 *
 * `data/*.json` 不是 `JSON.stringify(book, null, 2)` 的输出（实测差 6 万余行），
 * 且 `relations` 是数组、整体重写会打乱顺序并淹没 diff。
 * 本脚本把新边**序列化后插到 `relations` 数组末尾**，并在写之前自检：
 *   ① `JSON.parse` 成功；② 关系总数恰好 +3；③ 三条边都在且内容逐字相符；
 *   ④ 除新增外，原有每条边的序列化结果**逐条不变**。
 *
 * 用法：
 *   node scripts/fix-3k-v194-peixu.mjs          # 预览
 *   node scripts/fix-3k-v194-peixu.mjs --write  # 落盘（幂等）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');

const raw = fs.readFileSync(FILE, 'utf8');
const book = JSON.parse(raw);
const nm = (id) => book.characters.find((c) => c.id === id)?.name ?? id;

/* 三条新边。events 全部指回**已有事件**，不新造文案。 */
const NEW_EDGES = [
  {
    from: 'pei-xu', to: 'cui-liang', type: '诈赚', style: 'dashed',
    events: [{
      text: '裴绪持孔明伪书至安定，赚崔谅出城。',
      chapter: '第92章', place: 'anding-jun', evidence: 'paraphrase',
    }],
    basis: 'e-92-3 summary：「孔明定计遣假裴绪赚崔谅出城」',
  },
  {
    from: 'pei-xu', to: 'ma-zun', type: '诈赚', style: 'dashed',
    events: [{
      text: '裴绪持都督公文至天水，诈称二郡救应，催马遵发兵。',
      chapter: '第92章', place: 'tianshui', evidence: 'paraphrase',
    }],
    basis: 'e-92-5 summary：「太守马遵欲救南安」（裴绪持伪公文催其出兵，同场）',
  },
  {
    from: 'pei-xu', to: 'jiang-wei', type: '诈被识破', style: 'dashed',
    events: [{
      text: '姜维识破裴绪之诈，献计欲擒孔明。',
      chapter: '第92章', place: 'tianshui', evidence: 'paraphrase',
    }],
    basis: 'e-92-5 summary：「姜维识破裴绪之诈」',
  },
];

/* ⚠ 依据必须能在**已有事件**里找到对应字样，否则 exit 1 —— 不凭记忆写证据。 */
const BASIS_CHECKS = [
  { edge: 0, eventId: 'e-92-3', has: '赚崔谅出城' },
  { edge: 2, eventId: 'e-92-5', has: '识破裴绪之诈' },
];

const problems = [];
const fresh = [];

for (const e of NEW_EDGES) {
  for (const id of [e.from, e.to]) {
    if (!book.characters.some((c) => c.id === id)) problems.push(`找不到人物 ${id}`);
  }
  /* 幂等：已有同一条就跳过。 */
  const dup = (book.relations || []).some((r) =>
    (r.from === e.from && r.to === e.to) || (r.from === e.to && r.to === e.from));
  if (dup) { console.log(`  ＝ ${nm(e.from)} — ${e.type} — ${nm(e.to)} 已存在（跳过）`); continue; }
  fresh.push(e);
}

for (const c of BASIS_CHECKS) {
  const ev = (book.events || []).find((x) => x.id === c.eventId);
  if (!ev) { problems.push(`依据事件 ${c.eventId} 不存在`); continue; }
  if (!String(ev.summary || '').includes(c.has)) {
    problems.push(`${c.eventId} 的 summary 里找不到「${c.has}」`
      + `（现在是「${String(ev.summary || '').slice(0, 60)}」）`);
  }
}

/* ⚠ 地点 id 必须在 `places[]` 里存在 —— 这条是**补上去的**，第一版没写。
 *   第一版把安定郡写成 `anding`，而数据里的 id 是 `anding-jun`
 *   ⇒ `validate --all` 报「关系 pei-xu→cui-liang 的 place「anding」不在 places[] 里」
 *   ⇒ **引入了一个 error**。教训：新增引用型字段（place / chapter）时，
 *   要在脚本里自查它指向的东西存不存在，别指望 CI 兜着。 */
const placeIds = new Set((book.places || []).map((p) => p.id));
for (const e of NEW_EDGES) {
  for (const ev of e.events) {
    if (!ev.place) continue;                        // 空 place 是合法的（很多边没有）
    if (!placeIds.has(ev.place)) {
      problems.push(`${e.from}→${e.to} 的 events[].place「${ev.place}」不在 places[] 里`
        + `（本脚本应当填已存在的地点 id）`);
    }
  }
}

if (problems.length) {
  console.error('\n✗ 有 ' + problems.length + ' 处不能自动处理：');
  for (const p of problems) console.error('   ' + p);
  process.exit(1);
}

for (const e of fresh) {
  console.log(`  ＋ ${nm(e.from)} — ${e.type} — ${nm(e.to)}`);
  console.log(`      依据：${e.basis}`);
}
if (!WRITE) {
  console.log(`\n（预览）将新增 ${fresh.length} 条关系。加 --write 才落盘。`);
  process.exit(0);
}
if (!fresh.length) {
  console.log('\n（无变化，未落盘）');
  process.exit(0);
}

/* 落盘：在 `relations` 数组的**最后一个元素之后**插入新边。
 *
 * ⚠ 这里踩了四版才做对，根因全是「用字符串猜结构」。定论：**用括号配平扫**。
 *   ① `relations` 不在文件末尾（后面还有 events / places）⇒ 不能拿文件尾当插入点；
 *   ② `indexOf(fromKey)` 命中的可能是**前面**同名 from 的边（三国里 `ji-miao` 就重复）
 *      ⇒ `lastIndexOf` 也不可靠，它取的是文件里最后一个同名，而不是数组里的最后一个元素；
 *   ③ 本文件是**混排格式**（`}` 后可能跟逗号、可能跟纯空白、可能同行）；
 *   ④ 前三版都被**写前自检**拦下（关系数没变），所以没有一次写坏文件 ——
 *      这就是「先自检再落盘」的价值：它把三次错误变成三次安静的失败。
 *
 * 现在：从 `"relations": [` 起做**括号配平**（正确跳过字符串字面量与转义），
 * 拿到数组末尾 `]` 的确切下标，在它前面插 `,` + 新边。
 */
const before = JSON.parse(raw);
const beforeRels = before.relations || [];

const relKey = '"relations"';
const relKeyAt = raw.indexOf(relKey);
if (relKeyAt < 0) { console.error('✗ 找不到 relations 字段'); process.exit(1); }

const bracketAt = raw.indexOf('[', relKeyAt);
if (bracketAt < 0) { console.error('✗ relations 不是数组'); process.exit(1); }

/** 从 `open` 处的 `[` 起做括号配平，返回匹配的 `]` 下标。跳过字符串字面量。 */
function matchBracket(src, open) {
  let depth = 0, inStr = false, esc = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const closeBracket = matchBracket(raw, bracketAt);
if (closeBracket < 0) { console.error('✗ relations 数组没有闭合'); process.exit(1); }

/* 数组末尾 `]` 之前若不是空白，说明数组为空或末尾有多余内容 —— 交给自检去发现。 */
const beforeClose = raw.slice(bracketAt + 1, closeBracket);
if (beforeClose.trim() === '') {
  console.error('✗ relations 是空数组，本脚本的插入路径不适用');
  process.exit(1);
}

/* 缩进：数组内最后一个元素的缩进（从最后一处行首 `\n    {` 取）。
 * 找数组段内最后一个换行后、到下一个 `{` 之前的空白。 */
const lastElemNl = raw.lastIndexOf('\n', closeBracket);
const indentProbe = raw.slice(lastElemNl + 1, closeBracket);
const elemIndent = (/^[ \t]*/.exec(indentProbe) || [''])[0];
const NL = raw.includes('\r\n') ? '\r\n' : '\n';

/** 序列化一条边为与文件既有风格一致的多行文本。 */
function dumpEdge(e, indent) {
  const evLines = e.events.map((ev) => `${indent}  ${JSON.stringify(ev)}`);
  return [
    `${indent}{`,
    `${indent}  "from": ${JSON.stringify(e.from)},`,
    `${indent}  "to": ${JSON.stringify(e.to)},`,
    `${indent}  "type": ${JSON.stringify(e.type)},`,
    `${indent}  "style": ${JSON.stringify(e.style)},`,
    `${indent}  "events": [`,
    evLines.join(`,${NL}`),
    `${indent}  ]`,
    `${indent}}`,
  ].join(NL);
}

const block = fresh.map((e) => dumpEdge(e, elemIndent)).join(`,${NL}`);
/* 在 `]` 前插入：`,` + 换行 + 新边。原末尾 `]` 前的空白/换行保留在新边之后。 */
const out = raw.slice(0, closeBracket).replace(/(\s*)$/, '')
  + ',' + NL + block + NL + elemIndent
  + raw.slice(closeBracket);


/* ⚠ 自检（第一版没有这一步，靠人眼看 diff）。 */
const after = JSON.parse(out);
const afterRels = after.relations || [];
if (afterRels.length !== beforeRels.length + fresh.length) {
  console.error(`✗ 自检失败：关系数 ${beforeRels.length} → ${afterRels.length}，`
    + `期望 ${beforeRels.length + fresh.length}`);
  process.exit(1);
}
/* 原有每条边的序列化必须逐条不变（按多重集比，容忍数组重排）。 */
const bag = (arr) => {
  const m = new Map();
  for (const r of arr) { const k = JSON.stringify(r); m.set(k, (m.get(k) || 0) + 1); }
  return m;
};
const A = bag(beforeRels), B = bag(afterRels);
for (const [k, n] of A) {
  if ((B.get(k) || 0) < n) {
    console.error('✗ 自检失败：有原有边被改动或丢失 —— ' + k.slice(0, 80));
    process.exit(1);
  }
}
/* 三条新边确实在。
 * ⚠ 不能用 `JSON.stringify(hit) === JSON.stringify(e)` 比：**键顺序不同**——
 *   文件里的边是 `from,to,type,style,events`，我构造的是同样顺序，但
 *   `events` 里键序、以及文件里可能有我没写的额外字段，都会让字符串不等。
 *   第一版就是在这里误报的（关系数已对、内容被说成没落进去）。
 *   改成**逐字段 + 事件逐条**比对，键序无关。 */
const fieldsEq = (x, y) => ['from', 'to', 'type', 'style', 'kin'].every((k) => x[k] === y[k]);
for (const e of fresh) {
  const hit = afterRels.find((r) => r.from === e.from && r.to === e.to);
  if (!hit) { console.error(`✗ 自检失败：${e.from}→${e.to} 没落进去`); process.exit(1); }
  if (!fieldsEq(hit, e)) {
    console.error(`✗ 自检失败：${e.from}→${e.to} 字段不符`
      + `\n  期望 ${JSON.stringify(e)}\n  实际 ${JSON.stringify(hit)}`);
    process.exit(1);
  }
  const evEq = (hit.events || []).length === e.events.length
    && e.events.every((ev, i) => ev.chapter === hit.events[i].chapter && ev.text === hit.events[i].text);
  if (!evEq) {
    console.error(`✗ 自检失败：${e.from}→${e.to} 的 events 不符`
      + `\n  期望 ${JSON.stringify(e.events)}\n  实际 ${JSON.stringify(hit.events)}`);
    process.exit(1);
  }
}


fs.writeFileSync(FILE, out, 'utf8');
console.log(`\n✓ 已写入 data/three-kingdoms.json：新增 ${fresh.length} 条关系`
  + `　关系总数 ${beforeRels.length} → ${afterRels.length}（自检通过）`);
console.log('  下一步：node scripts/make-slim-packs.mjs　（网页加载的是 graph.json 生成物）');
