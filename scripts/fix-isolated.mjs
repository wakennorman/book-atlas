#!/usr/bin/env node
/**
 * v0.118：给「孤立人物」（degree=0）补关系 —— 只连**原文明确写出来**的。
 *
 * ## 一、起点数字先对质：对不上就停
 *
 * 上一轮报给我的是 38 个孤立人物，我自己算是 **35**。
 * 查 git 才发现 v0.117（已提交）刚修好 3 个（liu-yao / zhu-jun-han / yang-ling-nan），
 * 38 是**修复前**的数字。这一轮按 35 做 ——
 * 不是"我算错了"，是**基线变了**，不改口径就得按过期的账做活。
 *
 * ## 二、孤立 ≠ 漏人，也不等于该硬连
 *
 * 35 个里有一部分**本来就不该有边**，有一部分**是数据自己错了**（§三）。
 * 真正"补关系"只是其中一部分。把 35 当成"35 个洞都要填"就会开始编。
 *
 * ## 三、这一轮挖出来的 4 个**数据错误**（比补边重要）
 *
 * ### 1. 王颀 —— 数据把**两个人**并成了一个（朱儁/朱隽那一类）
 *     第 9 回：越骑校尉王颀，**死于长安国难**（李傕郭汜之乱，公元 190）
 *     第 116 回：天水太守王颀，邓艾部将（伐蜀，公元 255）
 *     相隔 **65 年**，前一个死于国难，后者还在领兵上阵 ⇒ 两个人。
 *     而这个 id 的 title/desc 只描述了第 9 回那个人
 *     ⇒ 「天水太守王颀」在图上是**查不到、也搜不到**的一具空壳。
 *
 * ### 2. 关纯 —— 名字在正文里根本不存在，正文叫**闵纯**
 *     正文 4 次全是「闵纯」，一次「关纯」出现在第 120 回**注释**里，
 *     注释自己写着：「闵纯：原文'关纯'，'闵''关'繁体字形相近，或系古本抄写讹误」。
 *     ⇒ 数据用了注释里那个**讹字**，没用正文里那个**正字**。
 *     用户口径是「人名按那本书的版本」（朱儁→朱隽 同一原则）：
 *     **正文作「闵纯」**，别名保留「关纯」并注明是讹字。
 *
 * ### 3. 祝融夫人 —— 别名「夫人」在原文出现 **322 次**，是**污染源**
 *     用它检索会把蔡夫人/甘夫人/糜夫人/吴太夫人…全捞进来。
 *     「夫人」不是她的别名，是**对她的称谓**。称谓不该当别名索引。
 *
 * ### 4. 娄子伯 —— 名字全文搜不到（0 次），正文一律称「子伯」
 *     原文只写「姓娄名子伯」，此后全称「子伯」。
 *     不补别名就等于在图上放一个搜不到的人。
 *
 * ★ 四条都不是"顺手"发现的，是把 35 个人**逐个回原文读**才撞见的。
 *   光看数据（id / 度数）永远看不见 —— 数据里的错误正是用数据查不出来的。
 *
 * ## 四、有一条边我写错了，是被"人名能否搜到"抓出来的
 *
 * 娄子伯那条我第一版写「马超 —求计— 娄子伯」，而原文是：
 *     「有一老人来见**丞相**」→ 操请入 → 「子伯曰：丞相欲跨渭安营久矣…」
 *     → 「操大悟，厚赏子伯。子伯不受而去」→ 是夜北风大作筑成土城
 *     → 「细作报知马超。超领兵观之」
 * 也就是说 **娄子伯见的是曹操**，马超只是后来听说土城筑成的那个。
 * 我把"计策的受益者"当成了"求计的人"—— 记叙视角造成的错。
 *
 * ★ 而 **validate 全绿**，门禁没抓住它。
 *   是我另外跑「边两端人名能否在原文搜到」才撞见的
 *   （"娄子伯"三字原文 0 次，一搜就露馅）。
 *   ⇒ 这条检查已固化成 §三 的体检。
 *
 * ## 五、每条边都必须能指回原文一句话
 *
 * EDGES 每条都带一个 `locate` 定位短语，脚本会把它扔进源文本里查，
 * 查不到就**拒绝写入**。这是 v0.116 立下的规矩，本轮继续用。
 *
 * ## 六、type 与 kin 的两条规矩（都是被门禁/数据教育出来的）
 *
 * **type 门禁我第一版写错了。** 原本规则是"type 必须已有先例"，
 * 挡掉了 家奴/求计/族亲/托付 4 条，理由是"不造新词"。
 * 回头统计才发现：**740 个 type 里有 554 个只出现 1 次** ——
 * 这个数据集的正常形态就是大量单次 type。
 * 我那条规则比数据集自己的约定严得多，是拿我的偏好当标准。
 * ⇒ 改成：新 type 放行 + 打 warning 提示人工过目；
 *   **真正该硬拒的是"定位短语在原文里查不到"**，那条仍然拒。
 *
 * **kin 我第一版一律写 'sworn'**，被 validate 挡了 2 条（父子/父女配结义）。
 * 我第一反应是"把 type 改成别的词绕过" —— 那是**改对的东西迁就错的字段**。
 * 查数据实际约定，真相反过来：
 *     部将/君臣/敌对/交战/同盟/斩杀… 非亲属边，kin 一律**不写**（495 条）
 *     夫妻 → marriage；父子/父女/兄弟/族兄弟/堂兄弟 → blood
 * ⇒ 是我的 kin 填错了，不是 type 填错了。已按类型决定。
 *
 * 用法：node scripts/fix-isolated.mjs [--write]
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
  console.error('  这脚本依赖解包后的 epub 源文本，找不到就中止 —— 绝不在没有原文的情况下凭印象写边。');
  process.exit(1);
}

const src = fs.readFileSync(SRC, 'utf8');
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(src);

/* ── 回次表（沿用 add-missing-nine.mjs 已交叉验证过的算法） ──
   ⚠ 这段是从别的脚本抄的，别"顺手简化"：
   源文本里「第X回」出现三遍（目录 / 正文 / 末尾注释），
   取错哪一套会把任何位置都算成 120。取**第二次**出现的「第一回」作正文起点。 */
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
  while ((m0 = re0.exec(f))) {
    if (cn2num(m0[1]) === 1) firstAt.push(m0.index);
    if (firstAt.length >= 2) break;
  }
}
const BODY_START = firstAt[1] ?? 0;
const CH = [];
const seenCh = new Set();
const re = new RegExp('第([一二三四五六七八九十百零]+)回', 'g');
re.lastIndex = BODY_START;
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
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (CH[mid - 1].at <= pos) { best = CH[mid - 1].n; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}
const chOf = (phrase) => {
  const i = f.indexOf(flat(phrase));
  return i < 0 ? null : chapterAt(i);
};

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byName = new Map();
for (const c of book.characters) { byName.set(c.name, c); for (const a of (c.aliases || [])) byName.set(a, c); }
const byId = new Map(book.characters.map((c) => [c.id, c]));
const nm = (id) => byId.get(id)?.name ?? id;

