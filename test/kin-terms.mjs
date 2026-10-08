/**
 * 单测：scripts/kin-terms.mjs 的称谓计算。
 *
 * ⚠ 期望值都是先按中文亲属称谓在纸上推一遍才写的。
 *   这份测试改过三次，每次都是**我自己写错了**（期望写错 / 造谱漏边 / 代差下标错），
 *   顺带把算法里的两个真 bug 也逼出来了（见 kin-terms.mjs 里的注释）。
 *
 * 谱（GP+GM 之下 A、B 是同胞兄弟；D 也挂在 A 下面，用来造堂兄弟）：
 *   GP+GM
 *   ├─ A ─ 与 B 同胞兄弟
 *   │   ├─ C ─ 与 D 同父兄弟（都只挂了父 A）⇒ 判「同父异母」
 *   │   │   ├─ C1                          ⇒ C1 与 D1 是**堂**兄弟（父 C、D 是兄弟）
 *   │   │   │   └─ S1
 *   │   └─ C2 ── K1                        ⇒ A 与 K1 差 1 代（真叔侄）
 *   ├─ D ── D1
 *   └─ B ── E
 * 旁挂：F(母) ── G ── H（外祖孙）
 *
 * ⚠「叔侄」在中文里**严格指差 1 代**。A 与他兄弟的孙子相差 2 代，叫「叔祖父／侄孙」，
 *   不叫叔侄 —— 用户抓的就是这个（他把上校与奥雷里亚诺第二的关系看成"第二代和第四代"）。
 */
import { buildTree, computeKin, ancestorAtDepth, kinGenerationOf } from '../scripts/kin-terms.mjs';

let pass = 0, fail = 0;
const ok = (c, m, extra) => {
  if (c) { pass++; console.log(`  ✓ ${m}`); }
  else { fail++; console.error(`  ✗ ${m}${extra !== undefined ? `  → 实际：${JSON.stringify(extra)}` : ''}`); }
};

const chars = [
  { id: 'GP', gender: 'm' }, { id: 'GM', gender: 'f' },
  { id: 'A', gender: 'm' }, { id: 'B', gender: 'm' },
  { id: 'C', gender: 'm', birthRank: 1 }, { id: 'D', gender: 'm' }, { id: 'E', gender: 'f' },
  { id: 'F', gender: 'f' }, { id: 'G', gender: 'm' }, { id: 'H', gender: 'f' },
  { id: 'I', gender: 'm' }, { id: 'C1', gender: 'm' }, { id: 'D1', gender: 'm' },
  { id: 'S1', gender: 'm' }, { id: 'C2', gender: 'm', birthRank: 2 }, { id: 'K1', gender: 'f' },
];
const rel = [
  { from: 'GP', to: 'A', type: '父子' }, { from: 'GM', to: 'A', type: '母子' },
  { from: 'GP', to: 'B', type: '父子' }, { from: 'GM', to: 'B', type: '母子' },
  { from: 'A', to: 'C', type: '父子' }, { from: 'A', to: 'D', type: '父子' },
  { from: 'A', to: 'C2', type: '父子' },
  { from: 'C', to: 'C1', type: '父子' }, { from: 'C1', to: 'S1', type: '父子' },
  { from: 'C2', to: 'K1', type: '父女' },
  { from: 'D', to: 'D1', type: '父子' },
  { from: 'B', to: 'E', type: '父子' },
  { from: 'F', to: 'G', type: '母子' }, { from: 'G', to: 'H', type: '父女' },
  { from: 'A', to: 'I', type: '父子' },
];
const tree = buildTree(rel, chars);
const K = (a, b) => computeKin(tree, a, b);
const t = (r) => ({ kind: r.kind, gap: r.gap, eG: r.elderGen, yG: r.youngerGen, eW: r.elderWord, yW: r.youngerWord, term: r.term });

console.log('\n▶ buildTree：只有亲子边进族谱');
{
  const t2 = buildTree([
    { from: 'A', to: 'C', type: '父子' }, { from: 'A', to: 'C', type: '师徒' },
    { from: 'A', to: 'D', type: '义兄弟' }, { from: 'A', to: 'E', type: '养父子' },
  ], chars);
  ok(t2.parents.get('C')?.length === 1, '「师徒」「义兄弟」不算亲子边', t2.parents.get('C'));
  ok(t2.children.get('A')?.length === 2, '重复边幂等；「养父子」算亲子', t2.children.get('A'));
  ok(tree.parents.get('C')?.length === 1, 'C 只有一个父 A（谱里没给母）', tree.parents.get('C'));
}

