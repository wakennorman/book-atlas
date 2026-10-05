#!/usr/bin/env node
/**
 * v0.106：① 删掉原著里查无此人的诸葛珪　② 孙氏世系代号校准
 *
 * ## ① 删诸葛珪（用户裁定："小说没有就算了呗"）
 *
 * 原著「诸葛珪」出现 **0 次**。属 v0.100 同一类：史书有人、小说无名。
 * 连同 3 条边一起删（1 条手打 + 2 条推导）。推导边会在 derive-kin 重算时重建，
 * 所以这里删不删都一样，但删干净更好查。
 *
 * ## ② 孙氏世系代号校准
 *
 * 数据里原本乱的（21 人）：
 *     孙坚 gen1　孙策 gen1　孙权 gen2　孙韶 gen2
 *     孙登 gen1　孙和 gen1　孙亮 gen2　孙休 gen1
 *     孙皓 gen2　孙桓 gen1　吴太子孙 gen1
 *     孙静 gen1　孙皎 gen1
 * —— 父子俩同代、孙子比祖父低，乱的。
 *
 * 校准依据（全部原文佐证）：
 *     「令叔孙静守之」「叔父妙用」   ⇒ 孙静是孙坚之**弟**，同代
 *     「却说孙权弟孙翊为丹阳太守」   ⇒ 孙翊是孙权之**弟**（孙坚之子），数据里无此人
 *     「先有太子孙登」               ⇒ 孙登为孙权长子
 *     「遂立次子孙和为太子」         ⇒ 孙和为次子
 *     「又立三子孙亮为太子」         ⇒ 孙亮为三子
 *     「休字子烈，乃孙权第六子也」   ⇒ 孙休为第六子，birthRank=6
 *     「又封兄之子孙皓为乌程侯」     ⇒ 孙皓是孙休**兄长**的儿子 ⇒ 孙皓是孙权的**孙辈**
 *     「大帝孙权太子孙和之子也」     ⇒ 孙皓是孙和之子
 *     「追谥父和为文皇帝」           ⇒ 同上
 *
 * ⇒ 校准后的世系（lineal depth）
 *     gen1  孙坚　孙静（弟）　孙皎（孙静之子，与孙坚同代）
 *     gen2  孙策　孙权　孙韶
 *     gen3  孙登　孙和　孙亮　孙休
 *     gen4  孙皓　孙桓
 *     gen5  吴太子孙
 *
 * ⚠ 只动上面这一支。吴国其他旁支（孙峻/孙綝、孙恭等）本轮**没核**，
 *   宁可留着不可猜 —— 上一次猜 id 就把排行按到了刘琮头上。
 *
 * ⚠ generation 只用于布局与族谱自检；亲属间距由 scripts/kin-terms.mjs
 *   从**亲子边**算，不读绝对代号，所以这里改号不会影响已算出的称谓。
 *
 * 用法：node scripts/fix-sun-geshi.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');

/** 一、删人物：[id, 名字, 依据] */
const PURGE = [['zhuge-gui', '诸葛珪', '原著出现 0 次（用户裁定：小说没有就算了）']];

/** 二、代号校准：[id, 现名, 应为, 依据] */
const REGEN = [
  ['sun-jian', '孙坚', 1, '与弟孙静同代'],
  ['sun-jing', '孙静', 1, '「令叔孙静守之」「叔父妙用」⇒ 孙坚之弟，同代'],
  ['sun-jiao', '孙皎', 1, '孙静之子、兄弟同辈，与孙坚同代'],
  ['sun-ce', '孙策', 2, '孙坚之子'],
  ['sun-quan', '孙权', 2, '孙坚之子'],
  ['sun-shao', '孙韶', 2, '孙坚之子'],
  ['sun-deng', '孙登', 3, '孙权长子'],
  ['sun-he', '孙和', 3, '孙权次子'],
  ['sun-liang', '孙亮', 3, '孙权三子'],
  ['sun-xiu', '孙休', 3, '「乃孙权第六子」'],
  ['sun-hao', '孙皓', 4, '「乃孙权太子孙和之子」⇒ 孙权的孙辈'],
  ['sun-huan', '孙桓', 4, '孙和之子，与孙皓同代'],
  ['sun-tai-zi', '吴太子孙', 5, '孙皓之子'],
];

/** 三、birthRank：[id, 名字, 排行, 依据] */
const RANKS = [
  ['sun-xiu', '孙休', 6, '「休字子烈，乃孙权第六子也」'],
];

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
let changed = 0;
const refused = [];

function guard(id, expect) {
  const c = byId.get(id);
  if (!c) { refused.push(`${id}　人物不存在`); return null; }
  if (c.name !== expect) { refused.push(`${id}　期望「${expect}」，实际「${c.name}」⇒ 拒绝写入`); return null; }
  return c;
}

console.log('=== 一、删掉原著里查无此人的人物 ===');
for (const [id, name, why] of PURGE) {
  const c = guard(id, name);
  if (!c) continue;
  const edges = book.relations.filter((r) => r.from === id || r.to === id);
  console.log(`  删 ${c.name}（${id}）：连带 ${edges.length} 条边`);
  for (const r of edges) {
    const other = r.from === id ? r.to : r.from;
    console.log(`     － ${r.from === id ? c.name : other} —${r.type}— ${r.from === id ? other : c.name}${r.derived ? '  [推导]' : ''}`);
  }
  book.relations = book.relations.filter((r) => r.from !== id && r.to !== id);
  for (const ev of book.events ?? []) {
    if (Array.isArray(ev.chars)) ev.chars = ev.chars.filter((x) => x !== id);
  }
  book.characters = book.characters.filter((x) => x.id !== id);
  byId.delete(id);
  changed++;
}

console.log('\n=== 二、孙氏世系代号校准 ===');
for (const [id, name, gen, why] of REGEN) {
  const c = guard(id, name);
  if (!c) continue;
  if (c.generation === gen) { console.log(`  (跳过) ${c.name} 已是 gen${gen}`); continue; }
  console.log(`  ${c.name.padEnd(8)} gen${c.generation} → gen${gen}　（${why}）`);
  c.generation = gen;
  changed++;
}

console.log('\n=== 三、birthRank ===');
for (const [id, name, rank, why] of RANKS) {
  const c = guard(id, name);
  if (!c) continue;
  if (c.birthRank != null) { console.log(`  (跳过) ${c.name} 已有 birthRank=${c.birthRank}`); continue; }
  console.log(`  ${c.name.padEnd(8)} birthRank=${rank}　（${why}）`);
  c.birthRank = rank;
  changed++;
}

if (refused.length) {
  console.log(`\n=== 拒绝写入 ${refused.length} 条 ===`);
  for (const r of refused) console.log(`  ⛔ ${r}`);
}

console.log(`\n合计改动 ${changed} 处${WRITE ? '（已写入）' : '（预览，加 --write 才落盘）'}`);
if (WRITE && changed) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
