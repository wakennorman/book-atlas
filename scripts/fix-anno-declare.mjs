/* 一次性修复：把**全库无人声明、却被同章正文引用**的事件补进条目的 `events[]` —— v0.177。
 *
 * ## 背景
 *
 * `scripts/audit-annotations.mjs` 的 A1-同章（v0.177 收紧后）只剩这一档要人看：
 * 「正文引用了同章事件，而**全库没有任何条目声明过它**」—— 该事件在拆书里
 * 是**孤儿**：章节事件列表（由 `events[].ch` 驱动）还看得到它，但**没有任何条目的
 * 底部 chip 会挂上它**，等于拆书从没宣称覆盖过它。
 *
 * 实测 2 处（v0.177，全库扫描 + 回原著逐条核）：
 *   · 罪与罚 ch4「「百分之一」：他给一个陌生女孩算完了她的一生」引用 e32
 *     正文原话：「他走过去时先骂了那上流人一句，警察赶来把两人隔开（e32）」
 *     原文场景在**第一部第四章**（「喂，您这个斯维德利盖洛夫！站在那儿要干什么？」）
 *   · 三国   ch62「张松死于一张被哥哥捡到的信」引用 e-62-1
 *     正文原话：「这一回写的是一个连锁：庞统献中计（e-62-1）→ …」
 *     原文在**第六十二回**（「三条计」）
 *
 * ## 判据（每条都断言，任一不过就 exit 1，不写盘）
 *
 *   ① 条目的 `body` 里**逐字**出现该事件 id（= 依据；本仓库「改数据必须带依据」的类比：
 *      这里没有原著 txt，依据就是"条目正文自己在引用它"）
 *   ② 该书 `events` 里存在该 id，且它的章号 **=** 该条目的 `ch`（同章，不是跨章）
 *   ③ 该 id **当前没被任何条目声明**（否则不是漏挂，跑错脚本了）
 *
 * ## 落盘方式：整段字面替换（**不是** parse→stringify）
 *
 * 三个标注文件的行尾/缩进不统一（三国/罪与罚 CRLF、百年孤独 LF；
 * `events` 数组在三国是**多行**、在罪与罚是**单行**）。
 * parse→stringify 会把整个文件重写一遍 ⇒ diff 炸开。
 * ⇒ 只在原文里定位那一个数组、按**它自己的排版**重排，其余字节不动；
 *   写完再 parse 一遍与预期对象深比对，不一致就 exit 1（不留半成品）。
 *
 * 用法：
 *   node scripts/fix-anno-declare.mjs            # 预览（不写盘）
 *   node scripts/fix-anno-declare.mjs --write    # 落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventChapter } from './lib/anno-cross-chapter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/* 待补的声明。`title` 用来在原文里唯一定位那个条目（取前缀，够唯一即可）。 */
const JOBS = [
  {
    book: 'crime-and-punishment',
    ch: 4,
    title: '「百分之一」：他给一个陌生女孩算完了她的一生',
    event: 'e32',
    why: '条目正文自己引用了它（「警察赶来把两人隔开（e32）」），原文场景在第一部第四章；全库没有别的条目声明 e32 ⇒ 它是孤儿。',
  },
  {
    book: 'three-kingdoms',
    ch: 62,
    title: '张松死于一张被哥哥捡到的信',
    event: 'e-62-1',
    why: '条目正文自己引用了它（「庞统献中计（e-62-1）」），原文在第六十二回；全库没有别的条目声明 e-62-1 ⇒ 它是孤儿。',
  },
];

