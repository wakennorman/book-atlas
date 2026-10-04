#!/usr/bin/env node
/**
 * 对着**原著正文**核一遍人物/地点/名字（规程 §零 第③步的工具）
 *
 * `audit-search.mjs` 扫的是本项目自己的文案（事件、关系小事件、人物档案）——
 * 也就是说它只能发现"**我们自己写的字里**提到了谁"，看不到原著正文里提到谁。
 * 所以它查不出用户已经抓到的那类缺口：
 * 「布鲁诺·克雷斯皮和安帕萝·摩斯科特结了婚」这种只出现在原著里、
 * 我们压根没收录的人，audit-search 永远看不到。
 *
 * 这个脚本补的就是这一环：拿原著正文（`scripts/extract-epub.mjs` 抽出来的 txt）
 * 对着数据核一遍，输出**缺口清单 + 出现次数 + 首现行原文片段**，供人工逐条确认。
 *
 * 用法：
 *   node scripts/audit-against-text.mjs data/one-hundred-years-of-solitude.json 原文.txt
 *   node scripts/audit-against-text.mjs --all .text/            # 目录里每本书的同名 .txt
 *   … --min 3            # 只报出现 ≥3 次的（默认 2）
 *   … --json             # 机器可读（给后续批处理用）
 *
 * 为什么要有 `--known-missing` 忽略名单：
 *   缺口清单会**反复**跑。人工确认过"这个确实是噪声/确实不必建档"的名字，
 *   写进 data/<slug>.missing-ok.json，下次就不会再冒出来 ——
 *   否则每次跑都要重新判一遍同样的 200 条，工具很快就会被弃用。
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const minIdx = argv.indexOf('--min');
const MIN = minIdx >= 0 ? Number(argv[minIdx + 1] || 2) : 2;
const topIdx = argv.indexOf('--top');
const topN = topIdx >= 0 ? Number(argv[topIdx + 1] || 60) : 60;
/** 「出现在已知人物 ±NEAR 字之内」才算人名 —— 人是**在别人的上下文里**被提到的 */
const NEAR = 90;
const all = argv.includes('--all');
const textDirIdx = argv.indexOf('--all');
const dir = textDirIdx >= 0 ? argv[textDirIdx + 1] || '.text' : '';

/* 与 audit-search.mjs 同一份百家姓（那边是内联的，这里刻意保持一致：
 * 两边用不同表 ⇒ 同一本书两次扫描结果对不上，缺口清单就没法当基线用）*/
const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫房裘缪解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊甄曲封芮储靳段富巫乌焦巴弓牧山谷车侯全班秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩聂晁勾敖融冷訾辛阚那简饶空曾毋沙养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公';

/* 官职/称谓/非人名尾字：挡掉"都尉""魏将""将军""从之"这类噪音 */
/**
 * 官职/称谓/常用词：挡掉"都尉""魏将""那样""任何人""秋海棠"这类噪音。
 *
 * ⚠ 这份 STOP 表是**实测调出来的**，不是想出来的：
 *   "姓氏+1~2字"这个规则会把几乎所有以姓氏字开头的常用词都捞进来
 *   （吉卜赛、时间、任何、那样、相反、房子、明白、幸福、支持……）。
 *   一开始只按 `audit-search.mjs` 那份表挡，扫出 822 条候选、真正的人名只占个位数；
 *   把实测出现过的噪声词逐个补进来之后才降到可读。
 *   **新增任何一本书，都应该把它的噪声词补进这张表**（补进来的都是实测值，不是猜测）。
 */