console.log('\n▶ 直系');
{
  ok(K('A', 'C').term === '父子', 'A → C 父子', K('A', 'C'));
  ok(K('G', 'H').term === '父女', 'G → H 父女', K('G', 'H'));
  const fh = K('F', 'H');
  ok(fh.kind === 'direct' && fh.term === '祖孙', 'F → H 祖孙（外祖母与外孙女）', fh);
  const cs = K('C', 'S1');
  ok(cs.kind === 'direct' && cs.gap === 2 && cs.term === '祖孙', 'C → 孙 S1 祖孙', cs);
  const as1 = K('A', 'S1');
  ok(as1.kind === 'direct' && as1.gap === 3 && as1.term === '曾祖孙',
    'A → 曾孙 S1 曾祖孙（直系 A→C→C1→S1）', as1);
}

console.log('\n▶ 同胞');
{
  const ab = K('A', 'B');
  ok(ab.kind === 'sibling' && ab.siblingKind === 'full' && ab.term === '兄弟',
    'A 与 B 同父母 ⇒ 兄弟', ab);
  ok(K('B', 'A').term === '兄弟', '对称：换传入顺序仍是兄弟', K('B', 'A').term);
  const cd = K('C', 'D');
  ok(cd.kind === 'sibling' && cd.term === '同父异母的兄弟',
    'C 与 D 都只挂了一个父、没挂母 ⇒ 判「同父异母」（宁可说半血，不冒充亲兄弟）', cd);
  ok(K('C', 'I').kind === 'sibling', 'C 与 I 同为 A 的儿子 ⇒ 同辈', K('C', 'I').kind);
}

console.log('\n▶ 旁系 1 代：「叔侄 / 姑侄」严格指差 1 代');
{
  // A → C2 → K1，但 C2 是 A 的兄弟 ⇒ K1 是 A 的侄女（差 1 代）
  const uncle = K('C', 'K1');
  ok(uncle.kind === 'collateral' && uncle.gap === 1,
    'C 与侄女 K1 差 1 代 ⇒ 旁系（不是直系！）', t(uncle));
  ok(uncle.base === '叔侄' && uncle.youngerWord === '侄女',
    '真叔侄：主词叔侄，晚辈称侄女', { base: uncle.base, yW: uncle.youngerWord });
  ok(!/祖/.test(uncle.elderWord), '差 1 代时长辈侧不带「祖」字', uncle.elderWord);
}

console.log('\n▶ ★ 旁系 2 代 / 3 代：用户抓出来的正是这一档');
{
  // 祖 → A、B 是兄弟；A → BRO；B → NC → NP → NN
  // ⇒ A 与 NC 差 1 代（侄）、NP 差 2 代（侄孙）、NN 差 3 代（侄曾孙）
  const p = [
    { from: 'T2', to: 'UA', type: '父子' }, { from: 'T2', to: 'UB', type: '父子' },
    { from: 'UA', to: 'BRO', type: '父子' },
    { from: 'UB', to: 'NC', type: '父子' }, { from: 'NC', to: 'NP', type: '父子' },
    { from: 'NP', to: 'NN', type: '父子' },
  ];
  const cs = [
    { id: 'T2', gender: 'm' },
    { id: 'UA', gender: 'm', birthRank: 2 }, { id: 'UB', gender: 'm', birthRank: 1 },  // UA 是弟弟 ⇒ 叔
    { id: 'BRO', gender: 'm' }, { id: 'NC', gender: 'm' }, { id: 'NP', gender: 'm' },
    { id: 'NN', gender: 'm' },
  ];
  const tt = buildTree(p, cs);

  const k1 = computeKin(tt, 'UA', 'NC');
  ok(k1.gap === 1 && k1.youngerWord === '侄', 'UA 与侄子 NC 差 1 代 ⇒ 侄', t(k1));
  ok(k1.elderWord === '叔父', '差 1 代长辈侧是「叔父」，没有「祖」字', k1.elderWord);

  const k2 = computeKin(tt, 'UA', 'NP');
  ok(k2.kind === 'collateral' && k2.gap === 2, 'UA 与侄孙 NP 差 2 代 ⇒ 旁系', t(k2));
  ok(k2.youngerWord === '侄孙', 'NP 是 UA 的侄孙', k2.youngerWord);
  ok(k2.elderWord === '叔祖父', 'UA 是 NP 的叔祖父', k2.elderWord);
  ok(!/祖叔|祖姑|祖舅|祖姨/.test(k2.term), '中文词序：叔祖父（不是「祖叔」）', k2.term);
  ok(kinGenerationOf(k2.term) === 2, '从文字读出代差 = 2', k2.term);
  ok(!/伯父与侄/.test(k2.term), '绝不写成差一代的「伯父与侄」', k2.term);

  const k3 = computeKin(tt, 'UA', 'NN');
  ok(k3.gap === 3 && k3.youngerWord === '侄曾孙', 'NN 是 UA 的侄曾孙', t(k3));
  ok(k3.elderWord === '曾叔祖父', 'UA 是 NN 的曾叔祖父', k3.elderWord);
}

