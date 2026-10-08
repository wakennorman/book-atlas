#!/usr/bin/env node
/**
 * v0.160：清掉「采用名字台账」里两条**已失效**的条目，并改正同一个根因留下的 `note`。
 *
 * ## 起因
 *
 * 新门禁 `scripts/check-name-form-ledger.mjs`（本版新增）一上来就抓到两条存量。
 * 那一刻的现场很说明问题：
 *
 *     audit-against-text.mjs --names --strict  →  「已申报 11 个」
 *     data/three-kingdoms.name-form-ok.json   →  "申报条数": 13
 *
 * **两个数字都印在文件里，差 2 条，却没有任何一处报过。**
 *
 * ## 两条分别是
 *
 * ### ① 诸葛珪 —— 人已经删了，台账留了 9 个版本
 *
 * v0.106 的 `scripts/fix-sun-geshi.mjs` 把它**连人一起删掉**
 * （`PURGE = [['zhuge-gui','诸葛珪', …]]`；理由：原著「诸葛珪」0 次，
 * 属"《三国志》里有、《三国演义》里没点名"那一类；用户裁定"小说没有就算了呗"）。
 * 删除记录在 `docs/known-dropped-relations.md`。
 * 但**台账条目没跟着删** —— 于是它从 v0.106 一直指向一个不存在的人。
 * （`purge-history-only.mjs` 后来补过"删人时同步查台账"的逻辑，但它只查自己那份删除名单，
 *   没有回头扫存量 ⇒ 这条一直没人发现。）
 *
 * ### ② 戴陵 —— 键写成别名，而且这条本来就**不该存在**
 *
 * 数据里该人物的主名是 **戴凌**，「戴陵」只是它的 `aliases`。
 * 台账键写成了别名 ⇒ 消费方 `declared.get(c.name)` 查不到 ⇒ 从 v0.128 起就没生效过。
 *
 * 更要紧的是：**回原著逐字一查，主名「戴凌」出现 16 次**，
 * 而「戴陵」**0 次**（详见本文件第一节的核验）。
 * ⇒ 主名本来就是**原书原样字** ⇒ 按台账口径（"申报主名不是原书原样字的人"）
 *   **这条根本不需要申报**，应该删掉，而不是把键改成主名。
 *
 * ⚠ 这条为什么危险：它**连误报都没发生**（主名在原文里 ⇒ 审计不报错），
 *   所以看起来"没事"。但它是一条**假记录** ——
 *   读它的人会以为"原书不写这个全名"，而原书写了 16 次。
 *
 * ## ③ 顺带：`dai-ling.note` 里同一个根因留下的假话
 *
 * 同一个错误在 `note` 里也留了一层：note 写
 * 「**只写姓氏「戴」，全名「戴陵」0 次**（全名见《三国志·张郃传》）」，
 * 末句还有「数据用了「陵」」—— 而数据里 `name` 是**「戴凌」**，**自相矛盾**。
 * 根因是同一个：**只搜了史书字形「戴陵」，从没搜过正文用的「戴凌」**。
 * 只修台账不修 note，等于把同一个坑留在原地。
 *
 * 用法：node scripts/fix-name-ledger-and-dailing-note.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const LEDGER = path.join(ROOT, 'data', 'three-kingdoms.name-form-ok.json');
const BOOK = path.join(ROOT, 'data', 'three-kingdoms.json');
const SRC = path.join(os.tmpdir(), 'opencode', 'ba-books', '三国演义.txt');

if (!fs.existsSync(SRC)) { console.error(`✗ 找不到原著文本：${SRC}`); process.exit(1); }
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(fs.readFileSync(SRC, 'utf8'));

const book = JSON.parse(fs.readFileSync(BOOK, 'utf8'));
const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));

/* ══════════════ 一、原文核验（不过就拒绝动数据） ══════════════ */
console.log('═══ 一、原文核验 ═══\n');
let ok = true;
for (const [needle, want, what] of [
  ['诸葛珪', 0, '「诸葛珪」逐字出现次数'],
  ['戴陵', 0, '「戴陵」（史书字形）逐字出现次数'],
  ['戴凌', 16, '「戴凌」（正文用字）逐字出现次数'],
]) {
  const got = f.split(needle).length - 1;
  const pass = got === want;
  console.log(`  ${pass ? '✓' : '✗'} ${what}：${got}（期望 ${want}）`);
  if (!pass) ok = false;
}
/* 再核一层：16 次必须**都是人名语境**，不是"去掉空白后相邻"造出来的假命中。
 * 取四处原文片段，必须逐字存在。 */
for (const c of ['懿令郃为先锋，戴凌为副将', '张郃、戴凌分付曰', '蜀兵困戴凌在垓心', '救出戴凌而回']) {
  const hit = f.includes(flat(c));
  console.log(`  ${hit ? '✓' : '✗'} 人名语境「${c}」`);
  if (!hit) ok = false;
}
if (!ok) { console.error('\n  ⛔ 原文核验不过 —— 拒绝改动'); process.exit(1); }

