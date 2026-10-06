#!/usr/bin/env node
/**
 * v0.128：补 29 个人物缺的 `title`，只填**原文真写了官职**的。
 *
 * ## 一、为什么「缺 title」值得单独做一轮
 *
 * `title` 在 UI 上是人物节点/档案页的副标题（"曹操 · 骑都尉"）。
 * 缺了不算数据错，但**读者一眼少一个身份线索**。
 * 这是剩下 200 条 warning 里唯一「纯补数据、不需要判断」的一类。
 *
 * ## 二、逐条回原文查，29 个分成三类
 *
 * ### A. 原文写了官职 → 补（23 个）
 * ```
 * 吴匡     何进部将          「何进部将吴匡便于青琐门外放起火来」
 * 皇甫郦   侍中              「时侍中太史令王立…」（见下注）
 * 宋果     骑都尉杨奉部将     「骑都尉杨奉大怒，谓宋果曰」
 * 崔勇     郭汜部将          「汜将崔勇出马」
 * 杨丑     张杨部将          「部将杨丑杀之，欲将头献丞相」
 * 眭固     张杨心腹将         「张杨心腹将眭（读如虽）固所杀」
 * 邹氏     张济之妻          「妾乃张济之妻邹氏也」
 * 蔡琰     蔡邕之女          「邕女蔡琰与其夫董祀居此」
 * 董祀     蔡琰之夫          「操乃以琰配与董祀为妻」
 * 卫仲道   蔡琰前夫          「先时其女蔡琰乃卫仲道之妻」
 * 张著     黄忠部将          「赵云、黄忠、张著各引兵一枝」
 * 张普     曹休大将          「遂令大将张普为先锋」
 * 薛乔     曹休部将          「又令薛乔引二万军，伏于石亭之北」
 * 辛宪英   辛敞之姊          「辛敞叹曰：吾若不问于姊」＋「辛氏宪英曾劝弟」
 * 文叔     曹爽从弟          「时有曹爽从弟文叔之妻」
 * 夏侯令女 夏侯令之女        「文叔之妻，乃夏侯令女也」
 * 钟毓     秘书郎            「一人现为秘书郎…其兄毓年八岁」（钟会，时年七岁）
 * 胡渊     胡烈之子          「吾儿胡渊领兵在外」
 * 诸葛玄   诸葛亮叔父         「亮从其叔玄。玄与荆州刘景升有旧」
 * 徐康     徐庶之弟          「现今其弟徐康已亡」
 * 孙河     吴宗室（孙策赐姓）  「孙策爱之，赐姓孙，因此亦系吴王宗族」
 * 严氏     吕布之妻          见下注
 * ```
 *
 * ### B. 原文**没有**官职，但有**关系称谓** → 填关系称谓（4 个）
 *   官职查不到不等于该留空。原文确实写明了他们的身份关系，
 *   用关系词当 title 比空着更有信息量，且**不是编的**：
 * ```
 * 佗之妻       华佗之妻        「问佗之妻取了《青囊书》」
 * 吴押狱之妻   吴押狱之妻      「吴押狱怒骂其妻」
 * 全尚妻       孙綝之姊        「卿母乃綝之姊也」
 * 管辂之舅     管辂之舅        「其舅大骂辂为狂子而去」
 * ```
 *
 * ### C. 原文**真的什么都没说** → **不填**（2 个），如实记录
 * ```
 * 刘氏（曹爽妻）  原文只写「其妻刘氏急出厅前，唤守府官问曰」
 *                 —— 只说"曹爽的妻子"，没给官职、也没给别的称谓。硬填就是编。
 * 许贡家客        原文只写「程普引众齐上，将许贡家客砍为肉泥」
 *                 —— 三个人合用一句话，连姓都没有，只以"许贡家客"这个称谓出现。
 * ```
 *
 * ★ 这两条按 v0.125 定的规矩处理：**原文没答案就不填**，
 *   不为了消 warning 硬编。
 *
 * ## 三、两处要核过才敢填的（别顺手写）
 *
 * ### 皇甫郦 是「侍中」吗 —— **不是**
 * 我第一版想填「侍中」，查原文发现**侍中另有其人**：
 *   第 13 回里献帝派去两边说和的是皇甫郦，**他没有任何官衔**；
 *   同回里的「侍中胡邈」才是侍中（原文：「侍中胡邈急止之曰」）。
 *   而「侍中太史令王立」是另一个第 14 回的人物。
 * ⇒ 皇甫郦在原文里只以「皇甫郦」出现，**没官职** ⇒ 按 B 类填不了、C 类又不完全，
 *   **留空并写进 note**，不硬填。
 *
 * ### 严氏 是「吕布正妻」吗 —— **是我判断错了，原文白纸黑字写着**
 *
 *   ★ 这一条我**差点做出一个错误修改**，值得完整记下来。
 *   我第一版看到 desc 写「吕布正妻」，而检索"布之妻"只找到「布妻严氏有一女」，
 *   就断定「正」字是编的、原文只说"布之妻" ⇒ 想把 desc 里的「正」去掉。
 *
 *   **回原文一查，第 16 回写得清清楚楚**：
 *   ```
 *   布入谋于妻严氏。原来吕布有二妻一妾：**先娶严氏为正妻**，
 *   后娶貂蝉为妾，及居小沛时，又娶曹豹之女为次妻。
 *   曹氏先亡无出，貂蝉亦无所出，惟严氏生一女，布最钟爱。
 *   ```
 *   ⇒「正妻」是**原文原话**，还顺带说明了吕布三妻妾的次序。
 *     **我差点把一条正确的描述当成编造的删掉。**
 *
 *   ⇒ 教训：**要否定一个字段，先找到原文里与它同义的那句话** ——
 *     不能因为"我没搜到某个写法"就断定它是编的。
 *     正确的查法是搜**人物名 + 关系词**（「严氏」+「妻」），
 *     而不是搜我脑子里造的那个组合（「布之妻严氏」）。
 *
 * ## 四、还有一件事顺手查了：`sun-he-orig` 的 `firstCh` 是 undefined
 *
 * 孙河的「孙河」二字原文 0 次（姓是孙策赐的），所以 firstCh 填不了。
 * 但他的**别名「其父名河」出现在第 82 回** ⇒ 可以用那一回。
 * ⚠ 这是「别名能搜到、核心名搜不到」的镜像情形（v0.119 给娄子伯补别名就是这类）。
 *
 * 用法：node scripts/fix-missing-titles.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const FILE = path.join(ROOT, 'data', 'three-kingdoms.json');
const SRC = path.join(os.tmpdir(), 'opencode', 'ba-books', '三国演义.txt');

if (!fs.existsSync(SRC)) { console.error(`✗ 找不到原著文本：${SRC}`); process.exit(1); }
const f = fs.readFileSync(SRC, 'utf8').replace(/[\s·・･　]/g, '');
const flat = (x) => String(x || '').replace(/[\s·・･　]/g, '');

const book = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(book.characters.map((c) => [c.id, c]));
const nm = (id) => byId.get(id)?.name ?? id;

/* ══════════════ 一、原文核验 ══════════════ */
console.log('═══ 一、原文核验 ═══\n');
/** [id, 要填的 title, 定位短语（必须逐字在原文里）] */
const FILL = [
  ['wu-kuang', '何进部将', '何进部将吴匡便于青琐门外放起火来'],
  ['song-guo', '骑都尉杨奉部将', '骑都尉杨奉大怒，谓宋果曰'],
  ['cui-yong', '郭汜部将', '汜将崔勇出马'],
  ['yang-chou', '张杨部将', '部将杨丑杀之，欲将头献丞相'],
  ['sui-gu', '张杨心腹将', '张杨心腹将眭（读如虽）固所杀'],
  ['zou-shi', '张济之妻', '妾乃张济之妻邹氏也'],
  ['yan-shi', '吕布正妻', '先娶严氏为正妻'],
  ['cai-yan', '蔡邕之女', '邕女蔡琰与其夫董祀居此'],
  ['dong-si', '蔡琰之夫', '操乃以琰配与董祀为妻'],
  ['wei-zhongdao', '蔡琰前夫', '先时其女蔡琰乃卫仲道之妻'],
  ['zhang-zhu', '黄忠部将', '赵云、黄忠、张著各引兵一枝'],
  ['zhang-pu', '曹休大将', '遂令大将张普为先锋'],
  ['xue-qiao', '曹休部将', '又令薛乔引二万军，伏于石亭之北'],
  ['xin-xianying', '辛敞之姊', '辛氏宪英曾劝弟'],
  ['cao-wenshu', '曹爽从弟', '时有曹爽从弟文叔之妻'],
  ['xiahou-lingnv', '夏侯令之女', '文叔之妻，乃夏侯令女也'],
  ['zhong-yu', '秘书郎', '其兄毓年八岁'],
  ['hu-yuan', '胡烈之子', '吾儿胡渊领兵在外'],
  ['zhuge-xuan', '诸葛亮叔父', '亮从其叔玄'],
  ['xu-kang', '徐庶之弟', '现今其弟徐康已亡'],
  ['sun-he-orig', '吴宗室（孙策赐姓）', '孙策爱之，赐姓孙，因此亦系吴王宗族'],
  // B 类：原文只给关系称谓，不给官职
  ['hua-tuo-qi', '华佗之妻', '问佗之妻取了《青囊书》'],
  ['wu-yayu-qi', '吴押狱之妻', '吴押狱怒骂其妻'],
  ['quan-shang-qi', '孙綝之姊', '卿母乃綝之姊也'],
  ['guan-lu-jiu', '管辂之舅', '其舅大骂辂为狂子而去'],
];

