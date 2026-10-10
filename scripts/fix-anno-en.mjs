#!/usr/bin/env node
/**
 * v0.174：把拆书数据里**会渲染给读者看**的英文词翻成中文。
 *
 * ## 为什么
 * 用户原话：「现在拆书部分的『e15』(e+数字)、『 events 』、『summary / impact』
 * 等的这类英文的请翻译成中文，有些中文用户可能看不懂」。
 * 这些词是**数据字段名**（`events[].summary` / `.impact` / `.quote`），
 * 写数据的人看得懂，读拆书的人看不懂。界面上要给读者看的是内容，不是字段名。
 *
 * ## 英文词实际出现在哪（实测，不是猜）
 *   `items[].body` / `global[].body`  —— 正文里当名词用：
 *      「而 impact 写的是…」「这一条带的 quote 是…」「在本书 events 里记的是…」
 *      三国 90 处 / 罪与罚 22 / 百年孤独 31（按条数）
 *   `items[].basis` / `global[].basis` —— 模板句，闭集：
 *      「整理者推断（依据本书 events 的 summary / impact）」等 26 种
 *   `items[].title` —— 1 处：「第 1–14 回（阶段 p1 群雄并起）的整体结构」
 *   ⚠ `note` **不在**处理范围：它是给维护者看的，里面的 `events`/`basis`/`data/*.json`
 *     是在**指代真实的字段名和文件名**，翻成中文反而变成错的。
 *     它也从不渲染（`renderAnnotations` 不读 `state.anno.note`）。
 *   ⚠ 行内 id（`e15`/`e-47-6`/`e01`）**不在**这里改 —— id 是机器用的键，
 *     数据里必须留着；它是**显示**问题，改在 `js/app.js` 的 `annoBody()`。
 *
 * ## 译法（尽量沿用界面自己的词，别另造一套）
 *   `impact` → 「影响」   —— 事件面板上本来就是 `<b>影响：</b>${ev.impact}`（app.js:5068）
 *   `quote`  → 「引文」   —— 界面上叫「原文引文」（index.html:474）
 *   `summary`→ 「简述」   —— 面板上它没有标签（就是正文那段），取「简述」
 *   `events` → 「事件」
 *
 * ## 为什么必须走脚本而不是手改
 *   ① 三个文件的**行尾不一样**（三国/罪与罚 CRLF，百年孤独 LF），
 *      JSON.parse → 写回会顺手统一行尾，那是一次看不见的全文件 diff。
 *   ② 文件缩进不是 `JSON.stringify(x, null, 2)`（数组元素只缩进 2 格），
 *      序列化回去也会全文件 diff。
 *   ⇒ 所以：**解析出来算，但落盘用「整值字面替换」**，一个字节都不碰别处；
 *      写完再 parse 回来跟预期对象做**深比对**，不一致就 exit 1（不留半成品）。
 *
 * ## 断言（不满足就拒绝写盘）
 *   ① 每条改动的原值必须在文件里**逐字出现**（找不到 = 我记错了，停下）。
 *   ② 改完 `basis` / `title` 里**不得再有拉丁字母**。
 *   ③ 改完 `body` 里除行内 id（`e-?\d[\w-]*`）外**不得再有拉丁字母**。
 *      —— ③ 同时是 `scripts/check-annotations.mjs` 里那条新规则的来源。
 *   ④ 落盘后深比对通过。
 *
 * 用法：
 *   node scripts/fix-anno-en.mjs           # 只预览（默认）
 *   node scripts/fix-anno-en.mjs --write   # 落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANNO_DIR = path.join(ROOT, 'data', 'annotations');
const WRITE = process.argv.includes('--write');

/* ---------- 译法 ---------- */
const WORDS = { impact: '影响', summary: '简述', quote: '引文', events: '事件' };

/* 中文/中文标点：用来判断「英文词是不是夹在中文里」（那样两边的空格要去掉） */
const CJK = '\\u3000-\\u303f\\u4e00-\\u9fff\\u2014\\u2018\\u2019\\u201c\\u201d\\u2026\\uff00-\\uffef';