/* ══════════════ 一、数据修复 ══════════════ */
console.log('═══ 一、数据修复 ═══\n');

/* ── 修复 1：王颀 —— 拆成两个人 ──
   ⚠ id 冲突检查是**双向**的（朱儁/朱隽教训）：
   v0.116 我猜 id `zhu-jun`，它已被另一个真人占着。 */
{
  const old = byId.get('wang-qi');
  const NEW_ID = 'wang-qi-tianshui';
  const NEW_ALIAS = '王颀（天水太守）';
  if (!old) console.log('  (跳过) 数据里没有 wang-qi');
  else if (byId.has(NEW_ID)) { console.error(`  ⛔ id「${NEW_ID}」已被占用 —— 拒绝`); process.exitCode = 1; }
  else if (byName.has(NEW_ALIAS)) { console.error(`  ⛔ 别名「${NEW_ALIAS}」已被占用 —— 拒绝`); process.exitCode = 1; }
  else {
    console.log('  1. 王颀 拆分（两个人被并成了一个）');
    console.log(`     原 id=${old.id} title=${old.title} desc=${old.desc}`);
    console.log('     → 第 9 回「越骑校尉王颀，死于长安国难」（190）保留原 id');
    console.log('     → 第 116 回「天水太守王颀，邓艾部将」（255）新建');
    old.note = `${old.note ? old.note + ' ' : ''}※ 已与第116回「天水太守王颀」（邓艾部将）拆分 —— 二人相隔 65 年（190 vs 255），是两个人。`.trim();
    book.characters.push({
      id: NEW_ID, name: '王颀', aliases: [NEW_ALIAS], generation: 1, gender: 'm',
      title: '天水太守 / 邓艾部将', faction: 'wei',
      desc: '邓艾伐蜀时为天水太守，奉命引兵一万五千攻沓中，为姜维所破。',
      firstCh: 116,
      note: '出处：「又遣天水太守王颀，引兵一万五千，从左攻沓中」「邓艾封师纂为益州刺史，牵弘、王颀等各领州郡」。⚠ 与第9回越骑校尉王颀**非同一人**（相隔 65 年），原先被并成一个人。',
      tier: 'minor',
    });
    byId.set(NEW_ID, book.characters[book.characters.length - 1]);
    byName.set(NEW_ALIAS, byId.get(NEW_ID));
    console.log(`     ＋ 王颀（天水太守） id=${NEW_ID} firstCh=116`);
  }
}

