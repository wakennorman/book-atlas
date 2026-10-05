/**
 * v0.110：修 `夏侯楙 —养父子— 夏侯惇` 的方向
 *
 * ## 原文
 *
 * 「众视之，乃**夏侯渊之子夏侯楙**（读如冒）也。楙字子林，其性最急又最吝。
 *   **自幼嗣与夏侯惇为子。**后夏侯渊为黄忠所斩，曹操怜之，
 *   以女清河公主招楙为驸马……」
 *
 * ⇒ 是**夏侯惇收养夏侯楙**。数据记成了 `夏侯楙 —养父子— 夏侯惇`，
 *   方向反了（把被收养的人填成了收养者）。
 *
 * ## 危害：养亲边被当成血亲边，算出假的祖孙
 *
 * `scripts/kin-terms.mjs` 的 `PARENT_CHILD` **包含 `养(父|母)(子|女)`**
 * （我那三个审计脚本的 `PC` 正则**不含**，两套定义不一致 —— 这本身是个隐患）。
 * 所以错误的养亲边被接进了族谱：
 *
 *     夏侯渊 → 夏侯楙 → 夏侯惇     ⇒ computeKin 判 夏侯渊 是 夏侯惇 的祖父（差 2 代）
 *
 * 而原文明写两人是族兄弟（「闻知曹操起兵，与其族弟夏侯渊」「夏侯渊救护其兄而走」）。
 * 这条假祖孙还会顺着族谱污染所有推导边。
 *
 * ## 改完是什么样
 *
 *     夏侯渊 → 夏侯楙        （父子）
 *     夏侯惇 → 夏侯楙        （养父子）
 *
 * 两人是夏侯楙的**两位父亲**，不再是祖先与后代。
 *
 * 用法：node scripts/fix-xiahou.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byName = new Map(book.characters.map((c) => [c.name, c]));
const nm = (id) => book.characters.find((c) => c.id === id)?.name ?? id;

const adopt = byName.get('夏侯惇');   // 收养者
const child = byName.get('夏侯楙');     // 被收养者

if (!adopt || !child) {
  console.error('⛔ 找不到夏侯惇 / 夏侯楙，跳过');
} else {
  const i = book.relations.findIndex((r) => r.from === child.id && r.to === adopt.id && /养/.test(String(r.type)));
  if (i < 0) {
    console.log(`  (跳过) 没有 ${child.name} → ${adopt.name} 的养亲边（可能已修过）`);
  } else {
    const r = book.relations[i];
    console.log(`  ${child.name}（gen${child.generation}）—${r.type}— ${adopt.name}（gen${adopt.generation}）`);
    console.log(`      ${r.events?.[0]?.text ?? ''}`);
    console.log(`  ⇒ 改为 ${adopt.name} —${r.type}— ${child.name}`);
    console.log(`      「自幼嗣与夏侯惇为子」⇒ 是夏侯惇收养夏侯楙`);
    if (adopt.generation > child.generation) {
      console.log(`      ⛔ 代号不支持（父 gen${adopt.generation} > 子 gen${child.generation}），仍不改`);
    } else {
      if (r.fromCh != null && r.toCh != null) r.fromCh = r.toCh;
      r.from = adopt.id; r.to = child.id;
      if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
      console.log(`\n${WRITE ? '已写入' : '预览模式（加 --write 才落盘）'}`);
    }
  }
}
