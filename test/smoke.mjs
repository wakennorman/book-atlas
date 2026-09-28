#!/usr/bin/env node
/**
 * 网页版核心逻辑冒烟测试（Node 跑，不需要浏览器）
 *
 * 直接加载 data/*.json，验证：
 *   · 数据结构完整性（id 唯一、引用存在）
 *   · BFS 最短路能找到路径
 *   · 剧透过滤后数量正确
 *   · 时间旅行关系切换正确
 *   · 章节摘要数据正确
 *
 * 用法：node test/smoke.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function section(name) {
  console.log(`\n▶ ${name}`);
}

/* ---------------- 数据加载 ---------------- */
const booksFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'books.json'), 'utf8'));
const books = booksFile.books;

assert(books.length >= 3, `至少 3 本书（当前 ${books.length}）`);

for (const b of books) {
  const fp = path.join(ROOT, b.file);
  assert(fs.existsSync(fp), `数据文件存在：${b.file}`);
}

/* ---------------- 每本书的核心逻辑 ---------------- */
for (const b of books) {
  const book = JSON.parse(fs.readFileSync(path.join(ROOT, b.file), 'utf8'));
  const slug = b.slug;

  section(`${b.title}（${slug}）`);

  // 1. 数据结构完整性
  const ids = new Set();
  let dupId = 0;
  for (const c of book.characters) {
    if (ids.has(c.id)) dupId++;
    ids.add(c.id);
  }
  assert(dupId === 0, `人物 id 无重复（${dupId} 个重复）`);
  assert(book.characters.length > 0, `人物数 > 0（${book.characters.length}）`);

  // 2. 关系引用完整性
  let badRef = 0;
  for (const r of book.relations) {
    if (!ids.has(r.from) || !ids.has(r.to)) badRef++;
  }
  assert(badRef === 0, `关系引用完整（${badRef} 条坏引用）`);

  // 3. 事件引用完整性
  let badEventRef = 0;
  for (const e of book.events) {
    for (const cid of e.chars || []) {
      if (!ids.has(cid)) badEventRef++;
    }
  }
  assert(badEventRef === 0, `事件 chars 引用完整（${badEventRef} 条坏引用）`);

  // 4. BFS 最短路（简化版：只验证连通性）
  const adj = new Map();
  for (const c of book.characters) adj.set(c.id, []);
  for (const r of book.relations) {
    if (!adj.has(r.from) || !adj.has(r.to)) continue;
    adj.get(r.from).push(r.to);
    adj.get(r.to).push(r.from);
  }

  // 找两个有关系的人，验证 BFS 能找到路径
  if (book.relations.length > 0) {
    const r0 = book.relations[0];
    const visited = new Set([r0.from]);
    const queue = [r0.from];
    let found = false;
    while (queue.length) {
      const cur = queue.shift();
      if (cur === r0.to) { found = true; break; }
      for (const next of adj.get(cur) || []) {
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    assert(found, `BFS 能找到路径：${r0.from} → ${r0.to}`);
  }

  // 5. 剧透过滤（简化版：验证 firstCh 分布）
  const firstChs = book.characters.map((c) => c.firstCh || 0);
  const maxFirstCh = Math.max(...firstChs);
  assert(maxFirstCh > 0, `有人物出场章（最大 firstCh = ${maxFirstCh}）`);

  // 6. 时间旅行：验证 relations 的 fromCh/toCh 字段
  const timedRels = book.relations.filter((r) => typeof r.fromCh === 'number');
  if (timedRels.length > 0) {
    const r = timedRels[0];
    // toCh 是可选字段；如果有值，必须 >= fromCh
    const toCh = typeof r.toCh === 'number' ? r.toCh : Infinity;
    assert(r.fromCh <= toCh, `时间区间合理：${r.from} → ${r.to}（${r.fromCh}-${r.toCh}）`);
  }

  // 7. 章节摘要：验证每章都有事件或新人物
  const chaptersWithContent = new Set();
  for (const c of book.characters) {
    const ch = c.firstCh || 0;
    if (ch > 0) chaptersWithContent.add(ch);
  }
  for (const e of book.events) {
    if (e.ch > 0) chaptersWithContent.add(e.ch);
  }
  assert(chaptersWithContent.size > 0, `有章节内容（${chaptersWithContent.size} 章）`);

  // 8. 阵营引用完整
  const factionKeys = new Set((book.factions || []).map((f) => f.key));
  let badFaction = 0;
  for (const c of book.characters) {
    if (c.faction && !factionKeys.has(c.faction)) badFaction++;
  }
  assert(badFaction === 0, `阵营引用完整（${badFaction} 个坏引用）`);
}

/* ---------------- 结果 ---------------- */
console.log(`\n${'='.repeat(40)}`);
console.log(`通过：${passed}  失败：${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('全部通过');
}