/* ── 修复 2：关纯 → 闵纯 ── */
{
  const c = byId.get('guan-chun');
  if (!c) console.log('  (跳过) 数据里没有 guan-chun');
  else if (byName.has('闵纯') && byName.get('闵纯') !== c) { console.error('  ⛔「闵纯」已被别人占用 —— 拒绝'); process.exitCode = 1; }
  else {
    console.log('\n  2. 关纯 → 闵纯（数据用了注释里的讹字，没用正文的正字）');
    console.log('     正文 4 次全是「闵纯」；唯一一次「关纯」在第120回注释里，注释自称系抄写讹误');
    const oldName = c.name;
    c.name = '闵纯';
    c.aliases = [...new Set([...(c.aliases || []), oldName])];
    c.desc = '韩馥别驾。奉命去请袁绍入主冀州；事泄后与耿武伏城外行刺，被文丑砍死。';
    c.note = `原文作「闵纯」（第7回正文 4 处）。别名「${oldName}」是第120回注释据史料所改的写法，注释自称系古本抄写讹误。firstCh=${c.firstCh}（第7回）。`;
    byName.set('闵纯', c); byName.set(oldName, c);
    console.log(`     关纯 → 闵纯，别名保留「${oldName}」  firstCh=${c.firstCh}`);
  }
}

/* ── 修复 3：删祝融夫人的污染别名「夫人」 ── */
{
  const c = byId.get('zhu-rong-furen');
  const before = (c?.aliases || []).length;
  if (c && (c.aliases || []).includes('夫人')) {
    c.aliases = c.aliases.filter((a) => a !== '夫人');
    console.log('\n  3. 祝融夫人 删别名「夫人」');
    console.log('     「夫人」在原文出现 322 次，检索会捞进蔡夫人/甘夫人/糜夫人/吴太夫人…');
    console.log(`     别名 ${before} → ${c.aliases.length}`);
  }
}

/* ── 修复 4：娄子伯 补别名「子伯」（否则搜不到） ── */
{
  const c = byId.get('lou-zibo');
  if (c && !(c.aliases || []).includes('子伯')) {
    c.aliases = [...(c.aliases || []), '子伯'];
    console.log('\n  4. 娄子伯 ＋别名「子伯」');
    console.log('     原文只写「姓娄名子伯」，此后一律称「子伯」；「娄子伯」三字全文 0 次 ⇒ 不加别名就搜不到');
  }
}

/* ══════════════ 二、补关系 ══════════════ */

/**
 * 边：[fromId, type, toId, 文案, 定位短语]
 * locate 必须在原文里查得到，查不到就拒写。
 */
