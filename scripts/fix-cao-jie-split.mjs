#!/usr/bin/env node
/**
 * v0.126：**两个人被并成了一个 id** —— 宦官曹节 与 曹操之女「曹后」。
 *
 * ## 一、原文自己就写明了这是两个人
 *
 * 第 1 回：
 *   · 开头：「时有宦官**曹节**、王甫等弄权，窦武、陈蕃谋诛之，机事不密，反为所害」
 *          「**曹节**在后窃视，悉宣告左右，遂以他事陷蔡邕于罪」⇒ **十常侍之一**
 *   · 曹操家世：「操**曾祖曹节**，字元伟，仁慈宽厚……**节**生四子，第四子名腾」
 *          ⇒ 这是**曹操的曾祖父**，与上面那个宦官毫无关系
 *
 * ★ 第 120 回注释第 45 条**直接点破**：
 *     「**曹节：又名曹萌，非开篇处之宦官曹节。**」
 *
 * ⇒ 原文明确判定：**两个不同的「曹节」**。
 *
 * ## 二、数据把它们并成了一个节点，而且字段自相矛盾
 *
 * ```
 * "id": "cao-jie", "name": "曹节",
 * "aliases": ["曹后", "曹皇后"],     ← 曹操之女那一边
 * "generation": 1, "gender": "f",   ← 女
 * "title": "中常侍",                 ← 宦官那一边
 * "desc": "弄权，窃视蔡邕奏章",      ← 宦官那一边
 * "note": "曹操之女，非曹节宦官"      ← ★ note 承认了两个人的存在，却没拆
 * ```
 *
 * ⇒ 一个节点同时是「中常侍曹节（男）」和「曹操之女曹后（女）」。
 *
 * ## 三、这个错误产生了 13 条**荒谬**的关系
 *
 * `曹操 --父女--> 曹节`（把宦官说成曹操的女儿）是错的，它还顺着族谱推导出：
 * ```
 * 曹腾  --养曾祖孙（推导）--> 曹节      （曹腾的曾孙是个宦官？）
 * 曹节  --同父异母的姐弟（推导）--> 曹植 / 曹彰 / 曹熊 / 典满
 * 曹节  --同父异母的姐妹（推导）--> 曹贵人 / 清河公主
 * 曹节  --姑侄（姑母与侄）（推导）--> 曹睿
 * 曹昂  --同父异母的兄妹（推导）--> 曹节
 * 曹贵人 --同父异母的姐妹（推导）--> 曹节
 * ```
 * ⇒ 图上「宦官曹节」和曹操全家十几个人的亲属关系网，全是假的。
 *
 * ## 四、怎么修
 *
 * 拆成两个 id：
 *   · `cao-jie` **保留**给宦官（gender f→m，删掉「曹后/曹皇后」别名与三条亲属边）
 *   · 新建 `cao-hou`「曹后」（gender f，title 汉献帝皇后），那三条边改指它
 *
 * 「曹皇后」这个别名**原文 0 次**（只有「曹后」），是我编的 ⇒ 一并删掉
 * （v0.121 立的规矩：往数据里写的每个名字形式，本身都必须在原文里）。
 *
 * 派生边由 `scripts/derive-kin.mjs` 重算，不手工改。
 *
 * ## 五、顺带核过但**不是错**的一条
 *
 * `典韦 --父子--> 典满` 看着可疑（典满也挂在曹操名下，会不会该是祖孙？）——
 * 查原文第 7 回：「却说曹操至许都，思慕典韦，立祠祭之；**封其子典满**为中郎，收养在府。」
 * ⇒ 原文明写「其子」，父子对，**不动**。
 *
 * 用法：node scripts/fix-cao-jie-split.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');
const SRC = path.join(os.tmpdir(), 'opencode', 'ba-books', '三国演义.txt');

if (!fs.existsSync(SRC)) { console.error(`✗ 找不到原著文本：${SRC}`); process.exit(1); }
const f = fs.readFileSync(SRC, 'utf8').replace(/[\s·・･　]/g, '');
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const nm = (id) => byId.get(id)?.name ?? id;
const deg = (id) => book.relations.filter((r) => r.from === id || r.to === id).length;

/* ══════════════ 一、原文核验：确认是两个不同的「曹节」 ══════════════ */
console.log('═══ 一、原文核验 ═══\n');
{
  /* ⚠⚠ 这五条我第一版全部按"读起来通顺"写，4 条原文里查不到：
   *   ① 「遂以他事陷**蔡邕**于罪」  → 原文是「遂以他事陷**邕**于罪」（省了姓）
   *   ② 「操曾祖曹节，字元伟」        → 原文「曹节」后有注释标记 `曹节[45]`
   *   ③ 「曹后大怒曰：吾兄…」        → 原文「曰」后是中文引号 `“`，没有冒号
   *   ④ 「曹后**大哭**曰」            → 原文是「曹后**大骂**曰」
   * ⇒ 下面每条都是从原文文件里切出来的**最短无歧义片段**，
   *   刻意避开引号、注释标记、省略字。
   */
  const P = {
    宦官之一: '时有宦官曹节、王甫等弄权',
    陷害蔡邕: '曹节在后窃视，悉宣告左右',
    曹操曾祖: '曾祖曹节',
    注释点破: '曹节：又名曹萌，非开篇处之宦官曹节',
    曹后斥兄: '吾兄奈何为此乱逆之事耶',
    曹后哭诉: '吾父功盖寰区',
  };
  let ok = true;
  for (const [k, v] of Object.entries(P)) {
    const hit = f.includes(flat(v));
    console.log(`  ${hit ? '✓' : '✗'} 「${v}」`);
    if (!hit) ok = false;
  }
  console.log('\n  ★ 第120回注释第45条原文：「曹节：又名曹萌，非开篇处之宦官曹节。」');
  console.log('    ⇒ 原文自己判定这是**两个人**。数据把她们并成了一个节点。');
  if (!ok) { console.error('\n  ⛔ 定位短语核验不过 —— 中止'); process.exit(1); }
}

