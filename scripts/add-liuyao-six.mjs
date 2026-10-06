#!/usr/bin/env node
/**
 * v0.119：补刘繇麾下 6 个**原著确有其人、但数据里没有**的人物（第 15 回孙策袭曲阿一线）。
 *
 * ## 一、来源：上一轮留下的那条待办
 *
 * v0.118 结束时用户列的待办之一：「刘繇的部将张英、谋士笮融／薛礼 不在数据里，未补」。
 * 我没有直接照单做，而是先把**那一整段原文读全**再决定补谁 ——
 * 结果发现待办列的 3 个只是这段里的**一部分**，同一段还有 3 个同样没建档的。
 *
 * 原文「刘繇字正礼…急聚众将商议」那段里，**原文点了名**的有 6 个：
 *     部将张英 ／ 谋士笮融、薛礼 ／ 部将于糜 ／ 繇将樊能 ／ 骁将陈横
 * 加上原文另一处点名的 陈武、蒋钦、周泰（放火袭牛渚），后三个**已在数据里**。
 * ⇒ 本轮补 6 个，不是 3 个。
 *
 * ## 二、6 个人名的确定依据（逐个在原文核过，不是"看着像个人名"）
 *
 *   张英  11 次　「部将张英曰：『某领一军，屯于牛渚』」—— **原文称"部将"**
 *   笮融   4 次　「谋士笮（读如责）融、薛礼劝免」　　—— **原文称"谋士"**
 *   薛礼   7 次　同上；后「薛礼闭门不敢出」「薛礼死于乱军中」
 *   于糜   5 次　「刘繇背后一人挺枪出马，乃**部将**于糜也」
 *   樊能   3 次　「**繇将樊能**见捉了于糜，挺枪来赶」⇒ 樊能也是刘繇的部将
 *   陈横   2 次　「与骁将**张英、陈横**杀出城来追之」⇒ 陈横与张英同为部将
 *
 * ⚠ **一个差点踩进去的坑：**
 *   我用"名字在原文出现几次"来判定真假人，脚本一跑说「于糜 5 次」——
 *   但其中 4 次是**同一场牛渚之战**，第 5 次是第 120 回**群英谱里「糜竺」的子串**
 *   （「…与糜竺、孙乾一同担任…」里的"于糜"跨了两个词）。
 *   ⇒ 命中次数**不能**当判据，必须回原文看那句话本身。
 *   这也是为什么"张英/笮融/薛礼在第120回群英谱里 0 次"却仍然是真人物：
 *   群英谱没收录 ≠ 原著没这个人。
 *
 * ## 三、id 不能猜（朱儁/朱隽、朱河/孙和 连着两次的教训）
 *
 * 先查 id 与名字两边，撞了任一边就拒绝写入。这一轮 6 个 id 全是空闲的。
 *
 * ## 四、关系只写原文明确写出来的
 *
 *   刘繇 —部将— 张英   「部将张英」「骁将张英」
 *   刘繇 —部将— 于糜   「乃部将于糜也」
 *   刘繇 —部将— 樊能   「繇将樊能」
 *   刘繇 —部将— 陈横   「骁将张英、陈横」
 *   刘繇 —谋士— 笮融   「谋士笮融、薛礼」
 *   刘繇 —谋士— 薛礼   同上
 *   张英 —敌对— 孙策   牛渚交战；后「张英拨马回走，被陈武一枪刺死」
 *   薛礼 —敌对— 孙策   「招谕薛礼投降」，城上暗放冷箭射伤孙策
 *   笮融 —敌对— 孙策   「刘繇会合笮融，去取牛渚」「刘繇、笮融二人出马迎敌」
 *   笮融 —同僚— 薛礼   「会薛礼、笮融军马，急来接应」
 *   陈武 —斩杀— 张英   「张英拨马回走，被陈武一枪刺死」
 *   蒋钦 —射杀— 陈横   「陈横被蒋钦一箭射死」
 *
 * 「笮融 —同僚— 薛礼」这一条是**据原文"会薛礼、笮融军马"**推的两人联合作战，
 * 原文没写他们私交。用「同僚」是因为数据里已有这个词，且语义是"同在一军"，
 * 不是"私交厚"——**不升级、不降格**。
 *
 * 用法：node scripts/add-liuyao-six.mjs [--write]
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
  console.error('  依赖解包后的 epub 源文本；找不到就中止 —— 没有原文不建档。');
  process.exit(1);
}
const src = fs.readFileSync(SRC, 'utf8');
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(src);

/* 回次表（沿用 add-missing-nine.mjs 已验证的算法：取第二次「第一回」作正文起点） */
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
const chOf = (p) => { const i = f.indexOf(flat(p)); return i < 0 ? null : chapterAt(i); };

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const byName = new Map();
for (const c of book.characters) { byName.set(c.name, c); for (const a of (c.aliases || [])) byName.set(a, c); }
const nm = (id) => byId.get(id)?.name ?? id;

