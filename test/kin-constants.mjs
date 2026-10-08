/**
 * KIN / KIN_HINT 跨端一致性对拍（v0.149 新增）
 *
 * ## 为什么要有它
 *
 * 「亲属类型」的标签（blood→血缘、inlaw→姻亲…）在项目里有 **5 处副本**：
 *   · scripts/kin.mjs                     —— 权威（被 validate.mjs / annotate-kin.mjs / wholebook.mjs import）
 *   · js/app.js            KIN_LABEL      —— 网页端
 *   · js/editor.js         KIN_LABEL      —— 编辑器端
 *   · miniprogram/utils/graph.js          —— 小程序（KIN + KIN_HINT）
 *   · miniprogram/pages/index/index.js    —— 小程序（KIN_LABEL）
 *
 * 之所以是副本而不是单一来源：浏览器 / 小程序模块 import 不了 `scripts/`（会要求把 scripts/ 也塞进
 * SW 预缓存 / 小程序包），项目对同类问题的既定策略是「手抄 + 对拍」（见 v0.146 的 guessKin、v0.147）。
 *
 * 目前 5 处一致，但**没有任何测试守着** —— 某端单独改一个标签（如把「姻亲」写成「亲家」），
 * 就会出现「同一个 kin 在网页显示 A、在小程序显示 B」这种**用户可见**的不一致，而门禁全绿。
 *
 * ## 做法
 *
 * 读各文件源码 → 正则抽出常量对象字面量 → 逐键比对（连「漏抄一个键」也能抓到）。
 * 不用 `new Function` / `eval`：对象值全是单引号字符串，正则足够，也免得踩 eslint 的 no-new-func。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIN } from '../scripts/kin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 从源码里抽 `[export] const NAME = { ... };`，解析成对象（值按单引号字符串取）。 */
function pick(file, name) {
  const m = read(file).match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;`));
  if (!m) throw new Error(`在 ${file} 里找不到 const ${name} = {...}`);
  const obj = {};
  for (const km of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*'([^']*)'/g)) obj[km[1]] = km[2];
  if (Object.keys(obj).length === 0) throw new Error(`${file} 的 ${name} 没解析出任何键（写法变了吗？）`);
  return obj;
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n▶ KIN 标签（与权威 scripts/kin.mjs 的 KIN 逐字比对）');
const LABEL_SITES = [
  ['js/app.js', 'KIN_LABEL'],
  ['js/editor.js', 'KIN_LABEL'],
  ['miniprogram/utils/graph.js', 'KIN'],
  ['miniprogram/pages/index/index.js', 'KIN_LABEL'],
];
for (const [f, name] of LABEL_SITES) {
  let v;
  try { v = pick(f, name); } catch (e) { ok(false, `${f}: ${e.message}`); continue; }
  ok(same(v, KIN), `${f} 的 ${name} 与权威一致（${Object.keys(v).length} 键）`);
}

console.log('\n▶ KIN_HINT（两处互比）');
const HINT_SITES = ['js/app.js', 'miniprogram/utils/graph.js'];
const hints = [];
for (const f of HINT_SITES) {
  try { hints.push([f, pick(f, 'KIN_HINT')]); } catch (e) { ok(false, `${f}: ${e.message}`); }
}
if (hints.length === 2) {
  ok(same(hints[0][1], hints[1][1]), `KIN_HINT 两处一致（${hints[0][0]} ⇄ ${hints[1][0]}）`);
  ok(same(Object.keys(hints[0][1]).sort(), Object.keys(KIN).sort()), 'KIN_HINT 的键集合与 KIN 相同');
}

console.log('\n▶ 权威键集合（金标：钉「正确」而非「现状」）');
const EXPECTED = ['adoptive', 'blood', 'foster', 'inlaw', 'marriage', 'step', 'sworn'];
ok(same(Object.keys(KIN).sort(), EXPECTED), `KIN 恰有这 7 个键：${EXPECTED.join(' / ')}`);

console.log(`\n${fail === 0 ? '✓' : '✗'} KIN 跨端一致性　通过：${pass}  失败：${fail}`);
process.exit(fail === 0 ? 0 : 1);