/* ══════════════ 二、删台账里两条已失效的条目 ══════════════ */
console.log('\n═══ 二、删两条已失效的条目 ═══\n');
const DROP = [
  ['诸葛珪', 'v0.106 已连人一起删（原著 0 次），台账条目没跟着删'],
  ['戴陵', '主名是「戴凌」（原著 16 次，本就是原样字）；键写成别名 ⇒ 申报不生效，且这条本不该存在'],
];
const before = ledger.明细.length;
for (const [name, why] of DROP) {
  const i = ledger.明细.findIndex((r) => r.name === name);
  if (i < 0) { console.log(`  (跳过) 台账里已没有「${name}」⇒ 已应用`); continue; }
  console.log(`  − 「${name}」—— ${why}`);
  ledger.明细.splice(i, 1);
}
ledger.申报条数 = ledger.明细.length;
console.log(`\n  台账：${before} 条 → ${ledger.明细.length} 条`);

/* ══════════════ 三、改正 dai-ling 的 note（同一个根因） ══════════════ */
console.log('\n═══ 三、改正 dai-ling 的 note ═══\n');
const NOTE_OLD = '只写姓氏「戴」，全名「戴陵」0 次';
const NOTE_NEW = '魏将，张郃的副将。\n'
  + '※ v0.120 改主名：戴陵 → 戴凌。\n'
  + '※ v0.160 更正：本 note 原先写「只写姓氏『戴』，全名『戴陵』0 次（全名见《三国志·张郃传》）」'
  + '—— 那句话只搜了**史书字形「戴陵」**，于是得出「原著不写全名」的错误印象。'
  + '回原著逐字核：正文用的是「戴凌」，出现 **16 次**'
  + '（第99–100回「懿令郃为先锋，戴凌为副将」「张郃、戴凌分付曰」「戴凌在左，张郃在右」'
  + '「蜀兵困戴凌在垓心」「救出戴凌而回」「张虎、戴凌、乐綝」…），而「戴陵」**0 次**。\n'
  + '⇒ 主名「戴凌」本来就是原书原样字；「戴陵」是《三国志》的写法，保留为别名。\n'
  + '⚠ 原 note 写「原书未出现此人」是同一个错：查的是**字形**，不是人在不在。'
  + '（本条原先在 data/three-kingdoms.name-form-ok.json 里有一条申报 —— 那也是多余的，v0.160 一并删了。）';
{
  const c = book.characters.find((x) => x.id === 'dai-ling');
  if (!c) { console.error('  ✗ 找不到 dai-ling'); process.exitCode = 1; }
  else if (c.note.includes('v0.160 更正')) console.log('  (跳过) note 已是 v0.160 版本 ⇒ 已应用');
  else if (!c.note.includes(NOTE_OLD)) { console.error(`  ✗ note 里找不到「${NOTE_OLD}」—— 数据已变，拒绝盲写`); process.exitCode = 1; }
  else {
    c.note = NOTE_NEW;
    console.log('  ＋ dai-ling.note 已重写：');
    console.log(NOTE_NEW.split('\n').map((l) => '      ' + l).join('\n'));
  }
  if (c && c.name !== '戴凌') { console.error(`  ✗ 主名不是「戴凌」而是「${c.name}」—— 与前提高不符，拒绝继续`); process.exitCode = 1; }
}

/* ══════════════ 四、体检 ══════════════ */
console.log('\n═══ 四、体检 ═══\n');
{
  const mainNames = new Set(book.characters.map((x) => x.name));
  const aliasOwner = new Map();
  for (const x of book.characters) for (const a of x.aliases || []) if (!aliasOwner.has(a)) aliasOwner.set(a, x.name);
  let bad = 0;
  for (const r of ledger.明细) {
    if (!mainNames.has(r.name)) {
      console.log(`  ✗ 「${r.name}」不是主名${aliasOwner.has(r.name) ? `（是 ${aliasOwner.get(r.name)} 的别名）` : ''}`);
      bad++;
    }
    if (!String(r.why || '').trim()) { console.log(`  ✗ 「${r.name}」why 为空`); bad++; }
  }
  const dup = ledger.明细.map((r) => r.name).filter((n, i, a) => a.indexOf(n) !== i);
  if (dup.length) { console.log(`  ✗ 重复：${dup.join('、')}`); bad++; }
  console.log(`  申报条数=${ledger.申报条数} / 明细=${ledger.明细.length}  ${ledger.申报条数 === ledger.明细.length ? '✓' : '✗'}`);
  console.log(bad ? `  ⇒ 仍有 ${bad} 处问题` : '  ✓ 每条都指着真实主名，why 都非空，无重复');
  if (bad) process.exitCode = 1;
}

if (WRITE) {
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  fs.writeFileSync(BOOK, JSON.stringify(book, null, 2).replace(/\n/g, '\r\n') + '\r\n', 'utf8');
  console.log(`\n已写入 ${path.relative(ROOT, LEDGER)} 与 ${path.relative(ROOT, BOOK)}`);
} else {
  console.log('\n预览模式（加 --write 才落盘）');
}
