#!/usr/bin/env node
/**
 * 校验 sw.js 的预缓存清单与 data/books.json 一致（发布门禁的一步）。
 *
 * 为什么需要它
 * ------------
 * 网站会持续加书，而 sw.js 的 SHELL 数组里是**硬编码**每个 `.graph.json` 的路径。
 * 每加一本书就得手工往里加一行，忘了不会有任何报错 —— 直到某天想做离线可用才发现少一本。
 *
 * 这不是曾经发生过的 v0.69–v0.71 那种事故（那次的症状是"老访客一直跑旧代码"），
 * 严重程度低得多：/data/ 走的是 stale-while-revalidate，漏了只是首次访问多一次
 * 网络请求，不会白屏、不会拿到错数据。但"悄悄不一致"本身就是 bug 的温床，
 * 而且这个检查写起来只有三十行。
 *
 * 它检查两件事：
 *   1. books.json 里每本书的 graphFile 都在 sw.js 的 SHELL 里（漏了要报）
 *   2. sw.js 的 SHELL 里没有已从 books.json 移除的 .graph.json（残留要报，会白占缓存）
 *
 * 用法：node scripts/check-sw-precache.mjs
 * 通过时静默退出 0；不一致时打印差异并 exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const books = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'books.json'), 'utf8')).books || [];

// sw.js 的 SHELL 里所有 ./data/... 条目
const cached = new Set(
  [...sw.matchAll(/'(\.\/data\/[^']+)'/g)].map((m) => m[1]),
);

const problems = [];
const wanted = new Set();

for (const b of books) {
  if (!b.graphFile) continue;
  // books.json 里写的是 "data/xxx.graph.json"，sw.js 里是 "./data/xxx.graph.json"
  const url = './' + b.graphFile.replace(/^\.\//, '');
  wanted.add(url);
  if (!cached.has(url)) {
    problems.push(`sw.js 的 SHELL 里缺 ${url}（《${b.title}》的图包）。加书时忘了同步，离线首访要多等一次网络。`);
  }
  // 有 graphFile 就该有 textFile，否则文案永远加载不出来
  if (!b.textFile) {
    problems.push(`books.json 里《${b.title}》有 graphFile 但没有 textFile —— 人物描述/结局会是空的`);
  }
}

for (const url of cached) {
  if (url.endsWith('.json') && !url.endsWith('books.json') && !wanted.has(url)) {
    problems.push(`sw.js 的 SHELL 里有多余的 ${url}（books.json 里已没有这本书）。书删掉后它会一直白占缓存。`);
  }
}

if (problems.length) {
  console.error('sw.js 预缓存清单与 data/books.json 不一致：');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('\n修复：往 sw.js 的 SHELL 数组里加上/删掉对应条目（改完记得跑 node scripts/bump-version.mjs <版本>）');
  process.exit(1);
}

console.log(`✓ sw.js 预缓存与 books.json 一致（${wanted.size} 本书的图包）`);