const STOP = /^(将军|校尉|都尉|从事|太守|刺史|丞相|主簿|司马|都督|长史|尚书|侍郎|中郎|上将|先锋|大帅|军师|谋士|文官|武官|将领|大王|主公|夫人|太后|皇后|贵妃|太子|王子|先主|后主|魏主|吴主|汉主|魏将|吴将|蜀将|汉将|众将|诸将|二将|三将|四将|大将|小将|名将|老将|女将|叔叔|舅舅|哥哥|姐姐|弟弟|妹妹|爷爷|奶奶|父亲|母亲|儿子|女儿|大哥|大姐|小弟|小妹|自己|别人|众人|二人|三人|四人|东西|那天|次日|当时|后来|如今|于是|因此|自从|然后|忽然|仍然|仍旧|已经|曾经|可以|没有|知道|看见|听见|回答|说道|笑道|想道|问道|答道|葫芦|流水|马匹|树木|房屋|石头|泥土|消息|道理|名字|声音|模样|时候|地方|周围|里面|外面|上面|下面|前面|后面|中间|旁边|对面|远处|近处|处处|人人|个个|件件|声声|步步|字字|吉卜赛|时间|那样|任何|秋海棠|那一|平静|相反|习惯|那天|房子|那时|金鱼|那么|游戏|幸福|印象|明白|房门|那个|支持|段时|印第安|巴旦杏|古钢琴|鲁塞尔|越来越|相信|游荡|马戏团|成一|时间一|羊皮卷|范晔|关系|时刻|空间|危险|能力|方法|空气|安宁|麻烦|满足|花园|解决|关联|黄昏|纪年|谈话|支持|注解|童年|寿衣|越山|武装|时光|岁月|方法|讲解|加入|金刚|双眼|金币|时分|于衷|曾祖父|计划|个人|今日|上古|下达|单独|里斯本|列斯|野史|史|界|术|科|郎|球|团|圣|悲|桑|波|亚|莎|蜜|雪|丹|富|卓|洪|黎|聪|肃|祥|禄|秉|祥|袁|凤|翔|鹊|瑾|瑜|昶|霄|漳|麟|铖)/;

