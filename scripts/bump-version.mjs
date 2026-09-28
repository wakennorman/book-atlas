#!/usr/bin/env node
/**
 * 版本号同步：改前端资源后跑一次，自动更新所有引用处的版本号。
 *
 * 用法：
 *   node scripts/bump-version.mjs 73           # 把所有版本号改到 73
 *   node scripts/bump-version.mjs 73 --dry-run # 只打印要改什么，不落盘
 *
 * 会更新：
 *   · index.html 里所有 ?v=NN
 *   · editor.html 里所有 ?v=NN
 *   · sw.js 里 CACHE = 'bookatlas-vNN'
 *   · sw.js SHELL 数组里所有 ?v=NN
 *   · js/editor.js 里 PDF_WORKER 的 ?v=NN
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const newVer = argv.find((a) => !a.startsWith('--'));

if (!newVer || !/^\d+$/.test(newVer)) {
  console.error('用法：node scripts/bump-version.mjs <版本号> [--dry-run]');
  console.error('例：node scripts/bump-version.mjs 73');
  process.exit(1);
}

const FILES = [
  'index.html',
  'editor.html',
  'sw.js',
  'js/editor.js',
];

const changes = [];

for (const file of FILES) {
  const fp = path.join(ROOT, file);
  if (!fs.existsSync(fp)) {
    console.warn(`跳过（不存在）：${file}`);
    continue;
  }
  let text = fs.readFileSync(fp, 'utf8');
  const original = text;

  if (file === 'sw.js') {
    // CACHE = 'bookatlas-vNN'
    text = text.replace(/bookatlas-v\d+/g, `bookatlas-v${newVer}`);
  }

  // 所有 ?v=NN → ?v=新版本
  text = text.replace(/\?v=\d+/g, `?v=${newVer}`);

  if (text !== original) {
    const count = (original.match(/\?v=\d+/g) || []).length
      + (original.match(/bookatlas-v\d+/g) || []).length;
    changes.push({ file, count });
    if (!dryRun) {
      fs.writeFileSync(fp, text, 'utf8');
    }
  }
}

if (dryRun) {
  console.log(`[dry-run] 将版本号改到 v${newVer}，涉及：`);
  for (const c of changes) console.log(`  ${c.file}（${c.count} 处）`);
} else {
  console.log(`版本号已同步到 v${newVer}：`);
  for (const c of changes) console.log(`  ${file}（${c.count} 处）`);
}
