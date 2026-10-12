/**
 * 「对着原著正文找漏人」的**唯一**判据实现（v0.189）。
 *
 * ## 为什么要从 `audit-against-text.mjs` 里抽出来
 *
 * 抽出来有两个理由，第二个才是关键：
 *
 * ① 老规矩：判据要能被 `test/*-guard.mjs` **在进程内直接 import 调用**
 *    （本机 node 起不了任何子进程，见 `test/guard-hygiene.mjs` 的文件头）。
 *    而 `audit-against-text.mjs` 是**顶层就干活**的脚本，`import` 它会把主流程跑一遍
 *    （同 `dup-names.mjs` / `missing-ok.mjs` 的处境）。
 *
 * ② **v0.189 抓到它报的数不是它算的数**。原实现是
 *
 *        .filter(([name, v]) => v.n >= MIN && v.near > 0 && !okSet.has(name))
 *        .map(…) .sort(…) .slice(0, topN)        // ← 显示窗口
 *        .filter(词的一部分粗筛)
 *
 *    然后打印 `原著正文里扫出 ${rows.length} 个疑似漏人`。`rows.length` 是
 *    **窗口内粗筛后**的条数，却当成"总缺口"报出去：
 *      · 《百年孤独》真实待判 **280** 条，报告写「5 个」；
 *      · 《罪与罚》真实待判 **708** 条，报告写「16 个」。
 *    更糟的是 `topN` 卡在粗筛**之前** ⇒ 它既不是"前 N 条"（粗筛会再砍掉大半），
 *    也不是"前 N 条像人名的"（粗筛只作用于窗口内）—— 一个两头不靠的截断。
 *    于是"把清单判干净"这件事在工具上**永远做不到**：每判掉几条高排名的，
 *    窗口就滑一格，把下一档顶上来，报的数看着像在原地打转。
 *
 * ## 判据链（**顺序即语义**，别调换）
 *
 *    候选扫描（姓氏+1~2 字）
 *      → 门槛（出现 ≥min 次 且 至少一次落在已知人物 ±near 字内）   … rawCount
 *      → 扣掉台账已判过的                                        … judgedDropped
 *      → 逐条取"落在已知人物旁"那次的原文片段                        … total（**这才是待判总数**）
 *      → 排序（近旁次数 → 出现次数）
 *      → 粗筛「不像词的一部分」                                   … plausible
 *      → **最后**才按 topN 截断（topN ≤ 0 = 不截断）               … rows / truncated
 *
 * ⚠ 粗筛必须在截断**之前**：截断是**显示**问题，粗筛是**质量**问题；
 *   质量筛放在显示截断后面，"显示前 N 条"这句话就不成立了。
 *
 * ## ⚠ 这条判据在**译本**上判别力很低（实测，别当它没这回事）
 *
 * 规则是 `[百家姓][汉字]{1,2}`，贪婪取 2 字 ⇒ 中文叙述文本上必然切出跨词碎片。
 * 在《三国演义》上它是**验证过有判别力**的（v0.185：真实缺口只有 `姜子牙`/`张子房` 两个，
 * 其余 2919 条是碎片），因为演义的人名就是"姓+名"。
 * 但**译本的人名不按中文姓氏构词**：
 *
 *   · 《百年孤独》《罪与罚》里排在候选榜首的是 `终于` `相同` `乐观` `那点酒` `何必去`
 *     —— 全是常用词/短语被切开，一个真名都没有；
 *   · `--min 3` 一开，《百年孤独》280 → 5、《罪与罚》708 → 155；
 *     `--min 4` 时 0 / 8 ⇒ 绝大部分候选**恰好只出现 2 次**，正是碎片的指纹
 *     （碎片跟着它所在的那个词出现，词出现几次它就有几次）。
 *   · 译本真名的形态是**间隔号**（`罗季昂·罗曼内奇`），而 `·` 会把姓氏规则切断
 *     ⇒ 规则**系统性漏掉**译本里最该找的那类名字。
 *
 * ⇒ 本清单在译本上只当**候选**看，且**不能**靠"把清单判空"来收尾；
 *   译本该走的是 `--names` 那条线（数据里的名字在原文里搜不搜得到）。
 */

/**
 * 百家姓表。**唯一来源**（v0.189）——`audit-search.mjs` 原先内联着一份逐字相同的副本，
 * 现已改为 `import { SURNAMES } from './lib/against-text.mjs'`。
 * ⚠ 两边各留一份时，"逐字相同"是**靠人眼维持**的：下次只补几个生僻姓到一边，
 *   同一本书两次扫描的候选就对不上，而两边都绿（铁律 7：同一个定义不许抄第二份）。
 * ⚠ 但**不**与 `audit-search.mjs` 的 `norm` 共用 —— 那个 `norm` 还负责去 `-`/`_`/`—`，
 *   合并会改掉 ③ 的候选集合。同名的两个函数服务不同调用点，不是重复定义。
 */
export const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫房裘缪解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊甄曲封芮储靳段富巫乌焦巴弓牧山谷车侯全班秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩聂晁勾敖融冷訾辛阚那简饶空曾毋沙养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公';

/**
 * 官职/称谓/常用词：挡掉"都尉""魏将""那样""任何人""秋海棠"这类噪音。
 *
 * ⚠ 这份 STOP 表是**实测调出来的**，不是想出来的：
 *   "姓氏+1~2字"这个规则会把几乎所有以姓氏字开头的常用词都捞进来。
 *   一开始只按 `audit-search.mjs` 那份表挡，扫出 822 条候选、真正的人名只占个位数；
 *   把实测出现过的噪声词逐个补进来之后才降到可读。
 *   **新增任何一本书，都应该把它的噪声词补进这张表**（补进来的都是实测值，不是猜测）。
 */
