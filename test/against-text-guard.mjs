/**
 * 单测：`scripts/lib/against-text.mjs`（对着原著正文找漏人的判据）＋
 * **它在 `audit-against-text.mjs` 里确实被接上了**。
 *
 * ## 为什么值得单独测（v0.189）
 *
 * 起因是一个**报的数不是它算的数**的缺陷：老实现把 `slice(0, topN)` 之后的
 * 窗口条数当成"扫出 N 个疑似漏人"印出来 ——
 * 《百年孤独》真实待判 280 条却印「5 个」，《罪与罚》708 条印「16 个」。
 * 而且 `topN` 卡在"词的一部分"粗筛**之前** ⇒ 它既不是"前 N 条"，
 * 也不是"前 N 条像人名的"，是个两头不靠的截断。
 *
 * ## ⚠ 这条守卫的核心是"红绿证据"，不是"跑得通"
 *
 * 第 1 组用例**刻意让"坏"候选（紧跟在「的」后面，粗筛该丢）的排名高于"好"候选**，
 * 再把显示窗口设成 1：
 *
 *   · 正确顺序（先粗筛、后截断）⇒ 显示那 1 条好候选；
 *   · 旧顺序（先截断、后粗筛）⇒ 窗口里全是坏候选，粗筛后**一条都不剩**。
 *
 * 所以断言 `shown === 1 && rows[0].name === 好候选` 是**能红**的 ——
 * 把 lib 里那两行调回去，这条用例立刻变红。（已实测：调换后 3 条红。）
 *
 * ## ⚠ 这条守卫**刻意不起子进程**
 *
 * 本机 node 起不了**任何**子进程（`spawnSync` 一律 EBUSY，v0.180 实测），
 * 而原著 txt **不在版本库里**（`extract-epub.mjs` 注明了）⇒ 这条链**没法**做成
 * 跑 CLI 的门禁。这里直接 import 判据，用**合成文本**构造边界。
 * 代价：入口判断不在覆盖内 ⇒ 靠手工跑一次（v0.189 已跑：
 * `node scripts/audit-against-text.mjs data/crime-and-punishment.json .text/crime-and-punishment.txt`
 * 正常输出）。
 *
 * ## v0.192 追加：第 14 组守「这本书该走哪条规则」
 *
 * 用户指出"拿百家姓扫《百年孤独》是错的 —— 外国人名不适用百家姓"。
 * 老做法两条规则都跑、都打印，那份碎片清单摆在最前面；现在按**原著正文**判书型
 * （`classifyScript`：`·` 密度 / 已知名字含 `·` 的比例），只渲染适用的那一节，
 * 不适用的那节打印"本规则不适用于本书 + 实测判据数字"。
 * 红绿两边都要能验：调低门槛 ⇒ 14a 红；去掉接线 ⇒ 14g 红。
 *
 * 用法：node test/against-text-guard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGapReport, renderGapReport, buildInterpReport, renderInterpReport,
  classifyScript, norm, plain, stripParen, knownForms, INTERP_LMAX, INTERP_RMAX,
  DOT_PER10K, DOT_NAME_SHARE, NEAR, MIN, TOP_N }
  from '../scripts/lib/against-text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };

console.log('══ scripts/lib/against-text.mjs 的守卫 ══\n');

/* ── 合成语料 ──
 * 「坏」候选紧跟在「的」后面（粗筛该丢），出现 5 次；
 * 「好」候选前面是句号（粗筛该留），出现 2 次。
 * ⇒ 排序按"近旁次数"降序 ⇒ **坏候选排在前**，这正是旧顺序会翻车的形状。
 */
const KNOWN = ['李四'];
const BAD = ['张甲乙', '王丙丁', '赵戊己', '钱庚辛', '孙壬癸'];
const GOOD = ['周子丑', '吴寅卯', '郑辰巳'];
let RAW = '';
for (let k = 0; k < 5; k++) for (const b of BAD) RAW += `李四的${b}。`;
for (let k = 0; k < 2; k++) RAW += `李四。${GOOD.join('。')}。`;

const ALL = BAD.length + GOOD.length;      // 8
const PLAUSIBLE = GOOD.length;             // 3

