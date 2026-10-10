/* 拆书标注（data/annotations/<slug>.json）的校验器。
 *
 * 为什么单独一个脚本、而且卡得这么死：
 * 拆书条目是**文学解读**，是这个项目里唯一一块"由人/模型写、但要当成事实展示"的内容。
 * 项目一贯纪律是「一切改动必须有原文逐字依据」「不造新词、新 id」。
 * 所以这里把纪律变成可执行的闸门：
 *   ① `events` / `chars` 里出现的每个 id **必须真实存在**于该书数据 ——
 *      写错一个字母就报红（这是防编造的主闸门）
 *   ② `ch` 必须落在该书章号范围内
 *   ③ `basis` 必填：说清这条是「原文」还是「整理者推断」——
 *      界面上要把两者区分开，读者才分得清哪条能当依据、哪条只是判断
 *   ④ `body` / `title` 不得为空，且不得是「待补」「TODO」「未详」这类占位
 *   ⑤ 同一章内 `title` 不许重复（重复多半是复制粘贴没改）
 *   ⑥ 不造新词：条目本身不带分类字段（要分类就用书里已有的 phase / relation type）
 *   ⑦ 面向读者的三个字段（`title` / `body` / `basis`）里**不许有英文单词**（v0.174）——
 *      拆书的读者是中文读者，`events` / `summary` / `impact` / `quote` 是**数据字段名**，
 *      写数据的人看得懂，读者看不懂。唯一例外是 `body` 里的行内 id（`e15` / `e-47-6` / `e01`）：
 *      那是机器用的键，数据里必须留着，显示层（js/app.js 的 annoBody）会把它换成事件名。
 *      存量 431 处由 `scripts/fix-anno-en.mjs` 一次性修掉；这条门禁防的是**再长回来**。
 *   ⑧ 面向读者的三个字段里，**配对记号必须成对**（v0.175）：`**` 成偶数次、
 *      `「」`/`『』`/`（）`/`《》` 两边数目相等。
 *      ⚠ `**` 同一个记号既开又闭 ⇒ 只能查**奇偶**，**不能**写成"两边的数相等"——
 *        对 `**` 而言那是 `n === n`，**恒真**，正是本项目反复踩的「假绿」。
 *      实测（v0.175 前）：全库 340 条里只有 1 处落单（罪与罚 ch29）。后果不是"少加粗一点"，
 *      而是 `annoBody` 里那条加粗正则（把星号对之间的内容换成 `<strong>`）会**从落单处开始错配**：
 *      把三处不该加粗的长句加粗（最长 166 字，而该文件加粗片段中位 18 字），
 *      并在段末给读者**留下字面的 `**`**。
 *      存量 1 处由 `scripts/fix-anno-bold.mjs` 修掉；这条门禁防的是再长回来。
 *
 * 用法：node scripts/check-annotations.mjs            # 校验全部
 *      node scripts/check-annotations.mjs --fix      # 顺带报告每本书的覆盖率
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const ANN = path.join(DATA, 'annotations');

/** 占位符黑名单：这些词出现在 title/body 里就是没写完 */
const PLACEHOLDER = /^(待补|待填|todo|TODO|无|未详|暂无|\.{3}|…+|-+)$/;

/** 规则⑦ 用：抽出一个字符串里的英文单词（去重）。
 *  ⚠ 行内 id 不是"英文单词"，是键：`body` 里要先把它们摘掉再判。
 *    三种真实形态：三国 `e-1-3`、罪与罚 `e1`、百年孤独 `e01`。 */
