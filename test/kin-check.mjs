/**
 * `checkKin` 规则检查的金标测试（v0.150 新增）
 *
 * ## 为什么要有它
 *
 * `scripts/kin.mjs` 的 `checkKin` 是「亲属类型（`kin`）与关系名（`type`）是否自洽」的**唯一判据**，
 * `scripts/validate.mjs` 靠它把矛盾报出来（v0.147 收紧后，「非 `blood` 配纯血缘称谓」是 error，
 * 正是靠它抓出「吴懿—刘璋 舅甥 + kin=inlaw」那两条）。但它此前**零测试覆盖** ——
 * 规则改了、退化了、或哪天被误删，都不会有人知道。
 *
 * ## 钉什么
 *
 * 钉**结构**（返回的 `level` 序列），不钉文案 —— **文案会改，语义不会**。
 * 每条用例都写明「为什么该是这个结果」，方便日后规则再收紧时逐条对照。
 *
 * ## 为什么用金标而不是对拍
 *
 * `js/editor.js` 里有一份**手抄的同类逻辑**（`validate()` 内），但它是浏览器模块、
 * 且判据细节不同（那边同时报多种 issue）。这里先给权威 `checkKin` 钉一张**金标表**；
 * 编辑器那份的对拍另作遗留。
 */
import { checkKin } from '../scripts/kin.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } };

/** [type, kin, 期望的 level 序列, 说明] */
const CASES = [
  // ── 非法 kin：先拦下，不再往下判（只出这一条） ──
  ['父子', 'bogus', ['error'], 'kin 不在 KIN_KEYS ⇒ 非法，且短路不再判别的规则'],

  // ── kin 留空 ──
  ['父子', '', ['warn'], 'kin 空 + type 能猜出 blood ⇒ 建议补'],
  ['夫妻', '', ['warn'], 'kin 空 + type 能猜出 marriage ⇒ 建议补'],
  ['朋友', '', [], 'type 落在 NOT_KIN（不是家人）⇒ 不猜、不报'],
  ['', '', [], 'type 与 kin 都空 ⇒ 无告警'],

  // ── v0.147 的核心：纯血缘称谓只能配 blood ──
  ['舅甥', 'inlaw', ['error', 'warn'], '血缘称谓配姻亲 ⇒ error；且 type 看着像 blood ≠ inlaw ⇒ 再加 warn'],
  ['父子', 'adoptive', ['error', 'warn'], '血缘称谓配收养 ⇒ error（收养/继亲/结义/抚养/姻亲/婚姻都不许写成「父子」）'],
  ['母子', 'sworn', ['error', 'warn'], '血缘称谓配结义 ⇒ error'],

  // ── 自洽：无告警 ──
  ['父子', 'blood', [], 'type 与 kin 都是血缘 ⇒ 一致'],
  ['养父子', 'adoptive', [], '「养父子」猜出 adoptive，与标注一致 ⇒ 无告警'],

  // ── 标了 blood 但看不出血缘 ──
  ['同宗', 'blood', ['warn'], '标了 blood，但 type「同宗」不在血缘词表里 ⇒ 提醒核对'],

  // ── kin 写成「空 / 无 / -」等占位 ⇒ 按空处理 ──
  ['舅甥', '空', ['warn'], 'kin「空」被规范化为空 ⇒ 回到「建议补 blood」'],

  // ── 方向对但类型错：只 warn 不 error（type 不是纯血缘称谓） ──
  ['夫妻', 'inlaw', ['warn'], '「夫妻」看着像 marriage，标的是 inlaw ⇒ warn（不是 error：type 不是纯血缘称谓）'],
];

console.log('\n▶ checkKin 规则金标');
for (const [type, kin, want, why] of CASES) {
  const got = checkKin({ type, kin }).map((x) => x.level);
  ok(JSON.stringify(got) === JSON.stringify(want),
    `type「${type}」kin「${kin}」⇒ [${got.join(',') || '空'}]${why ? `　（${why}）` : ''}`);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} checkKin 金标　通过：${pass}  失败：${fail}`);
process.exit(fail === 0 ? 0 : 1);
