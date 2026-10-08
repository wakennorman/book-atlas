#!/usr/bin/env node
/**
 * v0.144：三国 —— 收尾「事件在场人物」修复暴露出的**六个同类问题**。
 *
 * 上一轮（`scripts/fix-event-chars.mjs` 之后那次）按「字面提及」判据删了 23 处
 * `events[].chars`，只处理了 chars 侧。这一轮处理它**暴露出来**的、以及
 * `check-event-chars.mjs` 残留指向的问题。全部有**原著逐字依据**（locate 短语，
 * 必须在 `三国演义.txt` 里存在，否则拒绝并 exit 1 —— 与 fix-event-chars.mjs 同一纪律）。
 *
 * ## 一、别名里塞了地名（2 处）
 *   袁尚 aliases 有「冀州」、袁谭 aliases 有「青州」。
 *   「冀州/青州」是**地盘**，不是对这两个人的称呼。
 *   后果有二：① 搜「冀州」会错误命中袁尚；② validate 的「文案提到谁」用它做匹配，
 *   于是「弃小沛奔青州」这种**地名**文案被误判成"提到了袁谭"。
 *   ★ 这正是上一轮那 3 处「地盘别名假命中」的**根因** —— 上一轮删了 chars，没删别名，
 *     所以 validate 反过来报「e-7-1/e-24-6 提到袁尚」「e-10-5 提到袁谭」。
 *
 * ## 二、同名多人的命名不一致（5 处）
 *   项目里同名多人**必须带括号区分**（范例：雷同（雒城）/ 雷同（巴西））。
 *   但下面 5 个是裸名，和它那个"带括号的兄弟"撞在一起：
 *     刘氏   ←→ 刘氏（袁绍妻）／刘氏（曹操妾）
 *     李丰   ←→ 李丰（李严之子）
 *     王颀   ←→ 王颀（天水）        （两个都是裸名，最严重：搜「王颀」完全无法区分）
 *     张南   ←→ 张南（蜀将）
 *     李氏   ←→ 李氏（马邈妻）
 *   后果：validate 把「刘氏献甄氏」误判成提到"曹爽妻刘氏"（原文那人是**袁绍妻**）。
 *
 * ## 三、e-33-1 补回**正确**的人（1 处）
 *   上一轮从 e-33-1 删掉了错挂的「刘氏（曹爽妻）」—— 删对了，但**没挂回对的人**。
 *   原文第32回：「妾乃袁将军之妻刘氏也……此次男袁熙之妻甄氏也」⇒ 在场的是**袁绍妻**。
 *   （袁绍妻 firstCh=31 ≤ 33，不产生时间矛盾。）
 *
 * ## 四、14 个 firstCh 填错了（连同 desc 一起改）
 *   前 4 个来自 `check-event-chars.mjs` 残留的 5 行里 referent 唯一、可用原著证伪的那些：
 *     王朗 56→15 · 马良 63→52 · 李恢 91→60 · 邓芝 91→85
 *   后 10 个来自 `scripts/audit-first-ch.mjs`（拿原著对拍 881 人，「其余」组逐条核 referent）：
 *     李通 58→18 · 辛评 31→7 · 荀谌 22→7 · 逢纪 22→7 · 凌操 39→15
 *     孙静 29→15 · 华佗 29→15 · 陈群 79→58 · 许芝 79→69 · 荀攸 10→2
 *   ⚠ `desc` 的语义是「该人物在 firstCh 那回的简介」（实测：刘备/曹操=1 回、诸葛亮=36 回、
 *     周瑜=29 回，全部对应），所以改 firstCh **必须同步改 desc**，否则两处互相矛盾。
 *   ⚠ 第 5 行（李丰）不是 firstCh 错，见 §五。
 *   ⚠ 口径说明：`firstCh` = **首次实打实出场**，名单/被提及不算。
 *     证据：同在第65回投降名单里的秦宓(81)/谯周(80)/费诗(73)/费祎(87) 都远晚于 65；
 *     而李严(64)/吴懿(64) 在第64回是**真出场**（「费观举保…李严…一同领兵」）。
 *
 * ## 五、e-94-5 挂错了李丰（1 处）
 *   原文第94回：「镇守永安宫李严令子李丰来见」⇒ 在场的是**李严之子**（蜀汉）。
 *   数据里 chars 挂的却是 `li-feng-wei`（魏臣，第109回被司马师腰斩的**另一个**李丰）。
 *   数据里本来就有 `li-feng-liyan`（李丰（李严之子），firstCh=94）⇒ 换成它。
 *
 * ## 六、e-54-1 文案里的「刘氏」（1 处）
 *   原文（第53回）孔明的原话是「我劝主人立纸文书，**暂借**荆州为本，待我主别图得
 *   城池之时，便交付还东吴」—— 是**暂借**，没有「刘氏正统」这个说法。
 *   改文案后，validate 那条「提到刘氏」的误报一并消失。
 *
 * 用法：node scripts/fix-3k-v144.mjs [--write]
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
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(fs.readFileSync(SRC, 'utf8'));

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const evById = new Map(book.events.map((e) => [e.id, e]));

let refused = 0;
let changed = 0;
/** 每条改动都必须先在原文里逐字存在 */
function need(locate) {
  if (!f.includes(flat(locate))) { console.error(`      ⛔ 原文里找不到「${locate}」—— 拒绝本条`); refused++; return false; }
  return true;
}

