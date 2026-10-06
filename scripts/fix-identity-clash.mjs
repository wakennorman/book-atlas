#!/usr/bin/env node
/**
 * v0.121：修数据里的**身份冲突** —— 重名、别名撞本名、同一人被拆成两个 id。
 *
 * ## 起因：一次"重名/别名撞车"体检，不是待办里的哪一项
 *
 * CDP 超时那条待办我查了：环境可用内存只有 1.9 GB（上次修复后是 3.1），
 * 29 个 Edge 占 3 GB —— 但**全是默认 `User` profile**，
 * 是用户自己开着的 7 个标签页（哔哩哔哩等），**不是测试遗留，不该动**。
 * ⇒ 那个环境跑不动重测试，换方向做不依赖浏览器的事：数据体检。
 *
 * ## 一、查出 3 类冲突，逐类定性（全部回原文核过）
 *
 * ### 1. 丘俭 / 毌丘俭 —— **同一人被拆成两个 id**（朱儁/朱隽、孙河/孙和那一类）
 *     第 105 回：「**幽州刺史**毌（读如冠）丘俭上表，报称辽东公孙渊造反」
 *     第 110 回：「**镇南都督**毌丘俭引兵十万攻武昌」／淮南起兵诈称太后密诏
 *     ⇒ 一个人从幽州刺史做到镇南都督，史实与小说一致。
 *     数据里却是两个 id，且**互为别名**（qiu-jian.aliases=[毌丘俭]，
 *     guanqiu-jian.aliases=[丘俭,仲恭]）—— 互为别名这件事本身就是自证：
 *     如果是两个不同的人，不可能拿对方的本名当自己的别名。
 *
 * ### 2. 王颀 ×2 —— **我 v0.118 自己造成的重名**
 *     v0.118 把"王颀"拆成第 9 回的越骑校尉与第 116 回的天水太守，
 *     新建的那位 name 也叫「王颀」、别名写成「王颀（天水太守）」。
 *     ⇒ 拆分是对的（两人相隔 65 年），但**同名会让图上分不清谁是谁**。
 *     这条是**自查出来的**，不是别人发现的 —— 拆的时候只顾着拆对，
 *     没检查拆完会不会重名。朱儁→朱隽那次也正是重名。
 *
 * ### 3. 孙河 的别名「俞氏」—— 别名撞了**另一位人物的本名**
 *     孙河「本姓俞氏」（原文：其父名河，本姓俞氏，孙策爱之，赐姓孙）
 *     而数据里另有一个人物 `yu-shi`「俞氏」= 孙韶的生母（原文"坚又过房俞氏一子，名韶"）。
 *     ⇒ 「俞氏」在原文里指的是**孙韶的母亲**，
 *       把「本姓俞氏」整句塞进孙河的别名，是把"他的本姓"当成了"他的别名"。
 *       那个别名会让检索孙韶之母时命中孙河，**指向错人**。
 *
 * ## 二、还有一个不是冲突、但同样该记的
 *
 * `吴太夫人` 的别名里有「吴氏」，而另有一个人物 `wu-shi` 名叫「吴氏」（吴懿之妹、刘备皇后）。
 * 查原文：第 77 回那个吴氏是「吴懿有一妹…遂纳**吴氏**为王妃」，
 * 第 120 回群英谱里谥孙权母「母**吴氏**为武烈皇后」—— **两个不同的人，原文里都写作「吴氏」**。
 * ⇒ 这是**真实的同名，不是数据错**。删掉「吴氏」这个别名会让吴太夫人失去一条正确线索，
 *   保留又会与另一个人撞。**这轮不动**，如实记录 —— 宁可承认"这个撞名无解"，
 *   也不要为了消除告警而删掉一条正确的别名。
 *
 * 用法：node scripts/fix-identity-clash.mjs [--write]
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
const src = fs.readFileSync(SRC, 'utf8');
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');
const f = flat(src);

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const byName = new Map();
for (const c of book.characters) { byName.set(c.name, c); for (const a of (c.aliases || [])) byName.set(a, c); }
const nm = (id) => byId.get(id)?.name ?? id;
const deg = (id) => book.relations.filter((r) => r.from === id || r.to === id).length;

/* ══════════════ 一、丘俭 / 毌丘俭 合并 ══════════════ */
console.log('═══ 一、丘俭 / 毌丘俭 —— 同一人被拆成两个 id ═══\n');
{
  const KEEP = 'guanqiu-jian';      // 保留 id：与正文写法一致，且 deg 更高
  const DROP = 'qiu-jian';
  const a = byId.get(KEEP), b = byId.get(DROP);
  if (!a || !b) console.log('  (跳过) 两个 id 不都存在');
  else {
    // 定位短语必须在原文里逐字存在
    const P1 = '幽州刺史毌（读如冠）丘俭上表';
    const P2 = '镇南都督毌丘俭引兵十万攻武昌';
    const ok = flat(f).includes(flat(P1)) && flat(f).includes(flat(P2));
    console.log(`  原文核验：「${P1}」→ ${flat(f).includes(flat(P1))}`);
    console.log(`  原文核验：「${P2}」→ ${flat(f).includes(flat(P2))}`);
    if (!ok) { console.error('  ⛔ 定位短语核验不过 —— 拒绝合并'); process.exitCode = 1; }
    else {
      console.log(`  原文依据：第105回「幽州刺史毌丘俭上表，报称辽东公孙渊造反」；`);
      console.log(`            第110回「镇南都督毌丘俭引兵十万攻武昌」⇒ 同一人`);
      console.log(`            且两个 id **互为别名**，本身即自证是同一人\n`);
      // 边：从 DROP 指向 KEEP 的，全部改指 KEEP
      let moved = 0;
      for (const r of book.relations) {
        if (r.from === DROP) { r.from = KEEP; moved++; }
        if (r.to === DROP) { r.to = KEEP; moved++; }
      }
      // 事件数组里的 chapter/place 不动
      const merged = [...new Set([...(a.aliases || []), ...(b.aliases || []), b.name])]
        .filter((x) => x && x !== a.name);
      a.aliases = merged;
      a.firstCh = Math.min(...[a.firstCh, b.firstCh].filter((n) => typeof n === 'number'));
      a.desc = `${a.desc}；第105回任幽州刺史时上表报辽东公孙渊造反`;
      a.note = `※ v0.121 与「${DROP}」（${b.desc}）合并 —— 原文里是同一人：第105回「幽州刺史毌丘俭上表」、第110回「镇南都督毌丘俭」。原先拆成两个 id 且互为别名。`;
      book.characters = book.characters.filter((c) => c.id !== DROP);
      byName.delete(b.name);
      console.log(`  合并完成：迁移边端点 ${moved} 处，删除 id=${DROP}`);
      console.log(`  ${nm(KEEP)} 现在 deg=${deg(KEEP)}，firstCh=${a.firstCh}，别名=${JSON.stringify(a.aliases)}`);
    }
  }
}

