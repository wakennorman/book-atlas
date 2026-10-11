#!/usr/bin/env node
/**
 * 搜索命中率审计（每本书整理完的收尾必跑）
 *
 * 查四件事：
 *   ① 别名覆盖率：有关系但没别名的"主要人物"（读者按字号/简称/译名搜都搜不到）
 *   ② 译名变体：同一人物在不同译本里的写法（内置音译差异表，缺的可以 --write 自动补）
 *   ③ 文案里的"姓氏+名"：**⚠ 不是漏人检测器**（v0.183 实测，见文件末提示）。
 *      它扫的是**本项目自己写的文案**，`[百家姓][\u4e00-\u9fa5]{1,2}` 切出来的多半是
 *      **跨词边界的叙述碎片**（`黄巾起`/`平要术`/`诸侯讨`/`伏兵杀`）。
 *      **要找漏人请跑 `audit-against-text.mjs`**（扫原著正文，那才是缺口检测器）。
 *      已判过的噪声按 `data/<slug>.missing-ok.json` 过滤（语义与语料无关，见 lib/missing-ok.mjs）。
 *   ④ 同名重复：去掉括号补充后名字相同的多个人物（可能是同一人被拆成两条，也可能是真重名）
 *
 * 用法：
 *   node scripts/audit-search.mjs --all                 # 只报告
 *   node scripts/audit-search.mjs --all --write         # 自动补「译名变体」别名（其余只报告）
 *   node scripts/audit-search.mjs data/xx.json --cand 80
 */
import fs from 'node:fs';
import path from 'node:path';
/* ④ 的分组规则**不在这里定义** —— 它同时被门禁 scripts/check-dup-names-ledger.mjs 用着，
 * 而台账按 (book, 去括号后的主名) 记账。两边各写一份，定义一漂移就是「门禁与审计各算各的」，
 * 两边都绿而其中一个已经不认识这批数据了（本仓库同一个定义抄多份已吃过四次，见
 * scripts/lib/data-files.mjs 的注释）。⇒ 唯一来源在 scripts/lib/dup-names.mjs。
 *
 * ⚠ 门禁**不能**反过来 import 本脚本：这里是**顶层就干活**的，
 *   import 它会把主流程也跑一遍，而开头 `if (!files.length) { … process.exit(1) }`
 *   在门禁的 process.argv 下必然为空 ⇒ 门禁直接被 exit 1 掉。 */
import { dupeGroups } from './lib/dup-names.mjs';
/* ③ 的噪声过滤读 `data/<slug>.missing-ok.json`（v0.183）。同样抽成 lib 供守卫 import ——
   理由与 `lib/dup-names.mjs` 一样：本文件顶层就干活，门禁/守卫不能反过来 import 它。 */
import { loadMissingOk, dropAdjudicated } from './lib/missing-ok.mjs';
/* ③ 的**百家姓表也只有一份**（v0.189）。原先这里内联着一份 377 字的表，
   与 `lib/against-text.mjs` 里那份**逐字相同** —— 但"逐字相同"这件事**没有门禁守得住**：
   下次只改一边（比如补几个生僻姓），两处扫描对同一本书就会给出不同候选，
   而两边都绿、看不出谁对（铁律 7：同一个定义不许抄第二份）。
   ⚠ 本文件另有一个 `norm`，与 lib 的 `norm` **不是**同一个东西（下面那个还会去 `-`/`_`/`—`），
   两者只服务各自的调用点，**别顺手合并** —— 合并会改掉 ③ 的候选集合。 */
import { SURNAMES } from './lib/against-text.mjs';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const candIdx = argv.indexOf('--cand');
const candLimit = candIdx >= 0 ? Number(argv[candIdx + 1] || 60) : 60;
const files = argv.includes('--all')
  // 同 validate.mjs：只审计 books.json 登记的整本数据，别把 v85 新增的
  // <slug>.graph.json / <slug>.text.json 生成物也算进来（它们没有 aliases 等字段）。
  ? (() => {
    const dir = path.join(process.cwd(), 'data');
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'books.json'), 'utf8'));
    return (idx.books || []).map((b) => path.join(dir, `${b.slug}.json`)).filter((f) => fs.existsSync(f));
  })()
  : argv.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a));