/* ── 1. ⚠ 核心：粗筛必须在截断**之前**（否则好候选一条都看不见）── */
{
  const r = buildGapReport({ raw: RAW, names: KNOWN, topN: 1 });
  ok(r.rawCount === ALL, `扫出 ${ALL} 个候选（实测 ${r.rawCount}）`);
  ok(r.total === ALL, `待判 ${ALL} 条（实测 ${r.total}）—— **不是窗口条数**`);
  ok(r.plausible === PLAUSIBLE, `粗筛后 ${PLAUSIBLE} 条（实测 ${r.plausible}）—— 5 个坏候选被丢掉`);
  ok(r.shown === 1 && r.rows[0] && r.rows[0].name === GOOD[0],
    `窗口=1 时显示的是**好候选**（实测 ${r.shown} 条：${r.rows.map((x) => x.name).join('、') || '空'}）`
    + ' —— 若 lib 里把 slice 挪回粗筛之前，这里会变成 0 条');
  ok(r.truncated === true, `粗筛后 ${PLAUSIBLE} 条 > 窗口 1 ⇒ 报截断`);
}

/* ── 2. 报告里的"待判总数"必须是真的（这就是 v0.189 修的那个假数）── */
{
  const r = buildGapReport({ raw: RAW, names: KNOWN, topN: 1 });
  const text = renderGapReport(r, { slug: 'demo', min: MIN, near: NEAR, topN: 1 }).join('\n');
  ok(new RegExp(`待判 ${ALL} 条`).test(text), `报告里印的是**待判 ${ALL} 条**，不是"本页 1 条"`);
  ok(/本页显示 1 条/.test(text) && /还有 2 条\*\*没有显示\*\*/.test(text),
    '报告里说清了本页显示几条、还差几条没显示');
  ok(/译本/.test(text) && /判别力很低/.test(text),
    '常驻提示：这条规则在译本上判别力很低（漏了就等于让人把 280 条候选当成 280 个漏掉的人）');
}

/* ── 3. 截断要**显式**说出来 ── */
{
  const r = buildGapReport({ raw: RAW, names: KNOWN, topN: 3 });
  ok(r.total === ALL && r.plausible === PLAUSIBLE && r.shown === 3 && r.truncated === false,
    '窗口 3 = 粗筛后 3 ⇒ 不算截断（不能把"够放"报成"截断了"）');
  const big = buildGapReport({ raw: RAW, names: KNOWN, topN: 99 });
  ok(big.shown === PLAUSIBLE, `窗口 99 ⇒ 粗筛后的 ${PLAUSIBLE} 条全在（实测 ${big.shown}）`);
}

/* ── 4. `--top 0`（≤0）必须**全列**，不是"一条都不显示" ── */
{
  const r = buildGapReport({ raw: RAW, names: KNOWN, topN: 0 });
  ok(r.shown === PLAUSIBLE, `topN=0 ⇒ 全列 ${PLAUSIBLE} 条（实测 ${r.shown}）—— 老写法 slice(0,0) 会一条都不显示`);
  ok(r.truncated === false, 'topN=0 时永远不算截断');
  const neg = buildGapReport({ raw: RAW, names: KNOWN, topN: -3 });
  ok(neg.shown === PLAUSIBLE, 'topN 为负数同样全列（不崩、不静默清空）');
}

/* ── 5. 台账扣除：**只认精确相等**（与 check-missing-ok 的 M6 同一口径）── */
{
  const r = buildGapReport({ raw: RAW, names: KNOWN, okSet: new Set(['张甲乙']), topN: 0 });
  ok(r.judgedDropped === 1, `命中台账 1 条（实测 ${r.judgedDropped}）`);
  ok(r.rawCount === ALL && r.total === ALL - 1, `扣掉前 ${ALL} 条、待判 ${ALL - 1} 条，两个数都报出来`);
  ok(!r.rows.some((x) => x.name === '张甲乙'), '判过的那条不再出现在清单里');

  const sub = buildGapReport({ raw: RAW, names: KNOWN, okSet: new Set(['张甲']), topN: 0 });
  ok(sub.judgedDropped === 0, '子串**不算**判过（「张甲」不该把「张甲乙」扣掉）');
}

/* ── 6. 已知名字要能挡住（否则"已知的人"会被报成"漏人"）── */
{
  const r = buildGapReport({ raw: '李四张三丰。李四张三丰。', names: ['李四', '张三丰'], topN: 0 });
  ok(r.rawCount === 0, `已知名字（含别名）不会进候选（实测 ${r.rawCount} 条）`);
  const r2 = buildGapReport({ raw: '李四张甲乙。李四张甲乙。', names: ['李四'], topN: 0 });
  ok(r2.rawCount === 1, '同一个名字出现 2 次 ⇒ 过门槛');
  const r3 = buildGapReport({ raw: '李四张甲乙。', names: ['李四'], topN: 0 });
  ok(r3.rawCount === 0, '只出现 1 次 ⇒ 不过默认门槛（min=2）');
}

