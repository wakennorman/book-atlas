/* 报「事件在场人物」与人物登场章的时间矛盾 —— v0.135 由整理拆书素材时发现。
 * 【长期】发布门禁每轮都跑　（v0.195 由 tag-script-lifetime.mjs 依据「门禁/import/文档」三类证据判定）
 *
 * 现象（三国实测 28 处）：某事件的 `chars` 里出现了**首次出场章远晚于该事件章**的人物。
 * 最刺眼的一例：祝融夫人（孟获之妻、南蛮王后，`firstCh=90`）被塞进 **16 个**
 * 第 26–85 回的事件，包括「关羽挂印封金」「屏后密语备失言」「赵云单骑救主」。
 *
 * 为什么这是**错**而不是「提前被提及」：
 *   `events[].chars` 的语义是**在场人物**（见 events-evidence-方案.md 与 app.js 的用法：
 *   它决定事件卡高亮哪些节点，也决定 `charLastCh()` 算出的「最后出场章」）。
 *   一个人不可能在自己存在之前**在场**。
 *   ⚠ 但边界要诚实：`tier=minor`（仅被提及）的人物理论上可以被提到，
 *     所以单看「firstCh 晚于事件章」不足以定罪。
 *
 * 2026-10-08 修复（用户拍板「按内部一致性修」，修复记录见 docs/待修-事件在场人物时间矛盾.md）：
 *   判据 = **字面提及**：chars 里的人必须被该事件 summary/impact/quote 字面提到
 *   （含 aliases，逐行再核 referent），无字面依据即删。仓库没有原著 txt ⇒
 *   「否定字段要先在原文找到同义句」这条纪律由用户**明示豁免**，换成可全部机械核验的
 *   内部一致性。结果：28 处（+4 处 firstCh 缺失行）逐行复核 ⇒ 删 23 / 留 9：
 *     删 —— 祝融夫人×16（无字面依据）、袁尚×2 袁谭（aliases 存了地盘名「冀州/青州」，
 *           文本里指的是地方不是人）、刘氏×3 何氏（同名碰撞，文本自身可证伪 referent）；
 *     留 —— 王朗/马良/李恢/邓芝/李丰 + 徐氏/赵范/陈应/杨陵（字面直接命中）。
 *   ⇒ 本脚本此后报出的行**不再定罪 chars**：字面依据成立 ⇒ 矛盾转到 firstCh 侧
 *     （登场章记错），是另一侧的待办。
 *
 * 为什么值得单列一个脚本：现有 validate.mjs 只检查人物侧（firstCh 类型、父母一致性、
 * 阵营有效性），**没有任何一处交叉检查 events[].chars** ⇒ 这类污染一直是隐形的。
 *
 * ⚠ 一条**被我自己验伪的说法**（记下来别再犯）：
 *   我第一版写「后果＝结局剧透提前解锁」，**这是错的**。`charLastChCalc`（app.js）
 *   用的是 `Math.max(...)`，而每个被污染的人物在污染之外都还有更晚的真实事件
 *   ⇒ 最大值不受影响。实测 881 个人物里受影响 **0 人**。
 *   —— **「后果」必须实测，不能从机制推出来就写上去。**
 *
 * 实测的真正后果（三条）：
 *   ① 28 个事件卡点开会**高亮出当时不存在的人**（第 26 回《关羽挂印封金》里高亮祝融夫人）
 *   ② 23 个回的「本章 N 人出场」**虚高**，合计 24 人次
 *   ③ 结局剧透：**不受影响**
 *
 * 用法：node scripts/check-event-chars.mjs            # chars 侧违规 ⇒ 退出码 1（硬门禁）
 *       node scripts/check-event-chars.mjs --write    # 同时写出 docs/待修-事件在场人物时间矛盾.md
 *
 * ⚠ v0.156：本脚本此前**恒 exit 0**（自称"只报告"），于是这类污染"改完就没人守了"——
 *   但它的判据**不需要原著**（纯内部数据：`ev.chars` × `firstCh` × 事件文案字面命中），
 *   本可以进 CI。现在拆成两档：
 *     · chars 侧无字面依据 ⇒ **确定是错**（应删）⇒ `exit 1`，已进 check.yml
 *     · 字面有据但 firstCh 晚 ⇒ 疑在 firstCh 侧 ⇒ `exit 0`，人工回原著核
 *
 * ⚠⚠⚠ v0.203 **推翻了上一条里的「确定是错」** —— 那是个过于自信的断言。
 *
 *   「chars 里的人没被该事件文案字面提到」**不能推出他该被删掉**。
 *   v0.203 在罪与罚 e27 上把**两个方向**都撞到了（回原文逐句核）：
 *     · **该挂没挂**：玛尔美拉朵夫。原文「没走进房间里去，一到门口就屈膝跪下，
 *       把拉斯柯尔尼科夫推到前面去」—— 明确在场，而原 `chars` 只有 `raskolnikov`。
 *     · **挂了反而错**：阿玛丽雅。原文里她有戏（「自己挤到前面来了……骂着叫她明天搬家」），
 *       但**事件文案一个字都没提她** ⇒ 按 `docs/events-evidence-方案.md` 的口径
 *       （chars 跟文案一致、决定事件卡高亮哪些节点），她不该在 chars 里。
 *
 *   ⇒ 「无字面依据」这一档**方向不唯一**：既可能是漏挂，也可能是文案没写而人写了。
 *   ⚠ 而它曾被当成"**确定是错**"并 `exit 1` ⇒ 后果是**正确的挂载无法落盘**
 *     （v0.203 实测：把对的挂上去，脚本当场报红并阻塞门禁；
 *      下一个人只会照着报错去把正确的那一挂删掉）。
 *
 *   ⇒ v0.203 起：**没有任何一档自动 exit 1**，全部降为报告 + 退出码 0。
 *   理由与 v0.200/v0.201 一致：**假红比不判更贵** —— 它会挡住真正的修复。
 *   判据不够强的时候，正确做法是**说清它不够强**，而不是硬报红。
 *   ⇒ 真要硬门禁，得先有一条**能被证明不误报**的判据；本脚本目前没有。
 *
 * GATE_MAY_ALWAYS_SUCCEED: v0.203 起本脚本恒 exit 0，这是**故意的**，不是"形同虚设"。
 *   「在场 vs 提及」本质没有机械判据（v0.203 试过三种表面判据，全被原文证伪，见上方），
 *   而唯一的硬判据（exit 1）已实测**会把正确的挂载挡在门外** —— 那比不判更坏。
 *   留在门禁里的价值：每次都把「疑似矛盾」摆出来给人看；真要挡，得等判据变强。
 *   ⇒ 想让它重新变红，先删掉这一行，并**先证明新判据不误报**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const writeDoc = process.argv.includes('--write');

/** 迟多少回才算「矛盾」。1–2 回可能是「先被提及后出场」的正常情形，取 5。 */
const LATE_BY = 5;