export const STOP = /^(将军|校尉|都尉|从事|太守|刺史|丞相|主簿|司马|都督|长史|尚书|侍郎|中郎|上将|先锋|大帅|军师|谋士|文官|武官|将领|大王|主公|夫人|太后|皇后|贵妃|太子|王子|先主|后主|魏主|吴主|汉主|魏将|吴将|蜀将|汉将|众将|诸将|二将|三将|四将|大将|小将|名将|老将|女将|叔叔|舅舅|哥哥|姐姐|弟弟|妹妹|爷爷|奶奶|父亲|母亲|儿子|女儿|大哥|大姐|小弟|小妹|自己|别人|众人|二人|三人|四人|东西|那天|次日|当时|后来|如今|于是|因此|自从|然后|忽然|仍然|仍旧|已经|曾经|可以|没有|知道|看见|听见|回答|说道|笑道|想道|问道|答道|葫芦|流水|马匹|树木|房屋|石头|泥土|消息|道理|名字|声音|模样|时候|地方|周围|里面|外面|上面|下面|前面|后面|中间|旁边|对面|远处|近处|处处|人人|个个|件件|声声|步步|字字|吉卜赛|时间|那样|任何|秋海棠|那一|平静|相反|习惯|那天|房子|那时|金鱼|那么|游戏|幸福|印象|明白|房门|那个|支持|段时|印第安|巴旦杏|古钢琴|鲁塞尔|越来越|相信|游荡|马戏团|成一|时间一|羊皮卷|范晔|关系|时刻|空间|危险|能力|方法|空气|安宁|麻烦|满足|花园|解决|关联|黄昏|纪年|谈话|支持|注解|童年|寿衣|越山|武装|时光|岁月|方法|讲解|加入|金刚|双眼|金币|时分|于衷|曾祖父|计划|个人|今日|上古|下达|单独|里斯本|列斯|野史|史|界|术|科|郎|球|团|圣|悲|桑|波|亚|莎|蜜|雪|丹|富|卓|洪|黎|聪|肃|祥|禄|秉|祥|袁|凤|翔|鹊|瑾|瑜|昶|霄|漳|麟|铖)/;

/** 助词/连词：候选紧跟在这些字后面，多半是切歪了（"在某处安东尼奥"里的"在某处"）。 */
export const PARTICLE = /[的了在和与并及而就都也很还只把被让给对着向往从到]/;

/** 「出现在已知人物 ±NEAR 字之内」才算人名 —— 人是**在别人的上下文里**被提到的。 */
export const NEAR = 90;

/** 显示窗口默认大小（`--top`）。≤0 = 不截断。 */
export const TOP_N = 60;

/** 门槛默认值（`--min`）。 */
export const MIN = 2;