if (!files.length) { console.error('用法：node scripts/audit-search.mjs --all [--write]  |  data/xx.json'); process.exit(1); }

/* 音译差异表：同一人物在不同译本里的常见写法（左＝数据里可能出现的，右＝另一种译法） */
const VARIANT_PAIRS = [
  // 百年孤独（范晔版 ↔ 黄锦炎/高长荣等版）
  ['奥雷里亚诺', '奥雷良诺'], ['乌尔苏拉', '乌苏拉'], ['丽贝卡', '雷贝卡'], ['梅尔基亚德斯', '墨尔基阿德斯'],
  ['阿玛兰妲', '阿玛兰塔'], ['阿尔卡蒂奥', '阿卡迪奥'], ['何塞·阿尔卡蒂奥', '霍塞·阿卡迪奥'],
  ['费尔南达', '菲南达'], ['皮拉尔·特内拉', '皮拉·苔列娜'], ['桑塔索菲亚', '圣索菲亚'],
  ['蕾梅黛丝', '雷梅苔丝'], ['阿基拉尔', '阿吉拉尔'], ['史蒂文森', '斯蒂文森'], ['加布里埃尔', '加夫列尔'],
  ['加斯通', '加斯东'], ['莫科特', '摩斯科特'], ['尼格罗曼塔', '尼格罗·曼塔'],
  ['普鲁邓希奥', '普鲁登西奥'],
  // 罪与罚（汝龙版 ↔ 朱海观/王汶、耿济之等版）
  ['拉斯柯尔尼科夫', '拉斯科利尼科夫'], ['玛尔美拉朵夫', '马尔梅拉多夫'], ['索尼雅', '索尼娅'],
  ['杜尼雅', '杜尼娅'], ['卢仁', '卢津'], ['波尔菲利', '波尔费利'], ['斯维德利盖洛夫', '斯维德里盖洛夫'],
  ['伊凡诺芙娜', '伊万诺夫娜'], ['阿辽娜', '阿廖娜'], ['拉祖米欣', '拉祖米兴'],
  ['列别贾特尼科夫', '列别佳特尼科夫'], ['普莉赫丽雅', '普尔赫莉娅'], ['阿芙朵嘉', '阿芙多佳'],
];

/* 常见姓氏（用于"疑似漏人"扫描）—— 唯一来源见文件头 import `./lib/against-text.mjs`。 */

const norm = (s) => String(s || '').replace(/[\s　·・．.\-—_、,，]/g, '').trim();

