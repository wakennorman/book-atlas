#!/usr/bin/env node
/**
 * v0.107：修 v0.105 / v0.106 引入的两个回归（自查发现，非用户报告）
 *
 * ## 回归 1：孙登的边被我换反了
 *
 * v0.105 我把 `孙权 —父子— 孙登` 改成 `孙登 —父子— 孙权`。
 * **那条边本来是对的**——它被 audit-kin-direction 标出来，只是因为
 * 当时代号是错的（孙权 gen2 / 孙登 gen1），不是边错了。
 * 我没有分辨"边反了"和"代号错了"这两种成因就动了手。
 *
 * 原文：「先有太子孙登」「遂立子孙登为皇太子」⇒ 孙权是孙登的父亲。
 * 现在把方向换回去。
 *
 * ## 回归 2：吴太子孙的代号被我改错了
 *
 * v0.106 我按"孙皓之子"把它设成 gen5。**读错了原文。**
 * 原文这段：「入宫中，令太子孙出拜…兴与群臣商议，欲立太子孙为君。
 * 左典军万彧曰：'幼，不能专政，不若取乌程侯孙皓立之。'」
 * —— 拿孙皓**替代**太子孙，说明太子孙是孙休那一支的太子，不是孙皓的儿子。
 * 数据里 `孙休 —父子— 吴太子孙` 本来就是对的。
 * ⇒ 吴太子孙 = 孙休之子，孙休 已校准为 gen3 ⇒ 吴太子孙 gen4。
 *
 * ★ 教训（第三次了）：代号递增只说明"这两个数对不上"，
 *   **不说明是边错了还是号错了**。audit-kin-direction.mjs 的输出
 *   必须逐条分辨成因才能动手，不能照单全收。
 *
 * 用法：node scripts/fix-sun-regress.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
let changed = 0;

const guard = (id, expect) => {
  const c = byId.get(id);
  if (!c) { console.log(`  ⛔ ${id} 人物不存在`); return null; }
  if (c.name !== expect) { console.log(`  ⛔ ${id} 期望「${expect}」实际「${c.name}」⇒ 拒绝写入`); return null; }
  return c;
};

console.log('=== 回归 1：把 孙登 —父子— 孙权 换回 孙权 —父子— 孙登 ===');
{
  const q = guard('sun-quan', '孙权'), d = guard('sun-deng', '孙登');
  if (q && d) {
    const r = book.relations.find((x) => x.from === 'sun-deng' && x.to === 'sun-quan' && !x.derived);
    if (!r) console.log('  ⛔ 找不到那条被换反的边');
    else {
      console.log(`  孙登（gen${d.generation}）—${r.type}— 孙权（gen${q.generation}）`);
      console.log(`      ⇒ 换回 孙权 —${r.type}— 孙登　（「先有太子孙登」「立子孙登为皇太子」）`);
      if (r.fromCh != null || r.toCh != null) { const t = r.fromCh; r.fromCh = r.toCh; r.toCh = t; }
      r.from = 'sun-quan'; r.to = 'sun-deng';
      changed++;
    }
  }
}

console.log('\n=== 回归 2：吴太子孙 gen5 → gen4（孙休之子，孙休 gen3）===');
{
  const c = guard('sun-tai-zi', '吴太子孙');
  if (c) {
    const father = guard('sun-xiu', '孙休');
    const edge = book.relations.find((x) => x.from === 'sun-xiu' && x.to === 'sun-tai-zi');
    if (!father || !edge) console.log('  ⛔ 找不到 孙休 —父子— 吴太子孙 这条边，不敢推代号');
    else {
      const want = father.generation + 1;
      console.log(`  ${c.name.padEnd(8)} gen${c.generation} → gen${want}　（孙休 gen${father.generation} 之子）`);
      c.generation = want;
      changed++;
    }
  }
}

console.log(`\n合计改动 ${changed} 处${WRITE ? '（已写入）' : '（预览，加 --write 才落盘）'}`);
if (WRITE && changed) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
