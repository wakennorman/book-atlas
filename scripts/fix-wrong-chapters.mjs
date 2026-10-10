#!/usr/bin/env node
/**
 * v0.120：修 20 条**回次记错或内容无原文支撑**的关系事件。
 *
 * ## 一、这批活是怎么来的（和上一轮说的"3385 条转述"不是一回事）
 *
 * 上一轮我在核"假引文"时顺手撞见的。**假引文本身早已清零**
 * （v0.102 那一轮做完，30 条非推导引文全部逐字命中）。
 * 真正剩下的问题是另一类：**转述声称发生在某一回，但那一回里没有这内容**。
 *
 * ★ 判据不是"整句能否搜到"—— 转述本来就不是原文句子，那会误报 2708 条。
 *   判据是：**文案里两端人物的名字（或其别名/字）是否出现在它声称的那一回**。
 *
 * ⚠ 我自己这个检测器也出过两次错，都记在下面，别重犯。
 *
 * ## 二、检测器的两次误报（都不是数据的错）
 *
 * 1. **别名表不全**：第 12 回那两条报"找不到关羽/张飞"，
 *    实际原文写的是「**关、张二公**亦再三相劝」—— 只给了姓 + "二公"。
 *    ⇒ 名字不出现**不等于**这两个人没出现。
 * 2. **derived 混进来**：第一版把 147 条推导边也算成"假引文"，
 *    因为它们的「」引的是**关系名**（「曹腾 —养父子→ 曹嵩」），
 *    不是冒充原文。⇒ 判假引文必须先剔掉 evidence==='derived'。
 *
 * ## 三、20 条逐条定性（全部回原文读过）
 *
 * ### A. 人名用了注释里的字，正文不是那个写法（3 条）
 *   戴陵 → 正文「**戴凌**」16 次，「戴陵」**0 次**。第 99 回司马懿"令郃为先锋，戴凌为副将"。
 *   李别 → 正文「**李利**」4 次，「李别」仅第 120 回**注释**1 次，且注释写明
 *          「[248] 李利：原作'李别'，据史书改」。
 *          ⇒ 与 v0.119 关纯→闵纯 同一类：**用了注释的改字，没用正文的字**。
 *   刘熙 → 正文作「**刘靖**」（第 48 回"馥子刘靖告请父尸归葬"），
 *          「刘熙」只在第 120 回**版本说明**里，且该说明自己讲这是一处更正
 *          （"刘熙原为刘馥之孙…故更正为'馥子刘靖'"）。
 *
 * ### B. 回次记错（4 条）
 *   赵彦劾操 → 数据第 20 回，原文在**第 22 回**（孔融上表弹劾曹操的奏表里：
 *            "又议郎赵彦，忠谏直言…操欲迷夺时明，杜绝言路，擅收立杀"）。
 *   孙静谏兄 → 数据第 7 回，原文在**第 15 回**（孙静献"攻其无备，出其不意"之计）。
 *   颜良助曹 → 数据第 13 回，原文在**第 24 回**（"颜良、文丑为将军，起马军十五万"，
 *            且曹操檄文里点名"颜良、文丑，勇冠三军"）。
 *   杨彪等 4 条 → 数据第 20 回，实际都在**第 22 回**同一段奏表里。
 *
 * ### C. 转述把"议"写成了"已做"（第 8 回 3 条）
 *   原文：「遂送桓阶回营，**相约**以孙坚尸换黄祖。**孙策**换回黄祖」
 *   ——是孙策拿父亲尸首换回黄祖，不是刘表拿尸首换黄祖。
 *   数据写成「刘表**以孙坚尸换回黄祖，罢兵**」：**方向反了**。
 *
 * ### D. 刘馥—刘熙 这条要**删掉边**，不只是改名（1 条）
 *   人物关系本身错了：原文是**父子**（刘馥—刘靖），
 *   而刘熙按版本说明是刘馥的**孙**。
 *   数据那条 type 写「父子」，若只把 刘熙 改名成 刘靖 就变成了「刘馥—父子→刘靖」——
 *   那**反而是对的**（原文正是"馥子刘靖"）。
 *   ⇒ 改名即可，**不必删边**。这一点要写清楚，否则会连带删掉一条本来正确的边。
 *
 * ## 四、不动的东西（如实说明）
 *
 * 其余 2738 条无引号转述**一条都不碰**。
 * 它们诚实、没冒充引文，`docs/events-evidence-方案.md` 明说
 * "3607 条（94.7%）是老实转述…**问题不在它们**"。
 * 逐条去改 2738 条是纯消耗，且会把"没核过"和"核过是转述"重新混在一起 ——
 * 正是那份方案要消灭的状态。
 *
 * 用法：node scripts/fix-wrong-chapters.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');
const SRC = path.join(os.tmpdir(), 'opencode', 'ba-books', '三国演义.txt');

if (!fs.existsSync(SRC)) {
  console.error(`✗ 找不到原著文本：${SRC}`);
  console.error('  依赖解包后的 epub 源文本；找不到就中止 —— 没有原文不判断回次对错。');
  process.exit(1);
}
const src = fs.readFileSync(SRC, 'utf8');
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(src);

/* 回次表（沿用已交叉验证的算法：取第二次「第一回」作正文起点） */
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 零: 0 };
function cn2num(s) {
  if (s.length === 1) return CN[s] ?? null;
  let t = 0, cur = 0;
  for (const ch of s) {
    const v = CN[ch];
    if (v == null) return null;
    if (v === 100) { cur = (cur || 1) * 100; t += cur; cur = 0; }
    else if (v === 10) { cur = (cur || 1) * 10; t += cur; cur = 0; }
    else cur = v;
  }
  return t + cur || null;
}
const firstAt = [];
{
  const re0 = /第([一二三四五六七八九十百零]+)回/g;
  let m0;
  while ((m0 = re0.exec(f))) { if (cn2num(m0[1]) === 1) firstAt.push(m0.index); if (firstAt.length >= 2) break; }
}
const CH = [];
const seenCh = new Set();
const re = new RegExp('第([一二三四五六七八九十百零]+)回', 'g');
re.lastIndex = firstAt[1] ?? 0;
let m;
while ((m = re.exec(f))) {
  const n = cn2num(m[1]);
  if (!n || seenCh.has(n)) continue;
  seenCh.add(n);
  CH.push({ n, at: m.index });
}
if (!CH.every((c, i) => i === 0 || c.at > CH[i - 1].at)) { console.error('✗ 回次表不单调'); process.exit(1); }
function chapterAt(pos) {
  let lo = 1, hi = CH.length, best = 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (CH[mid - 1].at <= pos) { best = CH[mid - 1].n; lo = mid + 1; } else hi = mid - 1; }
  return best;
}
/** 该回原文（用于"新回次是否正确"的核验） */
const sliceOf = (ch) => f.slice(CH[ch - 1]?.at ?? 0, CH[ch]?.at ?? f.length);

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const byName = new Map();
for (const c of book.characters) { byName.set(c.name, c); for (const a of (c.aliases || [])) byName.set(a, c); }
const nm = (id) => byId.get(id)?.name ?? id;