/* ══════════════ 一、别名里塞了地名 ══════════════ */
console.log('═══ 一、别名去污染 ═══\n');
const ALIAS_DROP = [
  ['yuan-shang', '冀州', '「冀州」是袁尚的地盘，不是称呼；留作别名会让搜「冀州」命中袁尚，并让 validate 把「弃小沛奔青州」类文案误判成提到袁尚'],
  ['yuan-tan', '青州', '「青州」是袁谭的地盘，同上'],
];
for (const [id, alias, why] of ALIAS_DROP) {
  const c = byId.get(id);
  if (!c) { console.log(`  ⛔ 没有人物 ${id}`); refused++; continue; }
  if (!(c.aliases || []).includes(alias)) { console.log(`  (跳过) ${c.name} 本来就没有别名「${alias}」`); continue; }
  c.aliases = c.aliases.filter((a) => a !== alias);
  console.log(`  − ${c.name} 删别名「${alias}」（剩 ${c.aliases.length} 条）`);
  console.log(`      ${why}`);
  changed++;
}

/* ══════════════ 二、同名多人命名规范化 ══════════════ */
console.log('\n═══ 二、同名多人命名规范化 ═══\n');
const RENAME = [
  ['liu-shi-cao-shuang', '刘氏', '刘氏（曹爽妻）', '另有「刘氏（袁绍妻）」「刘氏（曹操妾）」；裸名会让 validate 把「刘氏献甄氏」误判成提到曹爽妻'],
  ['li-feng-wei', '李丰', '李丰（魏臣）', '另有「李丰（李严之子）」（第94回）；本条目是第109回被司马师腰斩的魏臣'],
  ['wang-qi', '王颀', '王颀（长安）', '另有「王颀（天水）」；两个都是裸名，搜「王颀」无法区分（本条为李傕之乱、死于长安国难）'],
  ['zhang-nan', '张南', '张南（袁熙部）', '另有「张南（蜀将）」；本条是袁熙部将、倒戈降曹'],
  ['li-shi', '李氏', '李氏（庞德妻）', '另有「李氏（马邈妻）」；本条是庞德之妻、受托抚养庞会'],
];
for (const [id, from, to, why] of RENAME) {
  const c = byId.get(id);
  if (!c) { console.log(`  ⛔ 没有人物 ${id}`); refused++; continue; }
  if (c.name !== from) { console.log(`  (跳过) ${id} 的 name 是「${c.name}」，不是「${from}」`); continue; }
  c.name = to;
  console.log(`  ✎ ${id}：「${from}」→「${to}」`);
  console.log(`      ${why}`);
  changed++;
}

