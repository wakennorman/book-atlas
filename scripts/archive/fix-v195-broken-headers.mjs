#!/usr/bin/env node
/**
 * 【已归档】2026-10-12　v0.195 债二 B1：一次性补丁，用完即归档。
 *                     结论去向：data/*.json（改数据的脚本，跑完即生效）
 *                     留在这里是为了留痕「当时怎么改的」，不再是可执行入口。
 * 修 v0.195 标注脚本写坏的文件（一次性修复脚本）
 *
 * ## 出了什么事
 *
 * `scripts/tag-script-lifetime.mjs` 往文件头插生命周期声明时，
 * 判据是「在文件头块的第一行之后插」——
 * 但它**没处理「块注释单行闭合」**（`/* 一整行说明 *\/`）这种写法。
 * 下一行已经在块外，插进去的 ` * 【长期】…` 就成了**裸代码** ⇒
 * `node --check` 报 `SyntaxError: Unexpected token '*'`。
 *
 * 实测损坏 **8 个**（5 个顶层 + 3 个 archive）。
 *
 * ⚠ 为什么第一次没被自检抓到：`tag-script-lifetime.mjs` 的自检只验
 *   「插入行的上一行是不是注释」，而单行闭合块的下一行**恰好也是**
 *   ` * …` 形式的注释行（` * …… */`），所以自检通过了，文件却坏了。
 *   ⇒ 自检的判据不够严，这是本条存在的理由。
 *
 * ## 修法
 *
 * ① 把**孤立的**标记行删掉（它在块外：上一行已经是闭合或非注释开头）；
 * ② 把标记插到**块注释闭合之前**（多行则插在 `/**` 那行之后，单行则拆成两行）。
 *
 * 用法：node scripts/fix-v195-broken-headers.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './make-scripts-index.mjs';

const WRITE = process.argv.includes('--write');

/** 全仓找「插了标记但语法坏了」的 .mjs。 */
function allScripts(root) {
  const out = [];
  for (const dir of ['scripts', 'scripts/lib', 'scripts/archive', 'test', 'miniprogram', 'shared']) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
        else if (e.name.endsWith('.mjs') || e.name.endsWith('.js')) out.push(p);
      }
    };
    walk(abs);
  }
  return out;
}

const TAG_RE = /^(\s*(?:\/\/|\/\*\*?|\*)\s*)\s*【(?:长期|一次性)】/;

/** 该行是不是**孤立**的标记行（在块外）。 */
function isStray(lines, i) {
  const t = lines[i].trim();
  if (!/【(?:长期|一次性)】/.test(t)) return false;
  const prev = (lines[i - 1] || '').trim();
  /* 上一行已闭合块注释，或上一行不是注释开头 ⇒ 这一行在块外。 */
  const inBlock = prev.endsWith('*/') && !prev.startsWith('//');
  return inBlock || (!prev.startsWith('//') && !prev.endsWith('*') && !prev.startsWith('/*'));
}

const plans = [];
for (const f of allScripts(ROOT)) {
  /* ⚠ 跳过自己：它提到这些标记是**文档用途**，不是被插入的。 */
  if (f.endsWith('fix-v195-broken-headers.mjs')) continue;
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');

  const strayIdx = lines.map((_, i) => i).filter((i) => isStray(lines, i));
  if (!strayIdx.length) continue;
  if (!/【(?:长期|一次性)】/.test(src)) continue;

  /* 收集要保留的标记（去掉前缀 ` *`/`//`，只留标记本身）。 */
  const tags = strayIdx.map((i) => lines[i].replace(TAG_RE, '$1').trim()).filter(Boolean);

  /* 找到文件头块的起始行（跳过 shebang）。 */
  const at = lines[0].startsWith('#!') ? 1 : 0;
  const headIdx = lines.findIndex((l, i) => i >= at && (l.startsWith('/**') || l.startsWith('/*') || l.startsWith('//')));
  if (headIdx < 0) { console.log(`  ？ ${path.relative(ROOT, f)}：找不到文件头块，需手工`); continue; }

  const head = lines[headIdx];
  const style = head.startsWith('//') ? '// ' : head.trimEnd().endsWith('*/') && !head.includes('\n') ? '/**' : (lines[headIdx + 1] || ' *').match(/^\s*\*/)?.[0] + ' ' || ' * ';
  const singleLine = style === '/**';        // 标记为需要拆行

  const out = [...lines];
  /* 倒序删掉孤立行。 */
  for (const i of [...strayIdx].sort((a, b) => b - a)) out.splice(i, 1);
  /* 重新定位文件头（删除可能改变了行号）。 */
  const h2 = out.findIndex((l, i) => i >= at && (l.startsWith('/**') || l.startsWith('/*') || l.startsWith('//')));

  if (singleLine) {
    /* 单行闭合 ⇒ 拆成三行：说明 / 标记 / 闭合。 */
    const body = out[h2].replace(/^\/\*\*?/, '').replace(/\*\/\s*$/, '').trimEnd();
    out.splice(h2, 1, `/** ${body}`, ...tags.map((t) => ` * ${t}`), ' */');
  } else {
    out.splice(h2 + 1, 0, ...tags.map((t) => `${style}${t}`));
  }

  const text = out.join('\n');
  plans.push({ f, text, tags: tags.length });
  console.log(`  ✔ ${path.relative(ROOT, f).padEnd(46)} 收回 ${tags.length} 处标记`);
}

if (!WRITE) {
  console.log(`\n（预览）将修 ${plans.length} 个文件。加 --write 才落盘。`);
  process.exit(0);
}

for (const p of plans) {
  /* ⚠ 写前自检：语法必须通过 —— 但本机起不了子进程（EBUSY），
   *   所以这里只验「文件头块闭合 + 标记在块内」，真正的语法检查靠门禁的 eslint。 */
  if (!p.text.includes('*/') && !p.text.includes('//')) { console.error(`✗ ${p.f}：改完没有注释闭合`); process.exit(1); }
  const ls2 = p.text.split('\n');
  const tagAt = ls2.findIndex((l) => /【(?:长期|一次性)】/.test(l));
  if (tagAt < 1) { console.error(`✗ ${p.f}：找不到标记行`); process.exit(1); }
  const prev = ls2[tagAt - 1].trim();
  if (!prev.endsWith('*/') && !prev.startsWith('//') && !prev.endsWith('*') && !prev.startsWith('/*')) {
    console.error(`✗ ${p.f}：标记行仍落在块外（上一行是「${prev}」）`);
    process.exit(1);
  }
  fs.writeFileSync(p.f, p.text, 'utf8');
}
console.log(`\n✓ 已修 ${plans.length} 个文件`);