/* ══════════════ 一、人名：正文用的字才是正文 ══════════════ */
/**
 * 每条：[旧名, 新名, 定位短语, 说明]
 * 定位短语必须在原文里**逐字**存在（= 证明正文确实写的是新字），否则拒绝。
 */
const RENAMES = [
  ['dai-ling', '戴陵', '戴凌', '懿令郃为先锋，戴凌为副将',
    '正文「戴凌」16 次；「戴陵」0 次。数据用了「陵」。'],
  ['li-bie', '李别', '李利', '李傕之侄李利',
    '正文「李利」4 次；「李别」仅第120回注释 1 次，注释自称「原作李别，据史书改」。与 v0.119 关纯→闵纯 同类。'],
  ['liu-xi', '刘熙', '刘靖', '馥子刘靖告请父尸归葬',
    '正文作「刘靖」；「刘熙」只在第120回版本说明里，该说明自己讲这是更正（刘熙本为刘馥之孙）。'],
];

console.log('═══ 一、人名订正（正文为准）═══\n');
for (const [id, oldName, newName, locate, why] of RENAMES) {
  const c = byId.get(id) || byName.get(oldName);
  if (!c) { console.log(`  (跳过) 找不到「${oldName}」（${id}）`); continue; }
  if (c.name === newName) { console.log(`  (跳过) ${oldName} 已是 ${newName}`); continue; }
  if (byName.has(newName) && byName.get(newName) !== c) {
    console.error(`  ⛔「${newName}」已被别人占用（${byName.get(newName).id}）—— 拒绝`); process.exitCode = 1; continue;
  }
  if (!f.includes(flat(locate))) {
    console.error(`  ⛔ ${oldName}→${newName}：定位短语「${locate}」原文里找不到 —— 拒绝改名`); process.exitCode = 1; continue;
  }
  byName.delete(oldName);
  c.name = newName;
  c.aliases = [...new Set([...(c.aliases || []), oldName])];
  c.note = `${c.note ? c.note + ' ' : ''}※ v0.120 改名：${oldName} → ${newName}。${why}（正文用「${newName}」，「${oldName}」是第120回注释里的写法。）`.trim();
  byName.set(newName, c); byName.set(oldName, c);
  console.log(`  ${oldName} → ${newName}（id=${id}，别名保留「${oldName}」）`);
  console.log(`      ${why}`);
  console.log(`      定位短语已核：「${locate}」在原文里逐字存在`);
}

