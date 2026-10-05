#!/usr/bin/env node
/**
 * 第一步：把「原文里查不到」的假引号去掉（v0.102 方案阶段 1）。
 *
 * ⚠ 只做**能确定的那一件事**：凡是 `「…」` 里的内容在原书里逐字定位不到的，
 *   把这对引号去掉 —— 让它回到"老实转述"的形态，不再冒充原文。
 *   命中得到的那些**一个字都不动**（它们还等着人工确认是"原文"还是"我的转述"）。
 *
 * ⚠ 必须跳过推导边：它们的 text 是「由「父子」推导（原文没有直接互动）」这种，
 *   引号里装的是**关系类型词**（「父子」），本来就不在原书里，
 *   一旦当假引号去掉，这条边就变成没有推导说明的裸边了。
 *
 * ⚠ 为什么只去引号、不改写句子：
 *   「他说：「多么贪心的老太婆。」」→「他说：多么贪心的老太婆。」读起来通顺，
 *   而**改写**就等于我又替原文写了一遍话——那正是这次要消灭的东西。
 *
 * 用法：node scripts/strip-fake-quotes.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

const SOURCES = {
  'three-kingdoms': 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/三国演义.txt',
  'one-hundred-years-of-solitude': 'C:/Users/chw/AppData/Local/Temp/opencode/epub.txt',
  'crime-and-punishment': 'C:/Users/chw/AppData/Local/Temp/opencode/ba-books/罪与罚.txt',
};
const flat = (s) => String(s || '').replace(/[\s·・･]/g, '');

let total = 0;
const touched = [];

for (const [slug, srcPath] of Object.entries(SOURCES)) {
  const file = path.join(ROOT, 'data', `${slug}.json`);
  if (!fs.existsSync(srcPath)) { console.log(`  ⚠ ${slug}：找不到原书 ${srcPath}，跳过`); continue; }
  const src = flat(fs.readFileSync(srcPath, 'utf8'));
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));

  const isDerived = (ev) => ev.derived === true || /由.*推导/.test(String(ev.text || ''));
  const strips = [];

  /* 只把**定位不到**的那几对引号去掉；能定位的原样保留。
   * ⚠ 门槛是 1 不是 2：单字引号（「挡」）同样在冒充原文，
   *   而且一个字的引号本来就不构成"引文"，留着只会更像引文。 */
  const stripUnfound = (text) => text.replace(/[「『]([^」』]+)[」』]/g, (whole, inner) => {
    const f = flat(inner);
    if (!f.length) return whole;
    return src.indexOf(f.slice(0, Math.min(40, f.length))) >= 0 ? whole : inner;
  });

  let changed = 0;
  for (const rel of book.relations ?? []) {
    for (const ev of rel.events ?? []) {
      if (isDerived(ev)) continue;
      const before = String(ev.text || '');
      const after = stripUnfound(before);
      if (after !== before) { ev.text = after; changed++; strips.push(before); }
    }
  }
  for (const ev of book.events ?? []) {
    if (isDerived(ev)) continue;
    const before = String(ev.text || '');
    const after = stripUnfound(before);
    if (after !== before) { ev.text = after; changed++; strips.push(before); }
  }

  if (changed) {
    total += changed;
    touched.push(slug);
    console.log(`  ${slug}：去掉 ${changed} 处假引号`);
    for (const s of strips.slice(0, 4)) console.log(`     · ${s.slice(0, 88)}`);
    if (strips.length > 4) console.log(`     …另 ${strips.length - 4} 处`);
    /* ⚠ 第一版漏了 `&& WRITE` —— 于是"预览模式"其实**直接落盘了**，
     *   打印出来却说"加 --write 才落盘"，自己骗自己。
     *   这种错比结论错更坏：它让人以为没改。 */
    if (WRITE) fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
  } else {
    console.log(`  ${slug}：没有要改的`);
  }
}

console.log(`\n合计去掉 ${total} 处：${touched.join('、') || '无'}`);
if (!WRITE) console.log('（预览模式，**未落盘**；加 --write 才写）');