console.log('\n▶ ★ 叔侄 vs 舅甥：判据是与 elder 同辈的那个人的性别');
{
  /* 《百年孤独》的真实结构（用户报错的那几条）：
   *   何塞·阿尔卡蒂奥·布恩迪亚 → 何塞·阿尔卡蒂奥（第二代）[= BRO]
   *   何塞·阿尔卡蒂奥·布恩迪亚 → 奥雷里亚诺·布恩迪亚上校[= COL]    ⇒ 兄弟俩
   *   BRO × 庇拉尔·特尔内拉 → 阿尔卡蒂奥[= SON] → 奥雷里亚诺第二[= GS]
   *
   *   与 COL 同辈的那一层是 BRO（男性）⇒ 走**叔侄**一侧：
   *     COL — 阿尔卡蒂奥   差 1 代 ⇒ 叔侄（叔与侄）        ← 数据里本来就写对了
   *     COL — 奥雷里亚诺第二 差 2 代 ⇒ 叔侄（叔祖父与侄孙）  ← 数据写成了「叔侄」，差一代 ★
   *
   * 换成母系就是舅甥：祖 → 姐（女性）→ 外甥 ⇒ 祖与外甥差 1 代，祖是姨母，走舅甥一侧。 */
  const p = [
    { from: 'GP', to: 'COL', type: '父子' }, { from: 'GP', to: 'BRO', type: '父子' },
    { from: 'BRO', to: 'SON', type: '父子' }, { from: 'SON', to: 'GS', type: '父子' },
  ];
  const cs = [
    { id: 'GP', gender: 'm' },
    // 原文明说何塞·阿尔卡蒂奥是「哥哥」「长子」，所以上校是**弟弟** ⇒ 叔
    { id: 'COL', gender: 'm', birthRank: 2 }, { id: 'BRO', gender: 'm', birthRank: 1 },
    { id: 'SON', gender: 'm' }, { id: 'GS', gender: 'm' },
  ];
  const tt = buildTree(p, cs);

  const a = computeKin(tt, 'COL', 'SON');
  ok(a.gap === 1 && a.base === '叔侄' && a.youngerWord === '侄',
    'COL 与侄子差 1 代 ⇒ 叔侄（叔与侄）', t(a));

  const b = computeKin(tt, 'COL', 'GS');
  ok(b.gap === 2, 'COL 与侄孙差 2 代', t(b));
  ok(b.elderWord === '叔祖父' && b.youngerWord === '侄孙',
    '★ 差 2 代 ⇒ 叔祖父与侄孙（数据里写成「叔侄」，差一代）',
    { eW: b.elderWord, yW: b.youngerWord });
  ok(!/伯父与侄/.test(b.term), '绝不会写成差一代的「伯父与侄」', b.term);

  // 母系对照组：祖母 → 母亲 → 女儿 ⇒ 祖母与外孙女差 2 代，是**直系**不是旁系
  const t2 = buildTree([
    { from: 'T2', to: 'MOM', type: '母子' }, { from: 'MOM', to: 'DAU', type: '母女' },
  ], [{ id: 'T2', gender: 'f' }, { id: 'MOM', gender: 'f' }, { id: 'DAU', gender: 'f' }]);
  const c = computeKin(t2, 'T2', 'DAU');
  ok(c.kind === 'direct' && c.gap === 2 && c.term === '祖孙',
    '母系直系：祖母与孙女 ⇒ 祖孙（不套用旁系的甥）', t(c));
}