/* ---------- 逐字替换（先跑，覆盖掉机械替换会翻坏的地方） ---------- */
/** 每条：[原文, 改后, 必须出现的次数(null=不限)] */
const BESPOKE = [
  /* basis 模板：机械替换会得到「依据本书 事件的简述 / 影响」这种带斜杠＋多一个空格的
     半成品。⚠ 两条都要写：**带前导空格的在前**（「依据本书 events 的…」），
     不带的那条兜底（万一某条 basis 从 `events` 开头）。 */
  [' events 的 summary / impact', '事件的简述与影响', null],
  ['events 的 summary / impact', '事件的简述与影响', null],
  [' events 的 summary', '事件的简述', null],
  ['events 的 summary', '事件的简述', null],
  /* 「引号内为事件 quote 的逐字引文」机械替换成「事件引文的逐字引文」——
     引文/引文重复。数据里本来就有同义的另一种写法（「引号内为事件的逐字引文；
     其余为概括」），统一到它。 */
  ['事件 quote 的逐字引文', '事件的逐字引文', null],
  /* 标题里的阶段 id：界面本来就显示阶段名，`p1` 是多余的 */
  ['（阶段 p1 群雄并起）', '（阶段「群雄并起」）', 1],
  /* 「这句 impact 当时只是备注」——机械替换成「这句影响当时只是备注」，
     「这句影响」会被读成动宾短语。加个方位词把它钉回"字段"义。 */
  ['这句 impact 当时只是备注', '这句在影响一栏里当时只是备注', 1],
  /* 「e-84-2 impact 四个字：」机械替换成「e-84-2 影响四个字：」，
     缺谓语。这一处作者原意就是"影响只有四个字"。 */
  ['e-84-2 impact 四个字：', 'e-84-2 的影响只有四个字：', 1],
  /* 罪与罚唯一一处英文实词。⚠ 存疑，见 CHANGELOG：
     「拉祖米欣…随即开始一连串的回想——那个 Cleaner 呢？」这句
     在本机《罪与罚》txt 里找不到对应（「梗塞」「一阵难过」「清洁工」全为 0 处），
     无法用原文判定它指谁 ⇒ 只做字面翻译，不替它编一个身份。 */
  ['那个 Cleaner 呢？', '那个清洁工呢？', 1],
];

/** 机械替换：英文词 → 中文，并吃掉中文语境里多余的空格。
 *  ⚠ 四条规则的**顺序**是有讲究的，v0.174 第一版就是顺序写错才漏掉空格：
 *     ① 必须先处理「两边都是中文」，把**左右两个空格一起**吃掉 ——
 *        否则先跑单边的规则，英文词已经被换掉了，另一边就没得匹配。
 *     ② 中文不用空格分词，所以「而影响 用的词是」这种残留在中文里很扎眼。
 *  ⚠ 只吃**中文旁边**的空格：`e-84-2 impact 四个字` 里 `impact` 左边是数字，
 *    那个空格是有用的，不能吃（吃了就成 `e-84-2影响四个字`）。 */
function translateWords(s) {
  let t = s;
  for (const [en, zh] of Object.entries(WORDS)) {
    const W = `(?<![\\w-])${en}(?![\\w-])`;
    t = t.replace(new RegExp(`([${CJK}]) +${W} +(?=[${CJK}])`, 'g'), `$1${zh}`); // ① 两边中文
    t = t.replace(new RegExp(`([${CJK}]) +${W}`, 'g'), `$1${zh}`);              // ② 左边中文
    t = t.replace(new RegExp(`${W} +(?=[${CJK}])`, 'g'), zh);                   // ③ 右边中文
    t = t.replace(new RegExp(W, 'g'), zh);                                      // ④ 兜底
  }
  return t;
}

function fixText(s) {
  let t = String(s == null ? '' : s);
  for (const [oldS, newS] of BESPOKE) t = t.split(oldS).join(newS);
  return translateWords(t);
}

/* ---------- 走一遍三个文件 ---------- */
let changedFiles = 0, changedFields = 0;
const report = [];

/* ⚠ 逐字替换的「预期次数」是**跨三个文件**的全局数 —— 每条 bespoke 只属于某一本书，
 *   按文件分别断言会误报（三国那条在罪与罚里当然是 0 次）。 */
const globalCount = new Map(BESPOKE.map(([o]) => [o, 0]));
const plans = [];

for (const f of fs.readdirSync(ANNO_DIR).filter((x) => x.endsWith('.json')).sort()) {
  const p = path.join(ANNO_DIR, f);
  const raw = fs.readFileSync(p, 'utf8');
  const j = JSON.parse(raw);

  /* 目标字段：body / basis / title（note 不动，见文件头） */
  const fields = [];
  for (const [group, arr] of [['items', j.items], ['global', j.global]]) {
    for (const it of arr || []) {
      for (const k of ['body', 'basis', 'title']) if (typeof it[k] === 'string') fields.push({ group, it, k });
    }
  }

  /* ① 先算新值，收集字面替换对 */
  const edits = new Map();          // oldValue → newValue
  const perField = [];
  for (const { group, it, k } of fields) {
    const oldV = it[k];
    const newV = fixText(oldV);
    if (newV === oldV) continue;
    perField.push({ group, k, oldV, newV });
    edits.set(oldV, newV);
  }
  for (const [oldS] of BESPOKE) {
    const n = fields.reduce((acc, { it, k }) => acc + (String(it[k]).split(oldS).length - 1), 0);
    globalCount.set(oldS, globalCount.get(oldS) + n);
  }

  plans.push({ f, p, raw, j, fields, edits, perField });
}

