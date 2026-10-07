/* 报「事件在场人物」与人物登场章的时间矛盾 —— v0.135 由整理拆书素材时发现。
 *
 * 现象（三国实测 28 处）：某事件的 `chars` 里出现了**首次出场章远晚于该事件章**的人物。
 * 最刺眼的一例：祝融夫人（孟获之妻、南蛮王后，`firstCh=90`）被塞进 **16 个**
 * 第 26–85 回的事件，包括「关羽挂印封金」「屏后密语备失言」「赵云单骑救主」。
 *
 * 为什么这是**错**而不是「提前被提及」：
 *   `events[].chars` 的语义是**在场人物**（见 events-evidence-方案.md 与 app.js 的用法：
 *   它决定事件卡高亮哪些节点，也决定 `charLastCh()` 算出的「最后出场章」）。
 *   一个人不可能在自己存在之前**在场**。
 *   ⚠ 但边界要诚实：`tier=minor`（仅被提及）的人物理论上可以被提到，
 *     所以单看「firstCh 晚于事件章」不足以定罪 —— 本脚本按 `warn` 报，不自动改数据。
 *     **删除要单独一轮、拿原文逐条核**（见新书处理规程与 memory 里
 *     「否定一个字段前必须先在原文里找到同义句」那条纪律）。
 *
 * 为什么值得单列一个脚本：现有 validate.mjs 只检查人物侧（firstCh 类型、父母一致性、
 * 阵营有效性），**没有任何一处交叉检查 events[].chars** ⇒ 这类污染一直是隐形的。
 *
 * ⚠ 一条**被我自己验伪的说法**（记下来别再犯）：
 *   我第一版写「后果＝结局剧透提前解锁」，**这是错的**。`charLastChCalc`（app.js）
 *   用的是 `Math.max(...)`，而每个被污染的人物在污染之外都还有更晚的真实事件
 *   ⇒ 最大值不受影响。实测 881 个人物里受影响 **0 人**。
 *   —— **「后果」必须实测，不能从机制推出来就写上去。**
 *
 * 实测的真正后果（三条）：
 *   ① 28 个事件卡点开会**高亮出当时不存在的人**（第 26 回《关羽挂印封金》里高亮祝融夫人）
 *   ② 23 个回的「本章 N 人出场」**虚高**，合计 24 人次
 *   ③ 结局剧透：**不受影响**
 *
 * 用法：node scripts/check-event-chars.mjs            # 报告（退出码 0，不阻塞）
 *       node scripts/check-event-chars.mjs --write    # 同时写出 docs/待修-事件在场人物时间矛盾.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const writeDoc = process.argv.includes('--write');

/** 迟多少回才算「矛盾」。1–2 回可能是「先被提及后出场」的正常情形，取 5。 */
const LATE_BY = 5;

const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'books.json'), 'utf8'));
let total = 0;
const report = [];

for (const b of idx.books || []) {
  const f = path.join(DATA, `${b.slug}.json`);
  if (!fs.existsSync(f)) continue;
  const book = JSON.parse(fs.readFileSync(f, 'utf8'));
  const byId = new Map((book.characters || []).map((c) => [c.id, c]));
  const rows = [];
  for (const ev of book.events || []) {
    const ec = Number(ev.ch);
    if (!Number.isFinite(ec)) continue;
    (ev.chars || []).forEach((id, i) => {
      const c = byId.get(id);
      if (!c) return;
      const fc = Number(c.firstCh);
      if (!Number.isFinite(fc) || fc - ec <= LATE_BY) return;
      rows.push({
        evId: ev.id, ch: ec, evName: ev.name, cid: id, cName: c.name,
        firstCh: fc, tier: c.tier || '(无)', atEnd: i === ev.chars.length - 1,
      });
    });
  }
  if (!rows.length) continue;
  rows.sort((x, y) => x.firstCh - y.firstCh || x.ch - y.ch);
  total += rows.length;

  /* 按人物聚合：谁被安插到了早期事件，以及是不是都排在数组末尾 —— 
   * 「都排在末尾」是"被就地追加"的形态证据，比单条错更能说明成因。 */
  const byChar = new Map();
  for (const r of rows) {
    if (!byChar.has(r.cName)) byChar.set(r.cName, { firstCh: r.firstCh, chs: [], atEnd: 0 });
    const g = byChar.get(r.cName);
    g.chs.push(r.ch);
    if (r.atEnd) g.atEnd++;
  }
  const agg = [...byChar.entries()]
    .map(([name, g]) => ({ name, firstCh: g.firstCh, n: g.chs.length, atEnd: g.atEnd, chs: g.chs }))
    .sort((a, b) => b.n - a.n || a.firstCh - b.firstCh);
  const endMost = rows.filter((r) => r.atEnd).length;

  report.push({ slug: b.slug, totalCh: book.meta?.chapters || 0, rows, agg, endMost });

  console.log(`⚠ ${b.slug}：${rows.length} 处「在场人物」的登场章晚于事件章（> ${LATE_BY} 回）`);
  for (const a of agg.slice(0, 8)) {
    console.log(`    ${a.name}（第 ${a.firstCh} 回登场）被塞进 ${a.n} 个早期事件${a.n > 3 ? `，其中 ${a.atEnd}/${a.n} 排在 chars 末尾` : ''} → 第 ${[...new Set(a.chs)].sort((x, y) => x - y).join('、')} 回`);
  }
  console.log(`    （${endMost}/${rows.length} 处排在 chars 数组末尾 —— 「被就地追加」的形态）`);
  console.log('');
}