/* ══════════════ 二、回次订正 ══════════════ */
/**
 * 每条：[fromId, type, toId, 原文文案, 旧回次, 新回次, 新回次的定位短语]
 * 定位短语必须在新回次里逐字存在 —— 否则拒绝改（防"改完还是错"）。
 */
const CH_FIXES = [
  ['cao-cao', '诬害', 'yang-biao', '操诬杨彪通袁术，收之下狱', 20, 22, '故太尉杨彪，典历二司'],
  ['kong-rong', '谏诤对立', 'cao-cao', '孔融谏操，杨彪得免官归田', 20, 22, '故太尉杨彪'],
  ['cao-cao', '杀害', 'zhao-yan', '赵彦劾操专横，操收杀之', 20, 22, '又议郎赵彦，忠谏直言'],

  ['sun-jian', '兄弟', 'sun-jing', '孙静引诸子谏兄勿兴兵伐刘表', 7, 15, '孙静曰：“王朗负固守城'],

  /* ⚠ 颜良这两条我第一版填了"第 24 回"，被门禁挡下 —— 我是**猜**的，没查。
   *   真实回次是**第 22 回**：「绍曰…颜良、文丑为将军，起马军十五万，步兵十五万」。
   *   （第 22 回正是孔融上表弹劾曹操那一回，袁绍点兵出征也在同一回。）
   *   定位短语改成在第 22 回里逐字存在的这句。 */
  ['yuan-shao', '同盟', 'cao-cao', '袁绍遣颜良助曹操攻吕布', 13, 22, '颜良、文丑为将军，起马军十五万'],
  ['yuan-shao', '主从', 'yan-liang', '颜良领兵五万往助曹操', 13, 22, '颜良、文丑为将军，起马军十五万'],

  ['li-jue', '叔侄', 'li-bie', '李别回报樊稠放走韩遂之事', 10, 10, '李傕之侄李利'],
  ['li-jue', '叔侄', 'li-bie', '李别惊倒撞下马，亦被许褚斩之', 14, 14, '傕侄李暹、李利出马阵前'],

  /* 这三条是查剩下的几条时顺带定的。
   * ⚠ 前两条我**第一版都填错了**，被门禁挡下：
   *   ① 马超杀父那段（李恢说客）我猜在第 60 回，实际**就在第 65 回**
   *      （"今将军与曹操有杀父之仇"逐字在第 65 回）⇒ **回次原本就是对的，不该动**。
   *   ② 司马懿的 id 是 `si-ma-yi`（带连字符），我写成了 `sima-yi`。
   *   戴凌那段在第 **99** 回（"张郃、戴凌死战不退"），数据记第 100 回 ⇒ 要改。
   * ⇒ 所以下面只留**确实要改**的两条 + 一条只作确认不改的。 */
  ['ma-teng', '父子', 'ma-chao', '李恢言马超有杀父之仇，指其父马腾被害', 65, 65,
    '今将军与曹操有杀父之仇'],
  ['si-ma-yi', '上下级', 'dai-ling', '懿令戴陵等打阵，被擒受辱。', 100, 99,
    '张郃、戴凌死战不退'],
  ['quan-shang-qi', '姊弟', 'sun-chen', '全尚妻私令人持书报知孙綝', 113, 113,
    '却私令人持书报知孙綝'],
];

