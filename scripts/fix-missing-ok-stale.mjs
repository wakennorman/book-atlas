#!/usr/bin/env node
/**
 * v0.163：修「噪声忽略名单」里的两条**自相矛盾**条目 —— 新门禁
 * `scripts/check-missing-ok.mjs` 首跑就抓到了它们。
 *
 * ## 起因：忽略名单靠名字记账，名字变了它不知道
 *
 * `data/<slug>.missing-ok.json` 是 `audit-against-text.mjs` 的**噪声忽略名单**：
 * 人判过"这确实不是人名"的候选写进去，下次不再报。它 `_说明` 里立着一条红线：
 * **「绝不要把『还没查清楚』或『确实是漏人』的候选丢进来 —— 那等于把缺口永久藏起来。」**
 *
 * 但它靠**名字**记账，而名字会变。实测（门禁首跑）：
 *
 *     ✗ three-kingdoms 第 209 条：「车冑」恰好是数据里某个人物的名字
 *     ✗ three-kingdoms 第 276 条：「刘繇」恰好是数据里某个人物的名字
 *
 * 两条都**自相矛盾**：名单说"不是人名"，可数据里就有这个人
 * （`che-zhou` 主名就是车冑、`liu-yao` 主名就是刘繇）。
 * 而且它们**永远不会被读到**（真名在候选提取前就被屏蔽）——
 * 哪天这个人被改名 / 删掉，这条死条目会把他重新冒出来的候选**静默吃掉**。
 *
 * ## 怎么修
 *
 * 两条都**直接删掉**（不是改键）—— 因为主名本来就是真名，
 * 按名单口径（"只放明显不是人名的"）它们**根本不该在这里**。
 *
 * 另外，那份文件的 `_说明` 还写着「书里确实还有些没建档的人（车冑、潘璋、严颜、张鲁…）」
 * —— 实测这**四个现在全在数据里**，整句过期 ⇒ 一并改掉（保留"引述标记密集"那段语境）。
 *
 * ## 为什么是**外科手术式**改，不是重新序列化
 *
 * 这三份文件是**手工排版**的：说明头之后空一行，名字**多个挤在一行**
 * （`"文分解", "权曰", "余人", …`）。而 `JSON.stringify(obj,null,2)` 会**一个一行**，
 * 整份重写会造出几百行无谓 diff。⇒ 只做精确字符串替换，其余逐字节保持原样。
 *
 * 用法：node scripts/fix-missing-ok-stale.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMissingOk } from './check-missing-ok.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const MF = path.join(ROOT, 'data', 'three-kingdoms.missing-ok.json');
const BOOK = path.join(ROOT, 'data', 'three-kingdoms.json');

const raw = fs.readFileSync(MF, 'utf8');
const book = JSON.parse(fs.readFileSync(BOOK, 'utf8'));

/* ══════════════ 一、前置断言（不过就拒绝动数据） ══════════════ */
console.log('═══ 一、前置断言 ═══\n');
let ok = true;
const count = (s) => raw.split(s).length - 1;
const personNames = new Set();
for (const c of book.characters || []) for (const n of [c.name, ...(c.aliases || []), ...(c.altNames || [])]) if (typeof n === 'string') personNames.add(n);

