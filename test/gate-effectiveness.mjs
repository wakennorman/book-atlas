/**
 * 门禁里的每一步都必须**物理上可能报红** —— v0.165.7 新增
 *
 * ## 为什么要有它
 *
 * 2026-10-09 在 CI 上连着抓到三处"假绿"，都是同一个病的不同切面：
 * `test/browser.mjs` 找不到浏览器就 `process.exit(0)`、四个测试"拿不到 CDP ⇒ exit 0"、
 * 19 个测试"找不到浏览器 ⇒ exit 0"。它们的共同点是：
 * **步骤在门禁里显示"通过"，而它一条断言都没跑。**
 *
 * 现有的 `test/gate-claims.mjs` 守的是另一面 ——「注释自称的守卫必须真的在 run 步骤里」。
 * 它能发现"注释吹牛"，但发现不了"**步骤在、却永远不会红**"。
 * 后者更隐蔽：文件名和 run 步骤都齐整，任何"清单式"核对都会认为它没问题。
 *
 * ## 判据
 *
 * ① `check.yml` 非注释行里每个 `run: node X`，X 必须存在，且**含一条非零退出路径**。
 *    —— "非零退出路径"的判法：文件里出现 `process.exit(...)`，且其参数**不全**是字面量 `0`。
 *    （第一版只认字面量 `process.exit(1)`，把 `process.exit(fail === 0 ? 0 : 1)` 误判成
 *      "不会报红" —— 1 在**假分支**里也是非零退出。这类判据必须按语义写，不能按字面写。）
 *
 * ② 豁免必须**显式**写在脚本里：`GATE_MAY_ALWAYS_SUCCEED: <为什么>`。
 *    没有理由的豁免等于没豁免。
 *
 * ## 边界
 *
 * · 只管 `run: node X` 这种单行步骤（`run: |` 的 bash 块不在此列）。
 * · 「不是审计脚本却没进门禁」**不在本守卫范围内** ——
 *   `scripts/audit-annotations.mjs` / `audit-kin-direction.mjs` 是有意的人工报告，
 *   它们在文件头里写明了为什么恒 exit 0。把它们判红只会逼人把它们塞进门禁，
 *   那才是真的坏（判据没有的守卫不该有）。
 *
 * 用法：node test/gate-effectiveness.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YML = path.join(ROOT, '.github', 'workflows', 'check.yml');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

/* ---- 门禁里的 node 单行步骤（非注释行）---- */
const lines = fs.readFileSync(YML, 'utf8').split(/\r?\n/);
const steps = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^\s*#/.test(l)) continue;
  const m = /^\s*run:\s*node\s+(\S+)(.*)$/.exec(l);
  if (m) steps.push({ line: i + 1, file: m[1], args: (m[2] || '').trim() });
}

console.log(`  check.yml 里的 node 单行步骤：${steps.length} 个`);

/**
 * 有没有非零退出路径。
 * ⚠ 按语义判，不按字面判：`process.exit(errors ? 1 : 0)`、`process.exit(fail === 0 ? 0 : 1)`
 *   都是能报红的；只有"参数全是字面量 0"或"根本没有 process.exit("才算不能。
 */
function nonZeroExitPaths(src) {
  const args = [...src.matchAll(/process\.exit\(\s*([^)]*)\)/g)].map((m) => m[1].trim());
  if (!args.length) return [];
  return args.filter((a) => a !== '0');
}

for (const s of steps) {
  const abs = path.join(ROOT, s.file);
  if (!fs.existsSync(abs)) {
    ok(false, `check.yml:${s.line} 引用的 ${s.file} 在磁盘上不存在`);
    continue;
  }
  const src = fs.readFileSync(abs, 'utf8');

  const exemption = /GATE_MAY_ALWAYS_SUCCEED:\s*(.+)/.exec(src);
  if (nonZeroExitPaths(src).length) {
    ok(true, `${s.file}${s.args ? ' ' + s.args : ''} 有非零退出路径`);
  } else if (exemption) {
    ok(true, `${s.file} 恒 exit 0，但有显式豁免：${exemption[1].trim()}`);
  } else {
    ok(false, `${s.file}${s.args ? ' ' + s.args : ''} **永远不会报红**`);
    console.error(`      ⇒ 它在门禁里显示"通过"，但一条断言都不会跑。`);
    console.error(`        要么让它能报红，要么在文件里写明 GATE_MAY_ALWAYS_SUCCEED: <为什么>。`);
  }
}

console.log(fail ? `\n✗ ${fail} 个步骤形同虚设` : `\n✓ 全部 ${pass} 个步骤都可能报红`);
process.exit(fail ? 1 : 0);