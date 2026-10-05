#!/usr/bin/env node
/**
 * 《百年孤独》数据修正（v0.99）：全部依据用户提供的**范晔译本 epub 全文**。
 *
 * 做了四件事，每件都注明原文出处：
 *
 * ① 记长幼（birthRank）—— 不记就分不出伯/叔，这是中文的硬性区别。
 *    原文依据：
 *      「他的哥哥何塞·阿尔卡蒂奥，将会把这奇妙的形象传给所有后世子孙」
 *      「大儿子何塞·阿尔卡蒂奥已经十四岁」「带着他们的长子来听从……」
 *      「唯一经受了时间和战争考验的，只有孩提时代他对哥哥何塞·阿尔卡蒂奥的感情」
 *    ⇒ 何塞·阿尔卡蒂奥（第二代）是**长子**，上校是**弟弟** ⇒ 上校一律称**叔**。
 *
 * ② 修 5 条与族谱矛盾的手写称谓（对质器 scripts/check-kin-terms.mjs 报出来的）：
 *    上校 × 奥雷里亚诺第二 / 何塞·阿尔卡蒂奥第二 / 美人儿蕾梅黛丝 —— 差 2 代，
 *      原写「叔侄（**伯父**与侄）」：① 差一代 ② 伯应是叔。两条都错。
 *    乌尔苏拉 × 何塞·阿尔卡蒂奥（第五代）—— 差 4 代，原写「曾祖孙」。
 *      ⚠ 原文第15章自称「曾孙」，比族谱少一代（这是译本的简化，详见 CHANGELOG），
 *      用户裁定**按族谱改成「高祖孙」**。
 *    阿玛兰妲 × 何塞·阿尔卡蒂奥（第五代）—— 差 3 代，原写「姑侄」，差两代。
 *
 * ③ 给原本 events 为 0 的那 3 条补上推导链（它们原先是"零依据"）。
 *
 * ④ 补 4 个原文有、数据里没有的人物，各带原文引文：
 *    佩特洛尼奥（圣器保管人）、科罗奈尔神甫（"新手"）、
 *    好汉弗朗西斯科（江湖艺人）、拉斐尔·埃斯卡洛纳（其绝艺传人）。
 *    用户 2026-10-05 报的漏项。
 *
 * 用法：node scripts/fix-100y-v099.mjs           # 只预览要改什么
 *      node scripts/fix-100y-v099.mjs --write    # 落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTree, computeKin } from './kin-terms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'one-hundred-years-of-solitude.json');
const EPUB_PARTS = 'C:/Users/chw/AppData/Local/Temp/opencode/epub-parts.json';
const WRITE = process.argv.includes('--write');

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byName = new Map(book.characters.map((c) => [c.name, c]));
const nm = (id) => book.characters.find((c) => c.id === id)?.name ?? id;

/* ── 章号：按 epub 的**分卷**定位（不是按段落切，那会得到几百个假章号）── */
let chapterOf = () => null;
let partsOf = () => null;
if (fs.existsSync(EPUB_PARTS)) {
  const parts = JSON.parse(fs.readFileSync(EPUB_PARTS, 'utf8'));
  const norm = (s) => s.replace(/\s+/g, '');
  chapterOf = (quote) => {
    const q = norm(quote).slice(0, 24);          // 取前 24 字，避开跨卷断句
    if (!q) return null;
    const hit = parts.find((p) => norm(p.text).includes(q));
    return hit ? hit.chapter : null;
  };
  /** 某一章的全文，用于"这个人在本章出没"的自检。
   *  ⚠ 正文和查询名**两边都要**去掉「·」和空白 —— 第一版只去查询名的，
   *    于是拿「何塞阿尔卡蒂奥第二」去正文里找「何塞·阿尔卡蒂奥第二」，
   *    永远找不到，4 条全被误报成"待人确认"。 */
  const flat = (s) => s.replace(/[\s·・]/g, '');
  partsOf = (ch) => {
    if (!ch) return null;
    const hit = parts.find((p) => p.chapter === ch);
    return hit ? flat(hit.text) : null;
  };
} else {
  console.warn(`⚠ 找不到 ${EPUB_PARTS}，章号会写成 null`);
}