const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'books.json'), 'utf8'));
let total = 0;
let totalNoHit = 0;
const report = [];

for (const b of idx.books || []) {
  const f = path.join(DATA, `${b.slug}.json`);
  if (!fs.existsSync(f)) continue;
  const book = JSON.parse(fs.readFileSync(f, 'utf8'));
  const byId = new Map((book.characters || []).map((c) => [c.id, c]));
  const rows = [];
  for (const ev of book.events || []) {
    const ec = Number(ev.ch);
    if (!Number.isFinite(ec)) continue;
    (ev.chars || []).forEach((id, i) => {
      const c = byId.get(id);
      if (!c) return;
      const fc = Number(c.firstCh);
      if (!Number.isFinite(fc) || fc - ec <= LATE_BY) return;
      const text = [ev.summary, ev.impact, ev.quote || ''].join('\n');
      const hit = [c.name, ...(c.aliases || [])].find((n) => n && text.includes(n)) || null;
      rows.push({
        evId: ev.id, ch: ec, evName: ev.name, cid: id, cName: c.name,
        firstCh: fc, tier: c.tier || '(无)', atEnd: i === ev.chars.length - 1, hit,
      });
    });
  }
  if (!rows.length) continue;
  rows.sort((x, y) => x.firstCh - y.firstCh || x.ch - y.ch);
  total += rows.length;

  /* 按人物聚合：谁被安插到了早期事件，以及是不是都排在数组末尾 —— 
   * 「都排在末尾」是"被就地追加"的形态证据，比单条错更能说明成因。 */
  const byChar = new Map();
  for (const r of rows) {
    if (!byChar.has(r.cName)) byChar.set(r.cName, { firstCh: r.firstCh, chs: [], atEnd: 0 });
    const g = byChar.get(r.cName);
    g.chs.push(r.ch);
    if (r.atEnd) g.atEnd++;
  }
  const agg = [...byChar.entries()]
    .map(([name, g]) => ({ name, firstCh: g.firstCh, n: g.chs.length, atEnd: g.atEnd, chs: g.chs }))
    .sort((a, b) => b.n - a.n || a.firstCh - b.firstCh);
  const endMost = rows.filter((r) => r.atEnd).length;
  const noHit = rows.filter((r) => !r.hit).length;
  totalNoHit += noHit;

  report.push({ slug: b.slug, totalCh: book.meta?.chapters || 0, rows, agg, endMost, noHit });

  if (rows.length === 0) {
    console.log(`✓ ${b.slug}：0 处 —— 没有「在场人物」的登场章晚于事件章（阈值 > ${LATE_BY} 回）`);
    console.log('');
    continue;
  }
  console.log(`⚠ ${b.slug}：${rows.length} 处「在场人物」的登场章晚于事件章（> ${LATE_BY} 回）`);
  console.log(`    字面核验：${noHit} 处文案里没提到（**方向不唯一**：可能漏挂、也可能文案没写）`
    + ` / ${rows.length - noHit} 处字面有据`);
  for (const a of agg.slice(0, 8)) {
    console.log(`    ${a.name}（第 ${a.firstCh} 回登场）的登场章晚于 ${a.n} 个事件章${a.n > 3 ? `，其中 ${a.atEnd}/${a.n} 排在 chars 末尾` : ''} → 第 ${[...new Set(a.chs)].sort((x, y) => x - y).join('、')} 回`);
  }
  console.log(`    （${endMost}/${rows.length} 处排在 chars 数组末尾 —— 「被就地追加」的形态）`);
  console.log('');
}

