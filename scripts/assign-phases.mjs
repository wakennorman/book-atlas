#!/usr/bin/env node
/**
 * 按章节区间把事件归到阶段（phases[].from / phases[].to 用回/章号）
 *
 * 逐章生成时，只有第 1 章会输出 phases，后面各章的事件都会落到"第一个阶段"。
 * 所以书稿跑完合并后，用这个脚本按 ch 重新分配一次。
 *
 * 用法：
 *   node scripts/assign-phases.mjs data/three-kingdoms.json          # 预览
 *   node scripts/assign-phases.mjs data/three-kingdoms.json --write  # 写回
 *   node scripts/assign-phases.mjs --all [--write]                   # 所有书（没有 from/to 的跳过）
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const files = argv.includes('--all')
  ? fs.readdirSync(path.join(process.cwd(), 'data')).filter((f) => f.endsWith('.json') && f !== 'books.json').map((f) => path.join(process.cwd(), 'data', f))
  : argv.filter((a) => !a.startsWith('--'));

if (!files.length) {
  console.error('用法：node scripts/assign-phases.mjs data/xx.json [--write]  |  --all [--write]');
  process.exit(1);
}

for (const file of files) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const phases = (book.phases || []).filter((p) => typeof p.from === 'number' && typeof p.to === 'number');
  if (!phases.length) {
    console.log(`\n▶ ${path.basename(file)}：phases 没有 from/to 区间，跳过`);
    continue;
  }
  let changed = 0;
  for (const e of book.events || []) {
    const ch = typeof e.ch === 'number' ? e.ch : 0;
    const hit = phases.find((p) => ch >= p.from && ch <= p.to);
    if (!hit) continue;
    if (e.phase !== hit.id) { e.phase = hit.id; changed++; }
  }
  console.log(`\n▶ ${path.basename(file)}：${phases.length} 个阶段区间 → 重新归入 ${changed} 个事件`);
  for (const p of phases) {
    const n = (book.events || []).filter((e) => e.phase === p.id).length;
    console.log(`   ${p.id.padEnd(4)} 第 ${String(p.from).padStart(3)}–${String(p.to).padStart(3)} 回  ${p.name.padEnd(18, '　')} ${n} 个事件`);
  }
  if (write && changed) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
}
console.log(`\n${write ? '已写回' : '预览模式：加 --write 才写回'}`);
