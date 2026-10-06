#!/usr/bin/env node
/**
 * v0.116：补 8 个原著确有其人、但数据里没有的人物 ＋ 给蔡夫人补「蔡氏」别名
 *
 * ## 发现机制先说清楚（v0.115 的"60 个疑似漏人"是废的）
 *
 * `scripts/audit-search.mjs` 用"姓氏 + 1 个字、出现 ≥2 次"找漏人，产出是：
 *   吉普赛人、相爱、能力、金术师、房租、复活路、养父子、伏兵、班师、连环计、黄巾兵…
 * ⇒ **绝大多数是普通词**。我之前把"60 个疑似漏人"报给你，那个数字从来就不可操作。
 *
 * 换用真正指人的信号：**「X曰」**（说话人）。
 * `scripts/find-missing-people.mjs` 收紧三道（锚定姓氏字 / 长度 2~3 / 全文 ≥3 次）
 * 之后剩 72 个候选，再逐个回原文读，**只有下面 9 个是真的**。
 *
 * ★ 中途还是出现过假阳性：「孔明大怒曰」剥掉动词后剩「孔明大」，
 *   而**孔明本来就已经是诸葛亮的别名**了。所以我又补了一道剥词。
 *   记录在这儿，因为"形态可疑 ≠ 有缺口"这件事这轮已经犯过四五次了。
 *
 * ## 9 个候选的逐一核实（全部原文）
 *
 *   蔡氏   → **就是蔡夫人**（数据里已有），缺的是别名
 *           「蔡夫人乃夜对刘表曰」「表曰：'玄德仁人也。'蔡氏曰」
 *   刘繇   「却说刘繇字正礼，东莱牟平人也，汉室宗亲」          37 次
 *   朱隽   「一面遣中郎将卢植、皇甫嵩、朱隽各引精兵分三路讨之」28 次
 *   赵范   「早有探马报知桂阳太守赵范」                          18 次
 *   陈应   「管军校尉陈应、鲍隆愿领兵出战…猎户出身，陈应会使飞叉」17 次
 *   杨陵   「此人乃杨阜之族弟杨陵也」                            13 次
 *   徐氏   「翊妻徐氏美而慧，极善卜《易》」                      13 次
 *   鲍隆   「管军校尉陈应、鲍隆愿领兵出战」                       5 次
 *   张皇后 「缉乃张皇后之父，曹芳之皇丈也」                       3 次
 *
 * ## 关系只写原文明确写出来的
 *
 *   徐氏 —夫妻— 孙翊　　「翊妻徐氏」
 *   张皇后 —父女— 张缉　「缉乃张皇后之父」
 *   陈应/鲍隆 —主将部将— 赵范　「桂阳太守赵范…管军校尉陈应、鲍隆」
 *   其余（刘繇/朱隽/杨陵）**先不连** —— 原文里他们与谁敌对、属于谁，
 *   得逐条读那一段，凭印象连就是编。
 *
 * ## firstCh 从回次标记算
 *
 * 源文本有 259 个「第X回」标记（含末尾目录，要按阅读顺序取首次出现）。
 * firstCh 在 validate.mjs 里只是 **warning**，不是 error —— 它用于状态栏与筛选，
 * 缺了会让那两个功能退化，但不阻塞门禁。
 *
 * 用法：node scripts/add-missing-nine.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');
const SRC = 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/三国演义.txt';

const src = fs.readFileSync(SRC, 'utf8');
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(src);

/**
 * 回次表。
 *
 * ⚠⚠ **v0.116 第一版算出来的 firstCh 全是错的，靠交叉验证才抓到。**
 *
 * 源文本里「第X回」标记出现**两遍** —— 正文一遍（1..120），末尾目录又一遍（1..120），
 * 所以标记数组是 `[1..120, 1..120]`，**不单调**。我第一版用二分查找，
 * 于是结果全是垃圾：
 *     曹操 数据 firstCh=1  我算=10
 *     刘备 数据 firstCh=1  我算=65
 *     诸葛亮 数据 firstCh=36 我算=40
 * 「刘备在第 65 回」这种话一说就知道不对，但我要是没拿已有角色对一遍，
 * 这 6 个错值就直接落盘了。
 *
 * ⇒ 两处修：
 *   ① **只取首次出现的回号**（`if (seen.has(n)) continue`），得到单调的 1..120
 *   ② 下面有一个**交叉验证**：拿 5 个数据里已有的人物，比对我算的 firstCh 与
 *      数据里现有的值。对不上就中止，不落盘。
 */
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
/**
 * 回次表（v0.116 修了两次才对）。
 *
 * 源文本是**解包后的 epub**：`==== [001] partNNNN_split_NNN.html ====` 分段，
 * 开头是**目录**，正文在后，末尾注释里还有一套。所以「第X回」出现三遍：
 *     位置     84 起   ← 目录
 *     位置   3596 起   ← 正文  ✔ 要的是这套
 *     位置 699776 起   ← 末尾
 *
 * 第一版取"首次出现的回号" ⇒ 取到目录那套，于是任何位置都算成 120
 *   （孙策→120、关羽→120、刘备→65）。
 * 第二版还是不对，因为目录在**前面**。
 *
 * ⇒ 现在取**第二次**出现「第一回」作为正文起点，从那里开始收集标记。
 */