for (const file of files) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chars = book.characters || [];
  const rels = book.relations || [];
  const deg = new Map();
  for (const r of rels) { deg.set(r.from, (deg.get(r.from) || 0) + 1); deg.set(r.to, (deg.get(r.to) || 0) + 1); }

  /* 全书文案（用于漏人扫描）
   * ⚠ v0.96：`altNames`（又译）也要算进「已知名字」，否则**只写在 altNames 里的译名
   *   会被当成漏人报出来** —— 而它明明已经在数据里了。
   *   （`js/app.js` 的搜索/显示同批修的：这里判「已知」，那里判「搜得到」，口径必须一致。） */
  const texts = [];
  for (const e of book.events || []) texts.push(`${e.name} ${e.summary || ''} ${e.impact || ''}`);
  for (const r of rels) for (const ev of r.events || []) texts.push(ev.text || '');
  for (const c of chars) texts.push(`${c.desc || ''} ${c.fate || ''} ${c.title || ''} ${(c.aliases || []).join(' ')} ${(c.altNames || []).join(' ')}`);
  for (const p of book.places || []) texts.push(`${p.name} ${p.desc || ''} ${(p.aliases || []).join(' ')}`);
  const allText = texts.join('\n');

  /* ③ 疑似漏人：先剔掉已知名字（长名优先），再按"姓氏+1~2字"扫 */
  let stripped = allText;
  const known = new Set();
  const allNames = [];
  for (const c of chars) for (const n of [c.name, ...(c.aliases || []), ...(c.altNames || [])]) if (n && n.length >= 2) allNames.push(n);
  for (const p of book.places || []) for (const n of [p.name, ...(p.aliases || [])]) if (n && n.length >= 2) allNames.push(n);
  allNames.sort((a, b) => b.length - a.length);           // 长名优先：先替「何塞·阿尔卡蒂奥」再替「何塞」
  for (const n of allNames) { known.add(norm(n)); stripped = stripped.split(n).join('〇'); }
  // 官职/称谓/常见非人名尾字：挡掉"都尉""魏将""将军""从之""二字词"这类噪音
  const STOP = /^(将军|校尉|都尉|从事|太守|刺史|丞相|主簿|司马|都督|长史|尚书|侍郎|中郎|上将|先锋|大帅|军师|谋士|文官|武官|将领|大王|主公|夫人|太后|皇后|贵妃|太子|王子|先主|后主|魏主|吴主|汉主|魏将|吴将|蜀将|汉将|众将|诸将|二将|三将|四将|大将|小将|名将|老将|女将|之妻|之女|之子|之弟|之兄|之母|之父|养父|养子|义父|义子|双胞胎|羊皮卷|伏笔|牛流马|罗曼|罗芙娜|利亚|东西|张脸|那天|次日|当时|后来|如今|于是|因此|二人|三人|四人|众人|别人|和妹妹|从外省|越过界|应嫁给|房东|广场|文官|房客|酒馆|酒鬼|邻居|朋友|信使|囚徒|商人|店主|客人|主人|仆人|侍女|使女|弟子|门生|同乡|同窗|同学|战友|政敌|情敌|对手|上级|下属|上司|皇帝|天子|朝廷|官府|军士|士兵|士卒|百姓|村民|士兵)$/;
  const surnameRe = new RegExp(`[${SURNAMES}][\\u4e00-\\u9fa5]{1,2}`, 'g');
  const cand = new Map();
  const isSub = (s) => allNames.some((n) => n.includes(s));      // 已知名字/地名的片段一律不算
  for (const m of stripped.matchAll(surnameRe)) {
    const name = m[0];
    if (name.includes('〇') || known.has(norm(name)) || isSub(name) || STOP.test(name)) continue;
    if (/[的地得了着是不在有和与及然后里上下之]/.test(name)) continue;
    cand.set(name, (cand.get(name) || 0) + 1);
  }
  const candAll = [...cand.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);

  /* ③.1 扣掉「噪声忽略名单」里**已判过**的那些（v0.183）
   *
   * ⚠ 台账的语义是「这个字符串不是人名」，与语料无关 ⇒ 可以在我们自己的文案上复用。
   *   但它**只能挡掉已判过的**：实测三国 656 条里只挡 91 条（14%）。
   * ⚠ 挡掉了多少**必须打印**（v0.173：不打印"挡掉了什么"，绿就等于装饰品）。 */
  const ledger = loadMissingOk(path.join(process.cwd(), 'data'), path.basename(file).replace(/\.json$/, ''));
  if (ledger.error) console.error(`  ⚠ ${ledger.error}\n     ⇒ 本书 ③ 的噪声过滤**未生效**（不能当成空名单，那会让判过的噪声全部复活）`);
  const { kept: candKept, dropped: candDropped } = dropAdjudicated(candAll, ledger.names);
  const candTop = candKept.slice(0, candLimit);

  /* ② 译名变体：名字/别名/**又译**里有 A 形式但缺 B 形式
   * ⚠ v0.96：`altNames` 也进池子。不进的话会**误报**：
   *   「这个人的 altNames 里已经有 B 形式了」也会被报成"缺译名变体"。 */
  const missingVariants = [];
  for (const c of chars) {
    const pool = [c.name, ...(c.aliases || []), ...(c.altNames || [])].join('|');
    for (const [a, b] of VARIANT_PAIRS) {
      if (a === b) continue;
      if (pool.includes(a) && !pool.includes(b)) {
        const variant = c.name.includes(a) ? c.name.replace(a, b)
          : (c.aliases || []).find((x) => x.includes(a))?.replace(a, b)
          || (c.altNames || []).find((x) => x.includes(a))?.replace(a, b);
        if (variant && !pool.includes(variant)) missingVariants.push({ c, variant, pair: [a, b] });
      }
    }
  }

  /* ④ 同名重复（去括号）—— 分组规则来自 scripts/lib/dup-names.mjs，不在这里另写一份 */
  const dupes = dupeGroups(chars).map((g) => [g.base, g.chars]);

  /* ① 别名覆盖：有关系、却没别名的"主要人物" */
  const noAlias = chars
    .filter((c) => !(c.aliases || []).length && (deg.get(c.id) || 0) >= 3)
    .sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0));

  console.log(`\n▶ ${path.basename(file)}（${chars.length} 人 / ${rels.length} 关系）`);
  console.log(`  ① 主要人物但没别名：${noAlias.length} 人` + (noAlias.length ? ` → ${noAlias.slice(0, 12).map((c) => `${c.name}(${deg.get(c.id)})`).join('、')}${noAlias.length > 12 ? ' …' : ''}` : ''));
  console.log(`  ② 缺译名变体：${missingVariants.length} 处` + (missingVariants.length ? ` → ${missingVariants.slice(0, 8).map((m) => `${m.c.name}⇒${m.variant}`).join('、')}${missingVariants.length > 8 ? ' …' : ''}` : ''));
  /* ⚠ v0.183：**措辞改了**。③ 在**我们自己写的文案**上跑 `[百家姓][\u4e00-\u9fa5]{1,2}`，
   * 切出来的绝大多数是**跨词边界的叙述碎片**，不是人名。实测三国扣掉台账后剩 406 条，
   * 与原著检测器重合的只有 5 条（其余 401 条如 `黄巾起`/`平要术`/`诸侯讨`/`伏兵杀`）。
   * 而 `audit-against-text.mjs` 靠的"出现在已知人物 ±90 字内"那条精度信号，
   * 在我们文案上**一条都砍不掉**（0/565）—— 我们的文案通篇都在写已知人物。
   * ⇒ **要找漏人，请跑 `audit-against-text.mjs`（扫原著正文），那才是缺口检测器。**
   *   这一行保留 ③ 是因为"我们自己的文案里提了谁"偶尔也有用，但**别把它当漏人清单**。 */
  console.log(`  ③ 文案里的"姓氏+名"（⚠ **不是**漏人检测器，见下）：${candTop.length} 个`
    + (ledger.entries ? `（已按噪声台账挡掉 ${candDropped.length} 个；台账 ${ledger.entries} 条）` : (ledger.missing ? '（本书无噪声台账）' : ''))
    + (candTop.length ? ` → ${candTop.slice(0, 16).map(([n, k]) => `${n}×${k}`).join('、')}${candTop.length > 16 ? ' …' : ''}` : ''));
  console.log(`  ④ 去括号后同名：${dupes.length} 组` + (dupes.length ? ` → ${dupes.slice(0, 6).map(([k, v]) => `${k}(${v.length})`).join('、')}${dupes.length > 6 ? ' …' : ''}` : ''));

  if (write && missingVariants.length) {
    for (const { c, variant } of missingVariants) c.aliases = [...new Set([...(c.aliases || []), variant])].filter((a) => a !== c.name);
    fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
    console.log(`  ✓ 已补 ${missingVariants.length} 个译名变体别名`);
  }
}
console.log('\n提示：① 建议按"字号/简称/译名"补别名。');
console.log('      ③ **不是漏人检测器** —— 它扫的是本项目自己的文案，切出来的多半是叙述碎片'
  + '（实测三国 406 条里只有 5 条与原著检测器重合）。');
console.log('      **要找漏人请跑** `node scripts/audit-against-text.mjs data/<slug>.json <原著.txt>`'
  + '（扫原著正文，那才是缺口检测器；判过的噪声记进 data/<slug>.missing-ok.json）。');