console.log('\n▶ 姑母一侧（姑姑的**孙辈**，不是她自己的孙子）');
{
  /* ⚠ 上一版这里我把 G 和 Z 写成祖孙关系（G→Y→Z）却期望「姑母」，
   *   等于要求算法把直系当成旁系。G **就是** Z 的祖母，正确答案是「祖孙」。
   *   真正的姑母必须是**祖先的姐妹**：G 是 Z 父亲 Y 的姑母（G 与 Y 的父亲 Y2 同胞）。
   *
   *   谱：T2 → Y2、Y2 → Y（子）；T2 → G（女）⇒ G 与 Y2 同胞 ⇒ G 是 Y 的姑姑、
   *        Y → Z ⇒ G 是 Z 的**姑祖母**，Z 叫 G 的**侄孙**（从 Y 算起第 2 代）。 */
  const t2 = buildTree([
    { from: 'T2', to: 'Y2', type: '父子' }, { from: 'Y2', to: 'Y', type: '父子' },
    { from: 'T2', to: 'G', type: '父女' },
    { from: 'Y', to: 'Z', type: '父子' },
  ], [{ id: 'T2', gender: 'm' }, { id: 'Y2', gender: 'm' }, { id: 'Y', gender: 'm' },
      { id: 'G', gender: 'f' }, { id: 'Z', gender: 'm' }]);
  const r = computeKin(t2, 'G', 'Z');
  ok(r.kind === 'collateral' && r.gap === 2, 'G 与 Z 差 2 代 ⇒ 旁系', t(r));
  ok(r.elderWord === '姑祖母' && r.youngerWord === '侄孙',
    '姑姑的孙子辈 ⇒ 姑祖母与侄孙（女性长辈用「祖母」不用「祖父」）',
    { eW: r.elderWord, yW: r.youngerWord });
  ok(!/姨|舅/.test(r.elderWord), '走姑母一侧，不误判成姨母/舅父', r.elderWord);
  // 对照：G 确实是 Z 的祖母（不是旁系）
  ok(computeKin(t2, 'Y', 'Z').term === '父子', '对照：Y → Z 是父子', computeKin(t2, 'Y', 'Z'));
}

console.log('\n▶ 堂 / 表');
{
  const c1d1 = K('C1', 'D1');          // 父 C、D 是兄弟 ⇒ C1 与 D1 是堂兄弟
  ok(c1d1.kind === 'sibling', 'C1 与 D1 同辈', c1d1.kind);
  ok(/堂/.test(c1d1.term), '共同父母为 0、祖父相同 ⇒ 堂兄弟', c1d1.term);
  ok(c1d1.siblingKind === 'none', 'siblingKind=none 表示靠祖父层判的堂/表', c1d1.siblingKind);
  // ⚠ A 是 D1 的**祖父**（D1 的父是 D，D 的父是 A）⇒ 直系祖孙，不是堂系
  const aD1 = K('A', 'D1');
  ok(aD1.kind === 'direct' && aD1.term === '祖孙',
    'A 是 D1 的祖父（直系祖孙）—— 上一版误期望「堂」，那要求算法把直系当旁系', t(aD1));
}

console.log('\n▶ 族谱断裂时不许硬凑');
{
  const tt = buildTree([{ from: 'X', to: 'Y', type: '父子' }], [{ id: 'X', gender: 'm' }, { id: 'Y', gender: 'm' }]);
  const r = computeKin(tt, 'X', 'Z');
  ok(r.kind === 'unrelated', '无共同祖先 ⇒ unrelated', r);
  ok(r.term === '', 'unrelated 不给称谓（不许编）', r.term);
}

console.log('\n▶ ancestorAtDepth');
{
  ok(ancestorAtDepth(tree, 'C', 0) === 'C', 'depth 0 是自己');
  ok(ancestorAtDepth(tree, 'C', 1) === 'A', 'C 的父亲是 A');
  ok(ancestorAtDepth(tree, 'C', 2) === 'GP', 'C 的祖父是 GP');
  ok(ancestorAtDepth(tree, 'C', 9) === null, '走不到就 null，不瞎猜');
}