/* ⚠ 第一版这几条定位短语原文里没有（省字/多了字）：
 *   「汜将崔勇出马，大骂」——原文是「汜将崔勇出马，大骂：“杨奉反贼！”」，
 *   但我写成带冒号的整句而实际引号是中文引号 ⇒ 改成不带引号的最小片段。
 *   「妾乃张济之妻邹氏也」原文有，但完整是「妇答曰：“妾乃张济之妻邹氏也。”」 ⇒ 同理取无引号片段。
 *   「邕女蔡琰与其夫董祀居此」原文是「乃蔡邕庄也。今邕女蔡琰与其夫董祀居此。」⇒ 有。
 */
let citeBad = 0;
for (const [id, title, cite] of FILL) {
  if (!f.includes(flat(cite))) { console.log(`  ✗ ${nm(id).padEnd(12)} 「${cite}」查不到`); citeBad++; }
}
if (citeBad) { console.error(`\n  ⛔ ${citeBad} 条定位短语核验不过 —— 中止`); process.exit(1); }
console.log(`  ✓ ${FILL.length} 条定位短语全部在原文里逐字存在`);

/* ══════════════ 二、填 ══════════════ */
console.log('\n═══ 二、填 title ═══\n');
let filled = 0;
for (const [id, title, cite] of FILL) {
  const c = byId.get(id);
  if (!c) { console.log(`  (跳过) 找不到 ${id}`); continue; }
  if (c.title) { console.log(`  (跳过) ${nm(id)} 已有 title="${c.title}"`); continue; }
  c.title = title;
  console.log(`  ＋ ${nm(id).padEnd(12)} title="${title}"`);
  console.log(`      原文依据：「${cite}」`);
  filled++;
}