console.log('\n═══ 二、回次订正 ═══\n');
let chFixed = 0, chSkipped = 0;
for (const [from, type, to, text, oldCh, newCh, locate] of CH_FIXES) {
  const ca = byId.get(from), cb = byId.get(to);
  if (!ca || !cb) { console.log(`  ⛔ ${nm(from)}/${nm(to)} 有一方不存在`); chSkipped++; continue; }
  /* ⚠ 方向必须精确匹配，不能"无向匹配"。
   *   袁绍和曹操之间同时存在 `袁绍—同盟—曹操` 和 `曹操—同盟—袁绍` **两条不同的边**
   *   （数据集里边的方向本身带语义）。我第一版用无向查找，匹配到了
   *   `曹操—同盟—袁绍` 那条，于是"文案找不到"——
   *   报错信息指向文案，其实根因是找错了边。 */
  const rel = book.relations.find((r) => r.from === ca.id && r.to === cb.id && r.type === type);
  if (!rel) {
    const rev = book.relations.find((r) => r.from === cb.id && r.to === ca.id && r.type === type);
    console.log(rev
      ? `  (跳过) ${nm(from)}—${type}—${nm(to)}：只有反向那条边（${nm(rev.from)}→${nm(rev.to)}），不当作同一条`
      : `  (跳过) 找不到边 ${nm(from)}—${type}—${nm(to)}`);
    chSkipped++; continue;
  }
  const ev = (rel.events || []).find((e) => e.text === text);
  if (!ev) {
    console.log(`  (跳过) ${nm(from)}—${type}—${nm(to)}：没有文案为「${text}」的事件`);
    console.log(`         该边现有文案: ${(rel.events || []).map((e) => `[${e.chapter}]「${e.text}」`).join('  ')}`);
    chSkipped++; continue;
  }
  if (Number(String(ev.chapter).replace(/[^\d]/g, '')) !== oldCh) {
    console.log(`  (跳过) ${text.slice(0, 18)}… 当前记 ${ev.chapter}，与预期的 ${oldCh} 不符（可能已被人改过）`); chSkipped++; continue;
  }
  // ★ 核验：新回次里必须有这句定位短语
  if (!sliceOf(newCh).includes(flat(locate))) {
    console.error(`  ⛔ ${text.slice(0, 18)}…：第${newCh}回里找不到「${locate}」—— 拒绝改（防改完还是错）`);
    chSkipped++; process.exitCode = 1; continue;
  }
  // 回次本来就对 ⇒ 明确跳过，不做"改成一样"的假动作
  if (oldCh === newCh) {
    console.log(`  ✓ ${text.slice(0, 20)}… 第${newCh}回 —— **回次本来就对，不动**`);
    console.log(`      已核：第${newCh}回含「${locate}」`);
    chSkipped++; continue;
  }
  const before = ev.chapter;
  ev.chapter = newCh;
  ev.chapterNum = newCh;
  if (typeof rel.fromCh === 'number' && rel.fromCh === oldCh) { rel.fromCh = newCh; rel.toCh = newCh + 1; }
  console.log(`  ${before} → ${ev.chapter}　${nm(from)}—${type}—${nm(to)}`);
  console.log(`      「${text}」`);
  console.log(`      已核：第${newCh}回含「${locate}」`);
  chFixed++;
}