const EDGES = [
  /* ── 邹靖：第1回刘焉帐下校尉 ── */
  ['liu-yan', '部将', 'zou-jing', '刘焉令邹靖引刘玄德为先锋破贼，邹靖引见太守刘焉', '邹靖引见太守刘焉'],

  /* ── 华雄：第5回董卓部将，连斩鲍忠俞涉潘凤祖茂 ── */
  ['dong-zhuo', '部将', 'hua-xiong', '加为骁骑校尉，同李肃胡轸赵岑赴关迎敌，连斩鲍忠俞涉潘凤祖茂', '加为骁骑校尉'],

  /* ── 李蒙/王方：第9-10回董卓余党，被马超擒杀 ── */
  ['dong-zhuo', '部将', 'li-meng', '董卓余党，在长安为内应偷开城门；后为校尉，请兵万人迎敌西凉', '董卓余党李蒙、王方在城中为贼内应'],
  ['dong-zhuo', '部将', 'wang-fang', '董卓余党，与李蒙同在长安为内应，后同请兵万人迎敌西凉', '董卓余党李蒙、王方在城中为贼内应'],
  ['ma-chao', '生擒', 'li-meng', '马超生擒李蒙，迨至隘口把李蒙斩首号令', '只见马超已将李蒙擒在马上'],

  /* ── 管亥：第11回黄巾贼党围北海，被关羽斩 ── */
  ['kong-rong', '敌对', 'guan-hai', '管亥部领群寇数万围北海索粮，一刀砍宗宝于马下，孔融拒不发粮', '管亥部领群寇数万'],

  /* ── 秦庆童：第23回董承家奴首告 ── */
  ['dong-cheng', '家奴', 'qin-qingtong', '家奴秦庆童与侍妾云英私语被杖，怀恨逃入曹操府首告衣带诏', '忽见家奴秦庆童同侍妾云英在暗处私语'],

  /* ── 眭元进/赵睿：第30回袁绍督将，守乌巢 ── */
  ['yuan-shao', '部将', 'sui-yuanjin', '遣淳于琼部领督将眭元进等引二万人马守乌巢', '部领督将眭元进'],
  ['yuan-shao', '部将', 'zhao-rui', '遣淳于琼部领督将赵睿等引二万人马守乌巢', '部领督将眭元进'],

  /* ── 妫览/戴员：第38回谋杀孙翊 ── */
  ['sun-yi', '敌对', 'gui-lan', '丹阳督将妫览与郡丞戴员常欲杀翊，结边洪为心腹共谋杀翊', '乃与翊从人边洪结为心腹，共谋杀翊'],
  ['sun-yi', '敌对', 'dai-yuan', '丹阳督将妫览与郡丞戴员常欲杀翊，二人归罪边洪斩之于市', '妫览、戴员乃归罪边洪，斩之于市'],

  /* ── 娄子伯：第59回见曹操献策（⚠ 详见文件头 §四，第一版张冠李戴写成了马超） ── */
  ['cao-cao', '求计', 'lou-zibo', '京兆隐士娄子伯（梦梅居士）见曹操，献泼水冻城之计；操厚赏之，辞去', '问之，乃京兆人也，隐居终南山，姓娄名子伯'],

  /* ── 姜叙：第64回与杨阜姑表兄弟 ──
     ⚠ 原文明写「叙与阜是姑表兄弟，叙之母是阜之姑」。
     数据里有「族兄弟」，但**姑表兄弟不是族兄弟**（母系表亲 vs 同族），
     用族兄弟是把它降格成另一层关系 —— v0.117 修的正是这种错，不能重犯。
     ⇒ 用原文自己的词。方向：叙之母是阜之姑 ⇒ 姜叙是杨阜的姑表弟 ⇒ from=姜叙。 */
  ['jiang-xu', '姑表兄弟', 'yang-fu', '杨阜过历城见抚夷将军姜叙，叙与阜是姑表兄弟，叙之母是阜之姑；后姜叙与杨阜同举兵讨马超', '叙与阜是姑表兄弟，叙之母是阜之姑'],

  /* ── 杨昂/昌奇：第67回张鲁部将 ── */
  ['zhang-lu', '部将', 'yang-ang', '张鲁遣大将杨昂、杨任劫曹寨，后杨昂追曹操中计，被张郃所杀', '张鲁依言，遣大将杨昂、杨任'],
  ['zhang-lu', '部将', 'chang-qi', '杨任遣部将昌奇出马战夏侯渊，不三合被斩', '任遣部将昌奇出马'],

  /* ── 张嶷：第87回起，伏兵擒董荼那 ── */
  ['zhuge-liang', '部将', 'zhang-ni', '孔明遣张嶷、张翼伏兵山路，擒南蛮董荼那；后镇抚将军关内侯', '故遣张嶷、张翼以伏兵待之'],

  /* ── 南蛮：第89-90回 ── */
  ['meng-huo', '夫妻', 'zhu-rong-furen', '孟获妻祝融夫人，善飞刀，骑卷毛赤兔；孔明七擒孟获皆其解围', '孔明端坐于帐上，马岱解祝融夫人到'],
  ['yang-feng-man', '加害', 'meng-huo', '银冶洞二十一洞主杨锋设宴，以二子把盏为质，擒孟获、孟优、朵思献孔明', '朵思大王却待要走，已被杨锋擒了'],
  ['mu-lu-dawang', '敌对', 'zhu-rong-furen', '八纳洞主木鹿大王许孟获报仇，引猛兽出，与蜀军战至死于乱军', '木鹿大王许以报仇'],
  ['mu-lu-dawang', '加害', 'meng-huo', '八纳洞主木鹿大王为孟获报仇引兵出，死于乱军之中', '木鹿大王许以报仇'],
  ['meng-huo', '同盟', 'wu-tu-gu', '孟获投乌戈国见兀突骨，再拜哀告，兀突骨许以起本洞之兵报仇，率三万藤甲军助战', '吾起本洞之兵与汝报仇'],

  /* ── 尹赏：第93回天水守将，与姜维至厚 ── */
  ['jiang-wei', '交厚', 'yin-shang', '姜维语孔明「天水城中，尹赏、梁绪与某至厚」，令其内乱；后迎孔明入城降蜀', '尹赏、梁绪与某至厚'],

  /* ── 乐綝：第98回乐进之子（原文明写「乐进子乐綝」） ── */
  ['yue-jin', '父子', 'yue-lin', '真又令张辽子张虎为先锋，乐进子乐綝为副先锋，同守头营', '乐进子乐綝为副先锋'],

  /* ── 卑衍：第106回公孙渊军元帅，被夏侯霸斩 ── */
  ['gongsun-yuan', '部将', 'bei-yan', '渊令大将军卑衍为元帅，杨祚为先锋，起辽兵十五万杀奔中原', '令大将军卑衍为元帅'],

  /* ── 吕岱：第108回孙权遗诏辅政 ── */
  ['sun-quan', '君臣', 'lv-dai', '孙权病危，召太傅诸葛恪、大司马吕岱至榻前嘱以后事', '乃召太傅诸葛恪、大司马吕岱至榻前嘱以后事'],

  /* ── 张缉/张皇后：第109回血诏 ── */
  ['cao-fang', '托付', 'zhang-ji-wei', '曹芳咬破指尖写血诏授与张缉，托其诛司马师；事发后张缉被搜出龙凤汗衫', '芳脱下龙凤汗衫，咬破指尖，写了血诏，授与张缉'],
  ['zhang-ji-wei', '父女', 'zhang-huanghou', '缉乃张皇后之父，曹芳之皇丈也', '缉乃张皇后之父'],

  /* ── 迷当：第109回羌王 ── */
  ['guo-huai', '收降', 'mi-dang', '迷当被魏兵生擒，见郭淮，伏罪；淮说之当前部解铁笼山之围', '迷当惭愧伏罪'],

  /* ── 李丰：第109回魏中书令（原文特注与蜀李丰非一人） ── */
  ['cao-fang', '君臣', 'li-feng-wei', '曹芳退入后殿，左右止有三人：太常夏侯玄、中书令李丰、光禄大夫张缉', '乃太常夏侯玄，中书令李丰'],

  /* ── 刘丞：第113回孙綝杀之 ── */
  ['sun-chen', '斩杀', 'liu-cheng', '孙綝围大内，将全尚、刘丞并其家小拿下，先将全尚、刘丞等杀讫', '孙綝先将全尚、刘丞等杀讫'],

  /* ── 郑伦：第113回邓艾副将，被廖化斩 ── */
  ['deng-ai', '部将', 'zheng-lun', '唤副将郑伦引五百掘子军从地道拥出，为邓艾先锋；被廖化一刀斩于马下', '唤副将郑伦引五百掘子军'],

  /* ── 王含/蒋斌：第115回蜀将 ── */
  ['jiang-wei', '部将', 'wang-han', '姜维以王含、蒋斌为左军，守乐城；汉中失守，开门而降', '王含守乐城'],
  ['jiang-wei', '部将', 'jiang-bin', '姜维以王含、蒋斌为左军；蒋斌守汉城，汉中失守开门而降', '蒋斌守汉城'],

  /* ── 曾宣：第112回寿春守将，献北门 ──
     原文只有「守将曾宣献了北门，放魏兵入城」一句。
     他是诸葛诞的部将，献门是内应行为，两条都据原文。
     献门导致诸葛诞兵败被杀，但原文**没说**曾宣参与了杀诞
     ⇒ 只连这两条，不连「斩杀」/「弑主」（那是推测）。 */
  ['zhuge-dan', '部将', 'zeng-xuan', '诸葛诞守将曾宣献了寿春北门，放魏兵入城；诞兵败被胡奋斩杀', '守将曾宣献了北门，放魏兵入城'],
  ['si-ma-zhao', '内应', 'zeng-xuan', '司马昭围寿春，守将曾宣献北门放魏兵入城，诸葛诞因此兵败而死', '守将曾宣献了北门，放魏兵入城'],

  /* ── 王颀（第9回越骑校尉）：死于长安国难 ──
     原文只写他「死于国难」，没写他属于谁、与谁交过手。
     能确定的只有他死于李傕郭汜纵兵大掠这一场 ⇒ 只连这一条。 */
  ['li-jue', '敌对', 'wang-qi', '李傕郭汜纵兵大掠长安，太常卿种拂太仆鲁馗大鸿胪周奂城门校尉崔烈越骑校尉王颀皆死于国难', '越骑校尉王颀皆死于国难'],

  /* ── 王颀（天水太守）：邓艾部将 ── */
  ['deng-ai', '部将', 'wang-qi-tianshui', '邓艾遣天水太守王颀引兵一万五千从左攻沓中；后与牵弘各领州郡', '次遣天水太守王颀，引兵一万五千'],
  ['jiang-wei', '交战', 'wang-qi-tianshui', '姜维与天水太守王颀接战，不三合颀大败而走', '战不三合，颀大败而走'],

  /* ── 闵纯（原关纯）：第7回韩馥别驾 ── */
  ['han-fu', '君臣', 'guan-chun', '韩馥差别驾闵纯去请袁绍入主冀州；事泄后与耿武伏城外行刺，被文丑砍死', '韩馥即差别驾'],
];

