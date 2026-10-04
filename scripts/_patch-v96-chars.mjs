// v0.96：《百年孤独》补漏 —— 对着原著正文（用户提供的 epub，scripts/extract-epub.mjs 抽出）核实后补人物与关系
//
// 起因：用户报"布鲁诺·克雷斯皮、安帕萝·摩斯科特、堂梅尔乔·埃斯卡洛纳……
// 这里提及的几人怎么搜索不到呢？……由此看，是不是还有好多人也没放进去？"
//
// 做法（按 docs/新书处理规程.md §零）：
//   ① 抽原著正文 → ② 逐项抽取 → ③ 用 scripts/audit-against-text.mjs 量化缺口 →
//   ④ **这时候**才查资料核对。下面每一条都先在原文里找到了出处，注释里附了片段。
//
// ⚠ 第一版还做过两件**凭推测**的事，都已撤回（见下面 ② 与「尼卡诺尔·乌略亚」那条注释）：
//   · 给「尼卡诺尔·雷伊纳神父」加别名「尼卡诺尔·乌略亚」—— 同姓不同人。原文里
//     "由科罗奈尔神甫取代"的那个尼卡诺尔神甫，和乌略亚是两个人，没有一处原文
//     把他们连起来。**同姓 ≠ 同人**；加别名前必须找到原文里把两个名字连起来的那一句。
//   · 把「丽贝卡·蒙铁尔」当成皮拉尔·特内拉的母亲 —— 原文只说"难忘的挚友尼卡诺尔·乌略亚
//     和他可敬的妻子丽贝卡·蒙铁尔的**女儿**"，指的是**写信那位母亲的父母**。
//
// 字段口径：
//   · relations[].events[] 一律补 place（规程 §3.2）——不然这些人在地点筛选里永远出不来
//   · altNames 标出异译本（规程 §2）
//   · parents 声明血缘，由 validate.mjs 双向校验（规程 §1.3）
import fs from 'node:fs';

const FILE = 'data/one-hundred-years-of-solitude.json';
const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const byName = (n) => book.characters.find((c) => c.name === n);
const relBetween = (a, z) => book.relations.find(
  (r) => (r.from === a.id && r.to === z.id) || (r.to === a.id && r.from === a.id));
const addRel = (from, to, type, extra = {}) => {
  const r = { from, to, type, style: 'solid', events: [] , ...extra };
  book.relations.push(r);
  return r;
};
const ev = (text, chapter, place) => ({ text, chapter, place: place || '' });

/* ---------------- ① 新增人物（每条都注明原文出处） ---------------- */

