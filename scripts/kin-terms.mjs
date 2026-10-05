/**
 * 亲属称谓计算 —— 从族谱（亲子边）算出两个人到底是什么关系。
 *
 * 为什么要有这个模块（v0.98，用户抓出来的）：
 *   原来的称谓是**手打的字符串**。用户报《百年孤独》有一条
 *     「奥雷里亚诺·布恩迪亚上校 —叔侄（伯父与侄）— 奥雷里亚诺第二」
 *   说"第二代和第四代怎么可能只是叔侄？算是祖叔侄了吧"。
 *   查下来**同类错误有 3 条，全都差一代**，而且那 3 条 `events` 为 0 ——
 *   纯推断、连原文依据都没有。唯一正确的那条（上校—叔侄—阿尔卡蒂奥）有第 6 章引文。
 *
 *   更要命的是它们**互相掩护**：derive-kin.mjs 开头有一条
 *   「已有直接关系的两个人不再推导」⇒ 手打的错标签把推导系统挡住了，
 *   错的不但没被改对，还顺带让正确的推导边也不生成。
 *
 * 所以把称谓做成**纯函数**：喂进族谱，吐出称谓 + 可校验的结构化 detail。
 * 手打的标签可以被 check-kin-terms.mjs 拿来对质。
 *
 * ⚠ 事实来源是「关系表里的亲子边」，不是 `parents` 字段
 *   （《百年孤独》56 人里只填了 1 人，不能当依据）。
 *
 * ⚠ **不判长幼**：数据里没有出生顺序，所以男性长辈一律写「叔」不写「伯」——
 *   原来手打的「伯父」本身就是无法核实的猜测（而《百年孤独》里上校其实是双胞胎中的**弟弟**，
 *   真按长幼该写「叔父」）。要判长幼得先有 `birthOrder` 字段。
 */
const PARENT_CHILD = /^(亲生)?(父|母)(子|女)$|^养(父|母)(子|女)$/;