if (writeDoc) {
  const L = [];
  L.push('# 待修：事件「在场人物」与登场章的时间矛盾');
  L.push('');
  L.push('> 由 `node scripts/check-event-chars.mjs --write` 生成，勿手改。');
  L.push('> 数据本身**没被改动** —— 这是待办清单，不是修复记录。');
  L.push('');
  L.push('## 为什么这是错');
  L.push('');
  L.push('`events[].chars` 的语义是**在场人物**（见 `docs/events-evidence-方案.md`，以及 `js/app.js` 里');
  L.push('它决定事件卡高亮哪些节点）。一个人不可能在自己存在之前在场。');
  L.push('');
  L.push('## 实测的后果（三条）');
  L.push('');
  L.push('| # | 后果 | 实测量 |');
  L.push('|---|---|---|');
  L.push('| ① | 事件卡点开时**高亮出当时不存在的人** | 28 个事件 |');
  L.push('| ② | 章节面板「本章 N 人出场」**虚高** | 23 个回 / 合计 24 人次 |');
  L.push('| ③ | **结局剧透提前解锁** | **0 人 —— 不成立，见下** |');
  L.push('');
  L.push('### 关于③：我第一版写的是「结局剧透提前解锁」，那是错的');
  L.push('');
  L.push('推理链是：`charLastChCalc` 遍历 `events[].chars` 取 `Math.max(...)`，所以被污染的早期事件');
  L.push('会把「最后出场章」算早 ⇒ 剧透提前解锁。**但这是从机制推出来的，没有实测。**');
  L.push('');
  L.push('实测 881 个人物，**受影响 0 人** —— 因为每个被污染的人物在污染之外都还有**更晚**的真实事件，');
  L.push('`Math.max` 对这类污染是稳健的。');
  L.push('');
  L.push('> **教训：「后果」必须实测，不能从机制推出来就写上去。**');
  L.push('> 一个听起来很严重、但实测不成立的后果，会把修复的紧迫性判断整个带反。');
  L.push('');
  L.push('## 为什么一直没被发现');
  L.push('');
  L.push('`scripts/validate.mjs` 只检查**人物侧**（`firstCh` 类型、父母一致性、阵营有效性），');
  L.push('**没有任何一处交叉检查 `events[].chars`** ⇒ 这类污染一直是隐形的。');
  L.push('');
  L.push('## 边界：为什么不自动改数据');
  L.push('');
  L.push(`判定阈值是「人物登场章晚于事件章 **${LATE_BY} 回以上**」。1–2 回的差距可能是`);
  L.push('「先被提及、后出场」的正常情形（`tier=minor` 就是「仅被提及」），所以单看这条不足以定罪。');
  L.push('');
  L.push('⚠ 更重要的是：本项目的纪律要求**否定一个字段前必须先在原文里找到同义句** ——');
  L.push('「我没搜到 X」推不出「原文没有 X」。删数据要单独一轮、拿原文逐条核。');
  L.push('');
  L.push('**附带影响**：`scripts/check-annotations.mjs` 已加一条断言 ——');
  L.push('拆书条目若把「登场章晚于事件章」的人物写成该事件的引用者，会**直接报红**。');
  L.push('也就是说这批污染**不会**被带进拆书内容里。');
  L.push('');
  for (const r of report) {
    L.push(`## 《${r.slug}》 — ${r.rows.length} 处`);
    L.push('');
    L.push('### 按人物聚合');
    L.push('');
    L.push('| 人物 | 登场章 | 被塞进的早期事件数 | 其中排在 chars 末尾 | 涉及回次 |');
    L.push('|---|---|---|---|---|');
    for (const a of r.agg) {
      L.push(`| ${a.name} | ${a.firstCh} | ${a.n} | ${a.atEnd} | 第 ${[...new Set(a.chs)].sort((x, y) => x - y).join('、')} 回 |`);
    }
    L.push('');
    L.push('### 逐条');
    L.push('');
    L.push('| 事件 id | 回 | 事件名 | 被安插的人物 | 该人物登场章 | tier | 排在末尾 |');
    L.push('|---|---|---|---|---|---|---|');
    for (const x of r.rows) {
      L.push(`| \`${x.evId}\` | ${x.ch} | ${x.evName} | ${x.cName} | ${x.firstCh} | ${x.tier} | ${x.atEnd ? '是' : '否'} |`);
    }
    L.push('');
  }
  const out = L.join('\n');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  const p = path.join(ROOT, 'docs', '待修-事件在场人物时间矛盾.md');
  fs.writeFileSync(p, out, 'utf8');
  console.log(`✓ 已写出 docs/待修-事件在场人物时间矛盾.md（${(Buffer.byteLength(out, 'utf8') / 1024).toFixed(1)}KB）`);
}

console.log(total
  ? `\n共 ${total} 处。这个脚本**只报告不改数据**（退出码 0，不阻塞门禁）。`
  : '✓ 各书未发现「在场人物晚于事件章 ${LATE_BY} 回以上」的情形');