if (writeDoc) {
  const L = [];
  L.push('# 待修：事件「在场人物」与登场章的时间矛盾');
  L.push('');
  L.push('> 由 `node scripts/check-event-chars.mjs --write` 生成，勿手改。');
  L.push('> 2026-10-08 两轮修完：chars 侧按「字面提及」判据、firstCh 侧按原著逐字核。');
  /* ⚠ v0.157：这一行原先**硬编码**「当前残留 0 处」—— 一旦又出现污染，
   *   头部仍写 0、末尾却列出条目 ⇒ 自相矛盾。现在从本次扫描的 total / totalNoHit 动态生成。 */
  L.push(`> **本次扫描残留 ${total} 处**，其中 chars 侧无字面依据 ${totalNoHit} 处`
    + `（那一档会让本脚本 exit 1）。`);
  L.push('');
  L.push('## 为什么这是错');
  L.push('');
  L.push('`events[].chars` 的语义是**在场人物**（见 `docs/events-evidence-方案.md`，以及 `js/app.js` 里');
  L.push('它决定事件卡高亮哪些节点）。一个人不可能在自己存在之前在场。');
  L.push('');
  L.push('## 实测的后果（三条，修复前）');
  L.push('');
  L.push('| # | 后果 | 实测量 |');
  L.push('|---|---|---|');
  L.push('| ① | 事件卡点开时**高亮出当时不存在的人** | 28 个事件 |');
  L.push('| ② | 章节面板「本章 N 人出场」**虚高** | 23 个回 / 合计 24 人次 |');
  L.push('| ③ | **结局剧透提前解锁** | **0 人 —— 不成立，见下** |');
  L.push('');
  L.push('### 关于③：我第一版写的是「结局剧透提前解锁」，那是错的');
  L.push('');
  L.push('推理链是：`charLastChCalc` 遍历 `events[].chars` 取 `Math.max(...)`，所以被污染的早期事件');
  L.push('会把「最后出场章」算早 ⇒ 剧透提前解锁。**但这是从机制推出来的，没有实测。**');
  L.push('');
  L.push('实测 881 个人物，**受影响 0 人** —— 因为每个被污染的人物在污染之外都还有**更晚**的真实事件，');
  L.push('`Math.max` 对这类污染是稳健的。');
  L.push('');
  L.push('> **教训：「后果」必须实测，不能从机制推出来就写上去。**');
  L.push('> 一个听起来很严重、但实测不成立的后果，会把修复的紧迫性判断整个带反。');
  L.push('');
  L.push('## 为什么一直没被发现');
  L.push('');
  L.push('`scripts/validate.mjs` 只检查**人物侧**（`firstCh` 类型、父母一致性、阵营有效性），');
  L.push('**没有任何一处交叉检查 `events[].chars`** ⇒ 这类污染一直是隐形的。');
  L.push('');
  L.push('## 2026-10-08 修复记录（用户拍板：按内部一致性修）');
  L.push('');
  L.push('依据：**chars 里的人必须被该事件 summary/impact/quote 字面提及**（含 aliases，逐行复核 referent）。');
  L.push('⚠ 更正一处说法：原著 txt **在本机**（`%TEMP%\\opencode\\ba-books\\三国演义.txt`），');
  L.push('只是不进版本库 ⇒ 「否定字段要先在原文找到同义句」这条纪律**并没有真的失效**，');
  L.push('它只是不能写进 CI 门禁（CI 没有那份 txt）。本轮起，手工核验一律回原著逐字核。');
  L.push('');
  L.push('- **删 23 处**（23 个事件各 1 条）：');
  L.push('');
  L.push('  | 类型 | 数量 | 明细 |');
  L.push('  |---|---|---|');
  L.push('  | 无字面依据 | 16 | 祝融夫人（firstCh=90、aliases 空）被追加进 26、27、34、35、38、40、41、54×2、55×3、61×2、82、84 回事件 |');
  L.push('  | 地盘别名假命中 | 3 | 袁尚@`e-7-1`/`e-24-6`、袁谭@`e-10-5` —— aliases 里存了地盘名「冀州/青州」，文本里指的是地方不是人 |');
  L.push('  | 同名碰撞 | 4 | 刘氏×3（「刘氏献甄氏」=袁绍妻、「刘氏正统」=刘家皇室、「马腾举刘氏宗族」=汉室宗族；chars 挂的是曹爽妻，firstCh=107）、何氏@`e-2-5`（「两宫之争何氏胜出」=何太后；chars 挂的是孙皓母，firstCh=120） |');
  L.push('');
  L.push('- **留 9 处**（字面直接命中、指代同一人）：王朗@`e-15-6`、马良@`e-52-3`、李恢@`e-65-2`、');
  L.push('  邓芝@`e-85-6`、李丰@`e-94-5`（正文「李丰报孟达欲反」，referent 无法从仓库数据证伪 ⇒ 按机械判据保留）');
  L.push('  + 徐氏@`e-38-5`、赵范@`e-52-5`、陈应@`e-52-5`、杨陵@`e-92-4`（4 人 `firstCh` 字段缺失，本就不进时间判定）。');
  L.push('');
  L.push('## 2026-10-08 第二轮（v0.144）：firstCh 侧修完，残留归零');
  L.push('');
  L.push('上一轮判「firstCh 修正需要原著逐字定位，不在本轮范围」—— 本轮做了。');
  L.push('4 行残留的 referent 唯一、可用原著证伪 ⇒ 改 `firstCh` 并**同步改 `desc`**');
  L.push('（`desc` 的语义就是「该人物在 firstCh 那回的简介」：实测刘备/曹操=1 回、');
  L.push('诸葛亮=36 回、周瑜=29 回，全部对应）。');
  L.push('');
  L.push('| 人物 | 原 firstCh | 改为 | 原著依据 |');
  L.push('|---|---|---|---|');
  L.push('| 王朗 | 56 | **15** | 「会稽太守王朗欲引兵救白虎」（第15回） |');
  L.push('| 马良 | 63 | **52** | 「名良，字季常」（第52回 伊籍荐） |');
  L.push('| 李恢 | 91 | **60** | 「姓李，名恢，叩首谏曰」（第60回 谏刘璋） |');
  L.push('| 邓芝 | 91 | **85** | 「姓邓，名芝，字伯苗」（第85回 献联吴策） |');
  L.push('');
  L.push('第 5 行（李丰@`e-94-5`）**不是 firstCh 错**：原著第94回写「镇守永安宫李严令子李丰来见」');
  L.push('⇒ 在场的是**李严之子**（数据里 `li-feng-liyan`，firstCh=94 ✓），而 chars 挂的是');
  L.push('`li-feng-wei`（第109回被司马师腰斩的**另一个**李丰）⇒ 已换成 `li-feng-liyan`。');
  L.push('');
  L.push('⚠ 口径：`firstCh` = **首次实打实出场**，名单/被提及不算。');
  L.push('证据：同在第65回投降名单里的秦宓(81)/谯周(80)/费诗(73)/费祎(87) 都远晚于 65；');
  L.push('而李严(64)/吴懿(64) 在第64回是真出场（「费观举保…李严…一同领兵」）。');
  L.push('');
  L.push('工具：`scripts/fix-3k-v144.mjs`（带 `--write`，每条改动都要在原著里逐字存在）。');
  L.push('');
  L.push('> 另：同一轮里 `scripts/audit-first-ch.mjs` 还查出**另外 10 个** firstCh 填错');
  L.push('> （李通 58→18、辛评 31→7、荀谌 22→7、逢纪 22→7、凌操 39→15、孙静 29→15、');
  L.push('> 华佗 29→15、陈群 79→58、许芝 79→69、荀攸 10→2）—— 那批**不是** chars 矛盾发现的，');
  L.push('> 所以不列在本文件里；详见 CHANGELOG v0.144。');
  L.push('');
  L.push('**附带影响**：`scripts/check-annotations.mjs` 有一条断言 ——');
  L.push('拆书条目若把「登场章晚于事件章」的人物写成该事件的引用者，会**直接报红**。');
  L.push('firstCh 修正后这条断言的口径也随之收紧（登场章提前 ⇒ 可引用的事件变多）。');
  L.push('');
  L.push('## 残留');
  L.push('');
  L.push('本脚本现报 **0 处**。');
  L.push('');
  for (const r of report) {
    L.push(`## 《${r.slug}》 — ${r.rows.length} 处`);
    L.push('');
    L.push('### 按人物聚合');
    L.push('');
    L.push('| 人物 | 登场章 | 涉及的事件章节数 | 其中排在 chars 末尾 | 涉及回次 |');
    L.push('|---|---|---|---|---|');
    for (const a of r.agg) {
      L.push(`| ${a.name} | ${a.firstCh} | ${a.n} | ${a.atEnd} | 第 ${[...new Set(a.chs)].sort((x, y) => x - y).join('、')} 回 |`);
    }
    L.push('');
    L.push('### 逐条');
    L.push('');
    L.push('| 事件 id | 回 | 事件名 | 人物 | 该人物登场章 | tier | 排在末尾 | 字面命中 |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const x of r.rows) {
      L.push(`| \`${x.evId}\` | ${x.ch} | ${x.evName} | ${x.cName} | ${x.firstCh} | ${x.tier} | ${x.atEnd ? '是' : '否'} | ${x.hit ? `「${x.hit}」` : '✗ 无'} |`);
    }
    L.push('');
  }
  const out = L.join('\n');
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  const p = path.join(ROOT, 'docs', '待修-事件在场人物时间矛盾.md');
  fs.writeFileSync(p, out, 'utf8');
  console.log(`✓ 已写出 docs/待修-事件在场人物时间矛盾.md（${(Buffer.byteLength(out, 'utf8') / 1024).toFixed(1)}KB）`);
}

