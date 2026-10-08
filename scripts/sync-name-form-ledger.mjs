/**
 * 跟着 purge-history-only.mjs 同步清理「采用名字台账」。
 *
 * data/three-kingdoms.name-form-ok.json 记的是「原书没写出全名、但我们仍决定采用」的
 * 每一条及理由。删了人物就必须把对应条目删掉 —— 否则台账里会留下
 * 指向不存在人物的记录，下一个人照着它去查会白跑。
 *
 * 顺便改正戴陵那条：原理由「原书**未出现**此人（0 次）」是**错的**，
 * 查的是全名「第100回只写姓氏『戴』，全名 0 次」，
 * 而这个人在原著里确实出场（见 purge-history-only.mjs 的注释）。
 *
 * 用法：node scripts/sync-name-form-ledger.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(ROOT, 'data', 'three-kingdoms.name-form-ok.json');
const WRITE = process.argv.includes('--write');

/** 已从 characters 里删掉的人，台账里也要删 */
const REMOVED = ['陶商', '陶应', '公孙晃', '雷同（巴西）'];
/* ⚠ 「雷同（巴西）」是 v0.159 合并掉的：它与「雷同（雒城）」本是同一人（原著一条连续人生），
 *   合并后主名回到「雷同」，原著里逐字出现 ⇒ 不再需要「主名非原样字」的申报。 */

/** 仍在数据里、但理由写错的 */
const FIX_WHY = new Map([
  ['戴陵', '原书**有此人**，第100回司马懿派兵劫寨时写的是「张、戴二人自纵马视之，'
    + '只见数百辆草车横截去路」「不独张、戴二人所不料」——**只写姓氏「戴」，'
    + '从不连写「戴陵」**（0 次），全名见《三国志·张郃传》。'
    + '⚠ 原记「原书未出现此人」是错的：查的是全名，不是这个人在不在。'],
]);

const j = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const before = j.明细.length;

j.明细 = j.明细.filter((r) => !REMOVED.includes(r.name));
for (const [name, why] of FIX_WHY) {
  const row = j.明细.find((r) => r.name === name);
  if (row) {
    console.log(`  改正「${name}」的理由`);
    row.why = why;
  } else {
    console.log(`  ⚠ 台账里找不到「${name}」`);
  }
}
j.申报条数 = j.明细.length;

console.log(`\n台账：${before} 条 → ${j.明细.length} 条（删 ${before - j.明细.length} 条）`);
console.log(`  删除：${REMOVED.join('、')}`);
console.log(`  改因：${[...FIX_WHY.keys()].join('、')}`);

if (WRITE) {
  fs.writeFileSync(LEDGER, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log(`\n写入 ${path.relative(ROOT, LEDGER)}`);
} else {
  console.log('\n（预览模式，加 --write 才落盘）');
}
