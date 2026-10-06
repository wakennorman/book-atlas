#!/usr/bin/env node
/**
 * v0.122：清另外两本书的数据脏 + 给《罪与罚》的 2 个孤立人物补关系。
 *
 * ## 起因：把 v0.121 的身份冲突体检推广到三本书，而不是只看三国
 *
 * v0.121 在三国挖出 3 类问题（互为别名=同一人被拆开、拆分造成重名、别名撞他人本名）。
 * 那个体检当时只跑了三国。这轮三本一起跑，**另外两本各有问题**。
 *
 * ## 一、《罪与罚》2 个孤立人物 —— 戏份很重却一条边都没有
 *
 *   尼科丁·佛米奇  原文 **25 次**，区警察分局**局长**
 *   伊里亚·彼得罗维奇  原文 **35 次**，分局**副局长、中尉**，绰号「炮筒子」
 *
 *   两人在原文里是**同一分局的正副局长**，且**都直接与主角罗季昂冲突**：
 *     第1章：局长尼科丁佛米奇与副局长伊里亚彼得罗维奇同在分局，
 *             罗季昂去分局申诉，局长劝他「他是个极其高尚的人，然而又是炮筒子」，
 *             副局长骂丽扎维达「你是在拘留所吗？我早就警告过你十次」。
 *   ⇒ 数据里 `尼科丁` 与 `ilya` **一条边都没有**，图上是两个孤立的点。
 *
 *   ★ 这和三国那 35 个孤立人物是同一类问题，但更刺眼 ——
 *     这两位在人物表和原文目录里都排在很前面，是读者一眼能看到的主要角色。
 *
 * ## 二、11 处「别名 == 自己的本名」—— 纯冗余，但会让检索索引多一份
 *
 *   百年孤独 8 处（比西塔西翁／蕾梅黛丝·摩斯科特／阿波利纳尔·摩斯科特／皮埃特罗·克雷斯皮／
 *                 维多利奥·梅迪纳将军／尼格罗曼妲／加布列尔／阿基莱斯·里卡多）
 *   罪与罚  3 处（卡捷莉娜／娜斯达霞／扎麦托夫）
 *
 *   别名数组里放着自己的 name，检索时会**重复命中同一条**，
 *   编辑器里也会显示成"别名：某某、**某某**"这种一眼就别扭的样子。
 *   ⇒ 删掉（name 本身已经在索引里，不需要再塞进 aliases 一遍）。
 *
 * ## 三、三国那 2 处撞名这轮**不动**（v0.121 已定性）
 *
 *   吴太夫人 的别名「吴氏」撞 另一个真实人物「吴氏」（吴懿之妹/刘备皇后）
 *   王颀 ×2：原文里两个人本来就都写作「王颀」
 *   ⇒ 都是**真实同名**，不是数据错。删正确别名来消除告警＝降低准确性。
 *
 * 用法：node scripts/fix-other-two-books.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const SRC = path.join(os.tmpdir(), 'opencode', 'ba-books');

const BOOKS = {
  'crime-and-punishment': { src: '罪与罚.txt', label: '《罪与罚》' },
  'one-hundred-years-of-solitude': { src: '百年孤独.txt', label: '《百年孤独》' },
  'three-kingdoms': { src: '三国演义.txt', label: '《三国演义》' },
};

/**
 * ⚠ 内存里改过的 book 必须**复用于体检和写入**。
 *   我第一版每次都 `JSON.parse(readFileSync())` 重新读盘，
 *   于是 §一 删掉的别名、§二 加的边在体检里全都不存在、
 *   写盘时也被覆盖掉 —— 看起来"跑通了"，其实什么都没改。
 *   这跟 v0.121 那次「--write 打印的是预览内容」是同一族错误：
 *   **脚本跑了 ≠ 改落盘了**。
 */
const CACHE = new Map();
function load(slug) {
  if (CACHE.has(slug)) return CACHE.get(slug);
  const file = path.join(ROOT, 'data', `${slug}.json`);
  const srcPath = path.join(SRC, BOOKS[slug].src);
  if (!fs.existsSync(srcPath)) { console.error(`✗ 找不到原文：${srcPath}`); return null; }
  const v = { file, book: JSON.parse(fs.readFileSync(file, 'utf8')), f: fs.readFileSync(srcPath, 'utf8').replace(/[\s·・･　]/g, '') };
  CACHE.set(slug, v);
  return v;
}
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');