/* ══ ① 长幼 ═══════════════════════════════════════════ */
const RANKS = [
  ['何塞·阿尔卡蒂奥（第二代）', 1, '长子（双胞胎中的哥哥）。原文：「大儿子何塞·阿尔卡蒂奥已经十四岁」「带着他们的长子来听从何塞·阿尔卡蒂奥·布恩迪亚的调遣」「他的哥哥何塞·阿尔卡蒂奥，将会把这奇妙的形象传给所有后世子孙」。'],
  ['奥雷里亚诺·布恩迪亚上校', 2, '次子（双胞胎中的弟弟）。原文明称其兄为「哥哥何塞·阿尔卡蒂奥」「他哥哥何塞·阿尔卡蒂奥强占土地」。⇒ 他对兄之子女一律称**叔**，不称伯。'],
  ['丽贝卡', 3, '三女（在两个孪生哥哥之后）。原文：丽贝卡管阿玛兰妲叫「小妹妹」。'],
  ['阿玛兰妲', 4, '幺女（乌尔苏拉最小的孩子）。原文：丽贝卡称她「小妹妹」，何塞·阿尔卡蒂奥第二称她「姑妈」。'],
];
console.log('① 记长幼 birthRank');
for (const [name, rank, why] of RANKS) {
  const c = byName.get(name);
  if (!c) { console.log(`   ✗ 找不到 ${name}`); continue; }
  if (c.birthRank === rank) { console.log(`   · ${name} 已是 birthRank=${rank}`); continue; }
  console.log(`   ${name}  birthRank ${c.birthRank ?? '（无）'} → ${rank}`);
  console.log(`     依据：${why}`);
  c.birthRank = rank;
  c.note = `${c.note ? `${c.note}　` : ''}【长幼】${why}`;
}

/* ══ ② 修称谓 ═════════════════════════════════════════ */
const tree = buildTree(book.relations, book.characters);
const FIX = [
  ['奥雷里亚诺·布恩迪亚上校', '奥雷里亚诺第二'],
  ['奥雷里亚诺·布恩迪亚上校', '何塞·阿尔卡蒂奥第二'],
  ['奥雷里亚诺·布恩迪亚上校', '美人儿蕾梅黛丝'],
  ['乌尔苏拉·伊瓜兰', '何塞·阿尔卡蒂奥（第五代）'],
  ['阿玛兰妲', '何塞·阿尔卡蒂奥（第五代）'],
];
console.log('\n② 修 5 条与族谱矛盾的称谓');
let fixed = 0;
for (const [A, B] of FIX) {
  const a = byName.get(A)?.id, b = byName.get(B)?.id;
  if (!a || !b) { console.log(`   ✗ 找不到 ${A} 或 ${B}`); continue; }
  const k = computeKin(tree, a, b);
  const rel = book.relations.find((r) => !r.derived
    && ((r.from === a && r.to === b) || (r.from === b && r.to === a)));
  if (!rel) { console.log(`   ✗ 找不到关系 ${A} — ${B}`); continue; }
  if (rel.type === k.term) { console.log(`   · 已是 ${k.term}：${A} — ${B}`); continue; }
  console.log(`   ${A} — ${B}`);
  console.log(`      旧：${rel.type}`);
  console.log(`      新：${k.term}   （差 ${k.gap} 代，LCA=${nm(k.lca)}）`);
  rel.type = k.term;
  fixed++;
  if (!(rel.events ?? []).length) {
    rel.events = [{
      chapter: null,
      text: `由族谱推导：${A} 与 ${nm(k.lca)} 是同胞；${B} 是 ${nm(k.lca)} 的第 ${k.gap} 代晚辈`
        + `（${nm(k.q ?? k.lca)} → … → ${B}）⇒ 两人相差 ${k.gap} 代。原文没有直接互动。`,
    }];
    console.log('      ＋ 补推导链事件（原来 0 条依据）');
  }
}

/* ══ ③ 补 4 个漏掉的人物 ═══════════════════════════════ */
/* generation：布恩迪亚家族代际。这 4 位都不是布恩迪亚家的人，
 * 但 validate.mjs 要求每个人都有数字 generation，
 * 所以按「首次出场时当代的布恩迪亚代际」填，与既有非家族人物的做法一致
 * （普鲁邓希奥、梅尔基亚德斯是 0，长猪尾巴的孩子是 7）。
 *   ch3  当代＝何塞·阿尔卡蒂奥（第二代）/上校 ⇒ 2
 *   ch8-10 当代＝双胞胎（奥雷里亚诺第二等）⇒ 4
 *   ch20 当代＝长猪尾巴的孩子 ⇒ 7 */
