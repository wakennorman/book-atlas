/* 「内部措辞不进 UI」门禁 —— v0.213 新增。
 * 【长期】发布门禁每轮都跑（判据与范围见 scripts/lib/ui-notes.mjs 头部）
 *
 * 扫**浏览器直取的源数据**里有没有施工台账痕迹（版本号 / 本轮 / 用户报告 /
 * 合并拆分史 / 机器 id 引用…），命中即红。发现方式从 data/books.json 来——
 * 新书注册进 books.json 就自动纳入，不维护第二份清单。
 *
 * ⚠ 跳过的分支（都打印，不静默）：
 *   · 每个 slug 的 .graph.json / .text.json（生成物）与 *-ok.json 等台账不扫；
 *   · relations[N].basis、机器键（id/chars/events 字符串数组…）不扫——
 *     它们不渲染给读者，且事件 id 引用是它们的正常工作内容。
 *
 * 用法：node scripts/check-ui-notes.mjs
 * ⚠ 支持 BOOKATLAS_ROOT（只给测试用）：test/ui-notes-guard.mjs 在 tmp 里造最小
 *   data/ 逐场景断言。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectLeaks } from './lib/ui-notes.mjs';

const ROOT = process.env.BOOKATLAS_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

export function checkUiNotes() {
  const problems = [];
  const booksFile = path.join(DATA, 'books.json');
  if (!fs.existsSync(booksFile)) {
    problems.push('找不到 data/books.json —— 无法发现要扫的书');
    return problems;
  }
  let registry;
  try { registry = JSON.parse(fs.readFileSync(booksFile, 'utf8')); }
  catch (e) { problems.push(`data/books.json 解析失败：${e.message}`); return problems; }
  const books = Array.isArray(registry.books) ? registry.books : [];
  if (!books.length) {
    problems.push('data/books.json 里没有 books[] —— 一本书都没注册（形状变了？）');
    return problems;
  }

  /* 渲染面 = books.json + 每本的 data/<slug>.json + data/annotations/<slug>.json。
   * 路径记在 problems 里用相对路径，报红信息在任意 cwd 下都能读懂。 */
  const targets = [{ file: 'data/books.json', abs: booksFile, doc: registry }];
  for (const b of books) {
    const slug = b && typeof b.slug === 'string' ? b.slug : null;
    if (!slug) { problems.push(`books.json 里有一条缺 slug 的注册项：${JSON.stringify(b).slice(0, 60)}`); continue; }
    const bookAbs = path.join(DATA, `${slug}.json`);
    if (!fs.existsSync(bookAbs)) { problems.push(`books.json 注册了 ${slug}，但 data/${slug}.json 不存在`); continue; }
    let book;
    try { book = JSON.parse(fs.readFileSync(bookAbs, 'utf8')); }
    catch (e) { problems.push(`data/${slug}.json 解析失败：${e.message}`); continue; }
    targets.push({ file: `data/${slug}.json`, abs: bookAbs, doc: book });
    const annoAbs = path.join(DATA, 'annotations', `${slug}.json`);
    if (fs.existsSync(annoAbs)) {
      let anno;
      try { anno = JSON.parse(fs.readFileSync(annoAbs, 'utf8')); }
      catch (e) { problems.push(`data/annotations/${slug}.json 解析失败：${e.message}`); continue; }
      targets.push({ file: `data/annotations/${slug}.json`, abs: annoAbs, doc: anno });
    }
  }

  for (const t of targets) {
    for (const leak of collectLeaks(t.doc)) {
      problems.push(`${t.file} ${leak.path}：命中「${leak.name}」—— …${leak.sample}…`
        + `\n     ⇒ ${leak.why}`
        + `\n     改法：把施工台账从这条文案里剥掉，只留读者需要的事实；`
        + `施工记录进 docs/ 或 .workbuddy-ai/memory/。`);
    }
  }
  return problems;
}

/* 入口判断用 pathToFileURL 规范化再比（仓库目录名带空格，endsWith(argv[1]) 永远不等）。 */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ps = checkUiNotes();
  if (!ps.length) {
    console.log('✓ 渲染字段没有施工台账痕迹（books.json + 各书源文件 + annotations 全扫）');
    process.exit(0);
  }
  console.error(`✗ 渲染字段有 ${ps.length} 处施工台账痕迹：\n`);
  for (const p of ps) console.error('  ✗ ' + p + '\n');
  process.exit(1);
}