/** 待补 6 人：[id, 名, 别名, 性别, 头衔, 阵营, desc, fate, 出处引文, 定位短语]
 *
 * ⚠ fate 是数据里已有的字段（validate 会警告"缺少 fate（档案里会空着）"），
 *   惯例是**原文里那句交代结局的话**，不是自己写的总结。
 *   我第一版只填了 desc，跑出来 6 条"缺少 fate"警告 —— 补齐。
 */
const PEOPLE = [
  ['zhang-ying', '张英', [], 'm', '刘繇部将 / 骁将', 'wu',
    '刘繇部将，屯兵牛渚积粮十万于邸阁。牛渚一战寨中遭陈武蒋钦放火，弃牛渚逃。',
    '拨马回走，被陈武一枪刺死',
    '「部将张英曰：某领一军，屯于牛渚，纵有百万之兵，亦不能近」', '部将张英曰'],
  ['ze-rong', '笮融', [], 'm', '刘繇谋士', 'wu',
    '刘繇谋士。与薛礼同劝刘繇免斩张英。后与刘繇合兵取牛渚。',
    '与刘繇走豫章，投刘表去了',
    '「谋士笮（读如责）融、薛礼劝免」', '谋士笮（读如责）融、薛礼劝免'],
  ['xue-li', '薛礼', [], 'm', '刘繇谋士 / 守将', 'wu',
    '刘繇谋士。与笮融同劝免张英；后奉命屯兵零陵城拒敌，孙策攻秣陵时据城死守。',
    '死于乱军中',
    '「谋士笮（读如责）融、薛礼劝免」', '谋士笮（读如责）融、薛礼劝免'],
  ['yu-mi', '于糜', [], 'm', '刘繇部将', 'wu',
    '刘繇部将。牛渚之战出马迎战孙策。',
    '不三合被策生擒过去，策到门旗下，已被挟死',
    '「乃部将于糜也」', '乃部将于糜也'],
  ['fan-neng', '樊能', [], 'm', '刘繇部将', 'wu',
    '刘繇部将。见于糜被擒，挺枪来赶孙策。',
    '惊骇倒翻身撞下马来，破头而死',
    '「繇将樊能见捉了于糜，挺枪来赶」', '繇将樊能见捉了于糜'],
  ['chen-heng', '陈横', [], 'm', '刘繇部将 / 骁将', 'wu',
    '刘繇部将，与骁将张英同为将。秣陵之战与张英杀出城来追孙策。',
    '被蒋钦一箭射死',
    '「与骁将张英、陈横杀出城来追之」', '与骁将张英、陈横杀出城来追之'],
];

