#!/usr/bin/env node
/**
 * 检查小程序数据包是否与 data/*.json 同步（语义比对，不比字节）
 *
 * 为什么不做"重新生成 + git diff"：
 *   make-miniprogram-packs.mjs 里有 localeCompare（依赖 ICU/系统 locale），
 *   Windows 与 Ubuntu 生成的同度数角色排序不同 ⇒ 字节必然不同，
 *   但数据本身是一致的。字节比对会天天误报。
 *
 * 这里改成：把 miniprogram/data/<slug>.js 解析出来，与 data/<slug>.json
 * 逐字段深比较（characters / relations / events / places / phases / factions
 * / meta / 度数 / books 索引），并单独校验三套布局的坐标都是有限数。
 *
 * 用法：node scripts/check-packs-sync.mjs        （全部书）
 *       node scripts/check-packs-sync.mjs three-kingdoms
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const PACK_DIR = path.join(ROOT, 'miniprogram', 'data');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function readPack(p) {
  const t = fs.readFileSync(p, 'utf8');
  const m = t.match(/^\s*module\.exports\s*=\s*([\s\S]*?)\s*;?\s*$/);
  if (!m) throw new Error(`不是 module.exports 形式：${p}`);
  return JSON.parse(m[1]);
}

const problems = [];
const fail = (msg) => problems.push(msg);

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]));
}

/* 度数（与打包脚本同口径：两端各算一次，自环算两次） */
function degreeOf(book) {
  const deg = new Map(book.characters.map((c) => [c.id, 0]));
  for (const r of book.relations) {
    if (deg.has(r.from)) deg.set(r.from, deg.get(r.from) + 1);
    if (deg.has(r.to)) deg.set(r.to, deg.get(r.to) + 1);
  }
  return Object.fromEntries(deg);
}

const catalog = readJson(path.join(DATA_DIR, 'books.json'));
const books = catalog.books.filter((b) => !only.length || only.includes(b.slug));
if (!books.length) {
  console.error(`没有匹配的书：${only.join(', ')}`);
  process.exit(1);
}

for (const entry of books) {
  const book = readJson(path.join(ROOT, entry.file));
  const packPath = path.join(PACK_DIR, `${entry.slug}.js`);
  if (!fs.existsSync(packPath)) { fail(`${entry.slug}：缺 ${path.relative(ROOT, packPath)}，请跑 node scripts/make-miniprogram-packs.mjs`); continue; }
  const pack = readPack(packPath);

  const fields = ['slug', 'title', 'author', 'links', 'meta', 'factions', 'characters', 'relations', 'places', 'phases', 'events'];
  for (const f of fields) {
    const want = f === 'places' ? (book[f] || []) : f === 'phases' ? (book[f] || []) : f === 'links' ? (entry[f] || []) : f === 'slug' || f === 'title' || f === 'author' ? entry[f] : book[f];
    if (!deepEq(pack[f], want)) fail(`${entry.slug}：字段 ${f} 不同步（包里 ${countStr(pack[f])}，源里 ${countStr(want)}）`);
  }
  const wantDeg = degreeOf(book);
  if (!deepEq(pack.degree, wantDeg)) fail(`${entry.slug}：degree 不同步`);

  /* 布局：三套都必须给每个人一个有限坐标（NaN 会让小程序画不出图） */
  for (const view of ['gen-v', 'gen-h', 'force']) {
    const L = pack.layouts && pack.layouts[view];
    if (!L || !L.pos) { fail(`${entry.slug}：缺布局 ${view}`); continue; }
    let bad = 0;
    for (const c of book.characters) {
      const p = L.pos[c.id];
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) bad++;
    }
    if (bad) fail(`${entry.slug}：布局 ${view} 有 ${bad} 个坐标缺失或非有限数`);
  }

  if (!problems.length) {
    console.log(`✓ ${entry.slug}  与 data 同步（${book.characters.length} 人 / ${book.relations.length} 关系 / ${book.events.length} 事件，3 套布局坐标有限）`);
  }
}

/* books.js 索引 */
const idxPath = path.join(PACK_DIR, 'books.js');
if (!fs.existsSync(idxPath)) {
  fail('缺 miniprogram/data/books.js');
} else {
  const idx = readPack(idxPath).books || [];
  const want = catalog.books.map((b) => ({ slug: b.slug, title: b.title, author: b.author, file: `./${b.slug}.js` }));
  const got = idx.map((x) => ({ slug: x.slug, title: x.title, author: x.author, file: x.file }));
  if (!deepEq(got, want)) fail('books.js 索引与 data/books.json 不同步');
}

if (problems.length) {
  console.error('\n✗ 小程序数据包与 data/*.json 不同步：');
  for (const p of problems) console.error('  - ' + p);
  console.error('\n请在本地重跑：node scripts/make-miniprogram-packs.mjs 然后提交 miniprogram/data/');
  process.exit(1);
}
console.log('\n全部同步 ✓');

function countStr(v) {
  if (Array.isArray(v)) return `${v.length} 项`;
  if (v && typeof v === 'object') return `${Object.keys(v).length} 键`;
  return JSON.stringify(v);
}