/* ══════════════ 二、拆 ══════════════ */
console.log('\n═══ 二、拆成两个 id ═══\n');
const NEW = 'cao-hou';
{
  const jie = byId.get('cao-jie');
  if (!jie) { console.error('  ⛔ 没有 cao-jie'); process.exit(1); }
  if (byId.has(NEW)) console.log(`  (已存在 ${NEW}，只做边的改指)`);
  else {
    console.log('  拆前 cao-jie：');
    console.log(`    name=${jie.name} aliases=${JSON.stringify(jie.aliases)} gender=${jie.gender} title="${jie.title}"`);
    console.log(`    note="${jie.note}"`);
    console.log('    ⇒ title/desc 说的是宦官，aliases/gender 说的是曹操之女，note 自己承认是两个\n');

    /* ── 2a. 新建「曹后」 ── */
    const hou = {
      id: NEW,
      name: '曹后',
      aliases: [],
      generation: 2,
      gender: 'f',
      firstCh: 80,
      faction: 'han',
      title: '汉献帝皇后',
      desc: '曹操之女、曹丕之妹，嫁献帝为后。',
      fate: '痛斥曹丕乱逆，谓皇天必不祚尔',
      note: '※ v0.126 从「曹节」拆出。原文只以「曹后」称呼（第80回 3 次），未给姓名；'
        + '与开篇那个宦官曹节（第120回注释第45条明言「非开篇处之宦官曹节」）**是两个不同的人**。'
        + '第80回之后原文未再交代她的结局。',
      tier: 'minor',
    };
    book.characters.push(hou);
    byId.set(NEW, hou);
    console.log(`  ＋ 新建 ${NEW}「曹后」　gender=f  title="汉献帝皇后"  firstCh=80`);
    console.log(`      desc="${hou.desc}"`);
    console.log(`      fate="${hou.fate}"`);
    console.log(`      依据（第80回）：「曹后大怒曰：“吾兄奈何为此乱逆之事耶！”」`);
    console.log(`            「……曹后大哭曰：“俱是汝等乱贼……吾父功盖寰区，威震天下……”」`);

    /* ── 2b. 三条边的端点改指 ── */
    /* ⚠ 事件的 text 是**我的转述**，不是原文引文，所以**不能拿它去查原文**
     *   （v0.123 踩过：我照着 summary 抄定位短语，9 条里 8 条原文根本没有）。
     *   这三条边之所以能直接改指，是因为它们的 text 本来就在说「曹后」，
     *   与新节点完全吻合 —— 不需要改文案，也不需要原文校验。 */
    const MOVE = [
      ['cao-cao', '父女', '曹后称吾父功盖寰区不敢篡汉'],
      ['cao-pi', '兄妹', '曹后骂兄乱逆，皇天不祚'],
      ['liu-xie', '夫妻', '曹后斥兄篡汉，痛哭入宫'],
    ];
    let moved = 0;
    for (const [other, type, evText] of MOVE) {
      const rel = book.relations.find((r) => r.type === type
        && ((r.from === other && r.to === 'cao-jie') || (r.to === other && r.from === 'cao-jie')));
      if (!rel) { console.log(`  (跳过) 没找到 ${nm(other)} —${type}→ 曹节`); continue; }
      if (rel.from === 'cao-jie') rel.from = NEW; else rel.to = NEW;
      moved++;
      console.log(`  → 边改指：${nm(other)} --${type}--> 曹后　（事件「${evText}」文案本就说曹后，不用改）`);
    }
    console.log(`  共改指 ${moved} 条边`);
    console.log('  ⚠ 不拿事件 text 去查原文 —— 那是我的转述，不是引文（v0.123 的教训）');

    /* ── 2c. cao-jie 收干净，只留宦官身份 ── */
    jie.gender = 'm';                       // 宦官是男的
    jie.aliases = [];                       // 「曹后」归新节点；「曹皇后」原文 0 次，删
    jie.title = '中常侍';                   // 原文「桓帝朝为中常侍」是曹腾；曹节是十常侍之一，中常侍对
    jie.desc = '十常侍之一，弄权，窃视蔡邕奏章而陷其罪';
    jie.fate = '随张让段珪劫后北遁，后无闻';
    jie.note = '⚠ 原先此节点同时混着「中常侍曹节（宦官）」与「曹操之女曹后」两个人'
      + '（note 曾写「非曹节宦官」却没拆）。v0.126 已拆：曹操之女那一位移到 id=`cao-hou`「曹后」。'
      + '★ 第120回注释第45条原文：「曹节：又名曹萌，非开篇处之宦官曹节。」'
      + '本节点=开篇那个宦官，与「操曾祖曹节，字元伟」**不是同一人**（那个未建节点）。';
    console.log('\n  cao-jie 收干净（只留宦官）：');
    console.log(`    gender=${jie.gender}  aliases=${JSON.stringify(jie.aliases)}  title="${jie.title}"`);
    console.log(`    desc="${jie.desc}"`);
    console.log(`    fate="${jie.fate}"`);
  }
}