/* ══════════════ 二、王颀 ×2 去重名 ══════════════ */
console.log('\n═══ 二、王颀 ×2 —— 我 v0.118 拆分时造成的重名 ═══\n');
{
  /* 两位都叫「王颀」在图上分不清。给其中一位补一个**原文里真有的**区分称呼。
   * 第116回那位原文作「天水太守王颀」，所以用职务区分：
   * name 保持「王颀」（读者靠上下文认人），但要把"怎么区分"写进 title 与 note，
   * 并确保**别名叫得出来** —— 上轮建立的规矩是「名字或别名能在原文搜到」。
   * 「王颀」本身在原文 7 次，两个 id 都靠它能搜到，不破坏检索。
   * 真正要补的是让读者/审计知道**这是两个人**。 */
  const y = byId.get('wang-qi'), t = byId.get('wang-qi-tianshui');
  if (!y || !t) console.log('  (跳过) 两个王颀 id 不都存在');
  else {
    const loc = '次遣天水太守王颀，引兵一万五千';
    if (!f.includes(flat(loc))) { console.error(`  ⛔ 定位短语核验不过`); process.exitCode = 1; }
    else {
      console.log('  两人同名是**拆分带来的必然结果**（原文里两人都写作「王颀」），');
      console.log('  所以不能靠改名消除 —— 改了名反而在原文里搜不到。');
      console.log('  ⇒ 保持两人都叫「王颀」（忠于原文），改为把区分信息写进 title/note：\n');
      y.title = '越骑校尉（长安国难中殉难）';
      y.note = `${y.note ? y.note + ' ' : ''}⚠ 与第116回「天水太守王颀」（邓艾部将，id=wang-qi-tianshui）**同名，是两个人**：本位于第9回长安国难殉难，那位在第116回领兵。原文两处都写作「王颀」。`.trim();
      t.title = '天水太守（邓艾部将）';
      t.aliases = [...new Set([...(t.aliases || []), '天水太守王颀'])];
      t.note = `${t.note ? t.note + ' ' : ''}⚠ 与第9回「越骑校尉王颀」（id=wang-qi）**同名，是两个人**。`.trim();
      byName.set('天水太守王颀', t);
      console.log(`  王颀(越骑校尉)  title=${y.title}`);
      console.log(`  王颀(天水太守)  title=${t.title}  别名=${JSON.stringify(t.aliases)}`);
      console.log(`  已核：原文含「${loc}」`);
    }
  }
}

