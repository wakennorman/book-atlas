#!/usr/bin/env node
/**
 * 给数据里的亲属关系补 kin 字段（只补有把握的；拿不准的留给人工）
 *
 * 用法：
 *   node scripts/annotate-kin.mjs                 # 只看报告（不写文件）
 *   node scripts/annotate-kin.mjs --write         # 写回 data/*.json
 *   node scripts/annotate-kin.mjs --all           # 只看全部书
 */
import fs from 'node:fs';
import path from 'node:path';
import { KIN, KIN_KEYS, guessKin } from './kin.mjs';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const dir = path.join(process.cwd(), 'data');
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'books.json')
  .map((f) => path.join(dir, f));

let total = 0, filled = 0;
for (const file of files) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = [];
  let changed = 0;
  for (const r of book.relations || []) {
    total++;
    const guessed = guessKin(r.type);
    if (r.kin && !KIN_KEYS.includes(r.kin)) { rows.push(`  ✗ 非法 kin：${r.from}→${r.to}「${r.kin}」`); continue; }
    if (r.kin || !guessed) continue;
    r.kin = guessed;
    filled++; changed++;
    rows.push(`  + ${(r.type || '').padEnd(12, '　')} ${KIN[guessed].padEnd(3, '　')}  ${r.from} → ${r.to}`);
  }
  // 剩下的家人关系（没猜出来的）列出来，让人工过一眼
  const unknown = (book.relations || []).filter((r) => !r.kin && !guessKin(r.type) && /[父母子女儿兄弟姐妹妹夫夫妻孙叔侄甥姑姨舅婆媳媳婿]/.test(String(r.type || '')));
  console.log(`\n▶ ${path.basename(file)}：关系 ${(book.relations || []).length} 条，本次补 kin ${changed} 条`);
  rows.slice(0, 200).forEach((l) => console.log(l));
  if (unknown.length) {
    console.log('  ⚠ 这些像家人但没猜出来（请人工判断，别硬套）：');
    unknown.forEach((r) => console.log(`      · ${r.from} —「${r.type}」— ${r.to}`));
  }
  if (write && changed) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
}
console.log(`\n合计：${total} 条关系，补了 ${filled} 条 kin${write ? '（已写回）' : '（预览，加 --write 才写回）'}`);