const KNOWN_TYPES = new Set(book.relations.map((r) => r.type));
const NEW_TYPES = new Set();

console.log('\n═══ 二、补关系 ═══\n');

let added = 0, skipped = 0;
for (const [from, type, to, text, locate] of EDGES) {
  const ca = byId.get(from), cb = byId.get(to);
  if (!ca || !cb) { console.log(`  ⛔ ${nm(from)}/${nm(to)} 有一方不存在`); skipped++; continue; }
  if (!KNOWN_TYPES.has(type)) {
    if (!NEW_TYPES.has(type)) {
      NEW_TYPES.add(type);
      console.log(`  ⚠ type「${type}」数据里没有（740 个 type 中 554 个只出现一次，单次 type 是常态）—— 放行，请人工过目`);
    }
  }
  if (!f.includes(flat(locate))) { console.log(`  ⛔ ${nm(from)}—${type}— ${nm(to)}：定位短语「${locate}」原文找不到`); skipped++; continue; }
  const dup = book.relations.find((r) => (r.from === ca.id && r.to === cb.id && r.type === type)
    || (r.from === cb.id && r.to === ca.id && r.type === type));
  if (dup) { console.log(`  (跳过) ${nm(from)}—${type}— ${nm(to)} 已有`); skipped++; continue; }
  const ch = chOf(locate);
  if (ch == null) { console.log(`  ⛔ ${nm(from)}/${nm(to)}：定位短语无法定位回次`); skipped++; continue; }
  const kin = /^(父子|父女|母子|母女|兄弟|姐妹|兄妹|姐弟|祖孙|曾祖孙|叔侄|舅甥|姑侄|族兄弟|堂兄弟|从兄弟|姑表兄弟)/.test(type) ? 'blood'
    : (type === '夫妻' ? 'marriage' : undefined);
  const rel = { from: ca.id, to: cb.id, type, style: 'solid', fromCh: ch, toCh: ch + 1,
    events: [{ chapter: ch, place: '', text, evidence: 'paraphrase' }] };
  if (kin) rel.kin = kin;
  book.relations.push(rel);
  console.log(`  ＋ ${nm(from).padEnd(6)} —${type}— ${nm(to).padEnd(6)} 第${ch}回${kin ? `  kin=${kin}` : ''}`);
  added++;
}