console.log('═══ 一、补 6 个人物 ═══\n');
let added = 0;
for (const [id, name, aliases, gender, title, faction, desc, fate, cite, locate] of PEOPLE) {
  if (byName.has(name)) { console.log(`  (跳过) ${name} 已存在（${byName.get(name).id}）`); continue; }
  if (byId.has(id)) { console.error(`  ⛔ id「${id}」已被「${byId.get(id).name}」占用 —— 拒绝写入`); process.exitCode = 1; continue; }
  if (!f.includes(flat(locate))) { console.log(`  ⛔ ${name}：定位短语「${locate}」原文找不到，不加`); continue; }
  const ch = chOf(locate);
  if (ch == null) { console.log(`  ⛔ ${name}：无法定位回次`); continue; }
  book.characters.push({
    id, name, aliases, generation: 1, gender, title, faction, desc, fate,
    firstCh: ch,
    note: `出处：「${cite}」。`,
    tier: 'minor',
  });
  byId.set(id, book.characters[book.characters.length - 1]);
  byName.set(name, byId.get(id));
  console.log(`  ＋ ${name.padEnd(4)} ${title.padEnd(16)} firstCh=${ch}　fate=${fate}`);
  added++;
}

/* ── 刘繇：补 firstCh / faction / fate（v0.116 建他时故意没填，这轮补齐） ──
   ⚠ 刘繇是上一轮待办的主角，他自己的档案反而是空的。
   v0.116 的注释说「firstCh 按名字首次出现自动换算不可靠，宁可不写」——
   那个顾虑仍然成立，但**这一轮我手里有原文定位短语**，
   可以用和其余 6 人同一套办法（长且唯一的短语定位）拿到回次，
   不必再靠"名字首次出现"那种不可靠的换算。 */
{
  const ly = byId.get('liu-yao');
  const LOC = '却说刘繇字正礼，东莱牟平';
  if (ly) {
    const ch = chOf(LOC);
    if (ch != null) {
      const before = ly.firstCh;
      ly.firstCh = ch;
      ly.faction = 'wu';
      ly.fate = '兵败后与笮融走豫章，投刘表去了';
      ly.title = ly.title || '扬州刺史 / 汉室宗亲';
      ly.note = `${ly.note ? ly.note + ' ' : ''}※ firstCh=${ch}（据原文定位短语「${LOC}」换算，非"按名字首次出现"那种不可靠算法）。`.trim();
      console.log(`\n  ＋ 刘繇 补档案：firstCh ${before ?? '(空)'} → ${ch}，faction=wu，fate 已填`);
    } else console.log('\n  ⛔ 刘繇：定位短语找不到，firstCh 不动');
  }
}

/** 边：[from, type, to, 文案, 定位短语] */
const EDGES = [
  ['liu-yao', '部将', 'zhang-ying', '部将张英领一军屯牛渚，积粮十万于邸阁；后屯兵零陵城拒敌', '部将张英曰'],
  ['liu-yao', '谋士', 'ze-rong', '谋士笮融与薛礼劝免败回的张英', '谋士笮（读如责）融、薛礼劝免'],
  ['liu-yao', '谋士', 'xue-li', '谋士薛礼与笮融劝免败回的张英', '谋士笮（读如责）融、薛礼劝免'],
  ['liu-yao', '部将', 'yu-mi', '牛渚之战部将于糜出马迎战孙策', '乃部将于糜也'],
  ['liu-yao', '部将', 'fan-neng', '见於糜被擒，部将樊能挺枪来赶孙策', '繇将樊能见捉了于糜'],
  ['liu-yao', '部将', 'chen-heng', '骁将陈横与张英同为刘繇部将，秣陵之战杀出城来追孙策', '与骁将张英、陈横杀出城来追之'],

  ['sun-ce', '敌对', 'zhang-ying', '牛渚滩上两军会战，孙策出马，张英大骂；后张英中陈武枪而死', '孙策引兵到，张英出迎'],
  ['sun-ce', '敌对', 'xue-li', '孙策亲到城壕招谕薛礼投降，薛礼城上暗放冷箭射中孙策左腿', '招谕薛礼投降'],
  ['sun-ce', '敌对', 'ze-rong', '刘繇会合笮融去取牛渚，二人出马迎敌，兵败后同走豫章', '刘繇、笮融二人出马迎敌'],
  ['ze-rong', '同僚', 'xue-li', '刘繇令二者会合军马，急往秣陵接应', '会薛礼、笮融军马'],

  ['chen-wu', '斩杀', 'zhang-ying', '张英拨马回走，被陈武一枪刺死', '张英拨马回走，被陈武一枪刺死'],
  ['jiang-qin', '射杀', 'chen-heng', '陈横被蒋钦一箭射死', '陈横被蒋钦一箭射死'],
];