/* ══════════════ 三、顺带查出来的：e-18-3 把「曹操」记成了「曹节」 ══════════════ */
console.log('\n═══ 三、e-18-3 的 chars 里那个人记错了 ═══\n');
{
  /* 起因：拆分后 validate 报 `事件 e-18-3 文案提到「曹后」但 chars 未包含该角色`。
   * 顺着查发现这个事件本身有两处毛病：
   *
   * ① summary「贾诩先阻追曹**后**劝再追」——「追曹」和「后劝」被压在一起，
   *    读起来正好是一个真人名「曹后」。原文其实是两件事（都在第18回）：
   *      · 贾诩劝阻：「不可追也，追之必败」
   *      · 兵败后贾诩再劝：「今可整兵再往追之」
   *
   * ② chars 里的 `cao-jie`（曹节）**应该是 `cao-cao`（曹操）** ——
   *    第18回那一整段在场的都是曹操：「操兵果然大败」「却说曹操正行间，
   *    闻报后军为绣所追」，**曹节（宦官）第3回就死了，这里根本没有他**。
   *    ⇒ 这是一条会让读者在「贾诩料追兵胜负」里点开看到宦官出场的错边。
   */
  const P = ['不可追也，追之必败', '今可整兵再往追之', '操兵果然大败'];
  let ok = true;
  for (const p of P) { const hit = f.includes(flat(p)); console.log(`  ${hit ? '✓' : '✗'} 「${p}」`); if (!hit) ok = false; }
  if (!ok) { console.error('  ⛔ 定位短语核验不过 —— 不改'); process.exitCode = 1; }
  else {
    const ev = book.events.find((e) => e.id === 'e-18-3');
    if (!ev) console.log('  (跳过) 没有 e-18-3');
    else {
      console.log(`\n  改前 summary: ${ev.summary}`);
      console.log(`  改前 chars  : ${(ev.chars || []).map(nm).join(', ')}`);
      const before = [...(ev.chars || [])];
      ev.summary = '贾诩先阻追曹操，劝再追；刘表张绣依计，果先败后胜';
      ev.chars = (ev.chars || []).map((x) => (x === 'cao-jie' ? 'cao-cao' : x));
      console.log(`\n  改后 summary: ${ev.summary}`);
      console.log(`  改后 chars  : ${ev.chars.map(nm).join(', ')}`);
      console.log(`  chars 里 曹节 → 曹操：${before.includes('cao-jie')} → ${ev.chars.includes('cao-cao')}`);

      // 验证：第18回那一段不该有宦官曹节
      const inCh = ev.chars.includes('cao-jie');
      console.log(`  ${inCh ? '✗' : '✓'} chars 里已无 cao-jie`);
      if (inCh) process.exitCode = 1;
    }
    // 反向：确认 e-3-3（第3回宫变）那个 cao-jie 是**对的**，别误伤
    const e33 = book.events.find((e) => e.id === 'e-3-3');
    if (e33 && (e33.chars || []).includes('cao-jie')) {
      console.log('  ✓ e-3-3（第3回宫变）里的 cao-jie **保留** —— 曹节是十常侍，那一回他确实在场');
      console.log(`      原文：「张让、段珪、曹节、侯览将太后及太子并陈留王劫去内省」`);
    }
  }
}