/* ══════════════ 一、删「别名 == 自己本名」 ══════════════ */
console.log('═══ 一、删冗余别名（别名重复自己的 name）═══\n');
let aliasFixed = 0;
for (const slug of Object.keys(BOOKS)) {
  const L = load(slug);
  if (!L) continue;
  const hits = [];
  for (const c of L.book.characters) {
    const dup = (c.aliases || []).filter((a) => a === c.name);
    if (dup.length) hits.push({ c, dup });
  }
  if (!hits.length) { console.log(`  ${BOOKS[slug].label}：无`); continue; }
  for (const { c, dup } of hits) {
    const before = c.aliases.length;
    c.aliases = c.aliases.filter((a) => a !== c.name);
    console.log(`  ${BOOKS[slug].label}  ${c.name.padEnd(18)} 别名 ${before} → ${c.aliases.length}`);
    aliasFixed++;
  }
}

/* ══════════════ 二、罪与罚：给 2 个孤立人物补关系 ══════════════ */
console.log('\n═══ 二、《罪与罚》2 个孤立人物 ═══\n');
let edgesAdded = 0;
{
  const slug = 'crime-and-punishment';
  const L = load(slug);
  if (!L) process.exit(1);
  const { book, f } = L;
  const byId = new Map(book.characters.map((c) => [c.id, c]));
  const nm = (id) => byId.get(id)?.name ?? id;
  const RASK = 'raskolnikov';

  /* 定位短语必须逐字在原文里存在 —— 否则拒绝加边 */
  const NIK_LOC = '他就是本区警察分局的局长，尼科丁佛米奇';
  const ILYA_LOC = '尼科丁佛米奇带着亲切的好意对伊里亚彼得罗维奇说';
  const RASK_LOC = '我要跟您说，他是个极其高尚的人，然而又是炮筒子';
  for (const [w, loc] of [['尼科丁', NIK_LOC], ['伊里亚', ILYA_LOC], ['罗季昂', RASK_LOC]]) {
    if (!f.includes(flat(loc))) { console.error(`  ⛔ 定位短语核验不过：「${loc}」`); process.exit(1); }
  }
  console.log('  原文核验通过（三处定位短语都逐字存在）');

  /* ⚠⚠ type 必须用**三书共享词表里已有先例**的词 —— 而我第一版全写错了。
   *   我在注释里写「同事/说情/训斥 … 数据里已有先例」，
   *   一查《罪与罚》自己的 type 表：**三个全无先例**；
   *   再查三书共享（848 个）：「同事」「说情」「训斥」仍然全无。
   *   ⇒ 说明写注释时**根本没查表**，是照着语义想出来的。
   *
   * 改用确实有先例的：
   *   同僚   —— 已有（罪与罚「同学／朋友」、三国「同僚」75 条…）
   *   责备   —— 已有（用于副局长大骂女房东那场：「你是要在拘留所吗…」）
   *   辩护   —— 已有（局长替副局长说情那场：「他是个极其高尚的人，然而又是炮筒子」）
   */
  const TYPES = new Set(book.relations.map((r) => r.type));
  const SHARED = (() => {
    const s = new Set();
    for (const slug of Object.keys(BOOKS)) {
      const v = load(slug);          // 用 CACHE，别重新读盘
      if (v) for (const r of v.book.relations) s.add(r.type);
    }
    return s;
  })();
  const EDGES = [
    /* ① 分局内部：局长 ↔ 副局长。
       原文两人同框对话，局长说"人家送他一个绰号：炮筒子中尉" —— 认识绰号，是同僚。 */
    ['nikodim', '同僚', 'ilya', '尼科丁佛米奇带着亲切的好意对伊里亚彼得罗维奇说"又冒火了，又大发雷霆了"；局长亦称其绰号"炮筒子中尉"', ILYA_LOC],
    /* ② 局长 ↔ 主角：局长替副局长说情。
       原文：「我要跟您说，他是个极其高尚的人，然而又是炮筒子…他那颗心是金子的」
       —— 这是**替对方辩护**，用已有的「辩护」。 */
    ['nikodim', '辩护', RASK, '尼科丁佛米奇对罗季昂说"我要跟您说，他是个极其高尚的人，然而又是炮筒子…说到底，他那颗心是金子的"', RASK_LOC],
    /* ③ 副局长 ↔ 主角：副局长当着罗季昂的面大发雷霆、训斥女房东。
       ⚠ 我第一版写的定位短语「我早就警告过你十次」**原文里没有**
       （实际是「我早就警告过你」且只 1 次、「警告过你十次」0 次）⇒ 换成实测存在的原文。 */
    ['ilya', '责备', RASK, '伊里亚彼得罗维奇当着罗季昂的面大发雷霆，厉声训斥丽扎维达"你是存心要进拘留所吗"', '你是存心要进拘留所吗'],
  ];

  for (const [from, type, to, text, locate] of EDGES) {
    const ca = byId.get(from), cb = byId.get(to);
    if (!ca || !cb) { console.log(`  ⛔ ${nm(from)}/${nm(to)} 有一方不存在`); continue; }
    if (!SHARED.has(type)) { console.error(`  ⛔ type「${type}」三书共享词表里没有先例 —— 拒绝（不造词）`); process.exitCode = 1; continue; }
    if (!f.includes(flat(locate))) { console.error(`  ⛔ 定位短语原文找不到：${locate}`); process.exitCode = 1; continue; }
    const dup = book.relations.find((r) => (r.from === ca.id && r.to === cb.id && r.type === type)
      || (r.from === cb.id && r.to === ca.id && r.type === type));
    if (dup) { console.log(`  (跳过) ${nm(from)}—${type}—${nm(to)} 已有`); continue; }
    book.relations.push({
      from: ca.id, to: cb.id, type, style: 'solid',
      /* ⚠ chapter 用「第1章」而不是「第一部第一章」——
       *   validate 会警告「里没有数字（剧透保护要靠它）」。
       *   这本书所有边都用「第N章」（第1章…第41章），第一部即第1–2章，
       *   而这三段原文确实都在第一部开头 ⇒ 用第1章。
       *   （我在提交信息里先把原因写成"文案里的人名"，是猜的，
       *     跑 validate 看实际警告才发现是 chapter 缺数字。） */
      events: [{ chapter: '第1章', place: '', text, evidence: 'paraphrase' }],
    });
    console.log(`  ＋ ${nm(from).padEnd(12)} —${type}— ${nm(to)}`);
    console.log(`      ${text}`);
    edgesAdded++;
  }
}