/** 一条关系算不算「亲子边」（父子/母子/父女/母女/养父子…），带括号说明也认。 */
export const isParentChild = (r) =>
  PARENT_CHILD.test(String(r?.type || '').replace(/[（(].*$/, '').trim());

/**
 * 从关系表建族谱。
 * @param {Array} relations book.relations
 * @param {Array} chars     book.characters（取性别）
 */
export function buildTree(relations, chars) {
  const gender = new Map(chars.map((c) => [c.id, c.gender === 'f' ? 'f' : 'm']));
  /**
   * birthRank：同一批兄弟姐妹里的排行（1 = 长子/长女）。
   *
   * ⚠ 没有它就分不出**伯**与**叔** —— 中文里「父亲的哥哥」叫伯父、
   *   「父亲的弟弟」叫叔父，这是硬性区别，不是同义词。
   *   用户 2026-10-05 明确要求：「叔就是叔，伯就是伯，不要用西方那一套
   *   不加以区分的称呼」。
   *
   *   数据里没有排行时**不能瞎猜**，称谓写成「伯叔」（汉语里「伯叔兄弟」
   *   本就是父亲兄弟的合称），并把 orderUnknown 标出来。
   *
   *   来源只能是原文：像《百年孤独》里原文明说「他的哥哥何塞·阿尔卡蒂奥」
   *   「大儿子何塞·阿尔卡蒂奥」⇒ 上校是弟弟 ⇒ 叔。
   */
  const birthRank = new Map();
  for (const c of chars) {
    if (typeof c.birthRank === 'number') birthRank.set(c.id, c.birthRank);
  }
  const parents = new Map();   // child -> [parentId]
  const children = new Map();  // parent -> [childId]
  for (const r of relations) {
    if (!r || !isParentChild(r)) continue;
    if (!gender.has(r.from) || !gender.has(r.to)) continue;
    push(parents, r.to, r.from);
    push(children, r.from, r.to);
  }
  return { gender, birthRank, parents, children };
}

/**
 * elder 与 q 是同胞的话，elder 是「伯」还是「叔」？
 * @returns {'伯'|'叔'|'伯叔'}  「伯叔」＝排行不详，不硬猜
 */
export function elderSurnameOrder(tree, elder, q) {
  const a = tree.birthRank.get(elder), b = tree.birthRank.get(q);
  if (typeof a !== 'number' || typeof b !== 'number' || a === b) return '伯叔';
  return a < b ? '伯' : '叔';
}
function push(map, key, val) {
  if (!map.has(key)) map.set(key, []);
  if (!map.get(key).includes(val)) map.get(key).push(val);
}

/** 从 x 往上/往下走 d 层，返回 Map(id -> 层数)。 */
function walk(tree, x, d, dir) {
  const m = new Map([[x, 0]]);
  const next = dir === 'up' ? tree.parents : tree.children;
  let frontier = [x];
  for (let i = 1; i <= d; i++) {
    const nf = [];
    for (const y of frontier) for (const z of next.get(y) ?? []) if (!m.has(z)) { m.set(z, i); nf.push(z); }
    if (!nf.length) break;
    frontier = nf;
  }
  return m;
}

/** x 的第 d 代祖先（d=0 是 x 自己）；走不到返回 null。 */
export function ancestorAtDepth(tree, x, d) {
  if (d === 0) return x;
  for (const [id, depth] of walk(tree, x, d, 'up')) if (depth === d) return id;
  return null;
}

/**
 * 在 x 的第 d 代祖先里，挑出**与 elder 有血缘**的那一个。
 *
 * ⚠ 这一步不能省：一个人有**两个**父母时，第 d 层上有好几个候选，
 *   而「叔侄还是舅甥」完全取决于走了哪一侧。
 *   《百年孤独》的实测：上校 与 阿尔卡蒂奥 差 1 代、共同祖先是何塞·阿尔卡蒂奥·布恩迪亚，
 *   阿尔卡蒂奥这一层有两个人 —— 父亲「何塞·阿尔卡蒂奥（第二代）」（上校的**兄弟**）
 *   与母亲「庇拉尔·特尔内拉」（上校的**嫂子**）。
 *     走父亲 ⇒ 叔侄（上校是他父亲的兄弟）        ← 正确
 *     走母亲 ⇒ 舅甥（上校是他母亲的兄弟）
 *   随便取第一个就会在两者之间摇摆（第一版正是这样，报告里把「叔侄」判成了「舅甥」）。
 *
 * 判据：优先选**同胞**（共同父母 ≥1）；没有同胞就选与 elder 共同祖先最多的那个。
 */
export function pickConnectingAncestor(tree, younger, depth, elder) {
  const cands = [...walk(tree, younger, depth, 'up').entries()].filter(([, d]) => d === depth).map(([id]) => id);
  if (cands.length <= 1) return cands[0] ?? null;
  const elderAnc = walk(tree, elder, 12, 'up');
  const scored = cands.map((id) => {
    // id 与 elder 的共同父母数（≥1 ⇒ 同胞，优先选它）
    const sib = (tree.parents.get(id) ?? []).filter((p) => (tree.parents.get(elder) ?? []).includes(p)).length;
    // 与 elder 的共同祖先数（越多越可能是"同一支"）
    let common = 0;
    for (const [a, d] of walk(tree, id, 12, 'up')) if (elderAnc.has(a) && elderAnc.get(a) === d) common++;
    return { id, sib, common };
  });
  scored.sort((x, y) => (y.sib - x.sib) || (y.common - x.common));
  return scored[0].id;
}

/** 最近共同祖先：返回祖先 id 与两侧层数（层数 = 该人与祖先隔了几代）。 */
export function findLca(tree, aId, bId) {
  const MAX = 12;
  const A = walk(tree, aId, MAX, 'up');
  const B = walk(tree, bId, MAX, 'up');
  let best = null;
  for (const [x, da] of A) {
    if (!B.has(x)) continue;
    const db = B.get(x);
    const score = da + db;
    // 平手时取离两人更近的那个（da 小），这样直系不会被旁系祖先抢走
    if (!best || score < best.score || (score === best.score && da < best.da)) best = { ancestor: x, da, db, score };
  }
  return best;
}

/**
 * ★ 中文亲属称谓的「上行 / 下行」两套字，第 4 代起分岔 ★
 *
 * 《尔雅·释亲》《仪礼·丧服》的传统序列，每往上一级换一个字：
 *
 *   往上第几代 │ 上行（尊称）  │ 下行（卑称）
 *   ────────────┼──────────────┼──────────────
 *       1       │ 父／母        │ ——
 *       2       │ 祖父／祖母    │ 孙／孙女
 *       3       │ 曾祖父／曾祖母│ 曾孙／曾孙女
 *       4       │ 高祖父／高祖母│ 玄孙／玄孙女   ← 从这里开始两边字不一样
 *       5       │ 天祖父／天祖母│ 来孙／来孙女
 *       6       │ 烈祖／烈祖母  │ 晜孙
 *       7       │ 太祖／太祖    │ 仍孙
 *       8+      │ 远祖          │ 云孙／耳孙
 *
 * ⚠ 所以「高祖孙」这种写法**中文里不存在**：
 *   第 4 代要写成「高祖父与玄孙」。压缩写法只在 祖孙 / 曾祖孙 这两档成立
 *   （这两个词本身就是汉语现成的），从高祖起必须两边都点明。
 *
 * 「高祖」在书面递推里也叫「曾曾祖」（族谱、移民传说里能看到），
 * 口语则改说「太爷爷／太公」，且各地指代不同 —— 详见 CHANGELOG v0.99。
 */
const ZU = ['', '祖', '曾祖', '高祖', '天祖', '烈祖'];        // 上行，下标 = gap−1
const SUN_DOWN = ['', '孙', '曾孙', '玄孙', '来孙', '晜孙'];  // 直系下行，下标 = gap

/**
 * 旁系晚辈侧的辈分后缀，下标 = gen = gap−1（差 1 代不加，差 2 代加「孙」）。
 * ⚠ 旁系下行**没有自己的序列** —— 「侄孙 / 侄曾孙 / 侄玄孙」都是「侄/甥」+ 直系下行字。
 *   所以这里存的是"去掉『侄』字那部分的后缀"，由调用处接在「侄/甥」后面。
 *   两边的词序不同：长辈的辈分在**词中间**（叔**祖父**），晚辈的在**词尾**（侄**孙**）。
 *   第一版两边共用一张表且下标搞混，产出「祖叔」「孙侄」这种读不通的词。
 */
const SUN = ['', '孙', '曾孙', '玄孙', '来孙'];

/** elder 与 q 是同胞还是堂/表（用于「堂叔」「表叔」那层意思）。 */
function cousinMark(tree, elder, q) {
  // 同辈 ⇒ 比较祖父层：祖父有共同 ⇒ 堂，否则表
  const ge = walk(tree, elder, 2, 'up');
  const gq = walk(tree, q, 2, 'up');
  for (const [x, d] of ge) if (d === 2 && gq.get(x) === 2) return '堂';
  // 没有共同祖父但有共同曾祖的，堂/表之争在中文里已很边缘，统称表
  return '表';
}

/**
 * 算两个人是什么关系。
 * @returns {null|{kind, elder, elderGen, youngerGen, term, ...}}
 *   kind: self | direct | sibling | collateral | cousin | unrelated
 */
export function computeKin(tree, aId, bId) {
  if (aId === bId) return { kind: 'self', elder: aId, elderGen: 0, youngerGen: 0, term: '本人' };
  const f = findLca(tree, aId, bId);
  if (!f) return { kind: 'unrelated', elder: aId, elderGen: -1, youngerGen: -1, term: '' };

  const elderGen = Math.min(f.da, f.db);
  const youngerGen = Math.max(f.da, f.db);
  const elder = f.da <= f.db ? aId : bId;
  const younger = elder === aId ? bId : aId;
  const mE = tree.gender.get(elder) === 'm';
  const mY = tree.gender.get(younger) === 'm';
  const gap = youngerGen - elderGen;

  /* 直系：elder 自己就是共同祖先。
   * 差 1 代 ⇒ 父子/母子；差 2 代 ⇒ 祖孙；差 3 代 ⇒ 曾祖孙；
   * ⚠ **第 4 代起上、下两行的字分岔了，不能再压缩成一个词**：
   *     上行 父→祖父→曾祖父→高祖父→天祖父→烈祖
   *     下行 ——→孙  →曾孙  →玄孙  →来孙  →晜孙
   *   所以第 4 代是「高祖父与玄孙」、第 5 代是「天祖父与来孙」，
   *   绝不能拼出「高祖孙」这种中文里不存在的词。
   *   第一版就是 ZU[gap-1] + '孙' ⇒ 第 4 代输出「高祖孙」。 */
  if (elderGen === 0) {
    let term;
    if (gap === 1) {
      term = `${mE ? '父' : '母'}${mY ? '子' : '女'}`;
    } else if (gap <= 3) {
      // 「祖孙」「曾祖孙」是汉语里现成的压缩写法，沿用
      term = ZU[Math.min(gap - 1, ZU.length - 1)] + '孙';
    } else {
      const zhu = ZU[Math.min(gap - 1, ZU.length - 1)];   // 祖 / 曾祖 / 高祖 / 天祖 / 烈祖
      const sun = SUN_DOWN[Math.min(gap - 1, SUN_DOWN.length - 1)];   // 孙 / 曾孙 / 玄孙 / 来孙 / 晜孙
      // 「祖」这一档要补上「父/母」才成词：高祖 → 高祖父 / 高祖母
      const elderSide = `${zhu}${mE ? '父' : '母'}`;
      const youngerSide = mY ? sun : sun.replace(/孙$/, '孙女');   // 玄孙 → 玄孙女
      term = `${elderSide}与${youngerSide}`;
    }
    return { kind: 'direct', elder, younger, elderGen, youngerGen, gap, lca: f.ancestor, term };
  }

  /* 同辈：两人在共同祖先的同一层 */
  if (gap === 0) {
    const pa = tree.parents.get(aId) ?? [];
    const pb = tree.parents.get(bId) ?? [];
    const shared = pa.filter((x) => pb.includes(x));
    let term;
    /* ⚠ 性别组合有四种，不是两种。
     *   第一版写成 `mE === mY ? '兄弟' : '姐妹'` —— 两人都是女性时 mE===mY 同样成立，
     *   于是「梅梅—阿玛兰妲·乌尔苏拉」「丽贝卡—阿玛兰妲」全被判成「兄弟」。
     *   对质器一眼就看出来：同一份数据里别处写着「姐妹」，这里算出来「兄弟」。 */
    const sibWord = (mE && mY) ? '兄弟' : (!mE && !mY) ? '姐妹' : mE ? '兄妹' : '姐弟';
    if (shared.length >= 2) term = sibWord;
    else if (shared.length === 1) {
      const p = shared[0];
      term = `${tree.gender.get(p) === 'm' ? '同父异母' : '同母异父'}的${sibWord}`;
    } else term = `${cousinMark(tree, aId, bId)}${sibWord}`;   // 数据里不该出现：同辈必有共同父母
    const mark = shared.length >= 2 ? '' : shared.length === 1 ? '半血' : cousinMark(tree, aId, bId);
    return { kind: 'sibling', elder, younger, elderGen, youngerGen, gap, lca: f.ancestor,
      siblingKind: shared.length >= 2 ? 'full' : shared.length === 1 ? 'half' : 'none',
      mark, term };
  }

  /* 旁系：elder 在上，younger 在下，中间隔 gap 代。
     q = younger 一侧在 elderGen 层上的那个人（= younger 的第 elderGen 代祖先）。
     elder 与 q 同辈：elderGen===1 ⇒ 同胞；>=2 ⇒ 堂/表同辈。 */
  /* q = younger 一侧、与 elder **同辈**的那个人（elder 的同胞）。
   * ⚠ 下标不是 elderGen，而是 youngerGen − elderGen。
   *   youngerGen 是 younger 到 LCA 的距离，elderGen 是 elder 到 LCA 的距离；
   *   想找"与 elder 同辈"的那个节点，要从 younger 往上走 youngerGen−elderGen 步。
   *   写成 elderGen 就会取到 younger 的父母那一层（实测把「叔祖父」判成了「舅外祖父」）。 */
  const q = pickConnectingAncestor(tree, younger, youngerGen - elderGen, elder);
  if (!q) return { kind: 'unrelated', elder, younger, elderGen, youngerGen, gap, term: '' };

  /* 「堂／表」只在 elder 与 q **同辈**时才谈得上（elderGen===1 ⇒ q 是 elder 的同胞）。
   * elderGen≥2 时 elder 与 q 差着一代，拿祖父层去比会得到"没有共同祖父"，
   * 于是给一个本该是"亲叔侄"的关系加上「表」字 —— 实测 A 与孙辈就被判成「表叔…」。
   * 正确做法：elderGen===1 看同胞关系（earlier 的 mark），elderGen≥2 一律不加字。 */
  const mark = elderGen === 1 ? '' : '';
  /* link = **younger 本人**在这一侧的父亲（younger 的第 1 代祖先里挑与 elder 有血缘的那个）。
   * 晚辈是「侄」还是「甥」看的是**连接那位父亲**的性别，不是随便哪一层。
   *
   * ⚠ 踩过的坑：写成 ancestorAtDepth(younger, youngerGen−1) ⇒ 差 1 代时取到 q 自己
   *   （younger 的父母层），差 2 代时又往上跳一层。
   *   《百年孤独》实测「上校—阿尔卡蒂奥」：q = 何塞·阿尔卡蒂奥（第二代）（父亲），
   *   于是判成「叔侄（叔与**甥**）」—— 主词叫叔侄却管人叫甥。
   *   正确：younger 的**父亲**是男性 ⇒ 叫「侄」。 */
  const link = pickConnectingAncestor(tree, younger, 1, elder);
  const mLink = link ? tree.gender.get(link) === 'm' : true;

  /* 代差下标 = gap−1：差 1 代是「叔侄」本身，差 2 代才升级成「叔祖父／侄孙」。
   * elderCore 已按 gen 索引好，不再额外加前缀。 */
  const gen = Math.max(0, gap - 1);
  const youngerWord = mLink ? (mY ? '侄' : '侄女') : (mY ? '甥' : '甥女');
  /* ⚠ 中文辈分后缀的接法按性别不同：
   *     不加辈分（差 1 代）：侄 / 侄女 / 甥 / 甥女        —— 「女」跟在后面
   *     加辈分（差 2 代起）：侄孙 / 侄**孙女** / 甥孙 / 甥**孙女**
   *     一旦有辈分词，「女」就**插到辈分词前面**（侄孙女，不是侄女孙，也不是孙侄女）。
   *   所以不能一律 replace(/女$/,'')，也不能一律拼在后面 —— gen 决定接法。 */
  const genWord = SUN[Math.min(gen, SUN.length - 1)];
  /* 差 1 代不加辈分词：「侄」「侄女」「甥」「甥女」——「女」跟在后面。
   * 差 2 代起有辈分词，「女」要**插到辈分词前面**：侄孙 / 侄**孙女**、甥孙 / 甥**孙女**。
   * 一律拼在后面会造出「侄女孙」这种不存在的词（第一版就是这么错的）。 */
  const youngerFull = gen === 0 || mY
    ? youngerWord + genWord          // 男性：侄 + 孙 / 侄 + 曾孙
    : youngerWord.replace(/女$/, '') + genWord[0] + '女' + genWord.slice(1);   // 女性：侄女 + 孙 ⇒ 侄孙女

  /* 「叔 / 姑 / 舅 / 姨」这四个词判的是 **elder 与 q 的关系**（q = 与 elder 同辈的那个人）：
   *      q 是男性 ⇒ elder 是他的兄弟 ⇒ 叔；elder 是他的姐妹 ⇒ 姑母  ⇒ 主词「叔侄」
   *      q 是女性 ⇒ elder 是她的兄弟 ⇒ 舅父；elder 是她的姐妹 ⇒ 姨母 ⇒ 主词「舅甥」
   * 而晚辈那个「侄 / 甥」判的是 **link**（younger 的直接上一代）：男性 ⇒ 侄，女性 ⇒ 甥。
   *
   * ⚠ 《百年孤独》实测（上校—阿尔卡蒂奥这一对）：
   *     q = 何塞·阿尔卡蒂奥（第二代）（男性，上校的兄弟）⇒ 走叔侄
   *     link = 阿尔卡蒂奥本人（男性）⇒ 叫「侄」
   *     合起来「叔侄（叔与侄）」——与数据里写的一致，**这条本来就没错**。
   *
   * ⚠ 第一版拿 link 去判长辈词，于是同一对被判成「舅甥（舅父与甥）」；
   *   改过来之后又出现「叔侄（叔与甥）」——主词说叔侄却管人叫甥。
   *   两个词各看各的判据（长辈看 q、晚辈看 link），不能混。 */
  const mQ = q ? tree.gender.get(q) === 'm' : mLink;
  /* 长辈侧称谓。
   * ⚠ 中文里「叔 / 伯 / 姑 / 舅 / 姨」不是同义词，是**有长幼之分**的：
   *     父亲的哥哥＝伯父， 父亲的弟弟＝叔父
   *     祖父的哥哥＝伯祖父，祖父的弟弟＝叔祖父
   *   所以男性长辈这一支要按 elder 与 q 的排行分「伯/叔」，不能一律写「叔」。
   *   排行不详时写「伯叔」（汉语里「伯叔兄弟」本就是父亲兄弟的合称），不硬猜。
   *   女性长辈（姑母/姨母）和母系（舅父）本来就不分长幼。 */
  const order = mQ ? elderSurnameOrder(tree, elder, q) : '';
  const orderUnknown = order === '伯叔';
  const zhi = order || '叔';                       // 「伯」或「叔」或「伯叔」
  let elderCore;
  if (mQ && mE) elderCore = [`${zhi}父`, `${zhi}祖父`, `曾${zhi}祖父`, `高祖${zhi}父`];
  else if (mQ) elderCore = ['姑母', '姑祖母', '曾姑祖母', '高祖姑母'];
  else if (mE) elderCore = ['舅父', '舅外祖父', '曾舅外祖父', '高祖舅父'];
  else elderCore = ['姨母', '姨外祖母', '曾姨外祖母', '高祖姨母'];
  /* 主词必须跟着 mQ 走：q 是男性 ⇒ elder 是 q 的兄弟 ⇒ 「叔侄」；
   * q 是女性 ⇒ elder 是 q 的兄弟 ⇒ 「舅甥」。
   * ⚠ 但 elderCore 里的**具体词**也要跟着 link 走，两个不是一回事：
   *     《百年孤独》实测「上校—阿尔卡蒂奥」：q = 何塞·阿尔卡蒂奥（第二代）（男性），
   *     link = 阿尔卡蒂奥本人（男性）⇒ 叔 + 侄 ⇒「叔侄（叔与侄）」。
   *     第一版把长辈词按 link 判、晚辈词也按 link 判，主词却按 q 判，
   *     于是产出过「叔侄（叔与甥）」「舅甥（姨母与甥）」这种自相矛盾的组合。 */
  /* 长辈侧：下标 = gen = gap−1。gen=0 ⇒「叔」；gen=1 ⇒「叔祖父」；gen=2 ⇒「曾叔祖父」。
   * ⚠ 第一版这张表写成 ['叔','叔父','叔祖父',…]，于是 gen=1 输出了「叔父」——
   *   叔父是差 1 代的说法，差 2 代必须升级成「叔祖父」。单测抓到。 */
  const elderFull = elderCore[Math.min(gen, elderCore.length - 1)];
  /* 主词要看**两边**的性别，不能只看 q：
   *     q 男 + elder 男 ⇒ 叔侄（伯还是叔看排行）
   *     q 男 + elder 女 ⇒ 姑侄   ← 姑姑与侄子，中文就叫「姑侄」
   *     q 女 + elder 男 ⇒ 舅甥
   *     q 女 + elder 女 ⇒ 姨甥
   *   第一版只看 q，于是「阿玛兰妲（姑姑）与侄曾孙」被写成「叔侄（姑母与…）」——
   *   主词和括号里自相矛盾。中文有现成的四个词，不必硬塞进「叔侄」这一族。
   *   排行不详时写「伯叔侄」，不擅自替他判长幼。 */
  const baseWord = mQ
    ? (mE ? (orderUnknown ? '伯叔侄' : '叔侄') : '姑侄')
    : (mE ? '舅甥' : '姨甥');

  /* 主词：q 是女性 ⇒ elder 走舅/姨一侧 ⇒ 叫「舅甥」；q 是男性 ⇒ 「叔侄」。
   * 晚辈侧那个「侄/甥」则永远看 link（younger 的直接上一代）的性别：
   * link 是男性 ⇒ younger 是他的 侄；link 是女性 ⇒ 甥。 */
  return {
    kind: 'collateral', elder, younger, elderGen, youngerGen, gap, lca: f.ancestor,
    link, q, mark, base: baseWord, order: order || null, orderUnknown,
    elderWord: elderFull, youngerWord: youngerFull,
    term: `${baseWord}（${elderFull}与${youngerFull}）`,
  };
}

/** 去掉括号说明与「（推导）」，只留主词。 */
export function kinHeadword(term) {
  return String(term || '').replace(/[（(].*$/, '').trim();
}

/**
 * 从标签文字里读出"长辈比晚辈高几代"。
 * 识别不到就返回 0（表示"看不出代差"，校验时应判为不可信）。
 */
export function kinGenerationOf(term) {
  const t = String(term || '');
  if (/(曾)?(伯|叔)?(祖父|外祖父)/.test(t) && /祖/.test(t)) {
    if (/天祖/.test(t)) return 4;
    if (/高祖/.test(t)) return 3;
    if (/曾祖/.test(t)) return 3;
    return 2;                    // 祖父 / 外祖父
  }
  if (/姨母|姑母|舅父|叔|伯|姑|舅|姨/.test(t)) return 1;
  if (/侄|甥/.test(t)) return 1;
  return 0;
}

export const __test = { walk, cousinMark };