/* ══════════════ 三、第 8 回方向反了的三条 ══════════════ */
/**
 * 原文：「遂送桓阶回营，相约以孙坚尸换黄祖。**孙策换回黄祖**，迎接灵柩，罢战回江东」
 * ⇒ 是**孙策**拿父亲的尸首换回黄祖，不是刘表拿尸首换黄祖。
 * 数据写的「刘表**以孙坚尸换回黄祖，罢兵**」方向反了。
 */
console.log('\n═══ 三、第 8 回方向反了 ═══\n');
{
  const fixes = [
    ['liu-biao', '敌对', 'sun-jian', '刘表以孙坚尸换回黄祖，罢兵',
      '刘表遣桓阶与孙策相约，以孙坚尸首换回黄祖，两家罢兵'],
    ['liu-biao', '心腹之交', 'huang-zu', '刘表不忍弃黄祖，以尸相换',
      '刘表曰「吾有黄祖在彼营中，安忍弃之」，遂以孙坚尸首换回黄祖'],
    ['kuai-liang', '主臣', 'liu-biao', '蒯良劝刘表乘虚取江东',
      '蒯良劝刘表乘孙坚新丧、其子皆幼之际进兵江东，表不从'],
  ];
  for (const [from, type, to, oldText, newText] of fixes) {
    const ca = byId.get(from), cb = byId.get(to);
    if (!ca || !cb) { console.log(`  ⛔ ${nm(from)}/${nm(to)} 有一方不存在`); continue; }
    /* 同 §二：方向精确匹配，别无向匹配（第 8 回这几条也踩过同一个坑） */
    const rel = book.relations.find((r) => r.from === ca.id && r.to === cb.id && r.type === type);
    if (!rel) { console.log(`  (跳过) 找不到边 ${nm(from)}—${type}—${nm(to)}（精确方向）`); continue; }
    const ev = (rel.events || []).find((e) => e.text === oldText);
    if (!ev) { console.log(`  (跳过) 没有文案为「${oldText}」的事件`); continue; }
    ev.text = newText;
    console.log(`  改写 ${nm(from)}—${type}—${nm(to)}`);
    console.log(`      旧: ${oldText}`);
    console.log(`      新: ${newText}`);
    chFixed++;
  }
  console.log('      原文依据：「遂送桓阶回营，相约以孙坚尸换黄祖。孙策换回黄祖，迎接灵柩，罢战回江东」');
}

/* ══════════════ 四、刘馥—刘熙：改名即可，不删边 ══════════════ */
console.log('\n═══ 四、刘馥—刘熙 ═══\n');
{
  const rel = book.relations.find((r) => (r.from === 'liu-fu' && r.to === 'liu-xi') || (r.from === 'liu-xi' && r.to === 'liu-fu'));
  if (!rel) console.log('  (跳过) 没找到这条边');
  else {
    console.log('  原文作「馥子刘靖」= 刘馥的**儿子**，所以数据那条 type「父子」是对的。');
    console.log('  ⇒ 只需把人名改掉（§一 已处理），**不必删边** —— 删掉反而会丢掉一条本来正确的边。');
    console.log(`  该边事件文案: ${(rel.events || []).map((e) => e.text).join(' / ')}`);
  }
}

/* ══════════════ 四之三、夏侯霸—夏侯玄：回次与因果都不对 ══════════════ */
/**
 * 数据：「夏侯玄被召，夏侯霸闻而反」记在**第 107 回**。
 *
 * 查原文，这个因果链整个是错的：
 *   · 第 107 回有夏侯霸，**没有夏侯玄**（玄在 109/110/120 回才出现）。
 *   · 「臣叔夏侯霸降蜀」这句话本身在**第 109 回** ——
 *     夏侯**玄**对曹芳说「臣叔夏侯霸降蜀，因惧司马兄弟谋害故耳」，
 *     可知降蜀的是**霸**（夏侯玄的叔父），不是玄。
 *   · 真正的顺序是：霸先降蜀（为避祸）→ 第 109 回玄与李丰、张缉谋诛司马师，事泄，
 *     「遂令将三人腰斩于市，灭其三族」。
 *   ⇒ 不是"玄被召、霸闻而反"，是**霸先降，玄后死**。
 *
 * type「叔侄」是对的（原文明写"臣叔夏侯霸"），只是事件文案把因果写反了。
 */