const norm = (s) => String(s || '').replace(/[\s·・．.,，。、"'“”‘’()（）]/g, '').toLowerCase();

/** 助词/连词：候选紧跟在这些字后面，多半是切歪了（"在某处安东尼奥"里的"在某处"） */
const PARTICLE = /[的了在和与并及而就都也很还只把被让给对着向往从到]/;

/** 剥掉 HTML 标签与常见实体（extract-epub.mjs 通常已经剥过，这里再兜一层） */
function plain(t) {
  return String(t || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '');
}

function audit(bookFile, textFile) {
  const book = JSON.parse(fs.readFileSync(bookFile, 'utf8'));
  const raw = plain(fs.readFileSync(textFile, 'utf8'));
  const okFile = bookFile.replace(/\.json$/, '.missing-ok.json');
  const okSet = new Set(fs.existsSync(okFile) ? JSON.parse(fs.readFileSync(okFile, 'utf8')) : []);

  const chars = book.characters || [];
  const places = book.places || [];

  // 已知名字（长名优先替换，避免「何塞」把「何塞·阿尔卡蒂奥」先吃掉）
  const names = [];
  for (const c of chars) for (const n of [c.name, ...(c.aliases || []), ...(c.altNames || [])]) if (n && n.length >= 2) names.push(n);
  for (const p of places) for (const n of [p.name, ...(p.aliases || [])]) if (n && n.length >= 2) names.push(n);
  names.sort((a, b) => b.length - a.length);
  const knownNorm = new Set(names.map(norm));

  // 逐个把已知名字替换成〇
  let masked = raw;
  for (const n of names) masked = masked.split(n).join('〇');
  // 已知名字在**原文**里的所有位置（用来判断候选是否"出现在别人的上下文里"）
  const knownSpans = [];
  for (const n of names) {
    let i = raw.indexOf(n);
    while (i >= 0) { knownSpans.push([i, i + n.length]); i = raw.indexOf(n, i + 1); }
  }
  knownSpans.sort((a, b) => a[0] - b[0]);
  /** 候选附近（±NEAR 字）有没有已知人物 —— 这是"这是个人名"最强的信号 */
  const nearKnown = (at) => {
    for (let k = knownSpans.length - 1; k >= 0; k--) {
      const [s, e] = knownSpans[k];
      if (e < at - NEAR) break;
      if (!(e < at - NEAR || s > at + NEAR)) return true;
    }
    return false;
  };

  // 扫"姓氏 + 1~2 字"
  const surnameRe = new RegExp(`[${SURNAMES}][\\u4e00-\\u9fa5]{1,2}`, 'g');
  const cand = new Map();
  for (const m of masked.matchAll(surnameRe)) {
    const name = m[0];
    if (name.includes('〇')) continue;                     // 命中已知名字的残留
    if (knownNorm.has(norm(name))) continue;
    if (names.some((n) => n.includes(name) || name.includes(n))) continue;
    if (STOP.test(name)) continue;
    if (/[的地得了着是不在有和与及然后里上下之就都也很还只把被让给对着向往从向往]/.test(name)) continue;
    if (!cand.has(name)) cand.set(name, { n: 0, at: m.index, near: 0 });
    const c = cand.get(name);
    c.n++;
    if (nearKnown(m.index)) c.near++;                     // 有多少次是"出现在已知人物旁边"
  }

  const rows = [...cand.entries()]
    .filter(([name, v]) => v.n >= MIN && v.near > 0 && !okSet.has(name))
    .map(([name, v]) => {
      // 优先给"出现在已知人物旁边"的那次出现当片段
      let ctx = '';
      let i = raw.indexOf(name);
      while (i >= 0) { if (nearKnown(i)) break; i = raw.indexOf(name, i + 1); }
      if (i >= 0) ctx = raw.slice(Math.max(0, i - 30), i + name.length + 36).replace(/\s+/g, ' ');
      return { name, count: v.n, near: v.near, snippet: ctx };
    })
    .sort((a, b) => (b.near - a.near) || (b.count - a.count))
    .slice(0, topN)
    .filter((x) => {
      /* 过滤掉明显是**词的一部分**而不是人名的：
       * 看首现片段——如果候选紧跟在另一个词后面（原文是"…在某处安东尼奥·伊莎贝尔神甫…"），
       * 或者片段里候选前面那个字本身是常用字，就多半是切歪了。
       * 代价：漏掉一些真候选，但留下的精度高得多，人工看得完。 */
      const s = x.snippet;
      if (!s) return true;
      const i = s.indexOf(x.name);
      if (i < 0) return true;
      const prev = s[i - 1];
      // 「安东尼奥」这种前面直接是句首/标点 ⇒ 很像人名
      if (!prev) return true;
      return !PARTICLE.test(prev);
    });

  return { slug: (book.meta || {}).slug || path.basename(bookFile, '.json'), total: names.length, rows };
}

/* ---------- 主流程 ---------- */
const pairs = [];
if (all) {
  const dataDir = path.join(process.cwd(), 'data');
  const idx = JSON.parse(fs.readFileSync(path.join(dataDir, 'books.json'), 'utf8'));
  for (const b of idx.books || []) {
    const bf = path.join(dataDir, `${b.slug}.json`);
    const tf = path.join(dir, `${b.slug}.txt`);
    if (fs.existsSync(bf) && fs.existsSync(tf)) pairs.push([bf, tf]);
    else console.error(`  (跳过 ${b.slug}：${fs.existsSync(bf) ? '缺 ' + tf : '缺 ' + bf})`);
  }
} else {
  const pos = argv.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a) && a !== dir);
  if (pos.length < 2) {
    console.error('用法：node scripts/audit-against-text.mjs data/xx.json 原文.txt [--min N] [--json]');
    console.error('  或：node scripts/audit-against-text.mjs --all .text/   # 每本书配 data/<slug>.txt');
    process.exit(1);
  }
  pairs.push([pos[0], pos[1]]);
}

const report = pairs.map(([bf, tf]) => audit(bf, tf));
if (asJson) { console.log(JSON.stringify(report, null, 1)); process.exit(0); }

for (const r of report) {
  console.log(`\n=== ${r.slug} ===`);
  console.log(`  数据里已知 ${r.total} 个名字；原著正文里扫出 ${r.rows.length} 个疑似漏人`);
  console.log(`  （门槛：出现 ≥${MIN} 次，且**至少一次出现在已知人物 ±${NEAR} 字之内**）\n`);
  if (!r.rows.length) { console.log('  （没有候选）'); continue; }
  for (const x of r.rows) {
    console.log(`  ${String(x.count).padStart(4)}×（其中 ${String(x.near).padStart(3)} 次在已知人物旁）  ${x.name}`);
    if (x.snippet) console.log(`         …${x.snippet}…`);
  }
  console.log(`\n  确认过"确实是噪声/不必建档"的，写进 data/${r.slug}.missing-ok.json（一行一个名字），下次不再报。`);
}