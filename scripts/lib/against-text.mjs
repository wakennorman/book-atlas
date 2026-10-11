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
  const list = [...new Set((names || []).filter((n) => n && n.length >= 2))];
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
  const { slug = '', min = MIN, near = NEAR, okLabel = '' } = o;
  const L = [];
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
  /* ⚠ 常驻提示，不是可选项：译本上这条规则的判别力**实测很低**，
   *   不写清楚，人会把"280 条候选"当成"280 个漏掉的人"。详见本文件头。 */
  L.push('  ⚠ 这条规则（姓氏+1~2 字）在**译本**上判别力很低：译本人名多带间隔号'
    + '（罗季昂·罗曼内奇），姓氏规则基本抓不到，报出来的一多半是跨词碎片。'
    + '译本请以 `--names`（数据里的名字在原文里搜不搜得到）为主。');
  return L;
}
