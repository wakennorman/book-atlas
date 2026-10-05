/**
 * 扫「亲子边的 type 与 gender 不符」。
 *
 * ## 为什么这是可靠判据（跟前几轮的"形态判据"不同）
 *
 * type 的四个值已经把父母的性别写死了：
 *     父子 ⇒ 父 m，子 m        父女 ⇒ 父 m，子 f
 *     母子 ⇒ 母 f，子 m        母女 ⇒ 母 f，子 f
 * 而 characters[].gender 是独立标注的。所以两边一对不上，
 * **至少有一边是错的**，而我们能确定错的是 type —— 因为
 * 吴太夫人「mother of 孙策/孙权」在原文里明写着，不需要猜。
 *
 * ⚠ 反过来不成立：gender 对、type 也对，但**辈分/方向**可能仍错。
 *   那个要靠原文，本脚本管不了。
 */
import fs from 'node:fs';
import { isParentChild } from './kin-terms.mjs';

/**
 * ⚠ 亲子边的定义**必须从 kin-terms.mjs 引，不要在这里另写一份**。
 *
 * v0.110 之前这里自己写 `/^(亲生)?(父|母)(子|女)$/`，**不含 `养`**，
 * 而 kin-terms.mjs 的 PARENT_CHILD 含 `养(父|母)(子|女)`。
 * 两套定义不一致的后果：所有**养亲边对审计完全不可见** ——
 * 而 v0.110 查出的正是 `夏侯楙 —养父子— 夏侯惇` 方向反了（被收养的人
 * 填成了收养者）。本脚本当时一条都没报，因为它压根不认养亲边。
 *
 * 同一个错误还波及 audit-kin-direction.mjs 与 fix-*.mjs，已一并改为引 isParentChild。
 */
const PC = {
  父子: ['m', 'm'], 父女: ['m', 'f'],
  母子: ['f', 'm'], 母女: ['f', 'f'],
  亲生父子: ['m', 'm'], 亲生父女: ['m', 'f'],
  亲生母子: ['f', 'm'], 亲生母女: ['f', 'f'],
  养父子: ['m', 'm'], 养父女: ['m', 'f'],
  养母子: ['f', 'm'], 养母女: ['f', 'f'],
};

/** 全书合计的不符条数。>0 ⇒ 退出码 1（这是硬门禁，不只出报告）。 */
let total = 0;

for (const slug of ['three-kingdoms', 'crime-and-punishment', 'one-hundred-years-of-solitude']) {
  const book = JSON.parse(fs.readFileSync(`data/${slug}.json`, 'utf8'));
  const byId = new Map(book.characters.map((c) => [c.id, c]));

  const bad = [];
  let noGender = 0;
  let kinEdges = 0;
  for (const r of book.relations) {
    if (r.derived) continue;
    if (!isParentChild(r)) continue;          /* 单一来源：kin-terms 的定义 */
    const base = String(r.type || '').replace(/[（(].*$/, '').trim();
    const want = PC[base];
    if (!want) continue;                      /* 不认识的 type（比如继父子）跳过 */
    kinEdges++;
    const p = byId.get(r.from), c = byId.get(r.to);
    if (!p || !c) continue;
    if (!p.gender || !c.gender) { noGender++; continue; }
    const [wp, wc] = want;
    if (p.gender !== wp || c.gender !== wc) {
      bad.push({ r, p, c, want });
    }
  }

  console.log(`\n=== ${slug} ===`);
  console.log(`  亲子边 ${kinEdges} 条　type 与 gender 不符 ${bad.length} 条　（gender 缺失跳过 ${noGender} 条）`);
  for (const b of bad) {
    console.log(`  ✗ ${b.p.name}(${b.p.gender}) —${b.r.type}— ${b.c.name}(${b.c.gender})`
      + `　期望 ${b.want[0]}/${b.want[1]}`);
    console.log(`      ${(b.r.events?.[0]?.text ?? '(无文案)').slice(0, 80)}`);
  }
  total += bad.length;
}

if (total) {
  console.error(`\n✗ 亲子边的 type 与 gender 有 ${total} 处不符`);
  process.exit(1);
}
console.log('\n✓ 亲子边的 type 与 gender 全部自洽');