/* ══════════════ 三、收尾体检 ══════════════ */
/**
 * ⚠ 这条体检是**被逼出来的**，不是预防性设计。
 * 娄子伯那条边我第一版写成「马超 —求计— 娄子伯」，实际原文是「有一老人来见丞相」
 * ⇒ 张冠李戴，而 validate 全绿 —— **门禁没抓住它**。
 * 是另外跑「边两端人名能否在原文搜到」才撞见的（"娄子伯"原文 0 次，一搜就露馅）。
 * ⇒ 固化成体检。它抓不到"张冠李戴"本身，但能抓到"名字在原文不存在"这类硬错，
 *   而后者正是张冠李戴的常见前兆。
 */
console.log('\n═══ 三、体检 ═══\n');
{
  const touched = new Set(EDGES.flatMap(([a, , b]) => [a, b]));
  let bad = 0;
  for (const id of touched) {
    const c = byId.get(id);
    if (!c) continue;
    const keys = [c.name, ...(c.aliases || [])].filter(Boolean);
    if (!keys.some((k) => f.includes(flat(k)))) {
      console.log(`  ✗ ${c.name}（${id}）的名字与别名在原文里全都搜不到`);
      bad++;
    }
  }
  if (bad) { console.error(`  ⇒ ${bad} 个人物在原文里搜不到 —— 人名可能有误，逐个回原文核`); process.exitCode = 1; }
  else console.log(`  ✓ 新增相关 ${touched.size} 个人物，名字/别名均可在原文搜到`);
}

/* ══════════════ 四、如实报告 ══════════════ */
const deg = new Map();
for (const c of book.characters) deg.set(c.id, 0);
for (const r of book.relations) {
  if (deg.has(r.from)) deg.set(r.from, deg.get(r.from) + 1);
  if (deg.has(r.to)) deg.set(r.to, deg.get(r.to) + 1);
}
const still = book.characters.filter((c) => deg.get(c.id) === 0);
console.log('\n═══ 四、结果 ═══');
console.log(`补关系 ${added} 条（跳过 ${skipped}）`);
console.log(`孤立人物 35 → ${still.length}`);
if (still.length) {
  console.log('仍未连（逐个说明理由，不假装做完）：');
  for (const c of still) {
    let why = '';
    if (c.id === 'pei-xu') why = '原文明说「实为孔明心腹军士假扮」，**不是真有其人**；连上去会误导读者以为魏国有此将。数据里已用 note 记明。';
    console.log(`  ${c.name}（${c.id}）${why}`);
  }
}
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');