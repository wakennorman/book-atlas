#!/usr/bin/env node
/**
 * v0.125：修两个**真数据错误** ＋ 补 18 条原文有明确交代的 `fate`。
 *
 * ## 一、两个真错误
 *
 * ### A. 马岱的 `fate` 是「。」—— 一个孤零零的句号
 *   这是我自己做的一次「全字段体检」查出来的（validate 抓不到：
 *   它只判空字符串，`"。"` 不是空）。
 *   读者在档案页会看到「**结局：**。」。
 *
 *   原文写得明明白白（第104回）：
 *     「却说董允未及到南郑，**马岱已斩了魏延**，与姜维合兵一处。」
 *     「**马岱有讨逆之功**，即以魏延之爵爵之。」
 *   群英谱也记：「马岱扶风茂陵人，马超从弟……诸葛亮病逝后受杨仪派遣斩杀魏延。」
 *
 * ### B. 刘氏（曹操妾）与 刘氏（曹昂母）—— **同一人被拆成两个 id**
 *   这跟 v0.121 修的丘俭/毌丘俭是同一类（那次是从 validate 的血缘声明里顺出来的，
 *   这次是我逐个人物核 `fate` 时撞见的）。
 *
 *   原文只有**一个**曹操的妾刘氏，两处提到：
 *     第68回「**妾刘氏**生子曹昂，因征张绣时死于宛城。」
 *     第78回「孤长子曹昂，**刘氏所生**，不幸早年殁于宛城。」
 *   （注：这两处"死于宛城/殁于宛城"的主语是**曹昂**，第78回明写"曹昂……殁于宛城"，
 *     所以刘氏本人结局原文没交代 —— 本轮**不给她编 fate**。）
 *
 *   数据里却是两个节点，各连一条边：
 *     liu-shi-cao         刘氏（曹操妾）  --母子--> 曹昂
 *     cao-cao --夫妻-->   liu-shi-caoang-mu  刘氏（曹昂母）
 *   ⇒ 图上会画出**两个"刘氏"**，一个只连儿子、一个只连曹操，读者完全看不出是一个人。
 *
 *   ★ 而且 `liu-shi-caoang-mu` 的别名「**曹操刘夫人**」**原文 0 次** ——
 *     这是我自己编的。合并后自然消失（合并只继承**原文里存在**的名字形式）。
 *
 * ## 二、补 18 条 `fate` —— 只补**原文明确交代了结局**的
 *
 * 三国 881 人里 68 人缺 `fate`。我逐个回原文查了全部 68 个，结论：
 *
 *   · **原文写了结局的：18 个** ⇒ 本轮补，全部带原文定位短语
 *   · **原文没交代结局的：50 个** ⇒ **不填**
 *     这批人在原文里只是被提一句（"九江都尉陆骏之子""刺史臧旻上表奏其功"…），
 *     之后再无一字。硬写等于编。
 *     数据里已有 15 处写「未详」表示"查过、确实没有"，本轮沿用那个约定，
 *     但**不批量填** —— 填"未详"只是消 warning，不新增任何读者可见信息，
 *     反而会把这 18 条真结局淹没。需要时再做一轮。
 *
 * ### 「未填」与「未详」为什么分开说
 *   validate 报的 68 条 warning 会降 18 条，剩 50 条 —— 这不是"修好了 18/68"，
 *   是"其中 18 个原文有答案的我填了，另外 50 个原文没答案"。
 *
 * ## 三、顺带记录一个**不是错误**的检索陷阱
 *
 * 「孙恭」（孙峻之父）在原文里独立出现**只有 1 处**（第108回「孙恭之子」），
 * 其余 4 处「孙恭」都是「**公孙**恭」的子串（辽东公孙康之弟，数据里另有 id）。
 * ⇒ 搜"孙恭"会先命中公孙恭。数据本身没错（两人确实不同），**不动**，
 *   如实记录 —— 与 v0.124 那批"共用字号"同类，但成因是**子串**而非共用。
 *
 * 用法：node scripts/fix-fate-and-merge-liu.mjs [--write]
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

/* ══════════════ 一、合并 刘氏（曹操妾）＋ 刘氏（曹昂母） ══════════════ */
console.log('═══ 一、合并「刘氏（曹操妾）」与「刘氏（曹昂母）」—— 同一人 ═══\n');
let movedEdges = 0;
{
  const KEEP = 'liu-shi-cao';           // 保留：name 与原文「妾刘氏」一致，firstCh=68 就是那处
  const DROP = 'liu-shi-caoang-mu';
  const a = byId.get(KEEP), b = byId.get(DROP);

  // 定位短语：必须在原文里逐字存在，否则拒绝合并
  const P = ['妾刘氏生子曹昂', '孤长子曹昂，刘氏所生'];
  const ok = P.every((p) => f.includes(flat(p)));
  for (const p of P) console.log(`  原文核验：「${p}」→ ${f.includes(flat(p))}`);
  if (!a || !b) { console.log('  (跳过) 两个 id 不都存在'); }
  else if (!ok) { console.error('  ⛔ 定位短语核验不过 —— 拒绝合并'); process.exitCode = 1; }
  else {
    console.log('\n  原文只有**一个**曹操的妾刘氏：');
    console.log('    · 第68回「妾刘氏生子曹昂，因征张绣时死于宛城」');
    console.log('    · 第78回「孤长子曹昂，刘氏所生，不幸早年殁于宛城」');
    console.log('  数据却拆成两个节点：');
    for (const r of book.relations) {
      if (r.from === KEEP || r.to === KEEP || r.from === DROP || r.to === DROP)
        console.log(`      ${nm(r.from)} --${r.type}--> ${nm(r.to)}`);
    }
    console.log(`\n  ★ ${nm(DROP)} 的别名「曹操刘夫人」原文 0 次（我自己编的）：`);
    console.log(`      「曹操刘夫人」在原文出现 ${f.split('曹操刘夫人').length - 1} 次`);
    console.log('  ⇒ 合并时**不继承**这个别名；原文里只有「刘氏」和「妾刘氏」两个形式\n');

    // 边：指向 DROP 的改指 KEEP
    let moved = 0, typeChanged = 0;
    for (const r of book.relations) {
      if (r.from === DROP) { r.from = KEEP; moved++; }
      if (r.to === DROP) { r.to = KEEP; moved++; }
    }
    movedEdges = moved;
    // 「夫妻」→「妾室」：原文明写「妾刘氏」，且曹操—邹氏已用「妾室」（有先例）
    const before = book.relations.length;
    for (const r of book.relations) {
      if (r.type === '夫妻' && ((r.from === 'cao-cao' && r.to === KEEP) || (r.to === 'cao-cao' && r.from === KEEP))) {
        r.type = '妾室'; typeChanged++;
      }
    }
    console.log(`  边：${nm(KEEP)} ← ${nm(DROP)} 的端点迁移 ${moved} 处；「夫妻」→「妾室」${typeChanged} 处`);
    console.log(`  （「妾室」是三书共享词表里已有的词，曹操—邹氏那条就是）`);

    // 别名只继承**原文里存在**的名字形式
    const own = [...new Set([...(a.aliases || []), b.name])].filter((x) => x && x !== a.name && f.includes(flat(x)));
    const dropped = (b.aliases || []).filter((x) => x && !f.includes(flat(x)));
    a.aliases = own;
    a.firstCh = Math.min(...[a.firstCh, b.firstCh].filter((n) => typeof n === 'number'));
    a.desc = `${a.desc}；第68回记「妾刘氏生子曹昂」，第78回曹操遗令复称「曹昂，刘氏所生」`;
    a.note = `${a.note ? a.note + ' ' : ''}※ v0.125 与「${DROP}」（原 desc：${b.desc}）合并 —— 原文里是同一人：第68回「妾刘氏生子曹昂」、第78回「曹昂，刘氏所生」。原先拆成两个节点，一个只连儿子、一个只连曹操，图上看不出是一个人。合并时删掉了原文里不存在的别名「曹操刘夫人」。`.trim();

    book.characters = book.characters.filter((c) => c.id !== DROP);
    byId.delete(DROP);
    console.log(`  删除 id=${DROP}　（${nm(KEEP)} deg=${deg(KEEP)}，firstCh=${a.firstCh}）`);
    console.log(`  别名：${JSON.stringify(a.aliases)}`);
    if (dropped.length) console.log(`  未继承的别名（原文查无）：${dropped.map((x) => `「${x}」`).join('、')}`);
  }
}

