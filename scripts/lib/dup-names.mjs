/**
 * 「去括号后同名」的定义 —— `scripts/audit-search.mjs` ④ 与
 * `scripts/check-dup-names-ledger.mjs`（台账门禁）的**唯一**来源（v0.181）。
 *
 * ## 为什么要抽出来
 *
 * ④ 的分组规则是 `String(name).replace(/[（(].*$/, '').trim()`，而 v0.181 给 ④
 * 配了台账（`data/dup-names-ok.json`），门禁必须按**同一条规则**重算分组才能对拍。
 * 抄第二份的后果，本仓库已经吃过四次（见 `data-files.mjs` 的注释）：
 * 定义漂移之后，门禁与审计各算各的 —— 要么台账"看着合规"其实对不上，
 * 要么审计报的组门禁认不出来，两边都绿。
 *
 * ## 为什么不直接从 `audit-search.mjs` export
 *
 * `audit-search.mjs` 是**顶层就干活**的脚本：`import` 它会把它的主流程也跑一遍，
 * 而它开头就有 `if (!files.length) { … process.exit(1) }` —— 门禁 import 它时
 * `process.argv` 是门禁自己的，`files` 必为空 ⇒ **门禁直接被 exit 1 掉**。
 * 所以规则放 lib，两边都从 lib 取。
 */

/** 去掉「（…）」/「(…)」补充，取主名。⚠ 与 ④ 原先的实现**逐字相同**。 */
export const baseName = (s) => String(s || '').replace(/[（(].*$/, '').trim();

/**
 * 把人物数组按「去括号后的主名」分组，只返回**撞车**（≥2 人）的那些组。
 *
 * @param {Array<{id?:string,name?:string}>} chars
 * @returns {Array<{base:string, chars:Array, names:string[]}>}
 *   按数据里首次出现的顺序返回（与 ④ 原先的输出顺序逐字一致）。
 */
export function dupeGroups(chars) {
  const byBase = new Map();
  for (const c of chars || []) {
    const k = baseName(c.name);
    byBase.set(k, [...(byBase.get(k) || []), c]);
  }
  return [...byBase.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([base, cs]) => ({ base, chars: cs, names: cs.map((c) => String(c.name)) }));
}