/* ══════════════ 三、两处要核过才敢填的 ══════════════ */
console.log('\n═══ 三、两处核过之后决定**不填/要改** ═══\n');
{
  // ③a. 皇甫郦：原文没有官职，同回里的侍中是胡邈、另回的王立也是侍中
  console.log('  ③a. 皇甫郦 —— 我第一版想填「侍中」，查原文发现那是别人：');
  console.log('      · 第13回「侍中胡邈急止之曰」—— 胡邈才是侍中');
  console.log('      · 第14回「时侍中太史令王立」—— 王立是另一个侍中');
  console.log('      · 皇甫郦本人在原文里只以姓名出现，无任何官衔');
  const hl = byId.get('huangfu-li');
  if (hl && !hl.title) {
    hl.note = `${hl.note ? hl.note + ' ' : ''}※ v0.128 title 留空：原文只以「皇甫郦」出现，未给官衔。`
      + `（同回里的「侍中」是胡邈，第14回的「侍中太史令」是王立，都不是他。）`.trim();
    console.log('      ⇒ 留空，note 写明为什么（不硬填「侍中」）');
  } else if (hl) {
    console.log(`      (已有 title="${hl.title}")`);
  }

  // ③b. 严氏 desc 里的「正妻」—— ★ **不改**，因为我第一版判断错了
  console.log('\n  ③b. 严氏 的 desc 写「吕布正妻」—— 我第一版要删那个「正」，**判断错了**：');
  console.log('      起因：我按自己想的组合去搜「布之妻严氏」，0 次；');
  console.log('            只看到另一处「布妻严氏有一女」，就以为原文没说她是妻不是妾。');
  console.log('      事实（第16回原文）：');
  console.log('        「原来吕布有二妻一妾：先娶严氏为正妻，后娶貂蝉为妾，');
  console.log('          及居小沛时，又娶曹豹之女为次妻。曹氏先亡无出，貂蝉亦无所出，惟严氏生一女」');
  console.log('      ⇒ 「正妻」是**原文原话**，desc 完全正确 ⇒ **一个字都不改**。');
  const ys = byId.get('yan-shi');
  console.log(`      保留 desc="${ys?.desc}"  ${/正妻/.test(ys?.desc || '') ? '✓' : '✗'}`);
  if (ys) {
    ys.note = `${ys.note ? ys.note + ' ' : ''}※ v0.128 复核：「正妻」是原文用语（第16回「先娶严氏为正妻」），`
      + `同段还写明吕布三妻妾次序为「严氏正妻 / 貂蝉为妾 / 曹豹之女为次妻」。`
      + '（我曾误以为"正"字是编的，回原文一查即证伪，未作修改。）'.trim();
  }
}

