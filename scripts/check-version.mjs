#!/usr/bin/env node
/**
 * 版本号一致性检查（发布门禁的一步）。
 *
 * 为什么需要它：v0.69–v0.71 连续三轮改了前端却忘了 bump `sw.js` 里的 `CACHE`，
 * SW 字节没变 ⇒ 浏览器不重装 SW ⇒ 早先访问过的老访客一直跑 v0.68 的代码。
 * 当时没有任何检查能发现，现在这个脚本就是那道检查。
 *
 * ⚠ 但「一直跑旧代码」这个机制**后来变了**：ed16c38 把 sw.js 的 fetch 改成**网络优先**之后，
 *   在线访客照样能拿到新资源 —— 如今不 bump 的代价主要是**离线与缓存卫生**（旧缓存不被清、
 *   SHELL 预缓存清单停在旧版本）。本脚本守的是「版本号四处彼此一致」这条约定本身，仍然要跑；
 *   而「改了前端却**该 bump 没 bump**」是另一件事，由 `check-version-bump.mjs` 守。
 *
 * 它检查「同一个版本号在所有该出现的地方都出现了，且都相同」：
 *   · sw.js            `CACHE = 'bookatlas-vNN'`
 *   · index.html       所有 `?v=NN`（css/style.css、js/app.js …）
 *   · editor.html      所有 `?v=NN`
 *   · js/editor.js     `PDF_WORKER = 'vendor/pdf.worker.min.js?v=NN'`
 *   · package.json     `"version": "x.y.z"` —— 小版本号须等于 NN
 *
 * 用法：node scripts/check-version.mjs
 * 通过时静默退出 0；不一致时打印全部差异并 exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const problems = [];

// 1) sw.js 的 CACHE = 'bookatlas-vNN'
const sw = read('sw.js');
const cacheM = sw.match(/bookatlas-v(\d+)/);
if (!cacheM) problems.push('sw.js 里找不到 bookatlas-vNN');
const swVer = cacheM ? cacheM[1] : null;

// 2) 其余文件里的所有 ?v=NN 必须都等于 swVer
const TARGETS = ['index.html', 'editor.html', 'js/editor.js'];
for (const file of TARGETS) {
  const text = read(file);
  const found = [...text.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  if (!found.length) continue;
  const bad = [...new Set(found.filter((v) => v !== swVer))];
  if (bad.length) {
    problems.push(
      `${file}：出现 ?v=${bad.join(' / ?v=')}，与 sw.js 的 bookatlas-v${swVer} 不一致`,
    );
  }
}

// 3) sw.js 的 SHELL 预缓存清单里带 ?v= 的项也必须等于 swVer
const shellBad = [...sw.matchAll(/'(\.\/[^']*\?v=(\d+))'/g)]
  .map((m) => m[2])
  .filter((v) => v !== swVer);
if (shellBad.length) {
  problems.push(
    `sw.js SHELL 预缓存清单：出现 ?v=${[...new Set(shellBad)].join(' / ?v=')}，与 CACHE v${swVer} 不一致`,
  );
}

// 4) package.json 的版本号小节须等于 swVer（项目里 sw.js 的 NN 与 package 的 x.y.z 中 y 一致）
const pkg = JSON.parse(read('package.json'));
const pkgMinor = String(pkg.version || '').split('.')[1];
if (swVer && pkgMinor !== swVer) {
  problems.push(
    `package.json 版本 ${pkg.version} 的小节（${pkgMinor}）与 sw.js 的 bookatlas-v${swVer} 不一致`,
  );
}

if (problems.length) {
  console.error('版本号不一致（这正是"部署后老访客仍跑旧代码"的成因，已在 v0.69–v0.71 出过一次）：');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('\n修复：node scripts/bump-version.mjs <版本号>，并同步改 package.json 的 version');
  process.exit(1);
}

console.log(`✓ 版本号一致：bookatlas-v${swVer} / package ${pkg.version}`);