console.log('\n▶ ★ 辈分后缀的接法：加辈分时「女」插到辈分词**前面**');
{
  // 叔 → 侄孙 / 侄孙女；叔祖父 → 侄曾孙 / 侄曾孙女
  const mk = (depth) => {
    const p = [{ from: 'T2', to: 'U', type: '父子' }, { from: 'T2', to: 'B', type: '父子' }];
    const cs = [{ id: 'T2', gender: 'm' }, { id: 'U', gender: 'm' }, { id: 'B', gender: 'm' }];
    let cur = 'B';
    let name = 'n0';
    for (let i = 1; i <= depth; i++) {
      const id = 'x' + i;
      p.push({ from: cur, to: id, type: i % 2 ? '父子' : '父女' });
      cs.push({ id, gender: i % 2 ? 'm' : 'f' });
      cur = id; name = id;
    }
    return { t: buildTree(p, cs), last: name };
  };
  const one = mk(1), two = mk(2);
  const k1 = computeKin(one.t, 'U', one.last);
  const k2 = computeKin(two.t, 'U', two.last);   // ⚠ 用 two.t：x2 只挂在两代那条谱上
  // x1 是男性（侄），x2 是女性（侄孙女）
  ok(k1.gap === 1 && k1.youngerWord === '侄', '差 1 代不加辈分 ⇒ 「侄」', k1.youngerWord);
  ok(k2.gap === 2 && k2.youngerWord === '侄孙女',
    '★ 差 2 代且女性 ⇒ 「侄孙女」（女在辈分词前面，不是侄女孙）',
    { gap: k2.gap, yW: k2.youngerWord, term: k2.term });
  ok(!/侄女孙|孙侄女/.test(k2.term), '不会产出「侄女孙」这种不存在的词', k2.term);
}

console.log('\n▶ ★ 直系第 4 代起：上行与下行的字分岔，不能再压缩成一个词');
{
  // 造一条直链：T0 → T1 → T2 → T3 → T4 → T5
  const rel = [];
  const cs = [];
  for (let i = 0; i <= 5; i++) cs.push({ id: `T${i}`, gender: i % 2 ? 'f' : 'm' });
  for (let i = 1; i <= 5; i++) rel.push({ from: `T${i - 1}`, to: `T${i}`, type: i % 2 ? '父子' : '父女' });
  const tt = buildTree(rel, cs);

  ok(computeKin(tt, 'T0', 'T2').term === '祖孙', '差 2 代 ⇒ 祖孙（汉语现成的压缩词）', computeKin(tt, 'T0', 'T2').term);
  ok(computeKin(tt, 'T0', 'T3').term === '曾祖孙', '差 3 代 ⇒ 曾祖孙（也是现成词）', computeKin(tt, 'T0', 'T3').term);
  // 谱：T0(m) → T1(f) → T2(m) → T3(f) → T4(m) → T5(f)
  ok(computeKin(tt, 'T0', 'T4').term === '高祖父与玄孙',
    '★ 差 4 代且都是男性 ⇒「高祖父与玄孙」（上行高祖、下行玄孙，不能拼成「高祖孙」）',
    computeKin(tt, 'T0', 'T4').term);
  ok(computeKin(tt, 'T1', 'T4').term === '曾祖孙',
    '差 3 代仍走压缩写法「曾祖孙」（汉语现成词，不必两边点明）',
    computeKin(tt, 'T1', 'T4').term);
  ok(computeKin(tt, 'T1', 'T5').term === '高祖母与玄孙女',
    '★ 差 4 代、长辈女性、晚辈女性 ⇒「高祖母与玄孙女」',
    computeKin(tt, 'T1', 'T5').term);

  const k4 = computeKin(tt, 'T0', 'T4');
  ok(!/高祖孙|祖孙女|孙孙/.test(k4.term), '绝不产出「高祖孙」这种不存在的词', k4.term);

  // 上行第 5 级 = 天祖，下行第 5 级 = 来孙
  const T6 = { id: 'T6', gender: 'm' };
  const t2 = buildTree([...rel, { from: 'T5', to: 'T6', type: '父子' }], [...cs, T6]);
  ok(computeKin(t2, 'T0', 'T5').term === '天祖父与来孙女',
    '★ 差 5 代 ⇒ 上行天祖、下行来孙（两套字各走各的）', computeKin(t2, 'T0', 'T5').term);
  ok(computeKin(t2, 'T0', 'T6').term === '烈祖父与晜孙',
    '差 6 代 ⇒ 上行烈祖、下行晜孙', computeKin(t2, 'T0', 'T6').term);
}