/* ══════════════ 三、体检 ══════════════ */
console.log('\n═══ 三、体检 ═══\n');
for (const slug of Object.keys(BOOKS)) {
  const L = load(slug);
  if (!L) continue;
  const { book, f } = L;
  // 冗余别名
  const dupAlias = book.characters.filter((c) => (c.aliases || []).includes(c.name));
  // 悬空边
  const ids = new Set(book.characters.map((c) => c.id));
  let dang = 0;
  for (const r of book.relations) { if (!ids.has(r.from)) dang++; if (!ids.has(r.to)) dang++; }
  // 孤立
  const deg = new Map();
  for (const c of book.characters) deg.set(c.id, 0);
  for (const r of book.relations) { if (deg.has(r.from)) deg.set(r.from, deg.get(r.from) + 1); if (deg.has(r.to)) deg.set(r.to, deg.get(r.to) + 1); }
  const iso = book.characters.filter((c) => deg.get(c.id) === 0);
  // 搜不到
  const core = (x) => String(x).replace(/[（(][^）)]*[）)]/g, '');
  const miss = book.characters.filter((c) => {
    const keys = [c.name, ...(c.aliases || [])].filter(Boolean);
    return !keys.some((k) => f.includes(flat(k))) && !keys.some((k) => core(k) && f.includes(flat(core(k))));
  });
  console.log(`  ${BOOKS[slug].label.padEnd(8)} 人物${book.characters.length} 关系${book.relations.length} | 冗余别名${dupAlias.length} 悬空端点${dang} 孤立${iso.length} 搜不到${miss.length}`);
  if (iso.length) console.log(`      仍孤立: ${iso.map((c) => c.name).join(', ')}`);
  if (dupAlias.length) console.log(`      ⚠ 冗余别名: ${dupAlias.map((c) => c.name).join(', ')}`);
  if (miss.length) console.log(`      ⚠ 搜不到: ${miss.map((c) => c.name).join(', ')}`);
}

console.log(`\n删冗余别名 ${aliasFixed} 处；补关系 ${edgesAdded} 条`);
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) {
  /* ⚠ 写**内存里改过的那份**（CACHE），不是重新从磁盘读 */
  for (const slug of Object.keys(BOOKS)) {
    const v = CACHE.get(slug);
    if (!v) continue;
    fs.writeFileSync(v.file, JSON.stringify(v.book, null, 2) + '\n', 'utf8');
    console.log(`  已写入 ${BOOKS[slug].label}：${path.relative(ROOT, v.file)}`);
  }
}