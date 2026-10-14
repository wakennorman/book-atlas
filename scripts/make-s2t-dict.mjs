/* 生成 `data/s2t.json` —— 简→繁转换表（字表 + 歧义词组表）。
 *
 * **长期脚本**：产物是**提交的人工资产**，`data/s2t.json` 只由本脚本写、门禁只校验不重生成。
 *
 * ## 它怎么来的
 *
 * 1. **语料** = 六本书的读者可见字段 + 界面文案（`scripts/lib/s2t.mjs` 的 `collectCorpus`，
 *    实测 262,446 字 / 3,522 个去重汉字）。
 * 2. **字表**：对每个字统计「opencc 在本语料上下文里实际给出它的哪一支、哪一支最多」，
 *    多数决当默认形；再用 `s2t-overrides.mjs` 的 `CHAR_FIX` 纠正实测翻车的那些。
 *    ⇒ **不靠我硬猜**，也保证专名（「奥雷里亚诺」的里、「十分钟」的钟）不会被通用规则打烂。
 * 3. **词组表**：把语料里的 2~4 字窗口逐个喂给 opencc，凡是它的**词组层**与我们的
 *    字表结果不同的地方，就落一条规则（最长匹配优先）。opencc 在本语料上的真实行为
 *    就这样被固化成一张小表 —— 运行期不再需要 opencc，也不需要联网。
 * 4. **人工覆盖**：`PHRASE_FIX` 最后盖上去，是最终权威。
 *
 * ## 重生成需要 opencc-js（不在 package.json 里，因为它只在生成期用）
 *
 *     npm i --no-save opencc-js@1.0.5
 *     node scripts/make-s2t-dict.mjs
 *
 * `data/s2t.json` 是**提交的人工资产**（门禁只校验、不重生成），所以 CI 不需要这个依赖。
 *
 * ## 用法
 *
 *     node scripts/make-s2t-dict.mjs            # 重新生成
 *     node scripts/make-s2t-dict.mjs --check    # 只报是否与现有文件一致（门禁用）
 *     node scripts/make-s2t-dict.mjs --audit    # 打印多义字分布与对拍清单
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAR_FIX, PHRASE_FIX, SHAPE_FIX, PROTECT_PHRASES, PHRASE_BLIND } from './lib/s2t-overrides.mjs';
import {
  collectCorpus, corpusCharCounts, corpusCharTotal, makeConverter, disagreements,
} from './lib/s2t.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 's2t.json');
const AUDIT_OUT = process.env.S2T_AUDIT_OUT || path.join(ROOT, 's2t-audit.txt');
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

async function main() {
  const args = process.argv.slice(2);
  const CHECK = args.includes('--check');
  const AUDIT = args.includes('--audit');

  // opencc 只在生成期用；不在依赖里 ⇒ 动态 import，失败时给出可操作的提示。
  let convert;
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const OpenCC = require('opencc-js');
    convert = OpenCC.Converter({ from: 'cn', to: 't' });   // 字形转换，不换词（不换台湾词汇）
  } catch {
    console.error('需要 opencc-js 才能重新生成转换表：\n'
      + '  npm i --no-save opencc-js@1.0.5\n'
      + '（data/s2t.json 已是提交的人工资产，只校验不需要这个依赖）');
    process.exit(2);
  }

  const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  const readText = (p) => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8'); } catch { return null; } };
  const books = readJson('data/books.json').books;

  const corpus = collectCorpus(books, readJson, readText);
  const counts = corpusCharCounts(corpus);
  console.log(`语料 ${corpus.length} 条 / ${corpusCharTotal(counts).toLocaleString('en-US')} 字 / `
    + `${counts.size} 个去重汉字`);

  /* ── ① 字表：opencc 在本语料上下文里的多数决 ── */
  /* ⚠ **这里也必须 normalize**（v0.219 踩过）：opencc 的 cn→t 走「旧标」一路，
   *   「群」多数时候给「羣」、为→爲、众→衆、床→牀、才→纔。
   *   字表若直接存这些异体，② 词组层却按归一后的字比，两边对不上 ——
   *   实测就是 `chars.群 = 羣`，转换一次得到「羣臣」，二次转换又变回「群臣」，
   *   把 D1（幂等）从 14 条顶到 72 条。 */
  const normalize = (s) => SHAPE_FIX.reduce((t, [a, b]) => t.split(a).join(b), s);
  const tally = new Map();   // ch -> Map(form -> n)
  const bump = (ch, f) => {
    if (!tally.has(ch)) tally.set(ch, new Map());
    const m = tally.get(ch);
    m.set(f, (m.get(f) || 0) + 1);
  };
  const runs = [];
  for (const { text } of corpus) {
    for (const seg of text.match(CJK_RUN) || []) {
      runs.push(seg);
      const out = normalize(convert(seg));
      if (out.length !== seg.length) continue;   // 长度变了就不能按位对齐，跳过
      for (let i = 0; i < seg.length; i++) bump(seg[i], out[i]);
    }
  }

  const chars = {};
  const split = [];
  for (const [ch] of counts) {
    const m = tally.get(ch);
    let best = ch, bestN = -1;
    if (m) for (const [f, n] of m) if (n > bestN) { best = f; bestN = n; }
    if (CHAR_FIX[ch]) best = CHAR_FIX[ch];
    if (best !== ch) chars[ch] = best;
    if (m && m.size > 1) split.push({ ch, forms: [...m].sort((a, b) => b[1] - a[1]) });
  }

  /* ── ② 词组表：opencc 词组层与字表不一致的地方 ── */
  const charOnly = makeConverter({ chars, phrases: {} });

  /* 专名保护：**叙事类**书的节点名是人名/地名，词组表一律不许插手（走字表）。
   * 理论类书（《物种起源》《刻意练习》）的节点名是**术语**，不能保护 ——
   * 它里面有个节点叫「海岛生物与最邻近的大陆生物的关系」，保护了会把「关系」全局钉死。
   * opencc 的词组层不认识「周瑜」「赫里内勒」「扎麦托夫」：会把「周瑜」判成「週瑜」、
   * 「托夫」判成「託夫」，而专名一旦错，读者对不上原著。 */
  const NARRATIVE = new Set(books.filter((b) => readJson(b.file).meta.type === '叙事类').map((b) => b.slug));
  const proseBig = new Set();
  const protect = new Set(PROTECT_PHRASES);
  for (const c of corpus) {
    const slug = c.src.split(' ')[0];
    const isName = / (?:ch|pl|ev)\.name\b|aliases/.test(c.src);
    for (const seg of c.text.match(CJK_RUN) || []) {
      for (let i = 0; i + 1 < seg.length; i++) {
        const k = seg.substr(i, 2);
        if (isName && NARRATIVE.has(slug)) protect.add(k);
        else proseBig.add(k);
      }
    }
  }

  /* 按**整段上下文**探测，不逐个孤立 bigram 地问。
   * 孤立问 opencc「丑砍」得「醜砍」；真实上下文「文丑砍死关纯」里它给「文丑砍死關純」——
   * 因为它认得出「文丑」是人名。丢上下文会把人名转坏（v0.219 踩过）。 */
  const phrases = {};
  const conflicts = new Map();
  const agree = new Set();     // opencc 在这里与字表**一致**的 bigram ⇒ 不该有规则
  for (const seg of runs) {
    const out = normalize(convert(seg));            // ⚠ 别忘了 normalize：opencc 吐「裏」，我们要「裡」
    if (out.length !== seg.length) continue;        // 长度变了不能按位对齐
    const ours = charOnly(seg);
    for (let i = 0; i < seg.length; i++) {
      const k = i + 1 < seg.length ? seg.substr(i, 2) : '';
      // ⚠ 必须比**整个 bigram**，不能只比首字 —— 「的油里」在「油」那一位就相等，
      //   只比首字会把「油里」误判成"opencc 也这么认为"，于是「油里」这条规则凭空消失。
      if (out.substr(i, 2) === ours.substr(i, 2)) { if (k) agree.add(k); continue; }
      if (!k) continue;                              // 段尾单字不落规则：单字规则是全局的，
      //   「老板的板」在段尾被判成「闆」，会顺手把「木板」也变成「木闆」（v0.219 踩过）
      if (PHRASE_BLIND.has(seg[i])) continue;      // 这个字词组层永远闭嘴（核实不许变「覈實」）
      // ⚠ **两个位置都要查**：PHRASE_BLIND 里的「才」出现在「刚**才**」的第二位时，
      //   只查首位会漏过去，于是建出「刚才→剛纔」这种把整个字换掉的规则（v0.219 踩过）。
      if (i + 1 < seg.length && PHRASE_BLIND.has(seg[i + 1])) continue;
      if (k in PHRASE_FIX || protect.has(k)) continue;
      const v = out.substr(i, 2);
      if (k in phrases && phrases[k] !== v) conflicts.set(`${k}：${phrases[k]} vs ${v}`, seg);
      phrases[k] = v;
    }
  }
  /* 「串位」过滤：一个 bigram 若在语料里**有一处** opencc 与字表一致，它就不是"处处特殊"，
   * 规则不能立 —— 否则「一只手」的「只→隻」会泄漏成「只看→隻看」（v0.219 踩过）。 */
  let dropped = 0;
  for (const k of Object.keys(phrases)) if (agree.has(k)) { delete phrases[k]; dropped++; }

  /* 规则值归一：`PHRASE_BLIND` 里的字既然对词组层闭嘴，规则**值**里也该用字表那一支。
   * 不做这一步会得到「带着→帶着」「叹为→嘆爲」「征为→徵爲」——
   * opencc 认为「着」本身就是合法繁体、对「为」偏好「爲」，值就带着它的偏好漏进来了。 */
  const applyCharFix = (s) => [...s].map((c) => CHAR_FIX[c] || c).join('');
  for (const k of Object.keys(phrases)) phrases[k] = applyCharFix(phrases[k]);

  if (process.env.S2T_DEBUG) {
    fs.writeFileSync(AUDIT_OUT + '.dbg', [
      `需保护 bigram ${protect.size} / 派生规则 ${Object.keys(phrases).length}（串位丢弃 ${dropped}）`,
      `冲突 ${conflicts.size} 组：${[...conflicts].map(([k, s]) => `${k} ←「${s}」`).join('；') || '无'}`,
      `样例：${Object.entries(phrases).slice(0, 24).map(([k, v]) => `${k}→${v}`).join('  ')}`,
    ].join('\n'), 'utf8');
  }
  // 人工覆盖是最终权威
  for (const [k, v] of Object.entries(PHRASE_FIX)) phrases[k] = v;
  // ⚠ 这里**不做剪枝**。曾试过"被更长规则覆盖的短规则删掉"，
  // 结果「关系」被「关系图→關係圖」吃掉，单独出现的 75 处「关系」全变成「關系」——
  // 长规则只在自己那串上下文里命中，替不了短规则。（v0.219 踩过）
  const kept = phrases;

  const dict = {
    schema: 's2t/1',
    _说明: '简→繁转换表。字表＝本语料上下文里的多数决（已按 scripts/lib/s2t-overrides.mjs 人工纠正）；'
      + '词组表＝opencc 词组层在本语料上的行为 + 人工覆盖，最长匹配优先。',
    _基准: '字形转换（cn→t），**不换词**：網絡仍是網絡、数据仍是數據。',
    _same: '`same` 里是「繁简同形、不需要动」的汉字，拼成一个字符串省体积。'
      + '语料里每个字要么在 `chars`、要么在 `same`，守卫 S1 就是守这条 —— 漏一个就是'
      + '繁中模式下悄悄露出一个简体字的静默故障。',
    chars,
    phrases: kept,
    same: [...counts.keys()].filter((c) => !chars[c]).sort().join(''),
  };

  const text = JSON.stringify(dict, null, 1) + '\n';
  if (CHECK) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error('✗ data/s2t.json 与重新生成的结果不一致（重跑 node scripts/make-s2t-dict.mjs）'); process.exit(1); }
    console.log(`✓ data/s2t.json 与生成器一致（字表 ${Object.keys(chars).length} / 词组表 ${Object.keys(kept).length}）`);
    return;
  }
  fs.writeFileSync(OUT, text, 'utf8');
  console.log(`✓ 写入 data/s2t.json：需转换 ${Object.keys(chars).length} 字 / 同形 ${dict.same.length} 字 / `
    + `词组 ${Object.keys(kept).length} 条 / ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);

  /* ── ③ 复核输出 ── */
  const top = split.filter((s) => !(s.ch in CHAR_FIX)).sort((a, b) => b.forms[0][1] - a.forms[0][1]);
  const dis = disagreements(corpus, (s) => normalize(convert(s)), dict);

  if (AUDIT) {
    console.log(`\n── 多义字分布（未被 CHAR_FIX 固定的，共 ${top.length} 个字）──`);
    for (const s of top.slice(0, 40)) console.log(`  ${s.ch}  ${s.forms.map(([f, n]) => `${f}×${n}`).join('  ')}`);
    console.log(`\n── 与 opencc 的差异 ${dis.length} 处 ──`);
    for (const d of dis.slice(0, 30)) console.log(`  ×${String(d.n).padStart(4)}  ${d.ctx}   opencc→${d.opencc}   本表→${d.ours}`);
  }

  /* H1 体检：语料里每个字都必须有交代 —— 要么我们表里转了，要么 opencc 也不转（繁简同形）。 */
  const bad = [];
  for (const ch of counts.keys()) {
    if (chars[ch]) continue;
    if (convert(ch) !== ch) bad.push(ch);   // opencc 认为该转，我们表里却没有 ⇒ 漏
  }
  console.log(`\nH1 体检：${bad.length === 0 ? '✓ 无漏字' : `✗ ${bad.length} 个字该转却没登记：${bad.join('')}`}`);

  fs.writeFileSync(AUDIT_OUT, [
    `语料 ${corpus.length} 条 / ${corpusCharTotal(counts)} 字 / ${counts.size} 去重汉字`,
    `字表 ${Object.keys(chars).length} / 同形 ${dict.same.length} / 词组 ${Object.keys(kept).length} / ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`,
    `H1 ${bad.length === 0 ? 'OK' : 'BAD ' + bad.join('')}`,
    '',
    '── 多义字分布（未被 CHAR_FIX 固定的）──',
    ...top.map((s) => `  ${s.ch}  ${s.forms.map(([f, n]) => `${f}×${n}`).join('  ')}`),
    '',
    `── 与 opencc 的差异 ${dis.length} 处 ──`,
    ...dis.map((d) => `  ×${String(d.n).padStart(4)}  ${d.ctx}   opencc→${d.opencc}   本表→${d.ours}`),
  ].join('\n'), 'utf8');
  console.log(`（完整复核清单 → ${AUDIT_OUT}）`);
}

main();
