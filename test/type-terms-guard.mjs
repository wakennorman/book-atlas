/* 守卫：书型术语层自洽（`js/app.js` 的 `TERMS`）＋ `index.html` 的接线正确。
 *
 * 为什么需要它 —— v0.206/v0.208 加术语层时，这几类错误**都不会有任何东西报红**：
 *   ① 给 `narrative` 加了词条、忘了给 `theory` 加（或反过来）⇒ 理论类上 `T().新词条`
 *      取到 `undefined`，界面上直接印出 `undefined`；
 *   ② 句子里的措辞改回了叙事类（`'结局：'` 之类），术语层那一句就白写了；
 *   ③ **把"运行时才定的那部分"写死**（`epubLifeH` 的人称）⇒ 表内部完全自洽、调用点
 *      也完全合法，只是**信息被静默丢掉**（v0.208 真事故：女性角色印成「他的一生」）。
 * 三种都是"跑得通、看着正常"的静默失效，正是本仓最常见的病。
 *
 * ⚠ 本机起不了子进程，也不 import `js/app.js`（它顶层就要 DOM）⇒ 判据是**纯文本分析**，
 *   本体在 `scripts/lib/type-terms.mjs`（H2 要求守卫 import 真判据，不许自己判自己）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTypeTerms, summarizeTypeTerms } from '../scripts/lib/type-terms.mjs';

const ROOT = process.env.BOOKATLAS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'js/app.js');
const HTML = path.join(ROOT, 'index.html');

const appSrc = fs.readFileSync(APP, 'utf8');
const htmlSrc = fs.readFileSync(HTML, 'utf8');

const s = summarizeTypeTerms({ appSrc, htmlSrc });
console.log('· 词条数：narrative %d / theory %d', s.nar, s.the);
console.log('· index.html 标注的 data-term：%d 个词条', s.htmlTerms);

const problems = checkTypeTerms({ appSrc, htmlSrc });

/* ── G11 的判别力自证（v0.214）────────────────────────────────────────────
 * 「跑得通、有输出」≠「有用」：判据得能在一个**已知有病的输入**上响、在一个
 * **已知正确的输入**上不响。G11 咬的是"量词式术语被数词/量词修饰"——
 * `一个{charN}` 在叙事类恰好还通（「一个人」），理论类却印出「一个**个概念**」。
 * 这类错当时占位符名字两侧一致（G2 过）、值都在（G3/G7 过）、不是编号占位符
 * （G10 过）⇒ 必须单独证明它咬得住，否则它只是"又多了一条不会响的判据"。 */
const synth = (lost) => `const TERMS = {
  narrative: { charN: '人', charMany: '人', x: '点任意一个${lost}' },
  theory:    { charN: '个概念', charMany: '概念', x: '点任意一个${lost}' },
};`;
const g11 = (src) => checkTypeTerms({ appSrc: src, htmlSrc: '' }).filter((p) => p.includes('G11'));
const g11Bad = g11(synth('{charN}'));
const g11Good = g11(synth('{charMany}'));
if (!g11Bad.length) { console.error('❌ G11 没有判别力：`一个{charN}`（理论类会印出「一个个概念」）它一条都不响'); process.exit(1); }
if (g11Good.length) { console.error('❌ G11 误报：`一个{charMany}` 是正确写法，它却响了'); process.exit(1); }
console.log('· G11 判别力自证：病句响 %d 条 / 正确写法 0 条', g11Bad.length);

if (problems.length) {
  console.log(`\n❌ 术语层守卫：${problems.length} 处问题`);
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}
console.log('✅ 术语层守卫通过：词条两侧对齐、引用可解析、无死词条、无人称写死、无残留写死文案');