console.log('\n▶ ★ 伯 / 叔 按长幼区分（用户 2026-10-05：「叔就是叔，伯就是伯」）');
{
  /* 祖Z → 长子UA、次子UB、长女UC
   *   UA 生 PA，UB 生 PB，UC 生 PC。
   *   ⚠ 伯父/叔父是「伯 与 侄」的关系 —— 伯是**侄的父亲的兄弟**，
   *     所以要比的是 (UA, PB) 这种跨兄弟的组合，不是 (UA, PA) 那种父子。
   *     我第一版就写成了父子对，computeKin 返回 direct、elderWord 是 undefined。
   *
   *   UA（哥哥）与 UB 的儿子 PB ⇒ 伯父与侄
   *   UB（弟弟）与 UA 的儿子 PA ⇒ 叔父与侄
   *   UC（姑姑）与 UA 的儿子 PA ⇒ 姑母与侄（女性长辈不分长幼）
   *   排行不详的 UR 与兄弟的儿子 ⇒ 只能写「伯叔」 */
  const rel = [
    { from: 'Z', to: 'UA', type: '父子' }, { from: 'Z', to: 'UB', type: '父子' },
    { from: 'Z', to: 'UC', type: '父女' }, { from: 'Z', to: 'UR', type: '父子' },
    { from: 'Z', to: 'US', type: '父子' },
    { from: 'UA', to: 'PA', type: '父子' }, { from: 'UB', to: 'PB', type: '父子' },
    { from: 'UC', to: 'PC', type: '父女' }, { from: 'UR', to: 'PU', type: '父子' },
    { from: 'US', to: 'PW', type: '父子' },
  ];
  const cs = [
    { id: 'Z', gender: 'm' },
    { id: 'UA', gender: 'm', birthRank: 1 }, { id: 'UB', gender: 'm', birthRank: 2 },
    { id: 'UC', gender: 'f', birthRank: 3 },
    { id: 'UR', gender: 'm' }, { id: 'US', gender: 'm' },   // 这两个没写 birthRank
    { id: 'PA', gender: 'm' }, { id: 'PB', gender: 'm' }, { id: 'PC', gender: 'm' },
    { id: 'PU', gender: 'm' }, { id: 'PW', gender: 'm' },
  ];
  const tt = buildTree(rel, cs);

  const a = computeKin(tt, 'UA', 'PB');     // UA 是哥哥 ⇒ 伯父
  ok(a.elderWord === '伯父' && a.base === '叔侄',
    '排行靠前者是哥哥 ⇒ 伯父（不是叔父）', { eW: a.elderWord, base: a.base });
  const b = computeKin(tt, 'UB', 'PA');     // UB 是弟弟 ⇒ 叔父
  ok(b.elderWord === '叔父', '排行靠后者是弟弟 ⇒ 叔父', b.elderWord);
  ok(a.elderWord !== b.elderWord, '同一辈人里的伯与叔必须能分出来');

  const c = computeKin(tt, 'UC', 'PA');
  ok(c.elderWord === '姑母',
    '女性长辈不分长幼 ⇒ 姑母（不写「姑伯母」这种怪词）', c.elderWord);

  const d = computeKin(tt, 'UR', 'PW');
  ok(d.orderUnknown === true && /伯叔/.test(d.base),
    '★ 排行不详 ⇒ 主词写「伯叔侄」，不擅自替他判长幼', { base: d.base, unk: d.orderUnknown });
  ok(!/^叔侄（/.test(d.term), '不会在排行不详时直接断言是叔', d.term);

  ok(computeKin(tt, 'PB', 'UA').elderWord === '伯父', '对称：反着传仍是伯父',
    computeKin(tt, 'PB', 'UA').elderWord);

  // 差两代时伯/叔升一级：伯→伯祖父、叔→叔祖父
  const rel2 = [...rel, { from: 'PA', to: 'GA', type: '父子' }, { from: 'PB', to: 'GB', type: '父子' }];
  const tt2 = buildTree(rel2, [...cs, { id: 'GA', gender: 'm' }, { id: 'GB', gender: 'm' }]);
  const e = computeKin(tt2, 'UA', 'GB');
  const f = computeKin(tt2, 'UB', 'GA');
  ok(e.elderWord === '伯祖父' && f.elderWord === '叔祖父',
    '★ 差 2 代升级：伯→伯祖父、叔→叔祖父', { ben: e.elderWord, shu: f.elderWord });
}