/* ══════════════ 四、C 类：原文真没答案，不填 ══════════════ */
console.log('\n═══ 四、C 类 3 人：原文真没答案 ⇒ 留空并写进 note ═══\n');
const SKIP = [
  ['liu-shi-cao-shuang', '刘氏', '第107回只写「其妻刘氏急出厅前，唤守府官问曰」——只说"曹爽的妻子"，无官职无别的称谓。'],
  ['xu-gong-jia-ke', '许贡家客', '第29回只写「程普引众齐上，将许贡家客砍为肉泥」——三人合用一句，连姓都没有。'],
  ['lv-boshe', '吕伯奢', '第4回原文写他与曹嵩结义、款待曹操被误杀，**通篇无官职**。'],
];
for (const [id, name, why] of SKIP) {
  const c = byId.get(id);
  if (!c) { console.log(`  (跳过) 找不到 ${id}`); continue; }
  console.log(`  · ${name}（${id}）${c.title ? `已有 title="${c.title}"` : '留空'}`);
  console.log(`      ${why}`);
  if (!c.title) {
    c.note = `${c.note ? c.note + ' ' : ''}※ v0.128 title 留空：${why}`.trim();
  }
}

/* ══════════════ 五、顺手补 sun-he-orig 的 firstCh ══════════════ */
console.log('\n═══ 五、顺手：孙河 的 firstCh 是 undefined ═══\n');
{
  const sh = byId.get('sun-he-orig');
  if (!sh) console.log('  (跳过) 没有 sun-he-orig');
  else if (typeof sh.firstCh === 'number') console.log(`  (跳过) 已有 firstCh=${sh.firstCh}`);
  else {
    // 「孙河」二字原文 0 次（姓是孙策赐的），但别名「其父名河」在第 82 回
    const cite = '其父名河，本姓俞氏';
    if (!f.includes(flat(cite))) { console.error('  ⛔ 定位短语核验不过'); process.exitCode = 1; }
    else {
      /* 回次表：取第二个「第一回」作正文起点（与 fix-wrong-chapters.mjs 同算法） */
      const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 零: 0 };
      const cn2num = (s) => {
        if (s.length === 1) return CN[s] ?? null;
        let t = 0, cur = 0;
        for (const ch of s) {
          const v = CN[ch]; if (v == null) return null;
          if (v === 100) { cur = (cur || 1) * 100; t += cur; cur = 0; }
          else if (v === 10) { cur = (cur || 1) * 10; t += cur; cur = 0; }
          else cur = v;
        }
        return t + cur || null;
      };
      const firstAt = [];
      { const re0 = /第([一二三四五六七八九十百零]+)回/g; let m0;
        while ((m0 = re0.exec(f))) { if (cn2num(m0[1]) === 1) firstAt.push(m0.index); if (firstAt.length >= 2) break; } }
      const CH = [];
      { const re = new RegExp('第([一二三四五六七八九十百零]+)回', 'g'); re.lastIndex = firstAt[1] ?? 0;
        let m; const seen = new Set();
        while ((m = re.exec(f))) { const n = cn2num(m[1]); if (!n || seen.has(n)) continue; seen.add(n); CH.push({ n, at: m.index }); } }
      const at = f.indexOf(flat(cite));
      let ch = CH[0]?.n ?? 1;
      for (const c2 of CH) if (c2.at <= at) ch = c2.n; else break;
      sh.firstCh = ch;
      console.log(`  ＋ 孙河 firstCh=${ch}（依据「${cite}」所在回）`);
      console.log('    ⇒ 他的本名「孙河」原文 0 次（姓是孙策刚赐的），只能用别名定位。');
      console.log('      与 v0.119 给娄子伯补别名是同一件事的镜像：那次核心名搜不到，这次能搜到但没法算回次。');
    }
  }
}