for (const [needle, want, what] of [
  ['"车冑"', 1, '原文里带引号的「车冑」出现次数（应为 1 —— 只作为忽略条目；说明头那句不带引号）'],
  ['"刘繇"', 1, '原文里带引号的「刘繇」出现次数'],
]) {
  const got = count(needle);
  console.log(`  ${got === want ? '✓' : '✗'} ${what}：${got}（期望 ${want}）`);
  if (got !== want) ok = false;
}
for (const n of ['车冑', '刘繇']) {
  const has = personNames.has(n);
  console.log(`  ${has ? '✓' : '✗'} 「${n}」是数据里的人物名（这就是"矛盾"的依据）`);
  if (!has) ok = false;
}
for (const [needle, what] of [
  ['_书里**确实**还有些没建档的人（车冑、潘璋、严颜、张鲁…），但这份名单只放', '说明头里那句过期的"没建档的人"'],
  ['_「明显不是人名」的，剩下的仍会留在报告里供逐条判定。', '说明头的下一句'],
]) {
  const has = raw.includes(needle);
  console.log(`  ${has ? '✓' : '✗'} 原文含：${what}`);
  if (!has) ok = false;
}
/* 说明头点名的四个人现在必须**都在**数据里（证明那句整体过期） */
for (const n of ['车冑', '潘璋', '严颜', '张鲁']) {
  const has = personNames.has(n);
  console.log(`  ${has ? '✓' : '✗'} 说明头点名的「${n}」现在已在数据里`);
  if (!has) ok = false;
}
if (!ok) { console.error('\n  ⛔ 前置断言不过 —— 拒绝改动'); process.exit(1); }

/* ══════════════ 二、改动（精确字符串替换，保持手工排版） ══════════════ */
console.log('\n═══ 二、改动 ═══\n');
let out = raw;
const edits = [
  ['  "车冑", ', '', '删掉忽略条目「车冑」（数据里 che-zhou 的主名就是它）'],
  ['"刘繇", ', '', '删掉忽略条目「刘繇」（数据里 liu-yao 的主名就是它）'],
  [
    '  "_书里**确实**还有些没建档的人（车冑、潘璋、严颜、张鲁…），但这份名单只放",',
    '  "_书里**可能**还有些没建档的人，但这份名单只放「明显不是人名」的，",',
    '说明头：去掉过期的"（车冑、潘璋、严颜、张鲁…）"',
  ],
  [
    '  "_「明显不是人名」的，剩下的仍会留在报告里供逐条判定。",',
    '  "_剩下的仍会留在报告里供逐条判定（v0.163：车冑/潘璋/严颜/张鲁 曾列于此，后来都建了档）。",',
    '说明头：补一句留痕，防止以后又有人把这四个塞回来',
  ],
];
for (const [from, to, what] of edits) {
  if (!out.includes(from)) {
    if (to && out.includes(to)) { console.log(`  (跳过) 已应用：${what}`); continue; }
    console.error(`  ✗ 找不到待替换片段：${what}`); process.exitCode = 1; continue;
  }
  out = out.replace(from, to);
  console.log(`  ✓ ${what}`);
}

/* ══════════════ 三、体检（重新解析 + 复查） ══════════════ */
console.log('\n═══ 三、体检 ═══\n');
{
  let parsed;
  try { parsed = JSON.parse(out); } catch (e) { console.error(`  ✗ 改后 JSON 解析失败：${e.message}`); process.exit(1); }
  const names = parsed.map((e) => (typeof e === 'string' ? e : (e && e.name))).filter((n) => typeof n === 'string' && n && !n.startsWith('_'));
  console.log(`  条目数（不含说明行）：${names.length}`);
  for (const n of ['车冑', '刘繇']) console.log(`  ${names.includes(n) ? '✗ 仍在名单里' : '✓ 已从名单移除'}：${n}`);
  /* 逐字节往返（应失败 —— 因为手工排版；只用来确认没被重排） */
  console.log(`  ${JSON.stringify(parsed, null, 2) + '\n' === out ? '（注意）往返逐字节相同' : '手工排版保持不变（未重新序列化）'}`);
}

if (WRITE) {
  fs.writeFileSync(MF, out, 'utf8');
  console.log(`\n已写入 ${path.relative(ROOT, MF)}`);
  const ps = checkMissingOk();
  console.log(ps.length ? `\n⚠ 门禁复查仍有 ${ps.length} 处问题：\n  ` + ps.join('\n  ') : '\n✓ 门禁复查：已转绿');
} else {
  console.log('\n预览模式（加 --write 才落盘）');
}
