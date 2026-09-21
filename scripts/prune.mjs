#!/usr/bin/env node
/**
 * 剪枝：清掉整本生成后常见的"碎数据"
 *
 *  A. 孤儿人物：没有任何关系、也没被任何事件引用 → 多半是某一章里被顺手写进去的名字
 *  B. 孤儿地点：没有任何事件（含关系小事件）挂到它 → 地点筛选用不到
 *  C. --demote：关系数 ≤ N 的人物标 tier="minor"（图上默认不显示标签，但仍可搜到）
 *
 * 用法：
 *   node scripts/prune.mjs data/three-kingdoms.json                 # 只看报告
 *   node scripts/prune.mjs data/three-kingdoms.json --write         # 应用（默认只丢孤儿）
 *   node scripts/prune.mjs data/three-kingdoms.json --write --demote 2 --keep-orphan-events
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const demote = (() => {
  const i = argv.indexOf('--demote');
  return i >= 0 ? Number(argv[i + 1] ?? 2) : null;
})();
const files = argv.includes('--all')
  ? fs.readdirSync(path.join(process.cwd(), 'data')).filter((f) => f.endsWith('.json') && f !== 'books.json' && !f.startsWith('.')).map((f) => path.join(process.cwd(), 'data', f))
  : argv.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));

if (!files.length) { console.error('用法：node scripts/prune.mjs data/xx.json [--write] [--demote 2]'); process.exit(1); }

for (const file of files) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chars = book.characters || [];
  const rels = book.relations || [];
  const events = book.events || [];

  const relCount = new Map(chars.map((c) => [c.id, 0]));
  for (const r of rels) { relCount.set(r.from, (relCount.get(r.from) || 0) + 1); relCount.set(r.to, (relCount.get(r.to) || 0) + 1); }
  const inEvent = new Set();
  for (const e of events) for (const id of e.chars || []) inEvent.add(id);

  const orphans = chars.filter((c) => !relCount.get(c.id) && !inEvent.has(c.id));
  const placeUse = new Map((book.places || []).map((p) => [p.id, 0]));
  for (const e of events) if (e.place && placeUse.has(e.place)) placeUse.set(e.place, placeUse.get(e.place) + 1);
  for (const r of rels) for (const ev of r.events || []) if (ev.place && placeUse.has(ev.place)) placeUse.set(ev.place, placeUse.get(ev.place) + 1);
  const deadPlaces = (book.places || []).filter((p) => !placeUse.get(p.id));

  const dist = {};
  for (const c of chars) { const n = relCount.get(c.id) || 0; dist[n] = (dist[n] || 0) + 1; }
  console.log(`\n▶ ${path.basename(file)}：${chars.length} 人 / ${rels.length} 关系 / ${events.length} 事件 / ${(book.places || []).length} 地点`);
  console.log(`   关系数分布：${Object.entries(dist).sort((a, b) => a[0] - b[0]).slice(0, 8).map(([k, v]) => `${k}条→${v}人`).join(' · ')} …`);
  console.log(`   孤儿人物 ${orphans.length} 人${orphans.length ? `：${orphans.slice(0, 12).map((c) => c.name).join('、')}${orphans.length > 12 ? ' …' : ''}` : ''}`);
  console.log(`   没挂事件的地点 ${deadPlaces.length} 个${deadPlaces.length ? `：${deadPlaces.slice(0, 12).map((p) => p.name).join('、')}${deadPlaces.length > 12 ? ' …' : ''}` : ''}`);
  if (demote !== null) {
    const low = chars.filter((c) => (relCount.get(c.id) || 0) <= demote && c.tier !== 'mentioned');
    console.log(`   关系数 ≤ ${demote} 的人物 ${low.length} 人 → 标 tier="minor"（图上默认不显示标签）`);
  }

  if (!write) { console.log('   （预览模式：加 --write 才改文件）'); continue; }

  const orphanIds = new Set(orphans.map((c) => c.id));
  const deadIds = new Set(deadPlaces.map((p) => p.id));
  book.characters = chars.filter((c) => !orphanIds.has(c.id));
  book.places = (book.places || []).filter((p) => !deadIds.has(p.id));
  if (demote !== null) for (const c of book.characters) { const n = relCount.get(c.id) || 0; if (n <= demote && c.tier !== 'mentioned') c.tier = 'minor'; }
  fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
  console.log(`   ✓ 已删 ${orphanIds.size} 人 / ${deadIds.size} 地点${demote !== null ? `；低关系人物已标 minor` : ''}`);
}