/* ══════════════ 三、e-33-1 补回正确的人 ══════════════ */
console.log('\n═══ 三、e-33-1 补回袁绍妻 ═══\n');
{
  const ev = evById.get('e-33-1');
  const c = byId.get('liu-shi-yuanshao');
  const LOCATE = '妾乃袁将军之妻刘氏也';
  if (!ev) { console.log('  ⛔ 没有事件 e-33-1'); refused++; }
  else if (!c) { console.log('  ⛔ 没有人物 liu-shi-yuanshao'); refused++; }
  else if ((ev.chars || []).includes('liu-shi-yuanshao')) { console.log('  (跳过) e-33-1 的 chars 已含刘氏（袁绍妻）'); }
  else if (need(LOCATE)) {
    ev.chars = [...(ev.chars || []), 'liu-shi-yuanshao'];
    console.log(`  ＋ e-33-1「${ev.name}」chars ＋ 刘氏（袁绍妻）`);
    console.log(`      原文依据：「${LOCATE}……此次男袁熙之妻甄氏也」（第32回）`);
    changed++;
  }
}

/* ══════════════ 四、firstCh 填错（连同 desc） ══════════════ */
console.log('\n═══ 四、firstCh 修正 ═══\n');
/**
 * 前 4 条来自 `check-event-chars.mjs` 的残留行；后 10 条来自
 * `scripts/audit-first-ch.mjs`（拿原著对拍 881 人筛出、「其余」组逐条核 referent）。
 * 判据统一：**首次实打实出场**（有台词/有行动），名单枚举与被提及不算。
 */
const FIRSTCH = [
  { id: 'wang-lang', from: 56, to: 15, desc: '会稽太守，助严白虎拒孙策，战太史慈', locate: '会稽太守王朗欲引兵救白虎' },
  { id: 'ma-liang', from: 63, to: 52, desc: '荆襄马氏五常之一，字季常，伊籍荐之，献策守荆襄取四郡', locate: '名良，字季常' },
  { id: 'li-hui', from: 91, to: 60, desc: '建宁俞元人，谏刘璋勿迎刘备入川', locate: '姓李，名恢，叩首谏曰' },
  { id: 'deng-zhi', from: 91, to: 85, desc: '义阳新野人，字伯苗，邓禹之后，献联吴拒魏之策', locate: '姓邓，名芝，字伯苗' },
  // ── 以下 10 条由 audit-first-ch.mjs 查出 ──
  //    `fate`＝"结局"、`desc`＝"首现那回的简介" ⇒ 原 desc 若写的是结局，
  //    改 desc 前先把结局挪进 fate，否则信息丢失（李通 / 凌操两条属此）。
  { id: 'li-tong', from: 58, to: 18, desc: '江夏平春人，字文达，守汝南，接应曹操，封建功侯', locate: '姓李，名通，字文达', fate: '迎战马超，被刺于马下，阵亡。' },
  { id: 'xin-ping', from: 31, to: 7, desc: '韩馥谋士，与荀谌同劝韩馥请袁绍同治冀州', locate: '辛评二谋士商议' },
  { id: 'xun-chen', from: 22, to: 7, desc: '韩馥谋士，劝韩馥请袁绍入冀州', locate: '馥慌聚荀谌' },
  { id: 'feng-ji', from: 22, to: 7, desc: '袁绍谋士，字元图，献计取冀州', locate: '谋士逢纪说绍曰' },
  { id: 'ling-cao', from: 39, to: 15, desc: '领乡人败严白虎，与子凌统归孙策为从征校尉', locate: '被土人凌操领乡人杀败', fate: '昔在江夏为甘宁射死，其子凌统欲报仇。' },
  { id: 'sun-jing', from: 29, to: 15, desc: '孙策之叔，字幼台，献计破王朗', locate: '王朗负固守城，难可卒拔' },
  { id: 'hua-tuo', from: 29, to: 15, desc: '名医，字元化，为周泰疗金疮', locate: '请视周泰疮' },
  { id: 'chen-qun', from: 79, to: 58, desc: '治书侍御史，字长文，献策劝曹操取江南', locate: '陈群，字长文' },
  { id: 'xu-zhi', from: 79, to: 69, desc: '魏太史丞，掌天象，向曹操举荐管辂', locate: '适太史丞许芝自许昌来见操' },
  { id: 'xun-you', from: 10, to: 2, desc: '字公达，荀彧之侄，何进所引大臣，扶立少帝', locate: '何进引何颙、荀攸' },
];
for (const { id, from, to, desc, locate, fate } of FIRSTCH) {
  const c = byId.get(id);
  if (!c) { console.log(`  ⛔ 没有人物 ${id}`); refused++; continue; }
  if (Number(c.firstCh) !== from) { console.log(`  (跳过) ${c.name} 的 firstCh 是 ${c.firstCh}，不是 ${from}（可能已修过）`); continue; }
  if (!need(locate)) continue;
  c.firstCh = to;
  const oldDesc = c.desc;
  c.desc = desc;
  console.log(`  ✎ ${c.name}：firstCh ${from} → ${to}　desc 同步改写`);
  console.log(`      原文依据：「${locate}」`);
  console.log(`      desc：「${oldDesc}」→「${desc}」`);
  if (fate) {
    const oldFate = c.fate;
    c.fate = fate;
    console.log(`      fate（原 desc 里的结局挪过来）：「${oldFate}」→「${fate}」`);
  }
  changed++;
}