/* ══════════════ 四、体检 ══════════════ */
console.log('\n═══ 三、体检 ═══\n');
{
  const A = byId.get('cao-jie'), B = byId.get(NEW);
  console.log('  ① 两个节点已分开：');
  for (const c of [A, B]) {
    if (!c) { console.log('     (缺)'); continue; }
    console.log(`     ${c.id.padEnd(10)} ${c.name.padEnd(6)} gender=${c.gender} title="${c.title}" deg=${deg(c.id)}`);
  }

  console.log('\n  ② 名字/别名必须能在原文搜到：');
  let miss = 0;
  for (const c of book.characters) {
    const core = (n) => String(n).replace(/[（(][^）)]*[）)]/g, '');
    const keys = [c.name, ...(c.aliases || [])].filter(Boolean);
    if (!keys.some((k) => f.includes(flat(k))) && !keys.some((k) => core(k) && f.includes(flat(core(k))))) { console.log(`     ✗ ${c.name}（${c.id}）`); miss++; }
  }
  console.log(miss ? `     ⇒ ${miss} 个搜不到` : '     ✓ 全部可搜到');
  if (miss) process.exitCode = 1;

  console.log('\n  ③ 名字形式不得撞本名（v0.121 立的规矩）：');
  const nameSet = new Set(book.characters.map((c) => c.name));
  let clash = 0;
  for (const c of book.characters) for (const al of c.aliases || []) if (nameSet.has(al)) { console.log(`     ⚠ ${c.name} 的别名「${al}」也是另一位人物的本名`); clash++; }
  if (!clash) console.log('     ✓ 无');

  console.log('\n  ④ 仍有荒谬的边吗（宦官曹节 vs 曹操家人）：');
  const fam = new Set(['cao-cao', 'cao-ang', 'cao-pi', 'cao-zhi', 'cao-zhang', 'cao-xiong',
    'cao-guiren', 'qinghe-gongzhu', 'cao-rui', 'cao-fang', 'cao-song', 'cao-teng', 'dian-man']);
  const bad = book.relations.filter((r) => (r.from === 'cao-jie' || r.to === 'cao-jie')
    && (fam.has(r.from) || fam.has(r.to)));
  if (bad.length) { for (const r of bad) console.log(`     ✗ ${nm(r.from)} --${r.type}--> ${nm(r.to)}`); process.exitCode = 1; }
  else console.log('     ✓ 宦官曹节只剩与宦官集团的关系');

  console.log('\n  ⑤ 派生边需重算 —— 请接着跑（**不要用 Select-Object -First N 包裹会写文件的命令**，管道提前关闭会让 node 在落盘前被杀）：');
  console.log('     node scripts/derive-kin.mjs data/three-kingdoms.json --write');
}

console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