/* ── 7. `norm` / `plain` 两个小工具（其余判据都建在它们上面）── */
{
  ok(norm('何塞·阿尔卡蒂奥') === '何塞阿尔卡蒂奥', 'norm 去掉间隔号（两本书的已知名都带 ·）');
  ok(norm('  A b，C ') === 'abc', 'norm 去空白/标点并小写');
  ok(plain('<p>甲&amp;乙</p>') === '甲&乙', 'plain 剥标签与实体');
  ok(plain('甲&#65;乙') === '甲乙', 'plain 剥数字实体（**只剥不解码** —— 原文本就是剥过的）');
}

/* ── 8. ⚠ 结构性：lib 里 slice 必须排在粗筛之后（静态兜一层）── */
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'against-text.mjs'), 'utf8');
  const iFilter = src.indexOf('const plausibleRows = ranked.filter(looksLikeName);');
  const iSlice = src.indexOf('plausibleRows.slice(0, topN)');
  ok(iFilter >= 0, 'lib 里有"粗筛"这一步（`ranked.filter(looksLikeName)`）');
  ok(iSlice >= 0, 'lib 里有"按 topN 截断"这一步（`plausibleRows.slice(0, topN)`）');
  ok(iFilter >= 0 && iSlice >= 0 && iFilter < iSlice,
    '**粗筛排在截断之前** —— 调回去就是 v0.189 修掉的那个"报的数不是算的数"');
}