/* ══════════════ 五、e-94-5 换掉挂错的李丰 ══════════════ */
console.log('\n═══ 五、e-94-5 换人（魏臣李丰 → 李严之子）═══\n');
{
  const ev = evById.get('e-94-5');
  const LOCATE = '李严令子李丰来见';
  if (!ev) { console.log('  ⛔ 没有事件 e-94-5'); refused++; }
  else if (!(ev.chars || []).includes('li-feng-wei')) { console.log('  (跳过) e-94-5 的 chars 里没有 li-feng-wei（可能已修过）'); }
  else if (need(LOCATE)) {
    ev.chars = ev.chars.map((x) => (x === 'li-feng-wei' ? 'li-feng-liyan' : x));
    console.log(`  ✎ e-94-5「${ev.name}」chars：魏臣李丰 → 李丰（李严之子）`);
    console.log(`      原文依据：「镇守永安宫${LOCATE}」（第94回）`);
    changed++;
  }
}

/* ══════════════ 六、e-54-1 文案里的「刘氏」 ══════════════ */
console.log('\n═══ 六、e-54-1 文案 ═══\n');
{
  const ev = evById.get('e-54-1');
  const OLD = '孔明以刘氏正统相驳';
  const NEW = '孔明以暂借为辞';
  const LOCATE = '我劝主人立纸文书，暂借荆州为本';
  if (!ev) { console.log('  ⛔ 没有事件 e-54-1'); refused++; }
  else if (!(ev.summary || '').includes(OLD)) { console.log('  (跳过) e-54-1 的 summary 里没有「刘氏正统」（可能已修过）'); }
  else if (need(LOCATE)) {
    ev.summary = ev.summary.replace(OLD, NEW);
    console.log(`  ✎ e-54-1「${ev.name}」summary 改写`);
    console.log(`      原文依据：「${LOCATE}」（第53回 孔明语）`);
    console.log(`      → ${ev.summary}`);
    changed++;
  }
}

/* ══════════════ 汇总 ══════════════ */
console.log(`\n${'─'.repeat(50)}`);
console.log(`共 ${changed} 处改动，${refused} 处被拒（原文依据不足）`);
if (refused > 0) { console.error('\n⚠ 有改动因原文依据不足被拒绝，未写入。'); process.exitCode = 1; }
console.log(WRITE ? '\n已写入 data/three-kingdoms.json' : '\n预览模式（加 --write 才落盘）');
if (WRITE && refused === 0) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
