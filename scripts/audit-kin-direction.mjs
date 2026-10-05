/**
 * 找**父子边方向反了**的记录。
 *
 * ## 判据
 *
 * 本项目的约定是 `from = 父母 / to = 子女`（数据里通篇如此：
 * 「费尔南达 —母女— 梅梅」「梅梅 —母子— 奥雷里亚诺·巴比伦」）。
 * 而 `generation` 是人工标注的代际，父子之间**必须** from 的代号 ≤ to 的代号。
 *
 * 所以：**亲子类边的代号必须不递增**。递增的即是方向反了。
 *
 * ⚠ 这是**结构判据**，不是靠文案关键词猜的 —— generation 是人工标的，
 *   但标得一致；拿它当交叉校验比读 2300 条文案可靠得多。
 *
 * ⚠ 养父母、继亲不完全按代号走，所以单独归一类、不算错。
 */
import fs from 'node:fs';

const PC = /^(亲生)?(父|母)(子|女)$/;
for (const slug of ['three-kingdoms', 'crime-and-punishment', 'one-hundred-years-of-solitude']) {
  const book = JSON.parse(fs.readFileSync(`data/${slug}.json`, 'utf8'));
  const byId = new Map(book.characters.map((c) => [c.id, c]));
  const nm = (id) => byId.get(id)?.name ?? id;

  const rev = [], same = [], noGen = [];
  for (const r of book.relations) {
    const base = String(r.type || '').replace(/[（(].*$/, '').trim();
    if (!PC.test(base)) continue;
    const a = byId.get(r.from), b = byId.get(r.to);
    if (!a || !b || a.generation == null || b.generation == null) { noGen.push(r); continue; }
    if (a.generation > b.generation) rev.push(r);
    else if (a.generation === b.generation) same.push(r);
  }
  console.log(`\n=== ${slug} ===`);
  console.log(`  亲子边里代号递增（方向反了） ${rev.length} 条`);
  console.log(`  代号相同（同辈，另有解释）   ${same.length} 条`);
  console.log(`  缺代号，无法判               ${noGen.length} 条`);
  for (const r of rev.slice(0, 25)) {
    console.log(`    ✗ ${nm(r.from)}（gen${byId.get(r.from).generation}） —${r.type}— ${nm(r.to)}（gen${byId.get(r.to).generation}）`);
    console.log(`        文案：${(r.events?.[0]?.text ?? '(无)').slice(0, 80)}`);
  }
  if (rev.length > 25) console.log(`    …另 ${rev.length - 25} 条`);
  if (same.length) {
    console.log(`  ── 代号相同，需人工看一眼 ──`);
    for (const r of same.slice(0, 12)) {
      console.log(`    ? ${nm(r.from)}（gen${byId.get(r.from).generation}） —${r.type}— ${nm(r.to)}（gen${byId.get(r.to).generation}）　${(r.events?.[0]?.text ?? '').slice(0, 50)}`);
    }
    if (same.length > 12) console.log(`    …另 ${same.length - 12} 条`);
  }
}