const LATIN = /[A-Za-z][A-Za-z'-]*/g;
const ID_LIKE = /e-?\d[\w-]*/g;
function latinWords(text, allowIds) {
  const s = allowIds ? String(text).replace(ID_LIKE, '') : String(text);
  return [...new Set(s.match(LATIN) || [])];
}

/** 规则⑧ 用：面向读者的字段里，配对记号必须成对。
 *  ⚠ `**` 同一个记号既开又闭 ⇒ 只能查**奇偶**。
 *    写成"两边的数相等"（`no === nc`）对 `**` 而言是 `n === n`，**恒真** —— 假绿。 */
const MARKUP_PAIRS = [['**', '**'], ['「', '」'], ['『', '』'], ['（', '）'], ['《', '》']];
function unbalancedMarkup(text) {
  const s = String(text);
  const out = [];
  for (const [o, c] of MARKUP_PAIRS) {
    const no = s.split(o).length - 1;
    if (o === c) {
      if (no % 2) out.push(`${o} 出现 ${no} 次（奇数，必有一处落单）`);
      continue;
    }
    const nc = s.split(c).length - 1;
    if (no !== nc) out.push(`${o}${c} 不配对（${no} vs ${nc}）`);
  }
  return out;
}

/** 规则⑦＋⑧：面向读者的三个字段（`title` / `body` / `basis`）一起判。
 *  items 与 global 两处共用，避免同一段判据抄两份（本项目抄两份必漂）。 */
function readerFieldProblems(obj, at, problems) {
  for (const [k, allowIds] of [['title', false], ['body', true], ['basis', false]]) {
    if (typeof obj[k] !== 'string') continue;
    const en = latinWords(obj[k], allowIds);
    if (en.length) problems.push(`${at}.${k} 里有英文单词 ${en.join(' ')} —— 拆书是给中文读者看的，字段名要写成中文（改法见 scripts/fix-anno-en.mjs）`);
    const bad = unbalancedMarkup(obj[k]);
    if (bad.length) problems.push(`${at}.${k} 的配对记号没成对：${bad.join('；')} —— 显示层会从落单处开始错配加粗，并在正文里给读者留下字面的记号（改法见 scripts/fix-anno-bold.mjs）`);
  }
}

const showFix = process.argv.includes('--fix');

function bookList() {
  const reg = JSON.parse(fs.readFileSync(path.join(DATA, 'books.json'), 'utf8'));
  return reg.books.map((b) => b.slug);
}

/** 该书的章号上限：优先 meta.chapters，否则按数据里出现过的最大章号 */
function maxChapter(book) {
  if (book.meta && book.meta.chapters) return book.meta.chapters;
  let m = 1;
  for (const c of book.characters || []) m = Math.max(m, Number(c.firstCh) || 1);
  for (const e of book.events || []) m = Math.max(m, Number(e.ch) || 1);
  return m;
}

let bad = 0;
const rows = [];

for (const slug of bookList()) {
  const annPath = path.join(ANN, `${slug}.json`);
  const problems = [];
  if (!fs.existsSync(annPath)) {
    rows.push([slug, '—', '—', '文件不存在']);
    continue;
  }
  let ann;
  try {
    ann = JSON.parse(fs.readFileSync(annPath, 'utf8'));
  } catch (e) {
    bad++;
    console.error(`✗ ${slug}：JSON 解析失败 —— ${e.message}`);
    continue;
  }

  if (ann.slug !== slug) problems.push(`slug 字段是 ${JSON.stringify(ann.slug)}，应为 ${JSON.stringify(slug)}`);
  if (!Number.isInteger(ann.schema)) problems.push(`schema 必须是整数（当前 ${JSON.stringify(ann.schema)}）`);
  if (!Array.isArray(ann.items)) problems.push('items 必须是数组');
  if (!Array.isArray(ann.global)) problems.push('global 必须是数组');
  if (ann.items && ann.items.some((it) => Object.prototype.hasOwnProperty.call(it, 'role') || Object.prototype.hasOwnProperty.call(it, 'kind') || Object.prototype.hasOwnProperty.call(it, 'type'))) {
    problems.push('条目里不许自带分类字段（role/kind/type）—— 不造新词；要分类就用书里已有的 phase / relation type');
  }

  const book = JSON.parse(fs.readFileSync(path.join(DATA, `${slug}.json`), 'utf8'));
  const evIds = new Set((book.events || []).map((e) => e.id));
  const chIds = new Set((book.characters || []).map((c) => c.id));
  const plIds = new Set((book.places || []).map((p) => p.id));
  const total = maxChapter(book);

  /* 数据里已知的污染：某些事件的 `chars` 里混进了「登场章远晚于该事件章」的人物
   * （三国实测 28 处，祝融夫人被塞进 16 个 26–85 回的事件，见
   *  docs/待修-事件在场人物时间矛盾.md 与 scripts/check-event-chars.mjs）。
   * ⚠ 后果是**事件卡高亮错人 + 「本章 N 人出场」虚高**；
   *   **结局剧透不受影响**（charLastChCalc 用 Math.max，被污染者另有更晚的真实事件）——
   *   我第一版写成"剧透提前解锁"，那是**从机制推出来没实测的错误说法**，已更正。
   *
   * ⚠ 这里**不改源数据**（删数据要拿原文逐条核，见新书处理规程与
   *   「否定一个字段前必须先在原文里找到同义句」那条纪律）。
   *   只保证**污染不会被带进拆书内容**：条目若把这样的人写成该事件的引用者，直接报红。
   */
  const evById = new Map((book.events || []).map((e) => [e.id, e]));
  const chById = new Map((book.characters || []).map((c) => [c.id, c]));
  const LATE_BY = 5;
  const implausible = (eventId, charId) => {
    const e = evById.get(eventId), c = chById.get(charId);
    if (!e || !c) return null;
    const ec = Number(e.ch), fc = Number(c.firstCh);
    if (!Number.isFinite(ec) || !Number.isFinite(fc) || fc - ec <= LATE_BY) return null;
    return `${c.name}（第 ${fc} 回登场）不可能在第 ${ec} 回《${e.name}》的场内`;
  };

  const seenTitle = new Map();
  const covered = new Set();
  if (Array.isArray(ann.items)) {
    ann.items.forEach((it, i) => {
      const at = `items[${i}]`;
      if (!Number.isInteger(it.ch) || it.ch < 1 || it.ch > total) problems.push(`${at}.ch = ${JSON.stringify(it.ch)}，应在 1–${total}`);
      else covered.add(it.ch);
      if (typeof it.title !== 'string' || !it.title.trim()) problems.push(`${at}.title 缺失`);
      else if (PLACEHOLDER.test(it.title.trim())) problems.push(`${at}.title 是占位符：${JSON.stringify(it.title)}`);
      if (typeof it.body !== 'string' || !it.body.trim()) problems.push(`${at}.body 缺失`);
      else if (PLACEHOLDER.test(it.body.trim())) problems.push(`${at}.body 是占位符：${JSON.stringify(it.body)}`);
      if (typeof it.basis !== 'string' || !it.basis.trim()) problems.push(`${at}.basis 缺失（必须写明「原文」还是「整理者推断」）`);
      /* 规则⑦＋⑧：面向读者的字段不许有英文单词、配对记号必须成对（见文件头） */
      readerFieldProblems(it, at, problems);
      // 引用必须真实存在 —— 防编造的主闸门
      for (const [key, set] of [['events', evIds], ['chars', chIds], ['places', plIds]]) {
        const arr = it[key];
        if (arr === undefined) continue;
        if (!Array.isArray(arr)) { problems.push(`${at}.${key} 必须是数组`); continue; }
        for (const id of arr) {
          if (!set.has(id)) {
            const near = [...set].filter((x) => String(x).includes(String(id).slice(0, 4)) || String(id).includes(String(x).slice(0, 4))).slice(0, 3);
            problems.push(`${at}.${key} 里的 ${JSON.stringify(id)} 在《${slug}》里不存在${near.length ? `（相近的有：${near.join(' / ')}）` : ''}`);
          }
        }
      }
      /* 条目同时列了 events 和 chars 时，两边必须对得上：
       * 若某个 chars 人物被声称"在场于"该条目引用的某个事件，而数据说那时他还没登场 ⇒ 报红。 */
      if (Array.isArray(it.events) && Array.isArray(it.chars)) {
        for (const eid of it.events) {
          for (const cid of it.chars) {
            const why = implausible(eid, cid);
            if (why) problems.push(`${at}：把 ${why} —— 拆书条目不能把已知的源数据污染写成依据`);
          }
        }
      }
      const key = `${it.ch}||${String(it.title || '').trim()}`;
      if (seenTitle.has(key)) problems.push(`${at}.title 与 ${seenTitle.get(key)} 重复：「${it.title}」`);
      else seenTitle.set(key, at);
    });
  }

  if (Array.isArray(ann.global)) {
    ann.global.forEach((g, i) => {
      const at = `global[${i}]`;
      if (typeof g.title !== 'string' || !g.title.trim()) problems.push(`${at}.title 缺失`);
      if (typeof g.body !== 'string' || !g.body.trim()) problems.push(`${at}.body 缺失`);
      if (typeof g.basis !== 'string' || !g.basis.trim()) problems.push(`${at}.basis 缺失`);
      /* 规则⑦＋⑧：同上 */
      readerFieldProblems(g, at, problems);
    });
  }

  const n = Array.isArray(ann.items) ? ann.items.length : 0;
  const g = Array.isArray(ann.global) ? ann.global.length : 0;
  rows.push([slug, `${n} 条 / ${covered.size} 章`, `${g} 条`, problems.length ? `${problems.length} 处问题` : 'OK']);

  if (problems.length) {
    bad++;
    console.error(`✗ ${slug}：${problems.length} 处问题`);
    for (const p of problems.slice(0, 20)) console.error(`    ${p}`);
    if (problems.length > 20) console.error(`    ……还有 ${problems.length - 20} 处`);
  }
}

if (showFix) {
  console.log('\n书\t章节条目\t全局条目\t状态');
  for (const r of rows) console.log(`${r[0]}\t${r[1]}\t${r[2]}\t${r[3]}`);
  console.log('\n覆盖率：见上面「N 条 / M 章」两列（M = 已覆盖章数，该书章号上限见 books 的 meta.chapters）。');
  console.log('提示：某本书 0 条时，右栏不显示拆书分区（这是正常的，不是错误）。');
}

if (bad) { console.error(`\n拆书标注校验：${bad} 本书有问题`); process.exit(1); }
console.log(`✓ 拆书标注校验：${bookList().length} 本书全部通过`);