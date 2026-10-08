/**
 * 「注释里自称的守卫」必须真的存在（v0.154 新增）
 *
 * ## 为什么要有它
 *
 * `check.yml` 里有一条注释写着：
 *
 *     audit-kin-direction（查父子边方向）与 audit-kin-gender（查 type/gender 自洽），
 *     两者都是硬门禁。
 *
 * 但 `audit-kin-direction.mjs` **从没进过 check.yml 的 run 步骤**，而且它恒 `exit 0`
 * （只 `console.log` 报告，没有 `process.exit(1)`）—— 也就是说：
 * **注释说它守着，其实它连门禁都没进。**
 *
 * 这比"没有守卫"更危险：读注释的人（包括未来的我）会以为这里有守卫，于是不去补。
 * 本项目已经栽过同类跟头（v0.145「门禁只守了 1/N」、v0.146「判据存在但从不触发」），
 * 而这一条是**注释在吹牛** —— 更隐蔽。
 *
 * ## 判据
 *
 * 扫 `check.yml` 的注释行：**凡是含「硬门禁」的行，其自身 ±1 行窗口内出现的脚本名，
 * 必须真的出现在 `check.yml` 的非注释行里（即真的被 run / 被语法检查）。**
 *
 * 于是：
 *   · 说了「是硬门禁」却没跑 ⇒ 报红（就是本次这条）
 *   · 想说明"某个脚本**不是**硬门禁" ⇒ 别把它的名字写在「硬门禁」三字旁边
 *     （隔 ≥2 行，或干脆不点名）—— 措辞本身就是判据。
 *
 * ⚠ 只扫 `check.yml`：脚本自己的文件头注释不受约束（`audit-kin-direction.mjs` 的
 *   身份说明写在它自己文件里，那才是它该待的地方）。
 *
 * 用法：node test/gate-claims.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YML = path.join(ROOT, '.github', 'workflows', 'check.yml');
const lines = fs.readFileSync(YML, 'utf8').split(/\r?\n/);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

const isComment = (l) => /^\s*#/.test(l);

/* ---- 1. 门禁里真正被跑的脚本（非注释行里的 scripts/xxx.mjs、test/xxx.mjs）---- */
const inGate = new Set();
for (const l of lines) {
  if (isComment(l)) continue;
  for (const m of l.matchAll(/(?:scripts|test)\/[\w-]+\.mjs/g)) {
    inGate.add(path.basename(m[0], '.mjs'));
  }
}

/* ---- 2. 注释里自称「硬门禁」的脚本名 ---- */
/* 注释里写的是**裸脚本名**（`audit-kin-direction`，没有 .mjs 后缀），
 * 所以匹配"含连字符的小写词" —— 它能把 `audit-kin-direction` 当整体抓出来，
 * 而不会误抓 `type/gender`（无连字符）、`--coverage`（以 - 开头）、`v0.115`（有点）。 */
const NAME = /[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g;
const claims = new Map();   // 脚本名 -> 行号（1 基）
for (let i = 0; i < lines.length; i++) {
  if (!/硬门禁/.test(lines[i])) continue;
  for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) {
    if (!isComment(lines[j])) continue;
    for (const m of lines[j].matchAll(NAME)) {
      if (!claims.has(m[0])) claims.set(m[0], j + 1);
    }
  }
}

/* ---- 3. 断言 ---- */
console.log(`  门禁里跑的脚本 ${inGate.size} 个；注释里自称「硬门禁」的脚本 ${claims.size} 个`);
if (claims.size === 0) {
  ok(true, 'check.yml 的注释里没有「硬门禁」声明（或都没点名脚本）—— 无需比对');
}
for (const [script, ln] of claims) {
  if (inGate.has(script)) {
    ok(true, `${script}（check.yml:${ln} 附近自称「硬门禁」）确实在门禁里`);
  } else {
    ok(false, `${script}（check.yml:${ln} 附近写着「硬门禁」）**不在** check.yml 的 run 步骤里`);
    console.error('      ⇒ 要么把它加进门禁（并让它有 process.exit(1)），');
    console.error('        要么把「硬门禁」与它的名字分开写（隔 ≥2 行）—— 别让注释吹牛。');
  }
}

console.log(fail ? `\n✗ ${fail} 处「硬门禁」声明与门禁实现不符` : `\n✓ 注释里的「硬门禁」声明与门禁实现一致（${pass} 条）`);
process.exit(fail ? 1 : 0);