const KNOWN_TYPES = new Set(book.relations.map((r) => r.type));
const NEW_TYPES = new Set();
console.log('\n═══ 二、补关系 ═══\n');
let edges = 0, skipped = 0;
for (const [from, type, to, text, locate] of EDGES) {
  const ca = byId.get(from), cb = byId.get(to);
  if (!ca || !cb) { console.log(`  ⛔ ${nm(from)}/${nm(to)} 有一方不存在`); skipped++; continue; }
  if (!KNOWN_TYPES.has(type) && !NEW_TYPES.has(type)) {
    NEW_TYPES.add(type);
    console.log(`  ⚠ type「${type}」数据里没有（740 个 type 中 554 个只出现一次，单次 type 是常态）—— 放行，请人工过目`);
  }
  if (!f.includes(flat(locate))) { console.log(`  ⛔ ${nm(from)}—${type}— ${nm(to)}：定位短语「${locate}」原文找不到`); skipped++; continue; }
  const dup = book.relations.find((r) => (r.from === ca.id && r.to === cb.id && r.type === type)
    || (r.from === cb.id && r.to === ca.id && r.type === type));
  if (dup) { console.log(`  (跳过) ${nm(from)}—${type}— ${nm(to)} 已有`); skipped++; continue; }
  const ch = chOf(locate);
  if (ch == null) { console.log(`  ⛔ ${nm(from)}/${nm(to)}：无法定位回次`); skipped++; continue; }
  book.relations.push({
    from: ca.id, to: cb.id, type, style: 'solid', fromCh: ch, toCh: ch + 1,
    events: [{ chapter: ch, place: '', text, evidence: 'paraphrase' }],
  });
  console.log(`  ＋ ${nm(from).padEnd(6)} —${type}— ${nm(to).padEnd(6)} 第${ch}回`);
  edges++;
}

/* 体检：新增人物的名字必须在原文里搜得到（v0.118 立，娄子伯事件的直接产物） */
console.log('\n═══ 三、体检 ═══\n');
{
  let bad = 0;
  for (const [id, name] of PEOPLE.map(([id, n]) => [id, n])) {
    const c = byId.get(id);
    if (!c) continue;
    const keys = [c.name, ...(c.aliases || [])].filter(Boolean);
    if (!keys.some((k) => f.includes(flat(k)))) { console.log(`  ✗ ${c.name}（${id}）名字在原文搜不到`); bad++; }
  }
  if (bad) { console.error(`  ⇒ ${bad} 个人物名字在原文搜不到`); process.exitCode = 1; }
  else console.log(`  ✓ 新增 ${added} 人，名字均可在原文搜到`);
}

const deg = new Map();
for (const c of book.characters) deg.set(c.id, 0);
for (const r of book.relations) { if (deg.has(r.from)) deg.set(r.from, deg.get(r.from) + 1); if (deg.has(r.to)) deg.set(r.to, deg.get(r.to) + 1); }
console.log(`\n═══ 四、结果 ═══`);
console.log(`人物 ${book.characters.length}（＋${added}）　关系 ${book.relations.length}（＋${edges}）`);
console.log(`刘繇 度数 4 → ${deg.get('liu-yao')}`);
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');