/* ============================================================
 * 养亲（v0.111，用户裁定走 (b)：仍算进族谱，但称谓加「养」字）
 *
 * 起因：`夏侯惇 —养父子— 夏侯楙`（原文明写「自幼嗣与夏侯惇为子」）
 * 接进族谱后 夏侯渊 → 夏侯楙 → 夏侯惇 成立，
 * computeKin 判「夏侯渊是夏侯惇的祖父」—— 而原文说这两位是族兄弟。
 *
 * 谱：
 *   XBF ── AP ── AD            AD 是 XBF 亲生的孙子
 *   AP ── AD2（养）            AP 收养了 AD2（无血缘）
 */
{
  const ac = [
    { id: 'XBF', gender: 'm' }, { id: 'AP', gender: 'm' },
    { id: 'AD', gender: 'm' }, { id: 'AD2', gender: 'm' },
  ];
  const ar = [
    { from: 'XBF', to: 'AP', type: '父子' },
    { from: 'AP', to: 'AD', type: '父子' },
    { from: 'AP', to: 'AD2', type: '养父子' },   // ← 唯一的养亲边
  ];
  const at = buildTree(ar, ac);

  const bio = computeKin(at, 'AP', 'AD');
  ok(bio.term === '父子' && !bio.adoptive,
    '养亲实现：亲生父子不受影响，仍是「父子」', { term: bio.term, adoptive: bio.adoptive });

  const adopted = computeKin(at, 'AP', 'AD2');
  ok(adopted.term === '养父子' && adopted.adoptive === true,
    '养亲实现：养父子 ⇒「养父子」且标 adoptive', { term: adopted.term, adoptive: adopted.adoptive });

  const grand = computeKin(at, 'XBF', 'AD2');
  ok(grand.term === '养祖孙', '养亲实现：隔代的养关系 ⇒「养祖孙」（不是祖孙）', { term: grand.term });

  const cousin = computeKin(at, 'AD', 'AD2');
  /* ⚠ 不能只测「含养字」——「养同父异母的兄弟」也含养字，照样过，
   *   而那正是要防的畸形词（收养没有血亲路径，不该带「同父异母」）。
   *   所以这里钉**恰好等于**「养兄弟」。 */
  ok(cousin.adoptive === true && cousin.term === '养兄弟',
    '养亲实现：养兄弟 ⇒ 恰好是「养兄弟」，不带「同父异母」', { term: cousin.term, adoptive: cousin.adoptive });

  /* 关键反例：血亲路径与养亲路径**并存**时，必须判血亲。
   * AD2 同时有 AP 的养父和 XBF 的血亲曾祖父 ⇒ XBF→AP→AD2 里
   * XBF→AP 是亲生、AP→AD2 是养的，路径上确实含养亲；
   * 但只要存在一条全血亲路径就不该标养。 */
  const mixed = [
    ...ar,
    { from: 'AP2', to: 'AD2', type: '父子' }, { from: 'XBF', to: 'AP2', type: '父子' },
  ];
  const ac2 = [...ac, { id: 'AP2', gender: 'm' }];
  const mt = buildTree(mixed, ac2);
  const m = computeKin(mt, 'AP2', 'AD2');
  ok(m.term === '父子' && !m.adoptive,
    '养亲实现：血亲与养亲路径并存时判血亲，不误标「养」', { term: m.term, adoptive: m.adoptive });
}

console.log(`\n${'='.repeat(40)}`);
console.log(`亲属称谓计算　通过：${pass}  失败：${fail}`);
process.exit(fail > 0 ? 1 : 0);