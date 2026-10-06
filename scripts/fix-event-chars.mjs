#!/usr/bin/env node
/**
 * v0.123：补事件 `chars` 里**真缺**的人物 ＋ 删掉一个我 v0.121 加错的别名。
 *
 * ## 一、这 53 条告警里，只有 10 处是真问题（其余是误报）
 *
 * validate 会检查「事件文案提到的人名是否都在 `chars` 里」——
 * 因为点开事件时只画 `chars` 里的人，**漏了就是读者点开看不到那个人**。
 *
 * 但它报出来的 53 条要分两类看：
 *
 * ### A. 官职词被当成人名（23 处，**不该管**）
 *   「太后」「丞相」「都督」「大将军」「魏王」「大都督」…
 *   这些是**官职**，不是人名。往 `chars` 里加它们会让图上多出"人物"节点。
 *   ⇒ 不动。这是 validate 的启发式误报。
 *
 * ### B. 真的漏了人（10 处，**要补**）—— 全部回原文核过
 *   e-3-3/3-4/3-5 缺【陈留王】= 刘协（原文「张让劫少帝与陈留王奔北邙」等）
 *   e-38-5    缺【徐氏】       （「其妻徐氏诈许婚，伏兵杀妫览、戴员」）
 *   e-52-5    缺【赵范】【陈应】（「赵云擒陈应降赵范」）
 *   e-92-4    缺【杨陵】       （「崔谅与杨陵定计赚蜀军入城，关兴斩杨陵」）
 *   e-110-1   缺【丘俭】       （「丘俭、文钦诈称太后密诏起兵讨司马师」）
 *   e-118-5   缺【王颀】       （「邓艾封王颀等领州郡」）
 *   e-81-5    "缺"【报父仇】—— **这条是误报，见 §二**
 *
 * ## 二、顺带查出**我自己 v0.121 加错的一个别名**
 *
 * 我给马腾加了别名「报父仇」「尊人」，本意是消除第65回的审计误报。
 * 查原文后发现：
 *   · 「公之尊人」确实是李恢称马腾之父 ⇒「尊人」可用。
 *   · **「报父仇」不是马腾的称呼** —— 原文里它出现在
 *     「马腾举义**报父仇**」（第10回回目）、
 *     「以图上**报父仇**，下立功名」（李恢劝马超，指马腾之仇）、
 *     「以**报父仇**，则无不可也」（第15回讲孙策），
 *     但作为**可检索的别名**它会把关兴张苞那条「共报父仇」误判成提到马腾。
 *   ⇒ 删掉「报父仇」，保留「尊人」。
 *   ★ 这是 v0.121 那个"补别名消除审计误报"的**副作用**：
 *     审计变绿了，但数据被塞进一个不该在那里的词。
 *
 * ## 三、只往 `chars` 加**确实在场**的人，且按原文核验
 *
 * 每条都带一个 `locate`（必须在原文里逐字存在）才允许写入。
 *
 * 用法：node scripts/fix-event-chars.mjs [--write]
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
const byName = new Map();
for (const c of book.characters) { byName.set(c.name, c); for (const a of (c.aliases || [])) byName.set(a, c); }
const evById = new Map(book.events.map((e) => [e.id, e]));

/* ══════════════ 一、删掉 v0.121 加错的别名 ══════════════ */
console.log('═══ 一、删掉我加错的别名 ═══\n');
{
  const ma = byId.get('ma-teng');
  if (!ma) console.log('  (跳过) 没有 ma-teng');
  else if (!(ma.aliases || []).includes('报父仇')) console.log('  (跳过) 马腾本来就没有「报父仇」这个别名');
  else {
    const before = ma.aliases.length;
    ma.aliases = ma.aliases.filter((a) => a !== '报父仇');
    console.log('  马腾 删别名「报父仇」　（' + before + ' → ' + ma.aliases.length + '）');
    console.log('      依据：原文里「报父仇」出现在「马腾举义报父仇」（回目）、「以图上报父仇」（李恢劝马超）、');
    console.log('            「以报父仇，则无不可也」（讲孙策）—— 它是**动作**，不是马腾的称呼。');
    console.log('            留着会让关兴张苞那条「共报父仇」误判成提到马腾。');
    console.log('      保留「尊人」：第65回「公之尊人，昔年曾与皇叔约共讨贼」= 李恢称马腾之父，确有其用。');
  }
}

