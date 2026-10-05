#!/usr/bin/env node
/**
 * v0.112：把 v0.105 错误合并的两个人拆开 —— 孙河 ≠ 孙和
 *
 * ## 我犯的错
 *
 * v0.105 我搜「孙河」在原文里 **0 次**，就断定"此人不存在"，
 * 把 `sun-he` 从「孙河」改名成「孙和」。
 *
 * **原著里"孙河"确实是 0 次 —— 因为原文写的是「名河」，姓是孙策刚赐的，前面不带"孙"字。**
 * 原文：
 *     「权视之，乃孙桓也。桓字叔武，**其父名河，本姓俞氏，孙策爱之，赐姓孙**，
 *       因此亦系吴王宗族。**河生四子，桓居其长**」
 *     「奈**此子（孙韶）虽本姓俞氏**，然**孤兄**甚爱之，赐姓孙」
 *
 * ⇒ **孙河**（俞氏 → 赐姓孙，孙策收养）和 **孙和**（孙权次子）是**两个人**。
 *
 * ★ 这正是我自己写进 scripts/purge-history-only.mjs 注释里的那条教训：
 *   「**全名 0 次 ≠ 人物不在原著里**」（戴陵那次）。
 *   当时记住了，v0.105 又违反了一次。**判断"人物是否存在"必须查姓氏之外的线索** ——
 *   本姓、字号、「其父名X」「X之子」这类表述。
 *
 * ## 两条边的归属（每条都有原文依据）
 *
 * 属于 **孙河**（俞氏，孙策赐姓）：
 *     孙策 —赐姓收养— 孙河   「孙策爱之，赐姓孙，因此亦系吴王宗族」
 *     孙河 —父子— 孙桓       「河生四子，桓居其长」
 *     aliases 里的 俞河 / 名河 / 其父名河 —— 都在说"他本姓俞、名河"
 *
 * 属于 **孙和**（孙权次子）：
 *     孙权 —父子— 孙和       「先有太子孙登」「遂立次子孙和为太子」
 *     全公主 —公主谮废太子— 孙和  「和因与全公主不睦，被公主所谮，权废之，和忧恨而死」
 *     孙和 —父子— 孙皓       「大帝孙权太子孙和之子也」
 *     birthRank = 2          「遂立**次子**孙和为太子」
 *
 * ## 后果
 *
 * 合并期间孙和被算成"孙权的儿子"，而孙河其实是俞氏人 ——
 * 于是孙河的族谱位置完全错了，孙桓的祖先也接错了人。
 *
 * 用法：node scripts/fix-split-sunhe.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const nm = (id) => book.characters.find((c) => c.id === id)?.name ?? id;

/** 属于孙河的边：[另一方名字, 边的 type, 原文依据] */
const TO_HE = [
  ['孙策', '赐姓收养', '「孙策爱之，赐姓孙，因此亦系吴王宗族」'],
  ['孙桓', '父子', '「河生四子，桓居其长」'],
];
/** 属于孙和的边：[另一方名字, 边的 type, 原文依据] */
const TO_ZONGHE = [
  ['孙权', '父子', '「先有太子孙登」「遂立次子孙和为太子」'],
  ['全公主', '公主谮废太子', '「和因与全公主不睦，被公主所谮，权废之，和忧恨而死」'],
  ['孙皓', '父子', '「大帝孙权太子孙和之子也」'],
];

const cur = book.characters.find((c) => c.id === 'sun-he');
if (!cur) {
  console.error('⛔ 找不到 sun-he');
  process.exit(1);
}
console.log(`当前：${cur.id}　${cur.name}　gen${cur.generation}　aliases=${JSON.stringify(cur.aliases ?? [])}`);
if (cur.name !== '孙和') {
  console.log(`（名字已是「${cur.name}」，不是「孙河」——可能已拆过，先核对再跑）`);
}