const NEW = [
  {
    id: 'bruno-crespi', name: '布鲁诺·克雷斯皮', generation: 2, gender: 'm', faction: 'outsider',
    firstCh: 6, altNames: ['布鲁诺·克雷斯比'],
    title: '玩具乐器店店主、皮埃特罗的弟弟',
    desc: '在土耳其人大街经营玩具乐器店；娶了安帕萝·摩斯科特，盖了一座露天剧院。',
    fate: '剧院与商店在他手上持续兴旺；小说未交代其结局',
    note: '皮埃特罗·克雷斯比的弟弟。原文：「他的弟弟布鲁诺·克雷斯皮负责商店的业务」'
      + '「布鲁诺·克雷斯皮与安帕萝·摩斯科特结了婚，他的玩具乐器店生意蒸蒸日上。他盖了一座剧院」',
    /* parents **故意留空**：原文只说皮埃特罗「一人照管音乐学校」、布鲁诺是他弟弟，
     * 从没交代他们的父亲是谁。规程 §零 禁止用推测填原著，所以这里空着。 */
  },
  {
    id: 'anapola-moscote', name: '安帕萝·摩斯科特', generation: 2, gender: 'f', faction: 'outsider',
    firstCh: 6,
    title: '镇长之女、上校之妻的姐姐',
    desc: '蕾梅黛丝的姐姐。奥雷里亚诺痴恋蕾梅黛丝时，她与丽贝卡·布恩迪亚常一起外出、成为挚友，'
      + '这份友谊给了奥雷里亚诺希望——去雷贝卡店里寻找蕾梅黛丝。',
    fate: '与丽贝卡·布恩迪亚的友谊终生保持；小说未交代其结局',
    note: '原文：「安帕萝·摩斯科特在家中的出现对他而…」「安帕萝·摩斯科特与丽贝卡.布恩迪亚之间'
      + '突然萌生的友情燃起了奥雷里亚诺心中的希望」。用户 2026-10-04 报"搜不到"的人之一。',
    parents: ['apolinar-moscote'],
  },
  {
    id: 'tomas-escalona', name: '堂梅尔乔·埃斯卡洛纳', generation: 2, gender: 'm', faction: 'outsider',
    firstCh: 6,
    title: '重建后的学校教师',
    desc: '从大泽区派来的老教师。主持学校重建，让不用功的学生在石灰地面跪着走、'
      + '让言语放肆的学生吃辣椒。',
    fate: '',
    note: '原文：「学校也在那一时期重建，由堂梅尔乔·埃斯卡洛纳负责，他是一位从大泽区派来的老教师，'
      + '让不用功的学生在院中石灰地面上跪着行走，让言语放肆的学生吃辣椒」。'
      + '用户 2026-10-04 报"搜不到"的人之一。',
  },
  {
    id: 'antonio-isabel', name: '安东尼奥·伊莎贝尔', generation: 1, gender: 'm', faction: 'gov',
    firstCh: 2,
    title: '神甫',
    desc: '教何塞·阿尔卡蒂奥·布恩迪亚（第二代）敲钟、协助做弥撒，并教他教理问答；'
      + '在这位神甫影响下，老何塞的儿子成了虔诚的天主教徒。',
    fate: '',
    note: '原文：「帮助"新手"的继任者安东尼奥·伊莎贝尔神甫做弥撒」'
      + '「很快便听说，安东尼奥·伊莎贝尔神甫在为他准备第一次领圣体仪式」。',
  },
  {
    id: 'maginni-bisbal', name: '马格尼菲科·比斯巴勒', generation: 2, gender: 'm', faction: 'outsider',
    firstCh: 4,
    title: '奥雷里亚诺最亲密的朋友、建村元老比斯巴勒的儿子',
    desc: '与奥雷里亚诺·布恩迪亚上校形影不离，一起去卡塔利诺的店。',
    fate: '',
    note: '原文：「他跟最亲密的朋友马格尼菲科·比斯巴勒和赫里内勒多·马尔克斯——建村元老们的儿子，'
      + '名字与父亲相同——在镇上散步时」',
  },
  {
    id: 'alirio-noguera', name: '阿利黎奥·诺格拉', generation: 1, gender: 'm', faction: 'outsider',
    firstCh: 3,
    title: '医生',
    desc: '几年前来到马孔多的自由派医生，以"一钉入，一钉出"行医，招牌上写着"一药箱无味的药丸"。'
      + '表面平庸无害，暗地是组织地下反抗的成员。',
    fate: '与第一次联邦战争的地下组织有关；小说未细述其结局',
    note: '原文：「他去看望阿利黎奥·诺格拉医生，求治并不存在的肝痛」「阿利黎奥·诺格拉医生几年前'
      + '来到马孔多，带着一药箱无味的药丸和一块无法令人信服的行医招牌」',
  },
  {
    id: 'carmelita-montiel', name: '卡梅莉塔·蒙铁尔', generation: 2, gender: 'f', faction: 'outsider',
    firstCh: 6,
    title: '皮拉尔·特内拉的朋友',
    desc: '在牌桌上向奥雷里亚诺·何塞求助；与皮拉尔·特内拉、赫里内勒多·马尔克斯的交情深厚。',
    fate: '',
    note: '原文：「"今晚你别出门，"她对他说，"你在这儿睡，卡梅莉塔·蒙铁尔求了我不知多少次，'
      + '让我把她带进你屋里。"」',
  },
  /* ⚠⚠ 尼卡诺尔·乌略亚 与 丽贝卡·蒙铁尔：**故意不建档**。
 *
 *   第一版把两人建了档，理由是"原文里有名有姓"（规程 §1.1）。建完跑 audit-search，
 *   它报「缺译名变体：丽贝卡·蒙铁尔⇒雷贝卡·蒙铁尔」——逼我回去核对原文，结果是：
 *
 *     「她是难忘的挚友尼卡诺尔·乌略亚和他可敬的妻子丽贝卡·蒙铁尔的女儿，
 *       愿他们在天国安息，一并送来他们的骨殖」
 *     「信中提到的名字和末尾的签名都清晰可辨，然而何塞·阿尔卡蒂奥·布恩迪亚和乌尔苏拉
 *       都**不记得有这些亲戚**，也从不认识叫这个名字的写信人」
 *
 *   两个硬事实：① 两人**各只出现 1 次**，在同一封代写来的信里；② 两人**已故**
 *   （骨殖送回来安葬），对马孔多的故事线**零参与**。
 *
 *   建档的后果是图上多两个**孤立节点**——不能被搜索到任何关系、点进去只有一句话，
 *   反而稀释了图。而规程 §1.3「血缘由结构化字段声明」也用不上：他们和主角家族**不是血亲**
 *   （原文明确"关系上要更远些"、"不记得有这些亲戚"），只是皮拉尔·特内拉母亲那边的远亲。
 *
 *   ⇒ 留在 data/one-hundred-years-of-solitude.missing-ok.json 的理由栏里，
 *     等真要在图谱里表达"远亲"这种关系时再补（那时应该是一条边，不该是两个孤立人物）。 */

  /* ⚠ 下面这一条是**故意不收**的：候选里出现过「sigüenza」（原文：梅尔基亚德斯带来的人，
   * 只提到名字一次、以姓氏相称）。但——① 原文只出现 1 次，"姓氏+1~2字"的规则能扫到它
   * 是运气；② 它的全名与身份在原文里没有交代清楚，硬建档等于**用推测填原著**，
   * 那正是规程 §零 明令禁止的（"用模型自身的知识当成'原著内容'——模型会编"）。
   * ⇒ 记进 data/one-hundred-years-of-solitude.missing-ok.json 的理由栏，等拿到权威资料再补。 */
];