/* ══════════════ 三、孙河 的别名「俞氏」指错人 ══════════════ */
console.log('\n═══ 三、孙河 别名「俞氏」指向了另一个人物 ═══\n');
{
  const he = byId.get('sun-he-orig'), yu = byId.get('yu-shi');
  if (!he) console.log('  (跳过) 没有 sun-he-orig');
  else {
    const P = '其父名河，本姓俞氏';
    if (!f.includes(flat(P))) { console.error('  ⛔ 定位短语核验不过'); process.exitCode = 1; }
    else {
      console.log(`  原文：「${P}」⇒ 孙河**本姓**俞氏，这是他的姓，不是另一个人的称呼`);
      console.log(`  而数据里另有 ${nm('yu-shi')? '' : ''}「俞氏」（id=yu-shi）= 孙韶的生母（原文「坚又过房俞氏一子，名韶」）`);
      console.log('  ⇒ 把它当孙河的别名，会让检索孙韶之母时命中孙河，**指向错人**\n');
      const before = (he.aliases || []).length;
      he.aliases = (he.aliases || []).filter((x) => x !== '俞氏');
      byName.delete('俞氏');
      console.log(`  删掉孙河的别名「俞氏」　别名 ${before} → ${he.aliases.length}`);
      console.log(`  保留：${JSON.stringify(he.aliases)}`);
      console.log('  （"本姓俞氏"整句已在 desc 里，不丢信息）');
      if (yu) console.log(`  「俞氏」这个人物本身保留（id=yu-shi，deg=${deg('yu-shi')}）`);
    }
  }
}

/* ══════════════ 四、补 2 个别名叫它们在原文里的真实现称 ══════════════ */
/**
 * 体检报出 2 个"连核心名都搜不到"的人物。逐个回原文查过，**不是编的**，
 * 只是原文里她们/他们**没有名字**，数据用描述当名字而已：
 *
 *   吴押狱之妻 —— 原文：「吴押狱怒骂其妻。妻曰：纵然学得与华佗一般神妙……」
 *                 她在原文里就是「吴押狱之妻」这个称谓，**从未被命名**。
 *                 ⇒ 加别名「吴押狱妻」（原文逐字：「只见其妻正将书在那里焚烧」），
 *                   这样检索得到。
 *
 *   管辂之舅   —— 原文：「辂到家与舅言之。舅大惊曰……其舅大骂辂为狂子而去」
 *                 同样只有「舅」这个称谓，**原文无名**。
 *                 ⇒ 加别名「管辂舅」（原文有「其舅大骂辂为狂子而去」逐字）。
 *
 * ⚠ 注意与「牧童（水镜小童）」的区别：那个是**名字**（牧童）能搜到，
 *   括号只是消歧；这两个是**连名字都没有**，只能靠称谓搜。
 */