/* ══════════════ 二、给 18 个「原文有明确结局」的人物补 fate ══════════════ */
console.log('\n═══ 二、补 18 条 fate（每条都带原文定位短语）═══\n');

/**
 * [id, fate, 定位短语（必须在原文里逐字存在）]
 *
 * ⚠ 定位短语全部取自**原文**，不是事件 summary —— 这是 v0.123 踩过的坑：
 *   我第一版照着 summary 抄，9 条里 8 条原文根本没有，被门禁全拦下。
 */
const FATE = [
  ['bao-long', '诈降被赵云识破，与陈应当时斩了', '将降将陈、鲍二人当时斩了'],
  ['chen-ying', '诈降被赵云识破，与鲍隆当时斩了', '将降将陈、鲍二人当时斩了'],
  ['ding-yuan', '被义子吕布一刀砍下首级', '布向前，一刀砍下丁原首级'],
  ['duan-gui', '被闵贡所杀，悬头于马项下', '贡遂杀段珪，悬头于马项下'],
  ['guo-sheng', '被赶至翠花楼前，剁为肉泥', '赵忠、程旷、夏恽、郭胜四个，被赶至翠花楼前，剁为肉泥'],
  ['guo-taihou', '近闻新亡，钟会因称其遗诏', '近闻郭太后新亡，可诈称太后有遗诏'],
  ['han-rong', '曲说李傕郭汜，二贼从其言', '却说韩融曲说傕、汜二贼，二贼从其言'],
  ['he-miao', '四面围定，砍为齑粉', '苗欲走，四面围定，砍为齑粉'],
  ['hua-tuo-qi', '取《青囊书》与吴押狱，书被其烧毁', '只见其妻正将书在那里焚烧'],
  // ⚠ 这一条我第一版写的是「…只回报曰：郦已不知何往矣」，被门禁拦下 ——
  //   原文引号前还有「“」，我抄 ctx 输出时被截断后自己补了个冒号。
  ['huangfu-li', '扬言李傕谋反，乱其军心，不知所往', '郦已不知何往矣'],
  ['shi-po', '宣之问时，已不知何处去了', '后主又宣师婆问时，却不知何处去了'],
  ['song-bai', '开门设席，醉杀毌丘俭，献首于魏兵', '县令宋白开门接入，设席待之。俭大醉，被宋白令人杀了，将头献与魏兵'],
  ['xu-shi', '智杀妫览戴员，孙权取归家养老', '取徐氏归家养老。江东人无不称徐氏之德'],
  ['yang-ling-nan', '中孔明赚城之计，被关兴斩于马下', '兴手起刀落，斩杨陵于马下'],
  ['zhang-huanghou', '司马师指其为张缉之女，用白练绞死', '叱左右将张后捉出，至东华门内，用白练绞死'],
  ['zhao-fan', '推于阶下，孔明为其释，仍令守桂阳', '云迎接入城，推赵范于阶下'],
  ['zuo-ci', '化青气聚形，招白鹤骑坐而去', '化成一个左慈，向空招白鹤一只骑坐'],
];