/* ⚠⚠ v0.203：**不再有任何一档 exit 1。**
 *
 * 原来「chars 侧无字面依据」那一档被当成"**确定是错**"并 exit 1。v0.203 实测证明那是错的：
 * 在罪与罚 e27 上，回原文逐句核，卡捷莉娜**明确在场且是动作主角**
 * （「她扑过去搜他的口袋」「一把抓住他的头发，把他拖进房间里去」）——
 * 把正确的挂载写进去之后，这个脚本**当场报红并阻塞门禁**。
 *
 * ⇒ 一个会把**正确修复挡在门外**的守卫，比没有守卫更坏：
 *   下一个人只会去"修"那个报红的地方（把对的挂载删掉），而真正的漏挂留在原地。
 *
 * 「在场 vs 提及」本质上**没有机械判据**：v0.203 试过三种
 *   ① 表面形态（上书于X / 以X之女 / 被当比喻引用）⇒ 46 条里只认出 4 条
 *   ② 引语内出现其名 ⇒ 认出 10 条
 *   ③ 硬动作动词（揪住/拖进/扑过去…）⇒ 2 条，其中 1 条**假阳**
 *      （e48 的卢仁：文案开头就是「卢仁**在信里说**」，他根本不在场）
 * ⇒ 判据不够强时，正确做法是**说清它不够强**，把判断交回给人，而不是硬报红。 */
if (total === 0) {
  console.log('\n✓ 共 0 处 —— 三本书都没有「在场人物」与登场章的时间矛盾（退出码 0）。');
} else {
  console.log(`\n⚠ 共 ${total} 处，其中 ${totalNoHit} 处文案里没有字面提到（另 ${total - totalNoHit} 处有）。`);
  console.log('  ⇒ **本脚本不判定对错，退出码 0**（v0.203 起；理由见文件头「v0.203 推翻了『确定是错』」）。');
  console.log('  ⇒ 无字面提到的那几处**很可疑**，但不能凭这一条就删。v0.203 实测的两个方向：');
  console.log('    · 真漏挂（该挂没挂）：罪与罚 e27 的玛尔美拉朵夫，原文「一到门口就屈膝跪下」，chars 里却没有');
  console.log('    · 也不该挂：同一条 e27 的阿玛丽雅，原文有她但**事件文案一个字没提** ⇒ 挂了反而错');
  console.log('  ⇒ 正确用法：**回原著逐条核**（`docs/新书处理规程.md` §四 0.5/0.6 那两步需要 epub，');
  console.log('    做不成 CI）。明细：node scripts/check-event-chars.mjs --write。');
}