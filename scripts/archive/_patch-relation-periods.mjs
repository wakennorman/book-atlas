#!/usr/bin/env node
/**
 * 给「同一对人、多条关系」标上时间区间（fromCh / toCh）—— 时间旅行一次只画当时那一条。
 *
 * 背景：《三国演义》里同一对人常有 3–10 条关系：有的是**同一段关系的多条依据**（刘关张的结义），
 * 有的是**关系真的变了**（曹操↔袁绍：同盟 → 貌合神离 → 敌对 → 旧交）。不区分的话图上会同时画好几条平行边。
 *
 * 规则（机械、可复核）：
 *   1. 同一对（无序）的关系按「解锁章 relCh = 事件里的最小章号」排序
 *   2. 按 **类型 + 线条样式** 切成连续的"阶段段"（`（…）` 里的补充说明与标点先归一化；
 *      类型或线条变了才算进入下一段）
 *   3. 每段的有效期 = [段首的章, max(下一段段首的章, 本段最后一条事件的章 + 1))
 *      —— max(...) 是为了不让"本段自己的事件"落到区间之外（否则那些事件在时间旅行里看不到）
 *   4. 最后一段：只写 fromCh（长期有效）
 *      —— 不做"人工收束点"：那会让主要人物对在末章凭空消失（曹操↔关羽 之类），
 *         而"这段关系最后变成了什么"其实已经由 style（实线/虚线/点线）与依据事件表达
 *
 * 用法：
 *   node scripts/_patch-relation-periods.mjs            # 干跑：只报告
 *   node scripts/_patch-relation-periods.mjs --write    # 写回 data/three-kingdoms.json
 */
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve('data/three-kingdoms.json');
const WRITE = process.argv.includes('--write');

const chOf = (s) => { const m = String(s || '').match(/(\d+)/); return m ? Number(m[1]) : null; };
const relCh = (r) => {
  const list = (r.events || []).map((e) => chOf(e.chapter)).filter((n) => n !== null);
  return list.length ? Math.min(...list) : 0;
};
const relLastCh = (r) => {
  const list = (r.events || []).map((e) => chOf(e.chapter)).filter((n) => n !== null);
  return list.length ? Math.max(...list) : 0;
};
/** 归一化：去掉（…）补充、空白与标点，只看"关系类型"本身 */
const normType = (r) => String(r.type || '').replace(/（[^）]*）/g, '').replace(/[\s·、,，。／/]/g, '');
const runKey = (r) => `${normType(r)}|${r.style || 'solid'}`;

/** 人工例外：确定的收束点（关系在第 toCh 章起不再存在） */
const OVERRIDES = [];

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const pairKey = (r) => [r.from, r.to].sort().join('|');
const groups = new Map();
for (const r of book.relations) {
  const k = pairKey(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

let staged = 0, runs = 0, skipped = 0;
const samples = [];
for (const [, list] of groups) {
  if (list.length < 2) continue;
  const sorted = [...list].sort((a, b) => relCh(a) - relCh(b) || relLastCh(a) - relLastCh(b));
  // 按 类型+线条 切成连续段
  const segments = [];
  for (const r of sorted) {
    const last = segments[segments.length - 1];
    if (last && last.key === runKey(r)) last.items.push(r);
    else segments.push({ key: runKey(r), items: [r] });
  }
  if (segments.length < 2) {                       // 只有一段（同一段关系的多条依据）→ 不切
    const first = segments[0].items[0];
    if (typeof first.fromCh !== 'number' && relCh(first) > 0) { first.fromCh = relCh(first); staged++; }
    continue;
  }
  segments.forEach((seg, i) => {
    const from = relCh(seg.items[0]);
    if (!from) return;
    if (i < segments.length - 1) {
      const nextFrom = relCh(segments[i + 1].items[0]);
      const lastEv = Math.max(...seg.items.map(relLastCh));
      const to = Math.max(nextFrom, lastEv + 1);
      if (to <= from) { skipped++; return; }
      for (const r of seg.items) { r.fromCh = from; r.toCh = to; staged++; }
      runs++;
      if (samples.length < 8) samples.push(`${seg.items[0].from}↔${seg.items[0].to}「${seg.items[0].type}」第 ${from}–${to - 1} 章（${seg.items.length} 条依据）`);
    } else {
      for (const r of seg.items) if (typeof r.fromCh !== 'number') { r.fromCh = from; staged++; }
    }
  });
}

// 人工例外（目前为空：见文件头第 4 条说明）
for (const o of OVERRIDES) {
  const list = groups.get([o.from, o.to].sort().join('|')) || [];
  const hit = list.find((r) => relCh(r) === o.relCh);
  if (!hit) { console.log(`⚠ 例外未命中：${o.from}↔${o.to}（第 ${o.relCh} 章）`); continue; }
  hit.fromCh = relCh(hit);
  hit.toCh = o.toCh;
  console.log(`✎ ${o.from}↔${o.to}「${hit.type}」→ 第 ${hit.fromCh}–${o.toCh - 1} 章　${o.note}`);
}

console.log(`\n阶段关系：${runs} 段、${staged} 条已标区间（跳过 ${skipped} 段同章起算的）`);
if (samples.length) console.log('例：\n  ' + samples.join('\n  '));

if (!WRITE) {
  console.log('\n（干跑）加 --write 才会写回文件');
} else {
  fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
  console.log(`\n✓ 已写回 ${path.relative(process.cwd(), FILE)}`);
}