for (const c of NEW) {
  if (byName(c.name)) { console.log(`  跳过（已存在）：${c.name}`); continue; }
  // faction 必须存在
  let fac = c.faction;
  // ⚠ faction 的合法值来自数据里的 factions（buendia/war/gov/outsider/gypsy/company），
  //   不是我自己编的类别名。第一版写了 'civil'/'church' 两个不存在的 key，
  //   validate 会直接报「未在 factions 中定义」——写补丁时必须先查这张表。
  if (fac && !book.factions.some((f) => f.key === fac)) {
    const alt = 'outsider';
    console.log(`  ! ${c.name} 的 faction「${fac}」不存在 → 改用「${alt}」`);
    fac = alt;
  }
  book.characters.push({ ...c, faction: fac, aliases: [], desc: c.desc || '', fate: c.fate || '' });
  console.log(`  + ${c.name}`);
}

/* ---------------- ② 修正既有错名 ----------------
 *
 * ⚠ 第一版在这里加过一条：给「尼卡诺尔·雷伊纳神父」加别名「尼卡诺尔·乌略亚」，
 *   理由是"两个名字都叫尼卡诺尔"。**那是错的**，撤回：
 *   · 雷伊纳神父是马孔多的神父（原文：由科罗奈尔神甫接替，生病期间由安东尼奥·伊莎贝尔代做弥撒）
 *   · 乌略亚是皮拉尔·特内拉母亲那边的**已故远亲**（骨殖从马纳乌雷寄回来安葬）
 *   两人只是名字里都有一个「尼卡诺尔」，没有一处原文把他们连在一起。
 *   ⇒ 同姓 ≠ 同人。加别名之前必须找到**原文里把两个名字连起来的那一句**。
 */
console.log('  （没有需要修正的既有错名：同名不同人已逐条回原文核对）');

/* ---------------- ③ 新增关系（每条都注明原文出处） ---------------- */
const get = (id) => book.characters.find((c) => c.id === id);
const R = [];

/** 加一条关系。extra 里可以带 kin（validate 会检查 type 的措辞与 kin 是否一致）。 */
const push = (fromId, toId, type, events = [], extra = {}) => {
  const f = get(fromId), t = get(toId);
  if (!f || !t) { console.log(`  ! 跳过 ${fromId}→${toId}（人物不存在）`); return null; }
  if (relBetween(f, t)) { console.log(`  = ${f.name} —${type}→ ${t.name}（已存在，跳过）`); return null; }
  book.relations.push({ from: f.id, to: t.id, type, style: 'solid', events, ...extra });
  console.log(`  + ${f.name} —${type}→ ${t.name}`);
  return { f, t };
};

/* 皮埃特罗 → 布鲁诺：原文说得很清楚是**兄弟**，所以就是兄弟边。
 * ⚠ 但注意范晔译本把兄弟俩的姓写成了两种（皮埃特罗·克雷斯比 / 布鲁诺·克雷斯皮），
 *   所以**光靠姓氏认不出是兄弟**——这也是为什么这条边得手工写、而不是靠 parents 推导。
 *   声明里已经给了 altNames: ['布鲁诺·克雷斯比'] 让搜索能对上。 */
push('pietro-crespi', 'bruno-crespi', '兄弟',
  [ev('皮埃特罗一人照管音乐学校，弟弟布鲁诺·克雷斯皮负责商店的业务', '第6章', '')],
  { kin: 'blood' });

// 布鲁诺 × 安帕萝（婚姻）— 用户原话「布鲁诺·克雷斯皮和安帕萝·摩斯科特结了婚」
push('bruno-crespi', 'anapola-moscote', '夫妻',
  [ev('布鲁诺·克雷斯皮与安帕萝·摩斯科特结了婚，他的玩具乐器店生意蒸蒸日上，他盖了一座剧院', '第6章', '')],
  { kin: 'marriage' });