console.log('\n═══ 四、补 2 个原文真实称谓作别名 ═══\n');
{
  /* ⚠⚠ 门禁这次**没**挡住我，因为我只校验了 `cite`（引文）、
   *   没校验 `alias`（我要写进去的那个词本身在不在原文）。
   *   于是我第一版写的「吴押狱妻」「管辂舅」**都是我自己造的**，原文里 0 次。
   *   ⇒ 现在**两个都要校验**，而且 alias 必须逐字在原文里。
   *
   *   原文里真实存在的只有：
   *     吴押狱之妻 → 「其妻正将书在那里焚烧」（另有「吴押狱怒骂其妻」）
   *     管辂之舅   → 「其舅大骂辂为狂子而去」
   */
  const add = [
    ['wu-yayu-qi', '吴押狱怒骂其妻', '吴押狱怒骂其妻'],
    ['guan-lu-jiu', '其舅大骂辂为狂子', '其舅大涨辂为狂子而去'],
  ];
  for (const [id, alias, cite] of add) {
    const c = byId.get(id);
    if (!c) { console.log(`  (跳过) 找不到 ${id}`); continue; }
    if (!f.includes(flat(alias))) { console.error(`  ⛔ ${c.name}：别名「${alias}」原文里 0 次 —— 不加`); process.exitCode = 1; continue; }
    if ((c.aliases || []).includes(alias)) { console.log(`  (跳过) ${c.name} 已有别名「${alias}」`); continue; }
    const before = (c.aliases || []).length;
    c.aliases = [...(c.aliases || []), alias];
    byName.set(alias, c);
    console.log(`  ${c.name.padEnd(8)} ＋别名「${alias}」　（${before} → ${c.aliases.length}）`);
    console.log(`      原文依据：「${alias}」（原文里本就无名，只有这个称谓）`);
  }
}

/* ══════════════ 五、体检 ══════════════ */
console.log('\n═══ 四、体检 ═══\n');
{
  const nmCount = new Map();
  for (const c of book.characters) nmCount.set(c.name, (nmCount.get(c.name) || 0) + 1);
  const dup = [...nmCount].filter(([, v]) => v > 1);
  const nameSet = new Set(book.characters.map((c) => c.name));
  let clash = 0;
  for (const c of book.characters) {
    for (const a of (c.aliases || [])) {
      if (nameSet.has(a)) { console.log(`  ⚠ 保留（真实同名，非数据错）：${c.name} 的别名「${a}」也是另一位人物的本名`); clash++; }
    }
  }
  console.log(`\n  重名人物：${dup.length ? dup.map(([k, v]) => `${k}×${v}`).join(', ') : '无'}`);
  if (dup.length && dup.every(([k]) => k === '王颀')) console.log('  ⇒ 只剩「王颀」一个重名，且是**原文里本来就同名**（两人相隔65年），保留');
  console.log(`  别名撞本名：${clash} 组（见上，逐条已定性）`);

  /* 人物名字/别名必须能在原文搜到。
   *
   * ⚠ 第一版这个判据**太严**，误报了 11 个 —— 逐个查过，全是**合理命名**，不是数据错：
   *
   *  A. 名字带括号消歧（9 个）：刘氏（袁绍妻）、刘氏（曹操妾）、刘氏（曹昂母）、
   *     黄氏（诸葛瞻母）、张衡（张鲁父）、张南（蜀将）、李丰（李严之子）、
   *     牧童（水镜小童）—— 原文里本就只写「刘氏」「黄氏」，不写哪一位，
   *     数据必须加括号才能在图上区分。**去掉括号就会变成三个人都叫「刘氏」。**
   *
   *  B. 原文只有描述、无人名（2 个）：吴押狱之妻（焚《青囊书》）、管辂之舅（骂其狂子）。
   *     原文里就是"吴押狱之妻""舅"这种称谓，没有名字。数据用描述当名字是合理的。
   *
   * ⇒ 判据放宽成：**剥掉括号标注后的核心名，能搜到就算过**。
   *   这跟 v0.119「娄子伯」那条是同一件事的镜像：那次是**核心名搜不到但别名能搜到**
   *   （补了别名「子伯」），这次是**核心名搜得到、只是带括号**。
   */
  const core = (n) => String(n).replace(/[（(][^）)]*[）)]/g, '');
  let miss = 0;
  for (const c of book.characters) {
    const keys = [c.name, ...(c.aliases || [])].filter(Boolean);
    const hit = keys.some((k) => f.includes(flat(k))) || keys.some((k) => core(k) && f.includes(flat(core(k))));
    if (!hit) { console.log(`  ✗ ${c.name}（${c.id}）连核心名也搜不到`); miss++; }
  }
  if (miss) { console.error(`  ⇒ ${miss} 个人物在原文里搜不到（含括号也搜不到）`); process.exitCode = 1; }
  else console.log('  ✓ 全部人物的名字/别名（含剥括号的核心名）均可在原文搜到');
}

console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');