let added = 0, skipped = 0, failed = 0;
for (const [id, fate, cite] of FATE) {
  const c = byId.get(id);
  if (!c) { console.log(`  ⛔ 找不到 ${id}`); failed++; continue; }
  if (!f.includes(flat(cite))) { console.error(`  ⛔ ${nm(id)}：定位短语「${cite}」原文里没有 —— 拒绝写入`); failed++; continue; }
  if (c.fate && /[\p{L}\p{N}]/u.test(c.fate)) { console.log(`  (跳过) ${nm(id)} 已有 fate「${c.fate}」`); skipped++; continue; }
  c.fate = fate;
  console.log(`  ＋ ${nm(id).padEnd(8)} fate="${fate}"`);
  console.log(`      原文依据：「${cite}」`);
  added++;
}

/* ══════════════ 三、马岱的 fate="。" ══════════════ */
console.log('\n═══ 三、马岱 的 fate 是一个孤零零的句号 ═══\n');
{
  const c = byId.get('ma-dai');
  if (!c) console.log('  (跳过) 没有 ma-dai');
  else {
    console.log(`  现状：fate="${c.fate}"　→ 读者在档案页看到「结局：。」`);
    console.log('  ⚠ validate 抓不到这个：它只判空字符串，`"."` 不是空。');
    console.log('    是我做的一次「全字段实质内容体检」查出来的（查哪些字段只有标点没字）。\n');
    const cite = '却说董允未及到南郑，马岱已斩了魏延，与姜维合兵一处';
    const cite2 = '马岱有讨逆之功，即以魏延之爵爵之';
    if (!f.includes(flat(cite)) || !f.includes(flat(cite2))) {
      console.error('  ⛔ 定位短语核验不过 —— 拒绝写入'); process.exitCode = 1;
    } else {
      c.fate = '奉孔明遗计斩魏延，以魏延之爵封之';
      c.note = `${c.note ? c.note + ' ' : ''}※ v0.125 原 fate 只有一个句号「。」，实为漏填。原文第104回：「却说董允未及到南郑，马岱已斩了魏延」「马岱有讨逆之功，即以魏延之爵爵之」。`.trim();
      console.log('  ＋ 马岱 fate="奉孔明遗计斩魏延，以魏延之爵封之"');
      console.log(`      原文依据①：「${cite}」`);
      console.log(`      原文依据②：「${cite2}」`);
      added++;
    }
  }
}