const NEW = [
  {
    id: 'pedronio', name: '佩特洛尼奥', gender: 'm', generation: 4,
    note: '钟楼上的圣器保管人，据传以蝙蝠为食。原文：「他去向佩特洛尼奥请教，这个疾病缠身的圣器保管人住在钟楼上，据说以蝙蝠为食」「佩特洛尼奥终于失去了耐心」「佩特洛尼奥果然拎着一张此前无人知晓其用途的小木凳，下了钟楼，带何塞·阿尔卡蒂奥第二走进附近的一处菜园」。',
    quote: '佩特洛尼奥果然拎着一张此前无人知晓其用途的小木凳，下了钟楼',
    rels: [['何塞·阿尔卡蒂奥第二', '点破小木凳谜底', '原文：「到了星期二，佩特洛尼奥果然拎着一张此前无人知晓其用途的小木凳，下了钟楼，带何塞·阿尔卡蒂奥第二走进附近的一处菜园」']],
  },
  {
    id: 'father-coronel', name: '科罗奈尔神甫', gender: 'm', generation: 4,
    aliases: ['新手'],
    note: '接替尼卡诺尔神甫的主祭神甫，**人称「新手」**，第一次联邦战争的老兵。原文：「尼卡诺尔神甫被肝病高热折磨得奄奄一息，已由科罗奈尔神甫取代，后者被人称作“新手”，是第一次联邦战争中的老兵。」⚠ 用户曾误以为「新手」是安东尼奥·伊莎贝尔，原文里安东尼奥·伊莎贝尔是「“新手”的**继任者**」。',
    quote: '后者被人称作“新手”，是第一次联邦战争中的老兵',
    rels: [
      ['尼卡诺尔·雷伊纳神甫', '被接替（主祭神甫）', '原文：「尼卡诺尔神甫被肝病高热折磨得奄奄一息，已由科罗奈尔神甫取代」'],
      ['安东尼奥·伊莎贝尔', '继任（主祭神甫）', '原文：「帮助“新手”的继任者安东尼奥·伊莎贝尔神甫做弥撒」'],
    ],
  },
  {
    id: 'francisco-el-aceptado', name: '好汉弗朗西斯科', gender: 'm', generation: 2,
    aliases: ['弗朗西斯科'],
    note: '将近两百岁的江湖艺人，常来马孔多吟唱自编歌谣。**真名实姓无人知晓**；人称「好汉」是因为他曾在一次即兴赛歌会上击败魔鬼。原文：「数月后，好汉弗朗西斯科回来了，他是个将近两百岁的江湖艺人，常来马孔多吟唱自编的歌谣」「人们称为好汉弗朗西斯科，是因为他曾在一次即兴赛歌会上击败魔鬼，至于其真名实姓则无人知晓」。'
      + '【v0.100 更正】他的歌被**奥雷里亚诺第二**唱过（第10章哼着贴钞票、第20章拉手风琴演奏），'
      + '⚠ 不是上校 —— 我原先挂错人了，见关系里的说明。',
    quote: '人们称他为好汉弗朗西斯科，是因为他曾在一次即兴赛歌会上击败魔鬼',
    rels: [
      /* ⚠ v0.100 修正：这条我原先挂在**上校**名下、关系还编成「师徒」，两处都错。
       *   · 行为人是**奥雷里亚诺第二**，不是上校。原文第10章连着几句：
       *       「每次看到他打开香槟仅仅是为了往头上喷泡沫寻找乐趣，她都要大声斥责他挥霍浪费。
       *        他对此十分厌烦，一天清早心血来潮，拿起一箱钞票、一罐糨糊和一把刷子，
       *        哼着好汉弗朗西斯科的老歌把家中里里外外、上上下下贴满了一比索的纸币。
       *        …这时奥雷里亚诺第二已经从立面到厨房全部裱糊完毕」
       *     「他」＝被乌尔苏拉斥责的那个人＝奥雷里亚诺第二，后文直接点名。
       *     同一段里上校在做另一件事（在作坊里给奥雷里亚诺第二看小金鱼），我串人了。
       *   · 「师徒」是我**编的**：原文只写他哼过、演奏过对方的歌，从没说有师徒关系。
       *     ⇒ 改成只陈述事实的「演唱其歌」，并把第20章那条一并挂上。 */
      ['奥雷里亚诺第二', '演唱其歌',
        '原文第10章：「他对此十分厌烦，一天清早心血来潮，拿起一箱钞票、一罐糨糊和一把刷子，哼着好汉弗朗西斯科的老歌把家中里里外外、上上下下贴满了一比索的纸币」'
        + '——这里的「他」是奥雷里亚诺第二（同段后文点名「这时奥雷里亚诺第二已经从立面到厨房全部裱糊完毕」）。'
        + '原文第20章：「奥雷里亚诺第二最后一次拉起手风琴，演奏好汉弗朗西斯科已被人遗忘的歌曲，只是他再也无法伴唱。」'],
    ],
  },
  {
    id: 'rafael-escalona', name: '拉斐尔·埃斯卡洛纳', gender: 'm', generation: 7,
    note: '主教的侄子，好汉弗朗西斯科的**绝艺传人**。原文：「花街柳巷最后一家营业的舞厅里，手风琴乐队弹唱起主教的侄子，好汉弗朗西斯科的绝艺传人拉斐尔·埃斯卡洛纳的歌曲」。',
    quote: '好汉弗朗西斯科的绝艺传人拉斐尔·埃斯卡洛纳',
    /* ⚠ 这一对**只在这里声明一次**。第一版在好汉弗朗西斯科和拉斐尔两边的 rels
     *   里各写了一遍，validate.mjs 报「关系重复：francisco-el-aceptado ↔
     *   rafael-escalona 的『绝艺传人』有 2 条」——图上会画出两条重复线。 */
    rels: [['好汉弗朗西斯科', '绝艺传人', '原文：「花街柳巷最后一家营业的舞厅里，手风琴乐队弹唱起主教的侄子，好汉弗朗西斯科的绝艺传人拉斐尔·埃斯卡洛纳的歌曲」']],
  },
];