/* ③ 断言：BESPOKE 里定了次数的，全局次数必须对得上（找不到 = 我记错了，停下）
 *  ⚠ 这是一次性修复脚本，跑第二遍时 bespoke 的原值当然已经不在（已改成新值）。
 *    所以「原值 0 次」分两种：新值也在（= 已经改过了，不是错）vs 新值也不在（= 我记错了）。 */
{
  const problems = [], already = [];
  const allText = plans.flatMap(({ fields }) => fields.map(({ it, k }) => String(it[k]))).join('\n');
  for (const [oldS, newS, times] of BESPOKE) {
    if (times == null) continue;
    const n = globalCount.get(oldS);
    if (n === times) continue;
    if (n === 0 && allText.includes(newS)) { already.push(oldS); continue; }
    problems.push(`逐字替换「${oldS}」预期 ${times} 次，实际 ${n} 次`);
  }
  if (problems.length) {
    console.error('\n✗ 拒绝写盘（逐字替换的预期次数对不上）：');
    for (const x of problems) console.error('   · ' + x);
    process.exit(1);
  }
  if (already.length) console.log(`（${already.length} 条逐字替换已经是新值 —— 看起来跑过了）`);
}

for (const { f, p, raw, j, fields, edits, perField } of plans) {
  /* ② 断言：改完不得残留拉丁字母 */
  const problems = [];
  for (const { group, k, newV } of perField) {
    if (k === 'body') {
      const rest = newV.replace(/e-?\d[\w-]*/g, '');
      const m = rest.match(/[A-Za-z][A-Za-z'-]*/g);
      if (m) problems.push(`${group}.body 改完仍有拉丁字母：${[...new Set(m)].join(' ')}`);
    } else {
      const m = newV.match(/[A-Za-z][A-Za-z'-]*/g);
      if (m) problems.push(`${group}.${k} 改完仍有拉丁字母：${[...new Set(m)].join(' ')}`);
    }
  }
  if (problems.length) {
    console.error(`\n✗ ${f} 拒绝写盘：`);
    for (const x of problems) console.error('   · ' + x);
    process.exit(1);
  }

  if (!perField.length) { report.push(`${f}: 无需改动`); continue; }

  /* ④ 落盘用「整值字面替换」——保住行尾与缩进 */
  let out = raw;
  for (const [oldV, newV] of edits) {
    const key = JSON.stringify(oldV);
    const cnt = out.split(key).length - 1;
    if (cnt < 1) {
      console.error(`\n✗ ${f} 里找不到这个原值（说明文件不是我读到的样子，停下）：\n   ${key.slice(0, 120)}…`);
      process.exit(1);
    }
    out = out.split(key).join(JSON.stringify(newV));
  }

  /* ⑤ 深比对：写出来的东西必须就是「预期的那个对象」
     ⚠ 顺序：**先把 j 改成预期态**（它此刻仍是原值，因为 edits 是先算好再用的），
       再拿 out 解析回来比。v0.174 第一版把顺序写反了 —— 拿 `j` 的深拷贝当 want，
       却去改 `j` 自己，于是 want 根本没被改过，比对必然不一致。 */
  for (const { it, k } of fields) it[k] = fixText(it[k]);
  const got = JSON.parse(out);
  if (JSON.stringify(got) !== JSON.stringify(j)) {
    console.error(`\n✗ ${f} 落盘后深比对不一致 —— 不写盘（不留半成品）`);
    process.exit(1);
  }

  changedFiles++; changedFields += perField.length;
  report.push(`${f}: ${perField.length} 处（${perField.filter((x) => x.k === 'body').length} body / `
    + `${perField.filter((x) => x.k === 'basis').length} basis / `
    + `${perField.filter((x) => x.k === 'title').length} title）`);
  if (WRITE) fs.writeFileSync(p, out, 'utf8');
}

console.log((WRITE ? '已写入 ' : '预览（未写盘）· 将改 ') + changedFiles + ' 个文件 / ' + changedFields + ' 处：');
for (const r of report) console.log('  ' + r);
if (!WRITE) console.log('\n加 --write 落盘。');