/* ══════════════ 四、体检 ══════════════ */
console.log('\n═══ 四、体检 ═══\n');
{
  // A. 不许再有"只有标点没有字"的字段
  const junk = [];
  for (const c of book.characters) {
    for (const k of ['title', 'desc', 'fate', 'note']) {
      const v = c[k];
      if (v && !/[\p{L}\p{N}]/u.test(v)) junk.push(`${c.name} 的 ${k}="${v}"`);
    }
  }
  for (const e of book.events || []) {
    for (const k of ['summary', 'impact', 'quote']) {
      const v = e[k];
      if (v && !/[\p{L}\p{N}]/u.test(v)) junk.push(`事件 ${e.id} 的 ${k}="${v}"`);
    }
  }
  console.log(junk.length ? `  ✗ 仍有实质为空的字段 ${junk.length} 处：\n      ${junk.join('\n      ')}` : '  ✓ 没有"只有标点没有字"的字段');
  if (junk.length) process.exitCode = 1;

  // B. 刘氏现在只有一个
  const liu = book.characters.filter((c) => /刘氏/.test(c.name));
  console.log(`\n  刘氏系列人物：${liu.map((c) => `${c.id}(${c.name},deg=${deg(c.id)})`).join(', ')}`);
  if (liu.some((c) => c.id === 'liu-shi-caoang-mu')) { console.error('  ✗ 合并没生效'); process.exitCode = 1; }
  else console.log('  ✓ 「刘氏（曹昂母）」已并入「刘氏（曹操妾）」');
  for (const r of book.relations) {
    if ((r.from === 'cao-cao' || r.to === 'cao-cao') && /刘氏|liu-shi-cao/.test(r.from + r.to))
      console.log(`  曹操—刘氏的边：${nm(r.from)} --${r.type}--> ${nm(r.to)}`);
  }

  // C. fate 长度与告警数
  const noFate = book.characters.filter((c) => !c.fate);
  console.log(`\n  缺 fate：${noFate.length} → 本轮补了 ${added} 条（其中 马岱 1 条是修「。」）`);
  console.log(`  新增 fate 最长 ${Math.max(...book.characters.filter((c) => c.fate).map((c) => c.fate.length))} 字（约定 ≤30）`);
  const over = book.characters.filter((c) => c.fate && c.fate.length > 30);
  if (over.length) console.error(`  ✗ 超 30 字：${over.map((c) => c.name).join(', ')}`);
  else console.log('  ✓ 全部 fate ≤30 字');
  console.log(`\n  仍缺 fate 的 ${noFate.length} 人：原文只提一句、之后再无交代（陆纡/陆骏/彭伯/蔡勋…）。`);
  console.log('  ⇒ 硬写就是编。数据里已有 15 处写「未详」表示"查过、确实没有"，本轮**不批量填**。');

  // D. 名字/别名仍须能在原文搜到
  const core = (n) => String(n).replace(/[（(][^）)]*[）)]/g, '');
  let miss = 0;
  for (const c of book.characters) {
    const keys = [c.name, ...(c.aliases || [])].filter(Boolean);
    if (!keys.some((k) => f.includes(flat(k))) && !keys.some((k) => core(k) && f.includes(flat(core(k))))) { console.log(`  ✗ ${c.name}（${c.id}）搜不到`); miss++; }
  }
  console.log(miss ? `  ⇒ ${miss} 个人物搜不到` : '  ✓ 全部人物的名字/别名仍可在原文搜到');
  if (miss) process.exitCode = 1;

  // E. 别名不得撞本名（v0.121 立的规矩）
  const nameSet = new Set(book.characters.map((c) => c.name));
  let clash = 0;
  for (const c of book.characters) for (const al of c.aliases || []) if (nameSet.has(al)) { console.log(`  ⚠ ${c.name} 的别名「${al}」也是另一位人物的本名`); clash++; }
  if (!clash) console.log('  ✓ 没有别名撞本名');
}

console.log(`\n本轮写入：合并 1 组（删 1 个 id，迁移 ${movedEdges} 处端点）；补 fate ${added} 条（跳过 ${skipped}，失败 ${failed}）`);
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