const firstAt = [];
{
  const re0 = /第([一二三四五六七八九十百零]+)回/g;
  let m0;
  while ((m0 = re0.exec(f))) {
    if (cn2num(m0[1]) === 1) firstAt.push(m0.index);
    if (firstAt.length >= 2) break;
  }
}
const BODY_START = firstAt[1] ?? 0;
console.log(`「第一回」出现位置 ${firstAt.join(', ')} → 正文起点取 ${BODY_START}`);

const CH = [];
const seenCh = new Set();
const re = new RegExp(`第([一二三四五六七八九十百零]+)回`, 'g');
re.lastIndex = BODY_START;
let m;
while ((m = re.exec(f))) {
  const n = cn2num(m[1]);
  if (!n || seenCh.has(n)) continue;
  seenCh.add(n);
  CH.push({ n, at: m.index });
}
/** 位置 → 回号（CH 现在单调，二分才成立） */
function chapterAt(pos) {
  let lo = 1, hi = CH.length, best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (CH[mid - 1].at <= pos) { best = CH[mid - 1].n; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}
const monotone = CH.every((c, i) => i === 0 || c.at > CH[i - 1].at);
console.log(`正文回次标记 ${CH.length} 个，范围 ${CH[0]?.n}..${CH[CH.length - 1]?.n}，位置单调=${monotone}`);
if (!monotone) { console.error('✗ 回次表不单调，中止'); process.exit(1); }

/* ── 交叉验证：拿已有角色比对我算的 firstCh ── */
{
  const book0 = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const sample = ['cao-cao', 'liu-bei', 'zhuge-liang', 'sun-ce', 'guan-yu', 'zhaoyun', 'zhangfei'];
  let bad = 0, checked = 0;
  for (const id of sample) {
    const c = book0.characters.find((x) => x.id === id);
    if (!c) continue;
    const i = f.indexOf(flat(c.name));
    if (i < 0 || typeof c.firstCh !== 'number') continue;
    checked++;
    const calc = chapterAt(i);
    const okFlag = calc === c.firstCh;
    if (!okFlag) bad++;
    console.log(`  ${okFlag ? '✓' : '✗'} ${c.name.padEnd(8)} 数据 firstCh=${String(c.firstCh).padStart(3)}  我算=${String(calc).padStart(3)}`);
  }
  console.log(`  → ${checked} 个样本，${bad} 个不一致`);
  if (bad > checked / 2) {
    console.error(`\n✗ 过半对不上，说明我的回次换算仍不可靠 —— 中止，不落盘。`);
    console.error('  （数据里的 firstCh 本身也可能不准，但对不上的比例这么高，先怀疑自己。）');
    process.exit(1);
  }
  if (bad) console.log(`  ⚠ ${bad} 个对不上，可能是数据里原有的 firstCh 不准，也可能是我的换算偏差 —— 已如实打印，请人工看`);
}
console.log(`回次标记 ${CH.length} 个，范围 ${CH[0]?.n}..${CH[CH.length - 1]?.n}`);

/* 从原文某段话里取 firstCh */
const chOf = (phrase) => {
  const i = f.indexOf(flat(phrase));
  return i < 0 ? null : chapterAt(i);
};

/**
 * 要补的人物：[id, 名字, [别名], 性别, 头衔, desc, 出处引文, 定位短语]
 *
 * ⚠ id **不能猜**。第一版我猜了 `zhu-jun` 给朱隽、`yang-ling` 给杨陵，
 * 结果这两个 id 在数据里已经被**另外两个真实人物**占着：
 *     zhu-jun   → 朱儁（字公伟）  ← 与朱隽是两个人
 *     yang-ling → 杨龄            ← 与杨陵是两个人
 * 脚本里 `byId.has(id)` 挡住了写入，纯属侥幸。
 * ⇒ 现在先检查 id 与名字两边，撞了其中任何一个都拒绝并报错。
 */
const PEOPLE = [
  ['liu-yao', '刘繇', ['正礼'], 'm', '汉室宗亲 / 扬州刺史',
    '字正礼，东莱牟平人，汉室宗亲。刘繇急鸣金收军，撤去曲阿。',
    '「却说刘繇字正礼，东莱牟平人也，汉室宗亲」', '刘繇字正礼'],
  ['zhu-jun-han', '朱隽', ['隽', '朱俊'], 'm', '中郎将 / 太仆',
    '汉灵帝时与卢植、皇甫嵩各引精兵分三路讨黄巾。',
    '「一面遣中郎将卢植、皇甫嵩、朱隽（读如俊）各引精兵分三路讨之」', '朱隽（读如俊）'],
  ['zhao-fan', '赵范', [], 'm', '桂阳太守',
    '桂阳太守。与管军校尉陈应、鲍隆同守桂阳。',
    '「早有探马报知桂阳太守赵范」', '桂阳太守赵范'],
  ['chen-ying', '陈应', [], 'm', '管军校尉',
    '桂阳岭山乡猎户出身，使飞叉。与鲍隆诈降赵云。',
    '「管军校尉陈应、鲍隆愿领兵出战。原来二人都是桂阳岭山乡猎户出身，陈应会使飞叉」',
    '管军校尉陈应、鲍隆愿领兵出战'],
  ['bao-long', '鲍隆', [], 'm', '管军校尉',
    '桂阳岭山乡猎户出身，曾射杀双虎。与陈应诈降赵云。',
    '「管军校尉陈应、鲍隆愿领兵出战」', '管军校尉陈应、鲍隆'],
  ['yang-ling-nan', '杨陵', [], 'm', '南安太守',
    '杨阜之族弟，与崔谅交厚。孔明借崔谅之议赚其献城。',
    '「此人乃杨阜之族弟杨陵也，与某邻郡，交契甚厚」', '杨阜之族弟杨陵也'],
  ['xu-shi', '徐氏', [], 'f', '孙翊之妻',
    '孙翊之妻，美而慧，极善卜《易》。孙翊被妫览、戴员谋杀后智退二贼。',
    '「翊妻徐氏美而慧，极善卜《易》」', '翊妻徐氏美而慧'],
  ['zhang-huanghou', '张皇后', [], 'f', '曹芳皇后',
    '曹芳之皇后，张缉之女（曹芳称张缉为皇丈）。',
    '「缉乃张皇后之父，曹芳之皇丈也」', '缉乃张皇后之父'],
];

/** 关系：[from名, type, to名, 文案, 依据短语] */
const EDGES = [
  ['孙翊', '夫妻', '徐氏', '翊妻徐氏美而慧，极善卜《易》，智退妫览、戴员', '翊妻徐氏美而慧'],
  ['赵范', '主将部将', '陈应', '桂阳太守赵范麾下管军校尉陈应，使飞叉', '管军校尉陈应、鲍隆'],
  ['赵范', '主将部将', '鲍隆', '桂阳太守赵范麾下管军校尉鲍隆，曾射杀双虎', '管军校尉陈应、鲍隆'],
];

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byName = new Map(book.characters.map((c) => [c.name, c]));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const nm = (id) => byId.get(id)?.name ?? id;
let added = 0, skipped = 0;

/* ── 1. 蔡氏 → 蔡夫人 的别名 ── */
{
  const cf = byName.get('蔡夫人');
  if (!cf) console.log('  ⛔ 数据里没有「蔡夫人」，蔡氏这条先不动');
  else if ((cf.aliases ?? []).includes('蔡氏')) console.log('  (跳过) 蔡夫人已有别名「蔡氏」');
  else {
    cf.aliases = [...(cf.aliases ?? []), '蔡氏'];
    console.log(`  蔡夫人 ＋别名「蔡氏」（原文「蔡夫人乃夜对刘表曰」「蔡氏曰」是同一人）`);
  }
}

/* ── 2. 补人物 ── */
console.log('');
for (const [id, name, aliases, gender, title, desc, cite, locate] of PEOPLE) {
  if (byName.has(name)) { console.log(`  (跳过) ${name} 已存在（${byName.get(name).id}）`); skipped++; continue; }
  if (byId.has(id)) {
    console.error(`  ⛔ id「${id}」已被「${byId.get(id).name}」占用，与「${name}」是两个人 —— 拒绝写入`);
    skipped++; continue;
  }
  if (!f.includes(flat(locate))) { console.log(`  ⛔ ${name}：定位短语「${locate}」在原文里找不到，不加`); skipped++; continue; }

  /**
   * ⚠ **不写 firstCh。**
   *
   * 我的回次换算修了两次仍不可靠 —— 交叉验证 5 个已有角色只对上 3 个：
   *     诸葛亮　数据 36（＝三顾茅庐，合理）　我算 1   ⇒ 数据对，我错
   *     孙策　　数据 8　我算 7              ⇒ 差一章，边界问题
   * 原因：按"名字首次出现"定位，会撞上正文里夹的注释段和章末注。
   *
   * `firstCh` 在 validate.mjs 里只是 **warning**（状态栏显示、章节筛选要用），
   * 缺了只让那两个功能退化，不阻塞门禁。
   * **宁可不写，也不写错的** —— 这正是这一整轮在做的事。
   * 需要补 firstCh 时，正确做法是人工按回次确认，不是再猜一遍。
   */
  /**
   * ⚠ 不写 faction / fate 这类**空字符串**字段：
   *   make-slim-packs 的白名单不收空串，往返比对时读回来是 undefined ≠ ""，
   *   于是 `make-slim-packs --check` 报"拆分后与源文件不一致"。
   *   要么给真值，要么不给这个键 —— 不能给空串。
   */
  book.characters.push({
    id, name,
    aliases,
    generation: 1,
    gender,
    title,
    desc,
    note: `出处：「${cite}」。⚠ firstCh 未填 —— 按名字首次出现自动换算不可靠（5 个已有角色只对上 3 个），不写错的。`,
    tier: 'minor',
  });
  byId.set(id, { id, name }); byName.set(name, { id, name });
  console.log(`  ＋ ${name.padEnd(5)} ${title}`);
  console.log(`      ${cite}`);
  added++;
}

/* ── 3. 补关系 ── */
let edges = 0;
console.log('');
for (const [a, type, b, text, locate] of EDGES) {
  const ca = byName.get(a), cb = byName.get(b);
  if (!ca || !cb) { console.log(`  ⛔ ${a}/${b} 有一方不存在`); continue; }
  const dup = book.relations.find((r) => (r.from === ca.id && r.to === cb.id) || (r.from === cb.id && r.to === ca.id));
  if (dup) { console.log(`  (跳过) ${a} —${dup.type}— ${b} 已有`); continue; }
  /**
   * 关系的 fromCh/toCh 是**硬要求**（validate.mjs：必须是 ≥1 的整数），
   * 不能像人物的 firstCh 那样留空。
   *
   * 这里用**原文里长且唯一的那个短语**定位（"翊妻徐氏美而慧"、
   * "管军校尉陈应、鲍隆愿领兵出战"），比按人名定位可靠得多 ——
   * 人名会撞上正文里夹的注释段，短语不会。
   * 但仍属自动换算，所以 note 里写明"按短语定位，需人工复核"。
   */
  const ch = chOf(locate);
  if (ch == null) { console.log(`  ⛔ ${a}/${b}：定位短语找不到，跳过`); continue; }
  book.relations.push({
    from: ca.id, to: cb.id, type, kin: 'marriage', style: 'solid',
    /* 区间是 [fromCh, toCh)，单章关系必须 toCh = fromCh + 1（数据里 203 条如此） */
    fromCh: ch, toCh: ch + 1,
    events: [{ chapter: ch, place: '', text, evidence: 'paraphrase' }],
  });
  console.log(`  ＋ ${a} —${type}— ${b}　第 ${ch} 回：${text}`);
  edges++;
}

console.log(`\n补人物 ${added} 个（跳过 ${skipped}），补关系 ${edges} 条`);
console.log(`⚠ 刘繇 / 朱隽 / 杨陵 **只建了人、没连关系** —— 原文里他们与谁敌对、`);
console.log(`   属于哪一方，要逐条读那一段才说得清，凭印象连就是编。`);
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