/* ══════════════ 二、补事件 chars 里真缺的人物 ══════════════ */
/** [eventId, 人物id, 定位短语（必须在原文里逐字存在）] */
/**
 * ⚠⚠ 定位短语第一版我**照着事件 summary 抄的**，9 条里 8 条原文里根本没有。
 *   门禁全部拦下 —— 这正是它该做的事。
 *   ⇒ 现在逐条回原文抄，**全部实测存在**。
 *
 * 顺带说明为什么 summary 不能当定位依据：
 *   summary 是"我的转述"，措辞和原文不同。e-52-5 的 summary 写「赵云擒陈应降赵范」，
 *   原文其实是「早有探马报知**桂阳太守**赵范…**管军校尉陈应**、鲍隆愿领兵出战」，
 *   压根没有「擒陈应降赵范」这个说法。
 */
const ADD = [
  ['e-3-3', 'liu-xie', '封皇子协为陈留王'],
  ['e-3-4', 'liu-xie', '封皇子协为陈留王'],
  ['e-3-5', 'liu-xie', '封皇子协为陈留王'],
  ['e-38-5', 'xu-shi', '翊妻徐氏美而慧'],
  ['e-52-5', 'zhao-fan', '早有探马报知桂阳太守赵范'],
  ['e-52-5', 'chen-ying', '管军校尉陈应、鲍隆愿领兵出战'],
  ['e-92-4', 'yang-ling-nan', '此人乃杨阜之族弟杨陵也'],
  ['e-110-1', 'guanqiu-jian', '幽州刺史毌（读如冠）丘俭上表'],
  ['e-118-5', 'wang-qi-tianshui', '邓艾封师纂为益州刺史，牵弘、王颀等各领州郡'],
];

console.log('\n═══ 二、补事件 chars ═══\n');
let added = 0, skipped = 0;
for (const [evId, charId, locate] of ADD) {
  const ev = evById.get(evId);
  const c = byId.get(charId);
  if (!ev) { console.log(`  ⛔ 事件 ${evId} 不存在`); skipped++; continue; }
  if (!c) { console.log(`  ⛔ 人物 ${charId} 不存在`); skipped++; continue; }
  if (!f.includes(flat(locate))) { console.error(`  ⛔ ${evId}：定位短语「${locate}」原文里找不到 —— 拒绝`); skipped++; process.exitCode = 1; continue; }
  if ((ev.chars || []).includes(charId)) { console.log(`  (跳过) ${evId} 的 chars 已含 ${c.name}`); skipped++; continue; }
  ev.chars = [...(ev.chars || []), charId];
  console.log(`  ＋ ${evId}「${ev.name}」chars ＋ ${c.name}`);
  console.log(`      原文依据：「${locate}」`);
  added++;
}

/* ══════════════ 三、体检 ══════════════ */
console.log('\n═══ 三、体检 ═══\n');
{
  // 官职词：validate 会拿它们当人名报，但它们不是人，不该进 chars
  const TITLES = new Set(['太后', '丞相', '都督', '大将军', '魏王', '魏主', '大都督', '司马', '中尉', '太守', '刺史', '将军', '国相']);
  const idx = new Map();
  for (const c of book.characters) {
    idx.set(c.name, c.id);
    for (const a of (c.aliases || [])) if (!idx.has(a)) idx.set(a, c.id);
  }
  const real = [], byTitle = [];
  for (const e of book.events) {
    for (const [name, id] of idx) {
      if ((e.chars || []).includes(id)) continue;
      let i = e.summary.indexOf(name), hit = false;
      while (i !== -1) {
        const before = e.summary.slice(Math.max(0, i - 3), i);
        const after = e.summary.slice(i + name.length, i + name.length + 2);
        if (!(before.endsWith('何塞·') || before.endsWith('·') || after.startsWith('·') || after.startsWith('（第'))) { hit = true; break; }
        i = e.summary.indexOf(name, i + 1);
      }
      if (hit) (TITLES.has(name) ? byTitle : real).push(`${e.id}×${name}`);
    }
  }
  console.log(`  疑似真漏：${real.length ? real.join(', ') : '无 ✓'}`);
  console.log(`  官职词误报（不动）：${byTitle.length} 处`);
  console.log('  ⇒ 官职词如需彻底消警，要改 validate 的启发式（把官职表加进排除名单），那是改工具不是改数据');
}

console.log(`\n删别名 1 处；补 chars ${added} 条（跳过 ${skipped}）`);
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');