console.log('\n③ 补 4 个原文有、数据里没有的人物');
let added = 0;
/* 先全部占位，避免「人物 A 的关系指向还没创建的人物 B」 */
for (const n of NEW) {
  if (byName.has(n.name) || book.characters.some((c) => c.id === n.id)) continue;
  book.characters.push({ id: n.id, name: n.name, aliases: n.aliases ?? [], gender: n.gender, generation: n.generation, note: n.note });
}
for (const n of NEW) {
  const exists = byName.has(n.name) || book.characters.some((c) => c.id === n.id && c.firstCh != null);
  const c = book.characters.find((x) => x.id === n.id);
  if (!c) { console.log(`   ✗ 没能创建 ${n.name}`); continue; }
  if (c.firstCh != null) { console.log(`   · 已存在：${n.name}`); continue; }
  const ch = chapterOf(n.quote);
  c.firstCh = ch;
  added++;
  console.log(`   ＋ ${n.name}（${n.id}）第 ${ch ?? '?'} 章　${n.note.slice(0, 40)}…`);
  for (const [other, type, ev] of n.rels) {
    const o = book.characters.find((x) => x.name === other);
    if (!o) { console.log(`      ✗ 关系对象没找到：${other}`); continue; }
    const q = (ev.match(/「(.+)」/)?.[1] ?? '').split('」「')[0];
    const evCh = chapterOf(q);
    book.relations.push({
      from: o.id, to: n.id, type, style: 'solid',
      events: [{ chapter: evCh, text: ev }],
    });

    /* ⚠ v0.100 加的行为人自检（**只是兜底，不参与退出码**）。
     *   上一版我只把引文**配对**上了（这句话确实在原文里、确实提到弗朗西斯科），
     *   没过问句子里那个「他」指的是谁 —— 中文长段落里「他」随时可能换人，
     *   结果把「奥雷里亚诺第二哼着歌贴钞票」挂成了上校。
     *
     *   为什么只能当兜底、不能当门禁：
     *     · 原文会用**别名/称号**指同一个人（本例章里写「新手」而不写「科罗奈尔神甫」）
     *     · 原文常常只写**姓氏或简称**（「张、戴二人」）
     *     · 关系双方本来就不一定都在同一章出现（旁系推导边尤其如此）
     *   真正的凭据永远是那段**上下文**，不是计数。 */
    const part = partsOf(evCh);
    const has = (name) => (part ? part.includes(name.replace(/[\s·・]/g, '')) : true);
    const hasOther = has(o.name);
    const hasSelf = has(n.name);
    const flag = part && !(hasOther && hasSelf) ? '⚠ 本章未见双方全名（可能是别名/简称，人工确认）' : '＋';
    console.log(`      ${flag} ${other} —${type}— ${n.name}（第 ${evCh ?? '?'} 章；`
      + `本章出现 ${other}：${hasOther ? '是' : '否'}，${n.name}：${hasSelf ? '是' : '否'}）`);
  }
}

console.log(`\n合计：称谓 ${fixed} 条、新增人物 ${added} 个`);
if (WRITE) {
  fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
  console.log(`写入 ${path.relative(ROOT, FILE)}`);
} else {
  console.log('（预览模式，加 --write 才落盘）');
}