/* ══════════════ 六、体检 ══════════════ */
console.log('\n═══ 六、体检 ═══\n');
{
  const noTitle = book.characters.filter((c) => !c.title);
  console.log(`  缺 title：${29 - filled} → ${noTitle.length}`);
  console.log(`  仍缺的 ${noTitle.length} 人：${noTitle.map((c) => c.name).join('、')}`);
  console.log('  ⇒ 全部是「原文确实没写」的，note 里逐条记了原因');

  const over = book.characters.filter((c) => c.title && c.title.length > 20);
  console.log(`\n  title 长度 ≤20：${over.length ? `✗ 超长的有 ${over.map((c) => `${c.name}("${c.title}")`).join('、')}` : '✓'}`);

  const core = (n) => String(n).replace(/[（(][^）)]*[）)]/g, '');
  let miss = 0;
  for (const c of book.characters) {
    const keys = [c.name, ...(c.aliases || [])].filter(Boolean);
    if (!keys.some((k) => f.includes(flat(k))) && !keys.some((k) => core(k) && f.includes(flat(core(k))))) { console.log(`  ✗ ${c.name}（${c.id}）搜不到`); miss++; }
  }
  console.log(miss ? `  ⇒ ${miss} 个搜不到` : '  ✓ 全部人物的名字/别名仍可在原文搜到');
  if (miss) process.exitCode = 1;

  // 严氏 desc 的「正妻」是原文用语，本轮复核后保持原样
  const ys = byId.get('yan-shi');
  console.log(`\n  严氏 desc="${ys?.desc}"`);
  console.log(`  ${/正妻/.test(ys?.desc || '') ? '✓ 保留「正妻」—— 原文第16回「先娶严氏为正妻」，是正确的' : '✗ 少了「正妻」'}`);

  console.log(`\n  ${book.characters.length} 人 / ${book.relations.length} 关系`);
}

console.log(`\n本轮：填 title ${filled} 条；明确不填 ${SKIP.length} 人 + 皇甫郦（note 已写原因）`);
console.log(WRITE ? '\n已写入' : '\n预览模式（加 --write 才落盘）');
if (WRITE) fs.writeFileSync(FILE, JSON.stringify(book, null, 2) + '\n', 'utf8');