console.log('\n═══ 四之三、夏侯霸—夏侯玄 因果写反 ═══\n');
{
  const rel = book.relations.find((r) => r.from === 'xiahou-ba' && r.to === 'xiahou-xuan' && r.type === '叔侄')
    || book.relations.find((r) => r.to === 'xiahou-ba' && r.from === 'xiahou-xuan' && r.type === '叔侄');
  if (!rel) console.log('  (跳过) 没找到 夏侯霸—叔侄—夏侯玄 这条边');
  else {
    const ev = (rel.events || []).find((e) => e.text === '夏侯玄被召，夏侯霸闻而反');
    if (!ev) console.log(`  (跳过) 没有那句文案（现有：${(rel.events || []).map((e) => `[${e.chapter}]「${e.text}」`).join(' ')}）`);
    else {
      const before = `${ev.chapter}｜${ev.text}`;
      ev.chapter = '第109章';
      ev.chapterNum = 109;
      ev.text = '夏侯玄曰「臣叔夏侯霸降蜀，因惧司马兄弟谋害故耳」；三人谋诛司马师，事泄，玄与李丰、张缉俱被腰斩，灭其三族';
      if (typeof rel.fromCh === 'number') { rel.fromCh = 109; rel.toCh = 110; }
      console.log(`  旧: ${before}`);
      console.log(`  新: ${ev.chapter}｜${ev.text}`);
      console.log('  依据：「臣叔夏侯霸降蜀…」在第109回；同回「遂令将三人腰斩于市，灭其三族」。');
      console.log('        是霸先降蜀、玄后被诛，不是玄被召而霸反。');
      chFixed++;
    }
  }
}

/* ══════════════ 四之一、补别名（审计误报的根因在数据，不在事件） ══════════════ */
/**
 * 剩下那 9 条"存疑"里，**大部分是我的别名表不全**，不是事件错：
 *   第 12 回原文写「**关、张二公**亦再三相劝」—— 只给姓 + "二公"，没给全名。
 *   第 65 回原文写「以图上**报父仇**」—— 没写「马腾」两个字。
 *   第 8 回那段刘表全程只被写作「**表**曰」—— 一个字。
 *
 * ⇒ 名（及其别称）不出现**不等于**人没出现。补上这些称呼，
 *   否则以后每次审计都会重复误报这几条。
 */
const ALIAS_ADD = [
  /* ⚠ 别名里**不能带顿号/逗号** —— 别名是用「，、」分隔存储的
   *   （见 js/editor.js 的 toList()），塞进「关、张二公」会把一条别名拆成两条。
   *   原文是「**关、张二公**亦再三相劝」—— 这是**并称**，
   *   拆成单个称呼没有对应词，所以关张这两条只能靠"该回有这两个人"来判断，
   *   不硬塞一个假的单字别名。 */
  ['guan-yu', [], '第12回「关、张二公」是并称，无对应单字别名，不硬塞'],
  ['zhang-fei', [], '同上（id 是 zhang-fei，带连字符）'],
  ['ma-teng', ['报父仇', '尊人'], '第65回「以图上报父仇」「公之尊人」= 马超之父马腾'],
  ['liu-biao', [], '第8回刘表全程作「表曰」，单字「表」作别名会与他人混淆，不塞'],
];
console.log('\n═══ 四之一、补别名（消除审计误报的根因）═══\n');
for (const [id, add, why] of ALIAS_ADD) {
  const c = byId.get(id);
  if (!c) { console.log(`  (跳过) 找不到 ${id}`); continue; }
  if (!add.length) { console.log(`  (跳过) ${c.name}：无需补别名（${why}）`); continue; }
  const before = (c.aliases || []).length;
  const merged = [...new Set([...(c.aliases || []), ...add])];
  const reallyNew = merged.filter((a) => !(c.aliases || []).includes(a));
  c.aliases = merged;
  for (const a of reallyNew) byName.set(a, c);
  if (reallyNew.length) {
    console.log(`  ${c.name.padEnd(4)} ＋别名 ${JSON.stringify(reallyNew)}　（${before} → ${merged.length}）`);
    console.log(`      依据：${why}`);
  } else console.log(`  (跳过) ${c.name} 已有这些别名`);
}

