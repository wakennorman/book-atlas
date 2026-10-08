/**
 * 找**父子边方向反了**的记录。
 *
 * ## 判据（**仅供参考，不能自动判死**）
 *
 * 本项目的约定是 `from = 父母 / to = 子女`（数据里通篇如此：
 * 「费尔南达 —母女— 梅梅」「梅梅 —母子— 奥雷里亚诺·巴比伦」）。
 * 若 `generation` 可靠，父子之间**应当** from 的代号 ≤ to 的代号。
 *
 * 所以：**亲子类边的代号不应递增**。递增的即为**疑似**方向反了，待人核。
 *
 * ## 身份：**人工报告**，不进硬门禁（v0.154 说明）
 *
 * 本脚本**恒 exit 0**，也**不在** check.yml 的 run 步骤里。原因：
 * `generation` 是**部分填写**的 —— 多数人物默认 1，只有少数标了真实代际。
 * 实测三国 871 人里 **763 人 gen1**，且带噪声：曹丕 gen2 而曹彰 gen3（兄弟不同代）、
 * 诸葛亮 gen4 与曹操 gen1 同期、还有曹腾 gen=-1。于是"代号递增"既可能是方向错、
 * 也可能是**代际没填或填错**，机器分不开。⇒ 输出只供人工核，不能当判决。
 *
 * ⚠ 曾经有一条注释（check.yml v0.115 那段）把本脚本说成"硬门禁" —— 那是错的：
 *   它从没进过 run 步骤。这类"注释吹牛"现由 `test/gate-claims.mjs` 守着。
 *
 * ⚠ 养父母、继亲不完全按代号走，所以单独归一类、不算错。
 */
import fs from 'node:fs';
import { isParentChild } from './kin-terms.mjs';

/* ⚠ 本报告不是判决：generation 是部分填写的（多数人物默认 1），
 *   所以"代号递增"里混着"真方向错"与"代际没填/填错"两种，须人工分辨。 */

for (const slug of ['three-kingdoms', 'crime-and-punishment', 'one-hundred-years-of-solitude']) {
  const book = JSON.parse(fs.readFileSync(`data/${slug}.json`, 'utf8'));
  const byId = new Map(book.characters.map((c) => [c.id, c]));
  const nm = (id) => byId.get(id)?.name ?? id;

  const rev = [], same = [], noGen = [];
  for (const r of book.relations) {
    /* ⚠ 亲子边定义从 kin-terms.mjs 引，不在这里另写一份。
     *   v0.110 之前这里用 /^(亲生)?(父|母)(子|女)$/，不含 `养`，
     *   于是所有养亲边对审计不可见 —— 而查出的正是
     *   `夏侯楙 —养父子— 夏侯惇` 方向反了（被收养的人填成了收养者）。 */
    if (!isParentChild(r)) continue;
    const a = byId.get(r.from), b = byId.get(r.to);
    if (!a || !b || a.generation == null || b.generation == null) { noGen.push(r); continue; }
    if (a.generation > b.generation) rev.push(r);
    else if (a.generation === b.generation) same.push(r);
  }
  console.log(`\n=== ${slug} ===`);
  console.log(`  亲子边里代号递增（疑似方向反，待人核） ${rev.length} 条`);
  console.log(`  代号相同（多半是没填代际，非错误）     ${same.length} 条`);
  console.log(`  缺代号，无法判                         ${noGen.length} 条`);
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