/* ── 1. 新建「孙河」这个人物（俞氏，孙策赐姓），并把孙策/孙桓的边归给他 ── */
let he = book.characters.find((c) => c.name === '孙河');
if (!he) {
  he = {
    id: 'sun-he-orig',
    name: '孙河',
    aliases: ['俞河', '名河', '其父名河', '本姓俞氏'],
    generation: cur.generation,
    gender: 'm',
    faction: 'wu',
    title: '',
    desc: '本姓俞氏，孙策爱之赐姓孙，因此系吴王宗族。孙桓之父，生四子桓居其长',
    fate: '',
    note: '⚠ 原著写作「其父名河，本姓俞氏」——姓是孙策所赐，故原文里「孙河」0 次。'
      + '与孙权次子「孙和」是两个人，v0.105 曾误并为一人，v0.112 拆开。',
    tier: 'minor',
  };
  book.characters.push(he);
  console.log(`\n新建人物：${he.id}　孙河（本姓俞氏，孙策赐姓）`);
} else {
  console.log(`\n已存在人物：${he.id}　孙河`);
}

let moved = 0, kept = 0, missing = 0;
for (const [otherName, type, why] of TO_HE) {
  const other = book.characters.find((c) => c.name === otherName);
  if (!other) { console.log(`  ⛔ 找不到 ${otherName}`); missing++; continue; }
  const i = book.relations.findIndex((r) => !r.derived
    && ((r.from === cur.id && r.to === other.id) || (r.from === other.id && r.to === cur.id))
    && String(r.type).replace(/[（(].*$/, '').trim() === type);
  if (i < 0) { console.log(`  ⛔ 找不到边 ${otherName} —${type}— ${cur.name}`); missing++; continue; }
  const r = book.relations[i];
  const wasFrom = r.from === cur.id;
  if (wasFrom) r.from = he.id; else r.to = he.id;
  console.log(`  ${otherName} —${type}— ${cur.name}   ⇒   ${otherName} —${type}— ${he.name}`);
  console.log(`      ${why}`);
  moved++; kept++;
}

/* ── 2. sun-he 改回孙和，并把 aliases 里属于孙河的词挪走 ── */
cur.name = '孙和';
/**
 * aliases 清理。
 *
 * v0.105 改名时做过 `aliases.map(a => a.replace(/俞河/g,'孙和').replace(/名河/g,'孙和'))`，
 * 于是原本属于孙河的 俞河 / 名河 / 其父名河 全被替换成"孙和"，
 * 还留下了重复项 —— 现在是 ["孙和","孙和","其父孙和"]。
 *
 * 这些全是孙河的线索（「名河」「本姓俞氏」说的是他），要归给孙河；
 * 孙和自己是次子，只留「次子」。
 */
const heOnly = new Set(['俞河', '名河', '其父名河', '本姓俞氏', '孙和', '其父孙和']);
const before = [...(cur.aliases ?? [])];
cur.aliases = [...new Set(['次子'])];
he.aliases = [...new Set([...(he.aliases ?? []), ...before.filter((a) => heOnly.has(a) && a !== '孙和')])];
if (!he.aliases.includes('俞氏')) he.aliases.push('俞氏');
console.log(`\nsun-he 改回「孙和」`);
console.log(`  孙和 aliases：${JSON.stringify(before)} → ${JSON.stringify(cur.aliases)}`);
console.log(`  孙河 aliases：${JSON.stringify(he.aliases)}`);
cur.birthRank = 2;
cur.desc = cur.desc || '孙权次子，琅琊王夫人所生，废为会稽王后忧恨而死';
cur.note = '孙权次子（「遂立次子孙和为太子」）。'
  + '⚠ v0.105 曾把孙河（俞氏，孙策赐姓）与本者误并为一人，v0.112 已拆开。';
console.log(`  孙和 birthRank=${cur.birthRank}（遂立**次子**孙和为太子）`);

console.log(`\n迁移 ${moved} 条边，缺 ${missing} 条`);
if (missing) console.log('⚠ 有边没找到，请人工核对后再跑');
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