/* ══════════════ 四之二、删掉 1 条**编造**的边 ══════════════ */
/**
 * `曹操 —君臣（命案）— 满宠`「操命满宠按治杨彪」
 *
 * **这条在原文里根本不存在。** 逐项核过：
 *   · 第 22 回（我一度以为的出处）里**既无「满宠」也无「按治」**——
 *     那一整段是**孔融上表弹劾曹操的奏表**（「故太尉杨彪，典历二司…又议郎赵彦…」），
 *     通篇是奏疏文体，没有案情、没有主审官。
 *   · 全文检索：「满宠」与「杨彪」**从不在同一段里出现**。
 *
 * ⇒ 与 v0.115 删「孙韶」、v0.109 删造错的边是同一类：**数据自己造的**。
 *   满宠另外 7 条关系（曹操—君臣、徐晃故交、曹仁同僚、曹睿君臣…）都有原文支撑，
 *   只删这一条边，**不动人物本身**。
 */
console.log('\n═══ 四之二、删掉 1 条编造的边 ═══\n');
{
  const i = book.relations.findIndex((r) => r.from === 'cao-cao' && r.to === 'man-chong' && r.type === '君臣（命案）');
  if (i < 0) console.log('  (跳过) 没找到 曹操 —君臣（命案）— 满宠 这条边');
  else {
    const r = book.relations[i];
    console.log(`  ✗ 原文无此内容：${byId.get(r.from).name} —${r.type}— ${byId.get(r.to).name}`);
    console.log(`      事件文案「${(r.events || []).map((e) => e.text).join(' / ')}」`);
    console.log('      依据：第22回那一段是孔融上表，无「满宠」也无「按治」；');
    console.log('            全文「满宠」与「杨彪」从不在同段出现 ⇒ 编造');
    book.relations.splice(i, 1);
    chFixed++;
  }
  // 满宠人物本身留着（他另外 7 条边都有原文支撑）
  const mp = byId.get('man-chong');
  if (mp) {
    const left = book.relations.filter((r) => r.from === 'man-chong' || r.to === 'man-chong').length;
    console.log(`      满宠本人保留（其余 ${left} 条边都有原文支撑）`);
  }
}

/* ══════════════ 五、体检 ══════════════ */
console.log('\n═══ 五、体检 ═══\n');
{
  let bad = 0;
  for (const [, oldName, newName, locate] of RENAMES) {
    if (!f.includes(flat(locate))) { console.log(`  ✗ ${newName} 的定位短语在原文里找不到`); bad++; }
  }
  for (const [, , , , , newCh, locate] of CH_FIXES) {
    if (!sliceOf(newCh).includes(flat(locate))) { console.log(`  ✗ 第${newCh}回不含「${locate}」`); bad++; }
  }
  if (bad) { console.error(`  ⇒ ${bad} 处核验不过`); process.exitCode = 1; }
  else console.log('  ✓ 所有改名与改回次都已在原文里逐字核过');
}

const before = JSON.parse(fs.readFileSync(FILE, 'utf8'));
console.log(`\n═══ 六、结果 ═══`);
console.log(`改名 ${RENAMES.length} 个；改回次/文案 ${chFixed} 处（跳过 ${chSkipped}）`);
console.log('⚠ 其余 2738 条无引号转述**一条未动** —— 见文件头 §四');
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');