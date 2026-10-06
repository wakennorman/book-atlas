#!/usr/bin/env node
/**
 * v0.115：删掉 `孙权 —赐姓养侄孙— 孙韶`，并把孙河代号值的任意性写进 note
 *
 * ## 一、孙韶：删
 *
 * 数据：`孙权 —赐姓养侄孙— 孙韶`　「孙权亲往辕门救下被斩的孙韶」
 * 原文：「奈**此子虽本姓俞氏，然孤兄甚爱之，赐姓孙**，于孤颇有劳绩」
 *      「权亲往辕门救下被斩的孙韶」
 *
 * 这个称谓**两处都没依据**：
 *   · 「赐姓」的动作属于孙权的**兄**（「孤兄甚爱之」），不属于孙权
 *   · 「侄孙」是差 2 代，但原文只说他是"兄的儿子"，即**侄**，从没写孙权称他什么
 *
 * 删的理由（用户裁定方向："没写就不设"）：
 *   换成「族侄」或「侄」都是**我的推断**，不是原文的话。
 *   按"查不到出处的一个字都不许写"，该删。
 *
 * ★ 代价要说清：「孙权救下孙韶」这件事是真的，删了这条边就丢掉这个互动。
 *   以后若在原文里找到孙权对孙韶的称呼，再按原文加回来 —— 记录在
 *   docs/known-dropped-relations.md 里，不留在这份数据里当半成品。
 *
 * ## 二、孙河的代号是任意的，写清楚
 *
 * 孙河 =「其父名河，本姓俞氏，孙策爱之，赐姓孙」（第九十二回）。
 * **原著从没说他是谁的儿子**，所以他在族谱里的绝对代号无从得知。
 * 现在是 gen3（孙河 gen3 → 孙桓 gen4），这只是为了满足"父代号 < 子代号"。
 *
 * ⚠ 但要说清：这个值**只影响布局，不影响任何推导** ——
 *   scripts/derive-kin.mjs 只读**亲子边**，不读 `generation`；
 *   check-kin-terms 的对质也是从亲子边推的。
 *   所以"孙河是第几代"这件事既没算错，也不会让称谓算错。
 *
 * 用法：node scripts/fix-sunhe-note.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byName = new Map(book.characters.map((c) => [c.name, c]));
const nm = (id) => book.characters.find((c) => c.id === id)?.name ?? id;

/* ── 一、删孙韶那条 ── */
{
  const sq = byName.get('孙韶'), quan = byName.get('孙权');
  if (!sq || !quan) console.log('  ⛔ 找不到孙韶 / 孙权，跳过');
  else {
    const i = book.relations.findIndex((r) => r.from === quan.id && r.to === sq.id
      && /侄孙/.test(String(r.type)));
    if (i < 0) console.log('  (跳过) 孙权 —赐姓养侄孙— 孙韶 已不存在');
    else {
      const r = book.relations[i];
      console.log(`  删掉：${nm(r.from)} —${r.type}— ${nm(r.to)}`);
      console.log(`     ${r.events?.[0]?.text ?? ''}`);
      console.log(`     理由：「赐姓」属孙权的兄（「孤兄甚爱之」）；「侄孙」差 2 代，原文只说"兄之子"。`);
      book.relations.splice(i, 1);
      console.log('     ★ 「孙权救下孙韶」这件事是真的，删边会丢掉这个互动 —— 已记进 docs/known-dropped-relations.md');
    }
  }
}

/* ── 二、孙河的 note 补上"代号任意"这句 ── */
{
  const he = byName.get('孙河');
  if (!he) console.log('  ⛔ 找不到孙河');
  else {
    const add = '⚠ 原著从未交代孙河的父亲是谁（历史上是孙贲，小说没写），'
      + '所以他在族谱里的绝对代号无从得知：现在 gen3 / 其子孙桓 gen4，'
      + '只为了满足"父代号 < 子代号"。这个值**只影响布局，不影响推导** —'
      + 'derive-kin 与 check-kin-terms 都只读亲子边，不读 generation。';
    if (!he.note.includes('只影响布局')) {
      he.note = he.note ? `${he.note}。${add}` : add;
      console.log(`\n  孙河 note 已补：\n     ${he.note}`);
    } else console.log('\n  (跳过) 孙河 note 已含该说明');
  }
}

console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