/** 从 `[` 起找匹配的 `]`（字符串感知：跳过 "..." 里的括号）。 */
function matchBracket(s, open) {
  let depth = 0, inStr = false, esc = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 按**原数组自己的排版**重排：多行就多行（沿用缩进与行尾），单行就单行。 */
function restyle(arrText, ids) {
  if (arrText.includes('\n')) {
    const eol = arrText.includes('\r\n') ? '\r\n' : '\n';
    const indent = (arrText.match(/\r?\n(\s+)"/) || [])[1] || '        ';
    const closeIndent = (arrText.match(/\r?\n(\s*)\]\s*$/) || [])[1] ?? '';
    return '[' + eol + ids.map((x) => indent + JSON.stringify(x)).join(',' + eol) + eol + closeIndent + ']';
  }
  return '[' + ids.map((x) => JSON.stringify(x)).join(', ') + ']';
}

let changed = 0, skipped = 0;
for (const job of JOBS) {
  const af = path.join(ROOT, 'data', 'annotations', `${job.book}.json`);
  const bf = path.join(ROOT, 'data', `${job.book}.json`);
  const raw = fs.readFileSync(af, 'utf8');
  const j = JSON.parse(raw);
  const B = JSON.parse(fs.readFileSync(bf, 'utf8'));
  const label = `《${job.book}》ch${job.ch}「${job.title}」+ ${job.event}`;

  /* 找条目 */
  const it = (j.items || []).find((x) => x.ch === job.ch && String(x.title).startsWith(job.title.slice(0, 12)));
  if (!it) { console.error(`✗ ${label}：找不到该条目`); process.exit(1); }

  /* 幂等：已经声明过就跳过 */
  if ((it.events || []).includes(job.event)) { console.log(`· ${label}：已经是新值（跑过了）`); skipped++; continue; }

  /* ① 依据：条目正文逐字出现该 id */
  if (!String(it.body).includes(job.event)) {
    console.error(`✗ ${label}：条目正文里**没有逐字出现** \`${job.event}\` ⇒ 没有依据，拒绝改（这是本脚本的 ① 号判据）`);
    process.exit(1);
  }
  /* ② 事件存在且同章 */
  const evById = new Map((B.events || []).map((e) => [e.id, e]));
  const ec = eventChapter(evById, job.event);
  if (ec === null) { console.error(`✗ ${label}：该书事件表里没有 \`${job.event}\``); process.exit(1); }
  if (ec !== job.ch) { console.error(`✗ ${label}：\`${job.event}\` 的章号是 ${ec}，与条目 ch ${job.ch} 不同（那是跨章，不该用本脚本）`); process.exit(1); }
  /* ③ 当前没人声明它 */
  const declaredBy = [...(j.items || []), ...(j.global || [])].filter((x) => (x.events || []).includes(job.event));
  if (declaredBy.length) { console.error(`✗ ${label}：已被 ${declaredBy.length} 个条目声明 ⇒ 不是漏挂，跑错脚本了`); process.exit(1); }

  /* 新数组：按事件在 B.events 里的次序排（= 书的自然顺序） */
  const order = new Map((B.events || []).map((e, i) => [e.id, i]));
  const newIds = [...it.events, job.event].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));

  /* 在原文里定位这个条目的 events 数组 */
  const titleKey = JSON.stringify(it.title);
  const pos = raw.indexOf(titleKey);
  if (pos < 0 || raw.indexOf(titleKey, pos + 1) !== -1) { console.error(`✗ ${label}：title 在原文里不是唯一的，定位不了`); process.exit(1); }
  const evKey = raw.indexOf('"events"', pos);
  if (evKey < 0 || raw.indexOf('"title"', pos + titleKey.length) < evKey) { console.error(`✗ ${label}：在 title 之后找不到本条的 "events" 键`); process.exit(1); }
  const open = raw.indexOf('[', evKey);
  const close = matchBracket(raw, open);
  if (open < 0 || close < 0) { console.error(`✗ ${label}：events 数组括号不匹配`); process.exit(1); }

  const oldArr = raw.slice(open, close + 1);
  const newArr = restyle(oldArr, newIds);
  const out = raw.slice(0, open) + newArr + raw.slice(close + 1);

  /* 深比对：落盘后必须与预期对象逐字一致 */
  it.events = newIds;
  const got = JSON.parse(out);
  if (JSON.stringify(got) !== JSON.stringify(j)) {
    console.error(`✗ ${label}：字面替换后深比对不一致 ⇒ 拒绝写盘`);
    process.exit(1);
  }

  console.log(`· ${label}`);
  console.log(`    ${JSON.stringify(it.events.filter((x) => x !== job.event))}  →  ${JSON.stringify(newIds)}`);
  console.log(`    依据：${job.why}`);
  if (WRITE) {
    fs.writeFileSync(af, out, 'utf8');
    console.log('    已写盘');
  }
  changed++;
}

console.log(`\n${WRITE ? '已落盘' : '预览（加 --write 落盘）'}：${changed} 处改动${skipped ? `，${skipped} 处已是新值` : ''}。`);