/** 归一：去空白/间隔号/标点并小写。用于"这个名字已知吗"的判断。 */
export const norm = (s) => String(s || '').replace(/[\s·・．.,，。、"'“”‘’()（）]/g, '').toLowerCase();

/**
 * 去掉「（长安）」这类**我们自己加的**消歧括注（v0.190）。
 *
 * 为什么必须去：括注是给读者消歧用的，**原著里永远不会出现**。
 * 数据里写 `张南（蜀将）`、`奥雷里亚诺·特里斯特（修铁路的那个）`，
 * 拿整串去掩码 ⇒ 原著里的 `张南` / `奥雷里亚诺·特里斯特` **一个字都没被掩掉**，
 * 于是已知人物被当成缺口报出来。
 *
 * 实测（`--min 2 --top 0`，`待判` 一栏，v0.190 当场对比 HEAD）：
 *
 * | 书 | HEAD | 去括注后 | 差 |
 * |---|---|---|---|
 * | 《百年孤独》 | 405 | 403 | −2 |
 * | 《罪与罚》 | 864 | 864 | 0 |
 * | 《三国演义》 | 2585 | 2580 | −5 |
 *
 * ⇒ **中文原著上效果最明显**（三国的 `王颀（长安）` 这类消歧括注最多），
 *   译本上几乎为零（译本的人名是 `名·父名·姓`，本来就不带我们的括注）。
 *   ⚠ 这里原先写的是"实测《百年孤独》靠这一条就少报 12 条"—— **那个 12 复现不出来**
 *   （见 CHANGELOG v0.190「一个数写进正文就会烂」）。数字一律以当场重跑为准。
 *
 * `audit-against-text.mjs` 的 `--names` 一侧早就在用同款 `bare()`，
 * 两边口径不一致本身就是个 bug。
 */
export const stripParen = (s) => String(s || '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();

/** 已知名字的**规范形态**：去括注、去重、长名在前（掩码必须长名先替，否则「何塞」会先吃掉「何塞·阿尔卡蒂奥」）。 */
export function knownForms(names) {
  const out = [...new Set((names || [])
    .map(stripParen)
    .filter((n) => n && n.length >= 2))];
  return out.sort((a, b) => b.length - a.length);
}

/** 剥掉 HTML 标签与常见实体（`extract-epub.mjs` 通常已经剥过，这里再兜一层）。 */
export function plain(t) {
  return String(t || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '');
}

/** 扫描用的正则（`new` 一次一份，`g` 标志会被 `matchAll` 复用）。 */
const surnameRe = () => new RegExp(`[${SURNAMES}][\\u4e00-\\u9fa5]{1,2}`, 'g');

/** 把已知名字逐个替换成 〇（长名优先，避免「何塞」先把「何塞·阿尔卡蒂奥」吃掉）。 */
function maskKnown(raw, names) {
  let masked = raw;
  for (const n of names) masked = masked.split(n).join('〇');
  return masked;
}

/** 已知名字在**原文**里的所有位置（用来判断候选是否"出现在别人的上下文里"）。 */
function knownSpansOf(raw, names) {
  const spans = [];
  for (const n of names) {
    let i = raw.indexOf(n);
    while (i >= 0) { spans.push([i, i + n.length]); i = raw.indexOf(n, i + 1); }
  }
  spans.sort((a, b) => a[0] - b[0]);
  return spans;
}

/** 造一个"某个位置附近有没有已知人物"的判据（闭包持 spans，避免每次都线性重扫）。 */
function nearKnownFn(spans, near) {
  return (at) => {
    for (let k = spans.length - 1; k >= 0; k--) {
      const [s, e] = spans[k];
      if (e < at - near) break;
      if (!(e < at - near || s > at + near)) return true;
    }
    return false;
  };
}

/**
 * 取"落在已知人物旁"那一次的原文片段（取不到就返回空串）。
 * ⚠ 必须取**近旁那次**：随便取首次出现，拿到的往往是回目标题/卷首语那种地方，
 *   片段里没有上下文，人工根本判不了。
 */
function snippetOf(raw, name, nearKnown) {
  let i = raw.indexOf(name);
  while (i >= 0) { if (nearKnown(i)) break; i = raw.indexOf(name, i + 1); }
  if (i < 0) return '';
  return raw.slice(Math.max(0, i - 30), i + name.length + 36).replace(/\s+/g, ' ');
}

/**
 * 粗筛：明显是**词的一部分**而不是人名的丢掉。
 *
 * 看首现片段——候选前面那个字若是助词（"…在某处安东尼奥…"），就多半是切歪了。
 * 代价：漏掉一些真候选，但留下的精度高得多，人工看得完。
 */
function looksLikeName(x) {
  const s = x.snippet;
  if (!s) return true;
  const i = s.indexOf(x.name);
  if (i < 0) return true;
  const prev = s[i - 1];
  if (!prev) return true;              // 句首/标点 ⇒ 很像人名
  return !PARTICLE.test(prev);
}

/**
 * 出一份"待判候选"报告。**纯函数**：只吃文本与名字，不碰文件系统。
 *
 * @param {object} o
 * @param {string} o.raw      原著正文（已 `plain`，已按需要切掉评点/附录）
 * @param {string[]} o.names  数据里的已知名字（人物主名/别名/地点名…）
 * @param {Set<string>} [o.okSet] 台账里已判过的名字（精确相等，不认子串）
 * @param {number} [o.min]    出现次数门槛
 * @param {number} [o.near]   近旁窗口（字）
 * @param {number} [o.topN]   显示窗口；≤0 = 不截断
 * @returns {{known:number, rawCount:number, judgedDropped:number, total:number,
 *            plausible:number, shown:number, truncated:boolean, rows:Array}}
 */
export function buildGapReport({ raw, names, okSet = new Set(), min = MIN, near = NEAR, topN = TOP_N }) {
  const text = String(raw || '');
  const list = knownForms(names);
  const knownNorm = new Set(list.map(norm));
  const masked = maskKnown(text, list);
  const nearKnown = nearKnownFn(knownSpansOf(text, list), near);

  // 扫"姓氏 + 1~2 字"
  const cand = new Map();
  for (const m of masked.matchAll(surnameRe())) {
    const name = m[0];
    if (name.includes('〇')) continue;                     // 命中已知名字的残留
    if (knownNorm.has(norm(name))) continue;
    if (list.some((n) => n.includes(name) || name.includes(n))) continue;
    if (STOP.test(name)) continue;
    if (/[的地得了着是不在有和与及然后里上下之就都也很还只把被让给对着向往从向往]/.test(name)) continue;
    if (!cand.has(name)) cand.set(name, { n: 0, near: 0 });
    const c = cand.get(name);
    c.n++;
    if (nearKnown(m.index)) c.near++;                     // 有多少次是"出现在已知人物旁边"
  }

  /* ── ① 门槛 ── */
  const passing = [...cand.entries()].filter(([, v]) => v.n >= min && v.near > 0);
  const rawCount = passing.length;

  /* ── ② 扣掉台账已判过的 ── */
  const afterJudged = passing.filter(([name]) => !okSet.has(name));
  const judgedDropped = rawCount - afterJudged.length;

  /* ── ③ 取片段 + 排序 ── */
  const ranked = afterJudged
    .map(([name, v]) => ({ name, count: v.n, near: v.near, snippet: snippetOf(text, name, nearKnown) }))
    .sort((a, b) => (b.near - a.near) || (b.count - a.count));

  /* ── ④ 粗筛（质量）—— **必须在截断之前** ── */
  const plausibleRows = ranked.filter(looksLikeName);

  /* ── ⑤ 显示截断（topN ≤ 0 = 全列）── */
  const rows = topN > 0 ? plausibleRows.slice(0, topN) : plausibleRows;

  return {
    known: list.length,
    rawCount,
    judgedDropped,
    total: afterJudged.length,          // **待判总数**（报告里的那个数必须是它）
    plausible: plausibleRows.length,
    shown: rows.length,
    truncated: plausibleRows.length > rows.length,
    rows,
  };
}

/**
 * 把报告渲染成行（**纯函数**，便于守卫断言"报的数就是算的数"）。
 *
 * @param {ReturnType<typeof buildGapReport>} r
 * @param {object} [o]
 * @param {string} [o.slug]
 * @param {number} [o.min] @param {number} [o.near]
 * @param {string} [o.okLabel] 台账文件标签（写进提示里，方便直接去核对）
 */
export function renderGapReport(r, o = {}) {
  /* ⚠ 这里**不收** topN：报告里只印"本页显示了几条 / 还差几条没显示"，
   *   那两件事 `r.shown` / `r.truncated` 已经算好了。
   *   再收一个 topN 就有第二处"窗口大小"，迟早和 r 里的对不上。 */
  const { slug = '', min = MIN, near = NEAR, okLabel = '', script = null } = o;
  const L = [];
  /* ⚠ `r === null` = **这本书不该走这条规则**（`classifyScript` 判成译本，见下）。
   *   这里必须**明说**，不能静默少打印一节 —— "少一节"和"这一节 0 条"长得一模一样，
   *   而 0 条会被读成"书里没人漏"。这正是用户 v0.192 指出的那个错：
   *   **拿百家姓规则去扫译本**（外国人名不适用百家姓）。 */
  if (!r) {
    L.push(`=== ${slug} ===`);
    /* ⚠ v0.206：跳过有两种**完全不同的理由**，报告必须分开说 ——
     *   译本：人名**怎么写的**不一样（间隔号 vs 姓氏），换规则二照样能找；
     *   理论类：这本书**压根没有"人名节点"**，换哪条规则都不该找。
     *   混着写会让人以为"换个规则就能扫出理论类的缺口"。 */
    if (script && script.isTheory) {
      L.push('  ⚠ **本规则（姓氏 + 1~2 字）不适用于本书** —— 它是**理论类**，'
        + '节点是**概念/术语**（心理表征、甜蜜点），**不是人名**。');
      L.push(`     判据（按原著正文算）：正文里「·」密度 **${script.per10k.toFixed(1)} 个/万字**`
        + `（门槛 ≥${DOT_PER10K}）；已知名字里含「·」的占 **${(script.translationShare * 100).toFixed(1)}%**`
        + `（门槛 ≥${(DOT_NAME_SHARE * 100).toFixed(0)}%）。`);
      L.push('     ⚠ 这两个数**在理论类上不构成判据**：它们量的是"人名怎么写"，而本书没有人名节点。'
        + `本例正文 ${script.per10k.toFixed(1)} 个/万字（引用了大量西方人名）本会把书判成**译本**，`
        + '从而跑规则二、报出几十条人名候选 —— 那些人**一条都不该建节点**。');
      L.push('  ⇒ 已**跳过**（人名提取器对概念名没有意义），'
        + '下面的**规则二（间隔号全名）同样跳过**（同一理由）。');
      L.push('  ⇒ 本书该走的是 `--names`：核**概念名**在原文里搜不搜得到（那一条对理论类**完全适用**）。');
      return L;
    }
    L.push('  ⚠ **本规则（姓氏 + 1~2 字）不适用于本书** —— 它是**译本**，人名不按中文姓氏构词。');
    if (script) {
      L.push(`     判据（按原著正文算，不按书名猜）：正文里「·」密度 **${script.per10k.toFixed(1)} 个/万字**`
        + `（门槛 ≥${DOT_PER10K}）；已知名字里含「·」的占 **${(script.translationShare * 100).toFixed(1)}%**`
        + `（门槛 ≥${(DOT_NAME_SHARE * 100).toFixed(0)}%）。`);
    }
    L.push('  ⇒ 已**跳过**这次扫描（拿它扫译本，报出来的一多半是跨词碎片），'
      + '改看下面的**规则二：间隔号全名**。');
    return L;
  }
  L.push(`=== ${slug} ===`);
  L.push(`  数据里已知 ${r.known} 个名字；原著正文里扫出 ${r.rawCount} 个候选`
    + `（出现 ≥${min} 次，且至少一次落在已知人物 ±${near} 字内）`);
  if (r.judgedDropped) {
    L.push(`  · 已扣掉台账里判过的 ${r.judgedDropped} 条${okLabel ? `（${okLabel}）` : ''}`
      + ` ⇒ **待判 ${r.total} 条**`);
  } else {
    L.push(`  · 台账里没有判过的条目 ⇒ **待判 ${r.total} 条**`);
  }
  if (!r.total) {
    L.push('  （没有候选）');
  } else {
    L.push(`  · 其中 ${r.plausible} 条过了「不像词的一部分」粗筛，本页显示 ${r.shown} 条`);
    if (r.truncated) {
      L.push(`  ⚠ 还有 ${r.plausible - r.shown} 条**没有显示** —— 加 --top N 调大，`
        + '--top 0 全列。**上行的"待判 N 条"才是缺口规模，不是本页条数。**');
    }
    L.push('');
    for (const x of r.rows) {
      L.push(`  ${String(x.count).padStart(4)}×（其中 ${String(x.near).padStart(3)} 次在已知人物旁）  ${x.name}`);
      if (x.snippet) L.push(`         …${x.snippet}…`);
    }
    L.push('');
    L.push(`  确认过"确实是噪声/不必建档"的，写进 ${okLabel || `data/${slug}.missing-ok.json`}`
      + '（一行一个名字），下次不再报。');
  }
  /* ⚠ 常驻提示，不是可选项：这条规则假定「首字＝姓」，**只在中文原著上成立**。
   *   译本人名不满足这个假定 ⇒ 脚本会自动改走规则二（见 classifyScript），
   *   不会拿这条规则去扫译本。写在这里，免得有人以为"清单空了 = 书里没人漏"。 */
  L.push('  ⚠ 这条规则（姓氏+1~2 字）假定「**首字＝姓**」，只在**中文原著**上成立 ——'
    + '在**译本**上判别力很低：人名是 `名·父名·姓`（罗季昂·罗曼内奇），姓氏规则基本抓不到，'
    + '报出来的一多半是跨词碎片。所以脚本会**按原著正文自动判**（`classifyScript`），'
    + '译本上直接跳过这一节、改走规则二。');
  return L;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 「这本书该走哪条规则」——按**原著正文**判，不按书名猜（v0.192）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 起因：用户指出"拿百家姓扫《百年孤独》是错的"
 *
 * 规则一（`[百家姓][汉字]{1,2}`）是个**中文姓名模型**，它假定"第 1 个字是姓"。
 * 译本人名不满足这个假定（`佩德罗妮拉·伊瓜兰` 首字「佩」不是百家姓；
 * `奥雷里亚诺·阿尔卡蒂奥·布恩迪亚` 三个字头都不是）⇒ 拿它扫译本，
 * 报出来的一多半是**跨词碎片**（`终于`/`相同`/`那点酒`/`何必去`），
 * 而真正该找的名字反而**结构性看不见**。用户说的对。
 *
 * 老做法是"两条规则都跑、都打印"，再在末尾加一句"规则一在译本上判别力很低"——
 * 但那份 280 条的清单照样摆在最前面，读的人**先看到它**，那句提示在后面。
 * 而且"清单是空的"和"这条规则没跑"长得一样。
 * ⇒ 现在改成：**判出书型，只渲染适用的那一节**，不适用的那节明写"本规则不适用于本书"。
 *
 * ## 判据：两个来源，任一成立即判为译本
 *
 * **A. 正文里 `·` 的密度（每万非空白字）** —— 译本全名是 `名·父名·姓`，间隔号是硬形态标记。
 *
 * | 书 | 人物数 | 主名含 `·` | 占比 | **全文** `·` 数 | **全文** `·`/万字 |
 * |---|---|---|---|---|---|
 * | 三国演义 | 886 | 0 | 0.0% | 13 | **0.2** |
 * | 罪与罚 | 38 | 20 | 52.6% | 1370 | **31.9** |
 * | 百年孤独 | 66 | 41 | 62.1% | 1575 | **67.3** |
 *
 * ⚠ 上表是**全文**的实测（v0.192 当场重跑：13 / 1370 / 1575，非空白字 767057 / 429675 / 233911）。
 *   三国那 13 个 `·` 全在**附录/音注**里（古今地名对照表之类）⇒ 切到 120 回正文后
 *   三国正文的密度是 **0.0**，比表里还干净。两种口径都远在门槛之下，判据不受影响。
 *   这里刻意不写成"正文 `·` 数"—— 老版本那样写，实际量的是全文（"一个数写进正文就会烂"）。
 *
 * 门槛取 **5**：中文原著 0.2 与译本 31.9 差**两个数量级**，中间是个很宽的空带，
 * 取 5 而不是取 16 是因为……不需要那么精确 —— 这个判据的要点是**别把中文原著误判成译本**
 * （误判的代价是把三国那 2580 条清单整个藏起来），而 0.2 → 5 已经有 25 倍余量。
 *
 * **B. 已知名字里含 `·` 的比例 ≥ 0.20** —— 兜住"正文混着附录、`·` 密度被稀释"的书。
 * 三国那份 txt 是**毛宗岗评点本**，附录/音注里有 13 个 `·`，分母一大密度就掉到 0.2；
 * 但**数据侧**的主名一个都不带 `·`（0%），所以 B 在三国上**不成立** ——
 * 这正是要 B 的原因：它看的是数据侧的形状，与 A 互补。
 *
 * ⚠ **B 的分母与上表不同，别把两处的百分比当成同一个数**：上表量的是 `characters[].name`
 *   的**主名**；`classifyScript` 量的是 `knownForms(names)` —— 即 `audit-against-text.mjs`
 *   传进来的**全部名字**（主名 + 别名 + altNames + 地点名），且去括注、去重、按长度排序。
 *   实测（v0.192）：三国 **0.0%** · 罪与罚 **30.8%** · 百年孤独 **46.6%**。
 *   两个口径相差 15 个百分点上下，但都在门槛（20%）的两侧，**判据结论不变**。
 *   报告里印的 `translationShare` 是**后者**（B 的那个分母），这样人复核时算的就是同一个数。
 *
 * ⚠ 两个来源都往报告里**印出实测数字**（不是只印"是译本"）—— 判错了人要能自己看出来。
 *
 * ## 已知局限（别把它当万能判据）
 *
 * · 门槛是**经验值**，不是从语料里推出来的（本项目只处理 3 本书）。
 *   新书进来时若判错，报告里的数字就是诊断入口。
 * · `·` 也可能来自**间隔号以外的用法**（如「阿·托尔斯泰」这类译名里的缩写点），
 *   但那种文本本身就是译本，判成译本**不亏**。
 * · 反过来，**中文原著里大量引用外国人名**（如《三国演义》附录的参考书目）时，
 *   A 可能被抬上去 —— 这正是 B 存在的意义，也是"附录要不要扫"那条老问题的同一面。
 */

/** 「正文里 `·` 密度」门槛（每万非空白字）。中文原著 0.2、译本 31.9/67.3 ⇒ 取 5。 */
export const DOT_PER10K = 5;
/** 「已知名字里含 `·` 的比例」门槛。三国 0%、译本 52.6/62.1% ⇒ 取 0.20。 */
export const DOT_NAME_SHARE = 0.20;

/**
 * 判"这本书该走哪条规则"。**纯函数**：只吃文本与名字（外加一个显式声明的书型），不碰文件系统。
 *
 * ## v0.206：加了**第三类**——理论类（节点是概念，不是人名）
 *
 * 前两类（中文原著 / 译本）都是**按原著正文量出来的**（`·` 密度、名字形状），
 * 因为它们问的是同一个问题："这本书里的人是**怎么写的**"。
 * 理论类问的是**另一个**问题："这本书的节点**是不是人**" —— 这个**量不出来**，
 * 只能看数据里的显式声明（`meta.type`）。所以它走 `isTheory` 参数，不参与量。
 *
 * 实测（《刻意练习》，v0.206）：正文 `·` 密度 **11.5 个/万字** ⇒ 旧判据会把它判成**译本**
 * （因为它引用了大量西方人名：史蒂夫·法隆、比尔·蔡斯…），于是规则二照跑，
 * 报出 **30 条人名候选**（全是书里的研究者与案例主角）。
 * 而这本书的节点是**概念**（心理表征 / 甜蜜点 / 长时记忆）——
 * 那 30 条**一条都不该建节点**，报告却把它们印成"待判 30 条"。
 * ⇒ 一个**假信号源**：人会一条条去判，判完发现"这些人本来就不该进这张图"。
 *   （本项目的老话：一个假信号源比没有更坏。）
 *
 * ⚠ 所以判据是**显式声明**而不是"猜这本书像不像理论书" —— 猜出来的类型会在某本书上
 *   悄悄判错，而报告看起来完全正常（同 `data-files.mjs` 里 `isTheoryBook` 的注释）。
 * ⚠ 理论类**两条规则都不跑**，但**两节都照样渲染**，内容改成"本规则不适用于本书 + 实测数字"。
 *   静默少一节 = 和"这一节 0 条"长得一样 = 假绿。
 *
 * ⚠ `isTheory` 由**调用方**传（`audit-against-text.mjs` 拿 `data-files.mjs` 的
 *   `isTheoryBook(book)` 算），本模块**不 import 它** —— 这里有一条真在守的不变量：
 *   「lib 零依赖、无顶层副作用，守卫才能直接 import 调」（见 `test/against-text-guard.mjs`）。
 *   引一个带 `fs` 的模块进来，那条不变量就从"真的"变成"字面上还成立"。
 *
 * @param {object} o
 * @param {string} o.raw      原著正文（已 `plain`、已按需要切掉评点/附录）
 * @param {string[]} [o.names] 数据里的已知名字（人物主名/别名/地点名…）
 * @param {boolean} [o.isTheory] 数据里**显式声明**的书型是不是理论类（`meta.type === '理论类'`）
 * @returns {{isTheory:boolean, isTranslation:boolean, byDots:boolean, byNames:boolean,
 *            translationShare:number, dotCount:number, per10k:number, nameCount:number}}
 *   `isTranslation` 是两个来源的**或**（理论类恒 false）；另外几个字段是**实测值**，
 *   要印进报告供人复核 —— 判错了人要能自己看出来。
 */
export function classifyScript({ raw, names = [], isTheory = false }) {
  const text = String(raw || '');
  const compact = text.replace(/\s/g, '');
  const dotCount = (text.match(/·/g) || []).length;
  const per10k = compact.length ? (dotCount / (compact.length / 10000)) : 0;
  /* ⚠ 用 `knownForms`（去括注、去重、长名在前）而不是裸数组：
   *   数据里 `张南（蜀将）`/`张南（天水）` 是**同一个串**，重复计数会把比例拉歪。 */
  const forms = knownForms(names);
  const dotted = forms.filter((n) => n.includes('·')).length;
  const translationShare = forms.length ? dotted / forms.length : 0;
  const byDots = per10k >= DOT_PER10K;
  const byNames = translationShare >= DOT_NAME_SHARE;
  const theory = !!isTheory;
  return {
    isTheory: theory,
    /* 理论类**压过**量出来的判据：那两条量的都是"人名怎么写"，而本书压根没有人名节点。
     * 不压的话，`isTranslation` 会因正文里的西方人名而变 true，报告会说"它是译本" ——
     * 结论碰巧一样（两条都跳过），**理由却是错的**，而错的理由比没理由更坏。 */
    isTranslation: !theory && (byDots || byNames),
    byDots,
    byNames,
    translationShare,
    dotCount,
    per10k,
    nameCount: forms.length,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 规则二：间隔号全名（**译本**那条线，v0.190）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么必须有第二条规则
 *
 * 规则一是 `[百家姓][汉字]{1,2}` —— 一个**中文姓名模型**，它假定"第 1 个字是姓"。
 * 译本人名不满足这个假定，两条路同时被堵死：
 *
 *   · `佩德罗妮拉·伊瓜兰`：首字「佩」不是百家姓 ⇒ 规则一**锚都锚不上**；
 *     唯一锚得上的片段是 `伊瓜兰`（「伊」是百家姓），而它**恰好是已知名
 *     `乌尔苏拉·伊瓜兰` 的子串** ⇒ 被"已知名字的片段一律不算"那条过滤掉。
 *   · `奥雷里亚诺·阿尔卡蒂奥·布恩迪亚`：奥 / 阿 / 布**一个都不是百家姓** ⇒ 规则一完全看不见。
 *
 * 《百年孤独》里乌尔苏拉的**外祖母、父亲、表兄、曾外祖父**全在建档，
 * 唯独**母亲** `佩德罗妮拉·伊瓜兰` 不在 —— 这正是规则一漏掉的形状。
 *
 * ## 判据：间隔号就是译本名字的形态学标记
 *
 * 译本全名是 `名·父名·姓`，`·` 是**唯一**可靠的锚点，所以规则二直接找 `·`。
 *
 * ## ⚠ 为什么是"枚举 + 计数"，而不是一条正则
 *
 * 第一版写成 `[\u4e00-\u9fa5]{2,}·[\u4e00-\u9fa5]{2,}`，实测**完全不可用**：
 * 正则的左段会贪婪地吃掉前面的叙述文字，同一名字在不同上下文里得到**不同**的串 ——
 *
 *     她曾祖母佩德罗妮拉·伊瓜兰      /      会遇见佩德罗妮拉·伊瓜兰
 *
 * ⇒ 两个串各出现 1 次，**双双被 min 门槛挡掉**（而这个名字真实出现 2 次）。
 * 右段同样会被吃掉（`奥雷里亚诺·特里斯特说` 的右段成了「特里斯特说」）。
 *
 * 改成：在每个 `·` 处枚举「左侧 ≤LMAX 字的后缀 × 右侧 ≤RMAX 字的前缀」，
 * **顺带精确计数**（单遍，不必对每个候选重扫全文 —— 每个 `L·R` 的出现
 * 恰好对应一个 `·` 位置），保留所有过门槛的候选，再**只留"最大"的那些**
 * （是另一个候选的真子串的一律丢掉）。
 *
 * 两处细节都是实测逼出来的：
 *
 *   · **右段必须允许再跨间隔号**。否则 `奥雷里亚诺·阿尔卡蒂奥·布恩迪亚`
 *     只会被切成 `奥雷里亚诺·阿尔卡蒂奥` 和 `阿尔卡蒂奥·布恩迪亚` 两截，
 *     而 `阿尔卡蒂奥` 本身是已知人物 ⇒ 两截都被"某一段是已知名字"剔掉，
 *     **整个人从清单里消失**（用户点名的第二个名字就是这么丢的）。
 *     ⚠ 实测口径：把 `INTERP_RSEGS` 改成 **0** ⇒ 这个人真的消失（守卫红 4 条）。
 *       改成 **1** 则与 2 **在三本书上完全一样（12 / 10 / 0，逐条同名）** ——
 *       承重的是"能跨 ≥1 个"，`2` 只是给 4 段名字（`A·B·C·D`）留的余量，
 *       目前**没有任何一本书**用到它。写在这里，免得下次有人以为它是实测调出来的。
 *   · **不能在每个 `·` 处只挑一个**。挑一个会把 `何塞·拉克尔·蒙卡达`
 *     拆成 `何塞·拉克尔`(7) + `拉克尔·蒙卡达`(6) —— 同一个人的两条。
 *     改成"全留 + 去子串"之后归一成 `何塞·拉克尔·蒙卡达` 一条。
 *
 * ## 实测（v0.190，三本书正文）
 *
 *   《三国演义》 正文里 `·` **0 个** ⇒ 规则二在中文原著上**零候选、零误报**（它本就不管中文名）。
 *   《百年孤独》 待判 10 条，含用户点名的 `佩德罗妮拉·伊瓜兰`。
 *   《罪与罚》   待判 8 条（`阿法纳西·伊凡诺维奇·瓦赫鲁兴`、`拉维扎·伊凡诺芙娜`…）。
 *
 * ## ⚠ 它报出来的**不全是"漏掉的人"** —— 三类必须分开判
 *
 *   · **真漏人** ⇒ 建节点（`佩德罗妮拉·伊瓜兰`）
 *   · 已知人物的**另一个写法**（全名 / 教名+父名）⇒ 补别名，**别**建节点
 *   · **现实世界的人**（`弗朗西斯·德雷克`、`约翰·弥尔顿`）与**附录里被提到的人**
 *     （`加西亚·马尔克斯`、`胡里奥·科塔萨尔`）⇒ **不是这本书的人物** ⇒ 写进 `missing-ok.json`
 *     （那份台账的语义是"这个字符串不该建档"，与"它不是人名"并不冲突）
 *
 * ⚠ 顺带测出来的第二件事：`mainTextOnly()` 只认"回目标题"，
 *   译本切不出回 ⇒ **附录（译后记 / 序）会被当成正文一起扫**，
 *   `加西亚·马尔克斯`、`阿莱霍·卡彭铁尔` 这类附录人名就混进了候选，
 *   加不加 `--with-appendix` 没有区别（本来就切不开）。
 *   这是 v0.184 给三国修过的同一类问题，在译本上还留着（见 CHANGELOG v0.190）。
 *
 * ## ⚠ 已知局限：**只出现 1 次的名字可能被它的短形挤掉**
 *
 * 用户点名的第二个例子 `奥雷里亚诺·阿尔卡蒂奥·布恩迪亚`（乌尔苏拉的曾外祖父，
 * 只在第 17 章出现 1 次）规则二**报不出来**，原因有两层，都不是 bug 而是取舍：
 *
 *   ① 它只出现 1 次 ⇒ 默认门槛（≥2）本来就挡住它（`--min 1` 才可见，报 37 条）；
 *   ② 更硬的一层：在它那个 `·` 处，短形 `奥雷里亚诺·阿尔卡蒂奥` 出现 2 次、
 *      长形只 1 次 ⇒ "次数最多"挑中的是短形，而短形两段里夹着已知人物 `阿尔卡蒂奥`
 *      ⇒ 被当碎片丢掉。**长形从没被选中过。**
 *      试过"顺带保留最长形"来救它，低频档立刻从 37 条涨到 978 条（全是
 *      `栗树下何塞·阿尔卡蒂奥·布恩迪亚的鬼魂` 这类叙述包名字的串）⇒ **回退了**。
 *
 * ⇒ 这一类（**一次提及 + 名字与已知人物撞段**）规则二抓不到，**得靠人读**。
 *   规则二的价值是"把 37 条（而不是 3000 条）摊到人面前"，不是"一条不漏"。
 */

/** 间隔号候选左段上限（字）。译本的教名极少超过 5 字（佩德罗妮拉 / 特兰奇丽娜 / 奥雷里亚诺）。 */
export const INTERP_LMAX = 5;
/** 右段上限（汉字数，含跨间隔号的各段）。要容得下 `阿尔卡蒂奥·布恩迪亚`(9 字) 这种两段姓。 */
export const INTERP_RMAX = 12;
const INTERP_LMIN = 2;
const INTERP_RMIN = 2;
/** 右段最多再跨几个间隔号（1 = `A·B`，2 = `A·B·C`）。 */
const INTERP_RSEGS = 2;
/** 「已知名 + 头衔」判定：摘掉已知名后残渣不超过这么多字的，算头衔而不是构词（见 ③）。 */
const TITLE_SLACK = 3;

const isCJK = (ch) => !!ch && /[\u4e00-\u9fa5]/.test(ch);
const cjkLen = (s) => [...s].filter(isCJK).length;

/**
 * `·` 右侧的前缀候选。允许再跨最多 `INTERP_RSEGS` 个间隔号
 * （`布恩迪亚` / `阿尔卡蒂奥·布恩迪亚` 都要能生成），总汉字数不超过 `INTERP_RMAX`。
 */
function rightPrefixes(text, from) {
  const out = [];
  let buf = '';
  let segs = 0;
  for (let p = from; p < text.length; p++) {
    const ch = text[p];
    if (isCJK(ch)) buf += ch;
    else if (ch === '·' && segs < INTERP_RSEGS) { segs++; buf += '·'; }
    else break;                                  // 标点/〇/空白/超出段数 ⇒ 名字到此为止
    const n = cjkLen(buf);
    if (n > INTERP_RMAX) break;
    if (!buf.endsWith('·') && n >= INTERP_RMIN) out.push(buf);
  }
  return out;
}

/** 取某个串首次出现的上下文片段（给人判"这是不是个人"用）。 */
function firstSnippet(text, name, span = 30) {
  const i = text.indexOf(name);
  if (i < 0) return '';
  return text.slice(Math.max(0, i - span), i + name.length + span).replace(/\s+/g, ' ');
}

/**
 * 出一份"间隔号全名"候选报告。**纯函数**：只吃文本与名字，不碰文件系统。
 *
 * @param {object} o
 * @param {string} o.raw       原著正文（**必须保留间隔号**；`flatSource()` 会把 `·` 删掉，不能用它）
 * @param {string[]} o.names   数据里的已知名字
 * @param {Set<string>} [o.okSet] 台账里已判过"不该建档"的串
 * @param {number} [o.min]     出现次数门槛
 * @param {number} [o.topN]    显示窗口；≤0 = 不截断
 * @returns {{known:number, rawCount:number, judgedDropped:number, total:number,
 *            shown:number, truncated:boolean, rows:Array}}
 */
export function buildInterpReport({ raw, names, okSet = new Set(), min = MIN, topN = TOP_N }) {
  const text = String(raw || '');
  const list = knownForms(names);
  const knownNorm = new Set(list.map(norm));

  /* ① 单遍：每个 `·` 处枚举 (左后缀 × 右前缀)，**顺带精确计数**。 */
  const count = new Map();
  const dots = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '·') continue;
    const Ls = [];
    for (let k = INTERP_LMIN; k <= INTERP_LMAX; k++) {
      const s = text.slice(i - k, i);
      if (s.length === k && [...s].every(isCJK)) Ls.push(s);
    }
    const Rs = rightPrefixes(text, i + 1);
    if (!Ls.length || !Rs.length) continue;      // 紧挨着非汉字（含 〇）⇒ 不是完整的名字
    dots.push({ i, Ls, Rs });
    for (const L of Ls) for (const R of Rs) {
      const key = `${L}·${R}`;
      count.set(key, (count.get(key) || 0) + 1);
    }
  }

  /* ② 每个 `·` 处挑「出现次数最多、并列取最长」的那一个当规范形。
   *
   *    ⚠ 这一步**不能省**。试过"把所有过门槛的 L·R 都留下"，实测从 11 条炸到 115 条 ——
   *      右段会带上紧随其后的叙述（`尔卡蒂奥·布恩迪亚不`、`捷莉娜·伊凡诺芙娜叫道`），
   *      而每个 `·` 处能生出几十个这样的变体，个个都"出现过 ≥2 次"。
   *      挑一个之后，同一名字的多次出现会归一成**同一个**串（这才是能过门槛的原因）。
   *
   *    ⚠ 也试过"顺带把**最长**那个也留下"，同样炸：低频档从 37 条涨到 **978 条**
   *      （`栗树下何塞·阿尔卡蒂奥·布恩迪亚的鬼魂`、`怕卡捷莉娜·伊凡诺芙娜` 这类
   *      "叙述+名字+叙述"的串），主清单也从 12 条涨到 15 条。**已回退。**
   *      代价写在文件头：**只出现 1 次的名字可能被它的短形挤掉**（见 §局限）。
   */
  const picked = new Map();
  for (const { i, Ls, Rs } of dots) {
    let best = null;
    for (const L of Ls) for (const R of Rs) {
      const key = `${L}·${R}`;
      const c = count.get(key);
      if (!best || c > best.c || (c === best.c && key.length > best.key.length)) best = { key, c };
    }
    const rLen = best.key.length - best.key.indexOf('·') - 1;
    if (!picked.has(best.key)) picked.set(best.key, { n: 0, intoKnown: text.slice(i + 1 + rLen).startsWith('·〇') });
    picked.get(best.key).n++;
  }

  /* ③ 质量筛 —— 三类"是已知人物的另一个写法"必须先剔掉，否则清单被它们淹掉。
   *    （实测《罪与罚》不过这一关时，前两名是 `罗季昂·罗曼内奇×60`、`索菲雅·谢敏诺芙娜×16`，
   *      两个都是**已知人物的教名+父名**，不是新的人。）
   *
   *    ⚠ 判据只能**单向**：**候选是已知名字的子串** ⇒ 是它的碎片，丢。
   *      **反过来**（候选里含着一个已知名字）**默认不能丢** —— 这本书的核心就是**复合同名**：
   *      `奥雷里亚诺·阿尔卡蒂奥·布恩迪亚`（乌尔苏拉的曾外祖父）里含已知名 `阿尔卡蒂奥`，
   *      而它是**另一个人**。第一版写成双向包含，于是这个人从清单里凭空消失 ——
   *      正是用户点名问的那一个。
   *
   *    ⚠ 但"含已知名"里有一类**必须**丢：**已知名 + 官职/称谓**
   *      （`阿利黎奥·诺格拉医生` = 已知的 `阿利黎奥·诺格拉` + 「医生」）。
   *      区分办法是**看剩下多少**：把已知名摘掉后残渣 ≤ `TITLE_SLACK` 字的，是"名字+头衔"；
   *      `奥雷里亚诺·阿尔卡蒂奥·布恩迪亚` 摘掉 `阿尔卡蒂奥` 还剩 10 字 ⇒ 是构词，不是头衔。
   */
  const survivors = [];
  for (const [name, v] of picked) {
    if (name.includes('〇')) continue;                                   // 命中已知名字的残留
    if (v.intoKnown) continue;                                           // 尾巴接已知名字 ⇒ 是它的前半截
    const segs = name.split('·');
    if (segs.length <= 2 && segs.some((seg) => knownNorm.has(norm(seg)))) continue; // 两段里夹一个已知名 ⇒ 碎片
    if (list.some((x) => x.includes(name))) continue;                    // 候选是已知名字的子串 ⇒ 碎片
    if (list.some((x) => name.includes(x) && name.length - x.length <= TITLE_SLACK)) continue; // 已知名+头衔
    survivors.push({ name, count: v.n });
  }

  /* ④ 门槛 → **只留最大** → 台账扣除 → 排序 → 显示截断
   *    "只留最大"放在**过门槛之后**：否则一个只出现 1 次的长串会把出现 5 次的短串
   *    （同一个人的常见写法）挤掉，然后自己又过不了门槛 —— 两条都丢。 */
  const passing = survivors.filter((x) => x.count >= min);
  const lowFreq = survivors.length - passing.length;
  const maximal = passing.filter((x) => !passing.some((y) => y !== x && y.name.includes(x.name)));
  const rawCount = maximal.length;
  const afterJudged = maximal.filter((x) => !okSet.has(x.name));
  const judgedDropped = rawCount - afterJudged.length;
  afterJudged.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
  const rows = afterJudged.map((x) => ({ ...x, snippet: firstSnippet(text, x.name) }));
  const shown = topN > 0 ? rows.slice(0, topN) : rows;

  return {
    known: list.length,
    rawCount,
    judgedDropped,
    total: afterJudged.length,
    lowFreq,
    shown: shown.length,
    truncated: rows.length > shown.length,
    rows: shown,
  };
}

/**
 * 渲染"间隔号全名"小节（**纯函数**）。不收 topN，理由同 `renderGapReport`。
 *
 * @param {ReturnType<typeof buildInterpReport>} r
 * @param {object} [o]
 * @param {string} [o.slug] @param {number} [o.min] @param {string} [o.okLabel]
 */
export function renderInterpReport(r, o = {}) {
  const { slug = '', min = MIN, okLabel = '', script = null } = o;
  const L = [];
  /* ⚠ 同 `renderGapReport`：`r === null` = 这本书不该走这条规则（中文原著）。
   *   必须**明说**，理由同上 —— 静默少一节会被读成"这条规则没意见"。 */
  if (!r) {
    L.push(`=== ${slug} · 规则二：间隔号全名 ===`);
    /* ⚠ v0.206：同 `renderGapReport`，理论类与译本要分开说（理由见那里的注释）。 */
    if (script && script.isTheory) {
      L.push('  ⚠ **本规则（间隔号全名）不适用于本书** —— 它是**理论类**，'
        + '节点是**概念/术语**，不是人名。');
      L.push(`     判据（按原著正文算）：正文里「·」密度 **${script.per10k.toFixed(1)} 个/万字**`
        + `（门槛 ≥${DOT_PER10K}）；已知名字里含「·」的占 **${(script.translationShare * 100).toFixed(1)}%**`
        + `（门槛 ≥${(DOT_NAME_SHARE * 100).toFixed(0)}%）。`);
      L.push('     ⚠ 正文里的间隔号来自**书中引用的西方人名**（史蒂夫·法隆、比尔·蔡斯…），'
        + '那些人是**案例里的主角**，不是这本书的节点 —— 它们进 `events[].summary` 的叙述，不建节点。');
      L.push('  ⇒ 已**跳过**（本规则在理论类上只会产出"本来就不该建节点"的候选，'
        + '**一个假信号源比没有更坏**）。');
      L.push('  ⇒ 本书该走的是 `--names`：核**概念名**在原文里搜不搜得到。');
      return L;
    }
    L.push('  ⚠ **本规则（间隔号全名）不适用于本书** —— 它是**中文原著**，人名不带间隔号。');
    if (script) {
      L.push(`     判据（按原著正文算）：正文里「·」密度 **${script.per10k.toFixed(1)} 个/万字**`
        + `（门槛 ≥${DOT_PER10K}）；已知名字里含「·」的占 **${(script.translationShare * 100).toFixed(1)}%**`
        + `（门槛 ≥${(DOT_NAME_SHARE * 100).toFixed(0)}%）。`);
    }
    L.push('  ⇒ 已**跳过**（它在中文原著上本来就该报 0 条），本书走上面的**规则一（姓氏 + 1~2 字）**。');
    return L;
  }
  L.push(`=== ${slug} · 规则二：间隔号全名（译本那条线）===`);
  L.push(`  数据里已知 ${r.known} 个名字；原文里扫出 ${r.rawCount} 个带间隔号的全名候选`
    + `（出现 ≥${min} 次，且不与任何已知名字互为子串）`);
  if (r.judgedDropped) {
    L.push(`  · 已扣掉台账里判过"不该建档"的 ${r.judgedDropped} 条${okLabel ? `（${okLabel}）` : ''}`
      + ` ⇒ **待判 ${r.total} 条**`);
  } else {
    L.push(`  · 台账里没有判过的条目 ⇒ **待判 ${r.total} 条**`);
  }
  if (!r.total) {
    L.push('  （没有候选）');
  } else {
    L.push(`  · 本页显示 ${r.shown} 条`);
    if (r.truncated) {
      L.push(`  ⚠ 还有 ${r.total - r.shown} 条**没有显示** —— 加 --top N 调大，--top 0 全列。`);
    }
    L.push('');
    for (const x of r.rows) {
      L.push(`  ${String(x.count).padStart(4)}×  ${x.name}`);
      if (x.snippet) L.push(`         …${x.snippet}…`);
    }
    L.push('');
    L.push(`  **判之前先分三类**（判错类别比漏判更坏）：`);
    L.push('    ① 真漏掉的人 ⇒ 建节点；');
    L.push('    ② 已知人物的另一个写法（全名 / 教名+父名）⇒ 补别名，**别**建节点；');
    L.push(`    ③ 现实世界的人或附录里被提到的作者/译者 ⇒ 不是这本书的人物，写进 ${okLabel || `data/${slug}.missing-ok.json`}`);
  }
  /* ⚠ 只被提到一次的人（乌尔苏拉的曾外祖父就是）**永远过不了默认门槛**，
   *   这一行是为了让人知道"还有一档"，而不是以为"清单已经空了"。 */
  if (r.lowFreq) {
    L.push(`  ⚠ 另有 **${r.lowFreq} 条只出现 1 次**的候选没有列出（默认门槛 ${min}）。`
      + '**只被提到一次的人只在这一档里** —— 加 `--min 1` 全列。');
  }
  /* ⚠ 这一行**分两种口径**（v0.192）：译本上本节是**主线**，中文原著上它"本来就该报 0 条"。
   *   混着写会误导 —— 在译本上告诉人"这条规则本该报 0 条"是错的（用户 v0.192 的指正）。 */
  if (script && script.isTranslation) {
    L.push(`  ⚠ 这本书**是译本**（正文「·」密度 ${script.per10k.toFixed(1)} 个/万字）⇒ 本节是**主线**；`
      + '上面那份「姓氏」清单已按规则跳过（姓氏规则在译本上判别力很低）。');
  } else {
    L.push('  ⚠ 规则二只认间隔号 ⇒ 中文原著上它**本来就该**报 0 条（三国正文 `·` 数为 0）。');
  }
  L.push('    译本若仍有漏人，大概率是**同一个人的名字被拆成两个候选**（如 何塞·拉克尔 / 拉克尔·蒙卡达），');
  L.push('    按人合并后再判。');
  return L;
}