/* ── 9. ⚠ lib 必须真的被接上（防「库写了、忘了接」）── */
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-against-text.mjs'), 'utf8');
  ok(/from\s+'\.\/lib\/against-text\.mjs'/.test(src),
    'audit-against-text.mjs 真的 import 了 lib/against-text.mjs（否则这个库就是死的）');
  ok(/buildGapReport\s*\(/.test(src) && /renderGapReport\s*\(/.test(src),
    '两个导出都被调用了（只 import 不用 = 另一种死法）');
  ok(/for \(const line of renderGapReport\(/.test(src),
    '报告的每一行都**打印**出来了（不打印就等于装饰品）');
  ok(!/\.slice\(0,\s*topN\)/.test(src),
    '脚本自己不再做 `slice(0, topN)` 截断（截断只许在 lib 里、且必须在粗筛之后）');
  /* 规则二同理：import 了、调了、打印了 —— 三样缺一样它就是死的。 */
  ok(/buildInterpReport\s*\(/.test(src) && /renderInterpReport\s*\(/.test(src),
    '规则二的两个导出都被调用了（v0.190 新增；只 import 不用 = 另一种死法）');
  ok(/for \(const line of renderInterpReport\(/.test(src),
    '规则二的报告也真的打印出来了（否则它只是算给自己看）');
}

/* ── 10. ⚠ 百家姓表**只有一份**（v0.189）——`audit-search.mjs` 不再内联副本 ──
 *
 * 背景：`audit-search.mjs` 原先内联着一份 377 字的百家姓，与 lib 里那份**逐字相同**。
 * "逐字相同"本身没有门禁守得住 ⇒ 下次只补几个生僻姓到一边，同一本书两次扫描
 * （③ 与我们自己的文案 / 原著正文）候选就对不上，而两边都绿。
 * 这里静态钉住"那边真的改成 import 了、且没再自己声明一份"。
 */
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-search.mjs'), 'utf8');
  ok(/import\s*\{\s*SURNAMES\s*\}\s*from\s*'\.\/lib\/against-text\.mjs'/.test(src),
    'audit-search.mjs 从 lib/against-text.mjs import 了 SURNAMES（唯一来源）');
  ok(!/const\s+SURNAMES\s*=/.test(src),
    '**没有**再自己声明一份 `const SURNAMES =`（声明了就说明副本又回来了）');
  /* 只 import 不用 = 另一种死法：还得确认那个名字真被拼进扫描正则。 */
  ok(/new RegExp\(`\[\$\{SURNAMES\}\]/.test(src),
    'import 进来的 SURNAMES 真的拼进了扫描正则（不是死变量）');
}

/* ── 12. ⚠ 规则二「间隔号全名」（v0.190）—— 译本那条线 ──
 *
 * 起因：用户拿《百年孤独》第 16/17 章乌尔苏拉谵妄那段问
 * 「佩德罗妮拉·伊瓜兰 和 乌尔苏拉的曾外祖父 奥雷里亚诺·阿尔卡蒂奥·布恩迪亚
 *   为什么没有加进去」。答案是规则一**结构性看不见这两个人**：
 *   · `佩德罗妮拉·伊瓜兰` 首字「佩」不是百家姓 ⇒ 锚都锚不上；唯一锚得上的
 *     `伊瓜兰`（「伊」是百家姓）又恰好是已知名 `乌尔苏拉·伊瓜兰` 的**子串** ⇒ 被过滤掉；
 *   · `奥雷里亚诺·阿尔卡蒂奥·布恩迪亚` 里奥/阿/布**一个都不是百家姓** ⇒ 完全不可见。
 * 所以这一组用**合成语料**把上面两条各自复现一遍，并且钉住规则二的四条质量筛。
 *
 * 合成语料里的每一处都**跟着句号或逗号**（`，`/`。`），否则右段会把后文的叙述吞进来
 * （`伊瓜兰又出现了一次`）—— 那正是文件头 §局限里写的那个弱点，不该混进断言。
 */
{
  const KNOWN2 = [
    '乌尔苏拉·伊瓜兰',
    '阿尔卡蒂奥',
    '罗季昂·罗曼内奇·拉斯柯尔尼科夫',
    '阿利黎奥·诺格拉',
  ];
  const NEWP = '佩德罗妮拉·伊瓜兰';            // 用户点名的第一个：规则一看不见
  const THREE = '奥雷里亚诺·阿尔卡蒂奥·布恩迪亚'; // 用户点名的第二个：规则一完全看不见
  const RAW2 =
    `乌尔苏拉·伊瓜兰，遇见了${NEWP}。`
    + `后来${NEWP}又出现了一次。`
    + '罗季昂·罗曼内奇·拉斯柯尔尼科夫。'
    + '罗季昂·罗曼内奇。罗季昂·罗曼内奇。'
    + `${THREE}。${THREE}。${THREE}。`
    + '阿利黎奥·诺格拉医生。阿利黎奥·诺格拉医生。';

  const gap = buildGapReport({ raw: RAW2, names: KNOWN2, topN: 0 });
  const itp = buildInterpReport({ raw: RAW2, names: KNOWN2, topN: 0 });
  const names2 = itp.rows.map((x) => x.name);

  /* 12a. 规则一**看不见**用户点名的这两个 —— 这是"为什么要有第二条规则"的证据。 */
  ok(!gap.rows.some((x) => x.name.includes('伊瓜兰')),
    `规则一报不出任何含「伊瓜兰」的名字（实测 ${gap.rows.filter((x) => x.name.includes('伊瓜兰')).length} 条）`
    + ' —— 「伊」是百家姓，但锚出来的 `伊瓜兰` 是已知名 `乌尔苏拉·伊瓜兰` 的子串，被当碎片滤掉');
  ok(!gap.rows.some((x) => x.name.includes('奥雷里亚诺·阿尔卡蒂奥')),
    '规则一也报不出 `奥雷里亚诺·阿尔卡蒂奥·布恩迪亚`（三个字头都不是百家姓）');

  /* 12b. 规则二把这两个都报出来 —— 而且只报这两个。 */
  ok(itp.total === 2 && itp.rawCount === 2,
    `规则二恰好报 2 条（实测 rawCount=${itp.rawCount} total=${itp.total}）`
    + `：${names2.join('、') || '空'}`);
  ok(names2.includes(NEWP), `报出了用户点名的 ${NEWP}`);
  ok(names2.includes(THREE), `报出了用户点名的 ${THREE}`);
  ok(itp.lowFreq === 0, `没有掉进低频档（实测 ${itp.lowFreq} 条）—— 两个名字都出现 ≥2 次`);

  /* 12c. 已知人物的"教名+父名"**必须**丢掉：它是已知名的子串。
   *      （去掉 lib 里 `list.some((x) => x.includes(name))` 这一行 ⇒ 这里立刻红。）*/
  ok(!names2.includes('罗季昂·罗曼内奇'),
    '`罗季昂·罗曼内奇` 不再报（它是已知名 `罗季昂·罗曼内奇·拉斯柯尔尼科夫` 的子串）');
  ok(!names2.includes('罗季昂·罗曼内奇·拉斯柯尔尼科夫'), '已知名本身也不会被当成新名字报出来');
  ok(!names2.includes('罗曼内奇·拉斯柯尔尼科夫'), '已知名的后半截（跨间隔号那段）同样不报');

  /* 12d. ⚠ 但"含已知名"**不能**一律丢 —— 这是**单向**判据的命门。
   *      `奥雷里亚诺·阿尔卡蒂奥·布恩迪亚` 里含着已知名 `阿尔卡蒂奥`，而它是**另一个人**。
   *      实测这条会红的两种改法（都当场验过）：
   *        ① 把 12c/12d 改成**双向**包含 ⇒ 红（用户点名的第二个就这么丢过一次）；
   *        ② 把 `INTERP_RSEGS` 改成 **0**（右段不能跨间隔号）⇒ 红（长名被切两截后全被剔掉）。 */
  ok(names2.includes(THREE),
    '⚠ 含已知名 `阿尔卡蒂奥` 的长名**仍然报**（判据必须单向：只丢"候选是已知名的子串"）'
    + ' —— 改成双向包含、或让右段不能跨间隔号，这条都红');
  ok(!names2.includes('阿尔卡蒂奥·布恩迪亚'),
    '`阿尔卡蒂奥·布恩迪亚` 要丢（两段里夹着已知名 ⇒ 是碎片），而上面那条长名要留');

  /* 12e. `已知名 + 官职` 要丢（残渣 ≤ TITLE_SLACK 字）。 */
  ok(!names2.includes('阿利黎奥·诺格拉医生'),
    '`阿利黎奥·诺格拉医生` 不报（= 已知名 + 「医生」，残渣 2 字）'
    + ' —— 去掉 TITLE_SLACK 那条判据这里就红');

  /* 12f. 中文原著上**本来就该报 0**：正文里没有间隔号。 */
  {
    const cn = buildInterpReport({ raw: '李四见了张甲乙。张甲乙又见了王丙丁。', names: KNOWN, topN: 0 });
    ok(cn.rawCount === 0 && cn.total === 0,
      `没有间隔号的正文 ⇒ 规则二报 0 条（实测 ${cn.total} 条）—— 中文原著上它不该有误报`);
  }

  /* 12g. 门槛与低频档：只出现 1 次的人**只在低频档里**，不会静默消失。
   *      （这正是用户点名的第二个例子的处境：全书只出现 1 次。） */
  {
    const once = buildInterpReport({ raw: `${NEWP}。`, names: KNOWN2, topN: 0 });
    ok(once.total === 0 && once.lowFreq === 1,
      `只出现 1 次 ⇒ 不进待判（${once.total}）但**报进低频档**（${once.lowFreq}）—— 不是静默丢掉`);
    const one = buildInterpReport({ raw: `${NEWP}。`, names: KNOWN2, min: 1, topN: 0 });
    ok(one.total === 1, '--min 1 时它出现在待判里（"只被提到一次的人只在这一档里"）');
    const judged = buildInterpReport({
      raw: `${NEWP}。`, names: KNOWN2, min: 1, okSet: new Set([NEWP]), topN: 0,
    });
    ok(judged.judgedDropped === 1 && judged.total === 0,
      '台账里判过的（"不是这本书的人物"）下次不再报，且**扣了几条要报出来**');
  }

  /* 12h. 报告必须把「三类要分开判」和两条常驻提示印出来 ——
   *      这三类**判错类别比漏判更坏**（现实世界的人写进节点就成了假人物）。 */
  {
    const text = renderInterpReport(itp, { slug: 'demo', min: MIN, okLabel: 'data/demo.missing-ok.json' }).join('\n');
    ok(/规则二：间隔号全名/.test(text), '报告有「规则二」这一节，且标题写明是译本那条线');
    ok(/待判 2 条/.test(text), '报告印的是**待判总数**，不是本页条数');
    ok(/① 真漏掉的人/.test(text) && /② 已知人物的另一个写法/.test(text) && /③ 现实世界的人/.test(text),
      '印出三分类的处理办法（建节点 / 补别名 / 写进 missing-ok）');
    ok(/data\/demo\.missing-ok\.json/.test(text), '第 ③ 类直接给出台账文件名，人不用去猜');
    ok(/三国正文/.test(text) && /0 条/.test(text),
      '常驻提示：中文原著上规则二本来就该报 0 条（免得有人以为它坏了）');
    /* ⚠ 低频档那一行只在**真有**低频候选时才印 ⇒ 上面那份（lowFreq=0）印不出来，
     *   得单独拿一份"名字只出现 1 次"的报告来断言 —— 否则这条断言永远绿。 */
    const low = buildInterpReport({ raw: `${NEWP}。`, names: KNOWN2, topN: 0 });
    const lowText = renderInterpReport(low, { slug: 'demo', min: MIN }).join('\n');
    ok(low.lowFreq === 1 && /只出现 1 次/.test(lowText) && /--min 1/.test(lowText),
      '有低频候选时印出低频档提示（否则人会以为"清单已经空了"）—— 只被提到一次的人只在这一档里');
  }

  /* 12i. ⚠ 结构性：lib 里必须留着"每个 · 处只挑一个"这一步。
   *      去掉它 ⇒ 右段会带上后文叙述（`尔卡蒂奥·布恩迪亚不`），实测候选从 11 条炸到 115 条；
   *      "顺带把最长那个也留下"同样炸（低频档 37 → 978 条）。两条都实测过、都回退了。 */
  {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'against-text.mjs'), 'utf8');
    ok(/const picked = new Map\(\)/.test(src) && /picked\.get\(best\.key\)\.n\+\+/.test(src),
      'lib 里有"每个 · 处挑一个规范形"这一步（去掉它候选会炸两个数量级）');
    ok(/c === best\.c && key\.length > best\.key\.length/.test(src),
      '并列时**取最长**（否则 `佩德罗妮拉·伊瓜兰` 会被更短的 `妮拉·伊瓜兰` 顶掉）');
    ok(/const maximal = passing\.filter/.test(src),
      '过门槛之后还要"只留最大"（去子串），否则同一个人的两个写法各报一条');
  }

  /* 12j. `stripParen` / `knownForms`（v0.190）—— 数据里 `张南（蜀将）` 这种括注
   *      **原著里永远没有**，拿整串去掩码等于一个字都没掩掉。 */
  {
    ok(stripParen('张南（蜀将）') === '张南', 'stripParen 去掉全角括注（我们自己加的消歧标记）');
    ok(stripParen('奥雷里亚诺·特里斯特（修铁路的那个）') === '奥雷里亚诺·特里斯特', 'stripParen 也认长括注');
    ok(stripParen('王颀(长安)') === '王颀', 'stripParen 半角括号也去');
    const kf = knownForms(['张南（蜀将）', '张南（天水）', '何塞', 'x']);
    ok(kf.includes('张南') && kf.filter((n) => n === '张南').length === 1,
      `去括注后**合并重复**（实测 ${JSON.stringify(kf)}）—— 两个消歧条目其实是一个串`);
    ok(!kf.includes('x'), '去括注后长度 <2 的被丢掉（`x` 不是名字）');
    ok(kf[0].length >= kf[kf.length - 1].length, 'knownForms 按长度降序（掩码必须长名先替）');
  }
}

/* ── 14. ⚠ 「这本书该走哪条规则」（v0.192）—— 用户指正：百家姓规则不适用译本 ──
 *
 * 起因：用户看到《百年孤独》的报告是用"姓氏+1~2 字"扫出来的，指出
 * 「外国人名不适用百家姓」。老做法两条规则都跑、都打印 ⇒ 那份 280 条的碎片清单
 * 照样摆在最前面，读的人**先看到它**；而且"清单是空的"和"这条规则没跑"长得一样。
 * 现在按**原著正文**判书型（不按书名猜），只渲染适用的那一节。
 *
 * 本组用**自带的合成语料**（不借上面 12 组的作用域），两个方向都要能红：
 *   · 把门槛调低到 0.1 ⇒ 14a 红（中文原著被误判成译本，三国 2580 条清单会整个藏起来）；
 *   · 去掉 `classifyScript` 的接线 ⇒ 14g 红（判据算了不用 = 另一种死法）。
 */
{
  const TR_NAMES = ['乌尔苏拉·伊瓜兰', '佩德罗妮拉·伊瓜兰'];
  const TR_RAW = '乌尔苏拉·伊瓜兰，遇见了佩德罗妮拉·伊瓜兰。'
    + '后来佩德罗妮拉·伊瓜兰又出现了一次。奥雷里亚诺·阿尔卡蒂奥·布恩迪亚。';
  const CN_NAMES = ['李四', '张甲乙', '王丙丁'];
  const CN_RAW = '李四见了张甲乙。张甲乙又见了王丙丁。李四。';
  /* ⚠ 数出来而不是写死：语料改了这条断言不该跟着烂（写死的数字正是"一个数写进正文就会烂"）。 */
  const TR_DOTS = (TR_RAW.match(/·/g) || []).length;

  /* 14a. 中文原著（正文无间隔号、数据主名也不带 ·）⇒ 判成非译本，走规则一。 */
  {
    const cn = classifyScript({ raw: CN_RAW, names: CN_NAMES });
    ok(cn.isTranslation === false,
      `中文原著判成非译本（实测 per10k=${cn.per10k.toFixed(1)} share=${(cn.translationShare * 100).toFixed(1)}%）`);
    ok(cn.byDots === false && cn.byNames === false, '两个来源都不成立 ⇒ 走规则一');
    ok(cn.dotCount === 0, '正文里 0 个间隔号');
  }

  /* 14b. 译本（正文密布间隔号）⇒ 判成译本，且**说得出是哪个来源成立的**。 */
  {
    const tr = classifyScript({ raw: TR_RAW, names: TR_NAMES });
    ok(tr.isTranslation === true, `译本判成译本（实测 per10k=${tr.per10k.toFixed(1)}）`);
    ok(tr.byDots === true, `正文间隔号密度 ${tr.per10k.toFixed(1)} 个/万字 ≥ 门槛 ${DOT_PER10K} ⇒ byDots`);
    ok(tr.dotCount === TR_DOTS, `数到了 ${tr.dotCount} 个间隔号（合成语料里恰好 ${TR_DOTS} 个）`);
    ok(tr.nameCount === 2 && tr.translationShare === 1, '数据侧两个主名都带 · ⇒ share=1（用去重后的规范形算）');
  }

  /* 14c. ⚠ 第二个来源（B）单独也要能成立 —— 兜住"正文混着附录、密度被稀释"的书。
   *      构造一份**没有间隔号**的正文 + **带间隔号**的名字 ⇒ A 不成立、B 成立。 */
  {
    const b = classifyScript({ raw: '李四见了王丙丁。', names: TR_NAMES });
    ok(b.byDots === false && b.byNames === true && b.isTranslation === true,
      `正文没间隔号但名字带间隔号 ⇒ 靠 B 判成译本（share=${(b.translationShare * 100).toFixed(1)}%）`);
  }

  /* 14d. ⚠ 门槛必须落在**空带**里（中文原著 0.2 / 译本 ≥31.9，差两个数量级）。
   *      这条断言防的是"有人把门槛调成 0.1"—— 那样三国立刻被误判成译本、
   *      2580 条清单整个藏起来，是比"多报碎片"坏得多的错。 */
  {
    ok(DOT_PER10K >= 1 && DOT_PER10K <= 20,
      `间隔号密度门槛落在空带里（${DOT_PER10K}；中文原著 0.2 / 译本 31.9·67.3）`);
    ok(DOT_NAME_SHARE >= 0.1 && DOT_NAME_SHARE <= 0.5,
      `名字含 · 的比例门槛落在空带里（${DOT_NAME_SHARE}；三国 0% / 译本 52.6·62.1%）`);
    const cn = classifyScript({ raw: '玄德曰。曹操大喜。', names: ['刘备', '曹操', '孙权'] });
    ok(cn.isTranslation === false, '中文名字一律不带 · ⇒ 不会被 B 误判成译本');
  }

  /* 14e. ⚠ 不适用的那一节必须**打印"不适用"**，不是静默少一节、也不是"0 条"。
   *      （静默少一节与"这一节 0 条"长得一样，而 0 条会被读成"书里没人漏"。） */
  {
    const script = classifyScript({ raw: TR_RAW, names: TR_NAMES });
    const gapNull = renderGapReport(null, { slug: 'demo', script }).join('\n');
    ok(/不适用于本书/.test(gapNull), '译本上规则一那一节明写「不适用于本书」');
    ok(/规则二/.test(gapNull), '并指向规则二（告诉人该看哪一节）');
    ok(/个\/万字/.test(gapNull), '把实测的判据数字印出来（判错了人要能自己看出来）');
    ok(!/待判/.test(gapNull), '**不是**"待判 0 条"那种写法（那会被读成"书里没人漏"）');

    const cnScript = classifyScript({ raw: CN_RAW, names: CN_NAMES });
    const itpNull = renderInterpReport(null, { slug: 'demo', script: cnScript }).join('\n');
    ok(/不适用于本书/.test(itpNull) && /中文原著/.test(itpNull), '中文原著上规则二那一节明写「不适用于本书」');
    ok(/规则一/.test(itpNull), '并指向规则一');
    ok(!/三国正文/.test(itpNull), '不适用时不印"三国正文 · 数为 0"那句（那是适用时的口径）');
  }

  /* 14f. ⚠ 译本上规则二的常驻提示要**换口径**：不能说"这条规则本该报 0 条"。 */
  {
    const script = classifyScript({ raw: TR_RAW, names: TR_NAMES });
    const itp = buildInterpReport({ raw: TR_RAW, names: TR_NAMES, topN: 0 });
    const text = renderInterpReport(itp, { slug: 'demo', min: MIN, script }).join('\n');
    ok(/本节是\*\*主线\*\*/.test(text) && /是译本/.test(text),
      '译本上明说本节是主线（老文案"中文原著上它本来就该报 0 条"在译本上是错的）');
    ok(!/三国正文/.test(text), '译本上不再印"三国正文 · 数为 0"那句（那是中文原著的口径）');
    /* 中文原著那一侧仍保留老口径 —— 否则上面那条断言可能只是"两处都删了"。 */
    const cnScript = classifyScript({ raw: CN_RAW, names: CN_NAMES });
    const cnText = renderInterpReport(
      buildInterpReport({ raw: CN_RAW, names: CN_NAMES, topN: 0 }),
      { slug: 'demo', min: MIN, script: cnScript }).join('\n');
    ok(/三国正文/.test(cnText), '中文原著上仍印"三国正文 · 数为 0"（红绿两边都验，不是删了就绿）');
  }

  /* 14g. ⚠ 结构性：`audit-against-text.mjs` 必须真的**按书型分流**（防"库写了、忘了接"）。 */
  {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-against-text.mjs'), 'utf8');
    ok(/classifyScript\s*\(/.test(src), '脚本调了 classifyScript（否则这个判据是死的）');
    ok(/script\.isTranslation/.test(src), '按 isTranslation 分流（不是算完不用）');
    ok(/script:\s*r\.script/.test(src), '把 script 传给两份 render（否则报告印不出实测数字）');
  }
}

/* ── 13. 入口卫生 ── */
{
  /* ⚠ 这里检查的是 **lib**，不是本守卫自己 —— 而本守卫的文件头正写着 spawnSync。
   *   且 `test/guard-hygiene.mjs`（H1）会**剥注释后**扫所有守卫，
   *   本文件里若出现 `child_process` 字面量会被它误判 ⇒ 关键词拆开构造。 */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'against-text.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const banned = ['child_' + 'process', 'spawn' + 'Sync', 'exec' + 'Sync', 'require(' + "'fs'"];
  ok(!banned.some((k) => src.includes(k)), 'lib 里没有子进程、没有 fs（纯函数，守卫才能直接调）');
  ok(/^export function buildGapReport/m.test(src), '导出 buildGapReport');
  ok(/^export function renderGapReport/m.test(src), '导出 renderGapReport');
  ok(/^export function buildInterpReport/m.test(src), '导出 buildInterpReport（规则二）');
  ok(/^export function renderInterpReport/m.test(src), '导出 renderInterpReport（规则二）');
  ok(/^export function classifyScript/m.test(src),
    '导出 classifyScript（v0.192：按原著正文判"这本书走哪条规则"）');
  ok(/^export const DOT_PER10K/m.test(src) && /^export const DOT_NAME_SHARE/m.test(src),
    '导出 DOT_PER10K / DOT_NAME_SHARE（门槛只有一处定义，消费方 import 而不是抄第二份）');
  ok(/^export function plain/m.test(src), '导出 plain');
  ok(/^export const stripParen/m.test(src) && /^export function knownForms/m.test(src),
    '导出 stripParen / knownForms（去我们自己的消歧括注，掩码与 near 判断都靠它）');
  ok(/^export const INTERP_LMAX/m.test(src) && /^export const INTERP_RMAX/m.test(src),
    '导出 INTERP_LMAX / INTERP_RMAX（间隔号候选的段长上限，只有一处定义）');
  ok(INTERP_LMAX === 5 && INTERP_RMAX === 12,
    `规则二段长上限没被悄悄改（LMAX=${INTERP_LMAX} RMAX=${INTERP_RMAX}）`);
  ok(/^export const NEAR/m.test(src) && /^export const MIN/m.test(src) && /^export const TOP_N/m.test(src),
    '导出 NEAR / MIN / TOP_N（阈值只有一处定义，消费方 import 而不是抄第二份）');
  ok(MIN === 2 && TOP_N === 60 && NEAR === 90, `默认阈值没被悄悄改（min=${MIN} top=${TOP_N} near=${NEAR}）`);
}

console.log(`\n${fail ? `✗ ${fail} 条不符合预期` : `✓ 全部 ${pass} 条通过`}`);
process.exit(fail ? 1 : 0);