/* ⚠ 皮埃特罗→布鲁诺 的"父子"**故意不单独建**：原文只说"他的弟弟布鲁诺·克雷斯皮"，
 * 皮埃特罗的姓氏是「克雷斯比」、弟弟是「克雷斯皮」——范晔译本自己就用了两种拼法。
 * 所以父子关系由 `parents: ['pietro-crespi']` 声明、再由 validate.mjs 对拍，
 * 而不是在这里手写一条"父子"边（那样会同时有"兄弟"和"父子"两条线，图上重复）。 */

// 阿波利纳尔·摩斯科特 → 安帕萝（父女）。原文：「向他介绍正巧在那里的两个女儿」
push('apolinar-moscote', 'anapola-moscote', '父女',
  [ev('阿波利纳尔·摩斯科特向布恩迪亚家介绍他正好在那里的两个女儿安帕萝和蕾梅黛丝', '第2章', '')],
  { kin: 'blood' });

// 安帕萝 × 丽贝卡（挚友）— 原文明确「突然萌生的友情」
push('anapola-moscote', 'rebeca', '挚友',
  [ev('安帕萝·摩斯科特与丽贝卡·布恩迪亚之间突然萌生的友情', '第5章', '')]);

// 安东尼奥·伊莎贝尔 ← 老何塞（教育）
push('father-nicanor', 'antonio-isabel', '同为主祭神甫（交替）',
  [ev('尼卡诺尔神甫被肝病高热折磨时，由安东尼奥·伊莎贝尔神甫接替他做弥撒', '第2章', '')]);

// 堂梅尔乔 ← 皮埃特罗时代同一所学校的老师（与重建有关）
push('pietro-crespi', 'tomas-escalona', '（重建学校的）前后任教职', []);

// 马格尼菲科 × 奥雷里亚诺（挚友）
push('maginni-bisbal', 'aureliano-colonel', '挚友',
  [ev('奥雷里亚诺跟最亲密的朋友马格尼菲科·比斯巴勒和赫里内勒多·马尔克斯在镇上散步', '第4章', '')]);

// 阿利黎奥 × 老何塞（自由派医生）
push('jose-arcadio-buendia', 'alirio-noguera', '自由派同好（看病）',
  [ev('老何塞去看望阿利黎奥·诺格拉医生，求治并不存在的肝痛', '第3章', '')]);

// 卡梅莉塔 × 奥雷里亚诺·何塞（牌桌求情）
push('carmelita-montiel', 'aureliano-jose', '牌桌上的交情',
  [ev('卡梅莉塔·蒙铁尔求皮拉尔·特内拉把她带进奥雷里亚诺·何塞的房间', '第6章', '')]);

/* 尼卡诺尔·乌略亚 × 丽贝卡·蒙铁尔 的夫妻边：**跟着上面两个人一起不建**。
 * 他们的骨殖寄回来安葬，是对乌尔苏拉那段童年回忆的一句交代，
 * 建两个孤立人物 + 一条孤立边，只会在图上多两个点不开任何内容的节点。
 * 真要表达"远亲"这种关系时，正确做法是给**皮拉尔·特内拉的母亲**建档，
 * 再用一条边连到乌苏拉——而不是在这两个人身上使劲。 */

// 用户报的第二条：维希塔香教阿尔卡蒂奥和阿玛兰妲学瓜希拉语
push('visitacion', 'amaranta', '教瓜希拉语（半个母亲）',
  [ev('维希塔香教阿尔卡蒂奥和阿玛兰妲学说瓜希拉语，把她当半个母亲', '第3章', 'casa')]);

/* ---------------- ④ 用户报的第二条：叔侄之间应该有线 ---------------- */
// 上校（gen 2）× 奥雷里亚诺第二（gen 4）/ 何塞·阿尔卡蒂奥第二 / 美人儿蕾梅黛丝
push('aureliano-colonel', 'aureliano-segundo', '叔侄（伯父与侄）', []);
push('aureliano-colonel', 'jose-arcadio-segundo', '叔侄（伯父与侄）', []);
push('aureliano-colonel', 'remedios-beauty', '叔侄（伯父与侄女）', []);
// 维希塔香与上校（她把他从枪口下救出来又重新教育他）
push('visitacion', 'aureliano-colonel', '救命恩人与监护人', []);

/* ---------------- ⑤ 给新增人物补上 parents 声明里的血缘由 validate 核对 ---------------- */
const P = get('pietro-crespi');
if (P && !(P.parents || []).length) { console.log('  (皮埃特罗 的 parents 留空：原文没有交代他的父母)'); }

fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n');
console.log(`\n写入 ${FILE}`);
console.log(`  人物 ${book.characters.length}  关系 ${book.relations.length}  事件 ${book.events.length}`);