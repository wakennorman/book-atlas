#!/usr/bin/env node
/* 关系去重：把「同一对人物 + 同一关系类型」的多条重复关系合并成一条
 *
 * 为什么：图上一对人之间的多条同型关系会扇开成多根一模一样的线
 * （三国演义实测：刘备↔关羽 6 条、张飞↔刘备 7 条，全叫「结义兄弟」）。
 * 阶段关系（同盟→敌对，type 不同）不受影响，本脚本只合并 type 完全相同的。
 *
 * 用法：
 *   node scripts/merge-duplicate-relations.mjs            # 预览（不写回）
 *   node scripts/merge-duplicate-relations.mjs --write    # 写回
 *   node scripts/merge-duplicate-relations.mjs data/three-kingdoms.json --write
 *
 * 合并规则：
 *   - 分组键 = 无向人物对 + type（与图上 edgeKey 的口径一致）
 *   - 方向   = 组内事件最多的那条的方向（并列取第一条）
 *   - events = 全部并入，按「text + chapter」去重
 *   - 区间   = 并集：任一成员没有 fromCh ⇒ 合并后从头算；任一成员没有 toCh ⇒ 合并后到结尾
 *     若成员区间之间有空档（中间断过），不自动合并，列出来人工处理
 *   - kin/style/derived 等字段取组内第一条有的值，不一致时告警
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const files = args.filter((a) => !a.startsWith('--'));
const targets = files.length
  ? files.map((f) => path.resolve(f))
  : fs.readdirSync(path.join(root, 'data'))
      .filter((f) => f.endsWith('.json') && f !== 'books.json' && !f.startsWith('.'))
      .map((f) => path.join(root, 'data', f));

const pairKey = (r) => [r.from, r.to].sort().join('|');

for (const file of targets) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rels = book.relations || [];
  const groups = new Map();
  rels.forEach((r, i) => {
    const k = `${pairKey(r)}||${(r.type || '').trim()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ r, i });
  });

  const dups = [...groups].filter(([, v]) => v.length > 1);
  const conflicts = [];
  let merged = 0, mergedEvents = 0;

  for (const [, members] of dups) {
    const first = members[0].r;

    // —— 区间检查：成员区间并起来有没有空档？有空档 ⇒ 不能自动合并 ——
    const periods = members.map(({ r }) => ({ from: r.fromCh || 0, to: r.toCh || Infinity }));
    const anyOpenEnd = periods.some((p) => p.to === Infinity);
    const anyOpenStart = periods.some((p) => p.from === 0);
    let gap = false;
    if (!anyOpenEnd || !anyOpenStart) {   // 全闭合才需要查空档
      const sorted = [...periods].sort((a, b) => a.from - b.from);
      let reach = sorted[0].from;
      for (const p of sorted) {
        if (p.from > reach) { gap = true; break; }
        reach = Math.max(reach, p.to === Infinity ? Infinity : p.to);
      }
    }
    if (gap) {
      conflicts.push(members.map(({ r }) =>
        `${book.characters?.find((c) => c.id === r.from)?.name || r.from}—${r.type}—${book.characters?.find((c) => c.id === r.to)?.name || r.to}（第${r.fromCh ?? '?'}–${r.toCh ?? '?'}章）`).join(' ；'));
      continue;
    }

    // —— 方向：取事件最多的那条 ——
    const dir = [...members].sort((a, b) =>
      ((b.r.events || []).length - (a.r.events || []).length) || (a.i - b.i))[0].r;
    if (dir !== first) {
      first.from = dir.from; first.to = dir.to;
    }

    // —— events 合并去重 ——
    const seen = new Set((first.events || []).map((e) => `${e.text}§${e.chapter || ''}`));
    for (const { r } of members) {
      if (r === first) continue;
      for (const e of r.events || []) {
        const k = `${e.text}§${e.chapter || ''}`;
        if (e.text && !seen.has(k)) { seen.add(k); (first.events ||= []).push(e); mergedEvents++; }
      }
    }

    // —— 区间并集 ——
    if (!anyOpenStart) first.fromCh = Math.min(...periods.map((p) => p.from));
    else delete first.fromCh;
    if (!anyOpenEnd) first.toCh = Math.max(...periods.map((p) => p.to));
    else delete first.toCh;

    // —— 字段一致性 ——
    for (const f of ['kin', 'style', 'derived']) {
      const vals = [...new Set(members.map(({ r }) => JSON.stringify(r[f] ?? null)))];
      if (vals.length > 1) console.log(`   ⚠ ${pairKey(first)} ${first.type} 的 ${f} 不一致：${vals.join(' / ')}（保留首条）`);
    }

    merged += members.length - 1;
  }

  if (!dups.length) { console.log(`✓ ${path.basename(file)}：没有重复关系`); continue; }
  console.log(`\n${path.basename(file)}：${dups.length} 组重复（同对同型），可合并 ${merged} 条，吸收小事件 ${mergedEvents} 条`);
  for (const [k, members] of dups.slice(0, 12)) {
    const [pair, type] = k.split('||');
    const [a, b] = pair.split('|');
    const nm = (id) => book.characters?.find((c) => c.id === id)?.name || id;
    console.log(`   · ${nm(a)} — ${type} — ${nm(b)}：${members.length} 条`);
  }
  if (dups.length > 12) console.log(`   … 其余 ${dups.length - 12} 组省略`);
  if (conflicts.length) {
    console.log(`   ⚠ ${conflicts.length} 组区间有空档，未合并（需人工处理）：`);
    conflicts.forEach((c) => console.log(`     - ${c}`));
  }

  if (!write) { console.log('   （预览模式：加 --write 才写回）'); continue; }

  // —— 重新执行合并并写回（与预览相同的判定） ——
  const g2 = new Map();
  rels.forEach((r, i) => {
    const k = `${pairKey(r)}||${(r.type || '').trim()}`;
    if (!g2.has(k)) g2.set(k, []);
    g2.get(k).push({ r, i });
  });
  const drop = new Set();
  for (const [, members] of g2) {
    if (members.length < 2) continue;
    const periods = members.map(({ r }) => ({ from: r.fromCh || 0, to: r.toCh || Infinity }));
    const anyOpenEnd = periods.some((p) => p.to === Infinity);
    const anyOpenStart = periods.some((p) => p.from === 0);
    let gap = false;
    if (!anyOpenEnd || !anyOpenStart) {
      const sorted = [...periods].sort((a, b) => a.from - b.from);
      let reach = sorted[0].from;
      for (const p of sorted) { if (p.from > reach) { gap = true; break; } reach = Math.max(reach, p.to); }
    }
    if (gap) continue;
    const first = members[0].r;
    const dir = [...members].sort((a, b) =>
      ((b.r.events || []).length - (a.r.events || []).length) || (a.i - b.i))[0].r;
    if (dir !== first) { first.from = dir.from; first.to = dir.to; }
    const seen = new Set((first.events || []).map((e) => `${e.text}§${e.chapter || ''}`));
    for (const { r } of members) {
      if (r === first) continue;
      for (const e of r.events || []) {
        const k = `${e.text}§${e.chapter || ''}`;
        if (e.text && !seen.has(k)) { seen.add(k); (first.events ||= []).push(e); }
      }
      drop.add(r);
    }
    if (!anyOpenStart) first.fromCh = Math.min(...periods.map((p) => p.from)); else delete first.fromCh;
    if (!anyOpenEnd) first.toCh = Math.max(...periods.map((p) => p.to)); else delete first.toCh;
  }
  book.relations = rels.filter((r) => !drop.has(r));
  fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
  console.log(`   ✓ 已写回：删除 ${drop.size} 条重复，${rels.length} → ${book.relations.length} 条关系`);
}
console.log(`\n${write ? '完成' : '预览完成'}`);
