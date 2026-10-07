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