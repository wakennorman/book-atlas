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

  // 0) 去掉重复阶段（AI 每章也可能吐出自己的 phases），同 id 只留带 from/to 的那个
  const seenPhase = new Map();
  for (const p of book.phases || []) {
    const prev = seenPhase.get(p.id);
    if (!prev) { seenPhase.set(p.id, p); continue; }
    if (!prev.from && p.from) seenPhase.set(p.id, p);
  }
  const dedupedPhases = [...seenPhase.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const dupPhases = (book.phases || []).length - dedupedPhases.length;
  book.phases = dedupedPhases;

  const phases = (book.phases || []).filter((p) => typeof p.from === 'number' && typeof p.to === 'number');
  if (!phases.length) {
    console.log(`\n▶ ${path.basename(file)}：phases 没有 from/to 区间，跳过（去重阶段 ${dupPhases} 个）`);
    continue;
  }
  let changed = 0;
  for (const e of book.events || []) {
    const ch = typeof e.ch === 'number' ? e.ch : 0;
    const hit = phases.find((p) => ch >= p.from && ch <= p.to);
    if (!hit) continue;
    if (e.phase !== hit.id) { e.phase = hit.id; changed++; }
  }
  // 阶段内按 章号 → 原有 order 排序，重新编号（事件轴就是按 order 排的）
  let ordered = 0;
  for (const p of phases) {
    const list = (book.events || []).filter((e) => e.phase === p.id)
      .sort((a, b) => (a.ch ?? 0) - (b.ch ?? 0) || (a.order ?? 0) - (b.order ?? 0));
    list.forEach((e, i) => { if (e.order !== i + 1) { e.order = i + 1; ordered++; } });
  }
  console.log(`\n▶ ${path.basename(file)}：${phases.length} 个阶段区间 → 归入 ${changed} 个事件、重排 ${ordered} 个顺序${dupPhases ? `；去掉 ${dupPhases} 个重复阶段` : ''}`);
  for (const p of phases) {
    const n = (book.events || []).filter((e) => e.phase === p.id).length;
    console.log(`   ${p.id.padEnd(4)} 第 ${String(p.from).padStart(3)}–${String(p.to).padStart(3)} 回  ${p.name.padEnd(18, '　')} ${n} 个事件`);
  }
  if (write) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
}
console.log(`\n${write ? '已写回' : '预览模式：加 --write 才写回'}`);
