#!/usr/bin/env node
/**
 * 搜索命中率审计（每本书整理完的收尾必跑）
 *
 * 查四件事：
 *   ① 别名覆盖率：有关系但没别名的"主要人物"（读者按字号/简称/译名搜都搜不到）
 *   ② 译名变体：同一人物在不同译本里的写法（内置音译差异表，缺的可以 --write 自动补）
 *   ③ 疑似漏人：全书文案里出现的"姓氏+1~2字"人名，但书里没有这个人物（按出现次数排序，人工确认）
 *   ④ 同名重复：去掉括号补充后名字相同的多个人物（可能是同一人被拆成两条，也可能是真重名）
 *
 * 用法：
 *   node scripts/audit-search.mjs --all                 # 只报告
 *   node scripts/audit-search.mjs --all --write         # 自动补「译名变体」别名（其余只报告）
 *   node scripts/audit-search.mjs data/xx.json --cand 80
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const candIdx = argv.indexOf('--cand');
const candLimit = candIdx >= 0 ? Number(argv[candIdx + 1] || 60) : 60;
const files = argv.includes('--all')
  ? fs.readdirSync(path.join(process.cwd(), 'data')).filter((f) => f.endsWith('.json') && f !== 'books.json' && !f.startsWith('.')).map((f) => path.join(process.cwd(), 'data', f))
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

/* 常见姓氏（用于"疑似漏人"扫描）*/
const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫房裘缪解应宗丁宣邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊甄曲封芮储靳段富巫乌焦巴弓牧山谷车侯全班秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩聂晁勾敖融冷訾辛阚那简饶空曾毋沙养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公';

const baseName = (s) => String(s || '').replace(/[（(].*$/, '').trim();
const norm = (s) => String(s || '').replace(/[\s　·・．.\-—_、,，]/g, '').trim();

for (const file of files) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chars = book.characters || [];
  const rels = book.relations || [];
  const byId = new Map(chars.map((c) => [c.id, c]));
  const deg = new Map();
  for (const r of rels) { deg.set(r.from, (deg.get(r.from) || 0) + 1); deg.set(r.to, (deg.get(r.to) || 0) + 1); }

  /* 全书文案（用于漏人扫描）*/
  const texts = [];
  for (const e of book.events || []) texts.push(`${e.name} ${e.summary || ''} ${e.impact || ''}`);
  for (const r of rels) for (const ev of r.events || []) texts.push(ev.text || '');
  for (const c of chars) texts.push(`${c.desc || ''} ${c.fate || ''} ${c.title || ''} ${(c.aliases || []).join(' ')}`);
  for (const p of book.places || []) texts.push(`${p.name} ${p.desc || ''} ${(p.aliases || []).join(' ')}`);
  const allText = texts.join('\n');

  /* ③ 疑似漏人：先剔掉已知名字（长名优先），再按"姓氏+1~2字"扫 */
  let stripped = allText;
  const known = new Set();
  const allNames = [];
  for (const c of chars) for (const n of [c.name, ...(c.aliases || [])]) if (n && n.length >= 2) allNames.push(n);
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
  const candTop = [...cand.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, candLimit);

  /* ② 译名变体：名字/别名里有 A 形式但缺 B 形式 */
  const missingVariants = [];
  for (const c of chars) {
    const pool = [c.name, ...(c.aliases || [])].join('|');
    for (const [a, b] of VARIANT_PAIRS) {
      if (a === b) continue;
      if (pool.includes(a) && !pool.includes(b)) {
        const variant = c.name.includes(a) ? c.name.replace(a, b) : (c.aliases || []).find((x) => x.includes(a))?.replace(a, b);
        if (variant && !pool.includes(variant)) missingVariants.push({ c, variant, pair: [a, b] });
      }
    }
  }

  /* ④ 同名重复（去括号）*/
  const byBase = new Map();
  for (const c of chars) { const k = baseName(c.name); byBase.set(k, [...(byBase.get(k) || []), c]); }
  const dupes = [...byBase.entries()].filter(([, v]) => v.length > 1);

  /* ① 别名覆盖：有关系、却没别名的"主要人物" */
  const noAlias = chars
    .filter((c) => !(c.aliases || []).length && (deg.get(c.id) || 0) >= 3)
    .sort((a, b) => (deg.get(b.id) || 0) - (deg.get(a.id) || 0));

  console.log(`\n▶ ${path.basename(file)}（${chars.length} 人 / ${rels.length} 关系）`);
  console.log(`  ① 主要人物但没别名：${noAlias.length} 人` + (noAlias.length ? ` → ${noAlias.slice(0, 12).map((c) => `${c.name}(${deg.get(c.id)})`).join('、')}${noAlias.length > 12 ? ' …' : ''}` : ''));
  console.log(`  ② 缺译名变体：${missingVariants.length} 处` + (missingVariants.length ? ` → ${missingVariants.slice(0, 8).map((m) => `${m.c.name}⇒${m.variant}`).join('、')}${missingVariants.length > 8 ? ' …' : ''}` : ''));
  console.log(`  ③ 疑似漏人（出现≥2次的"姓氏+名"）：${candTop.length} 个 → ${candTop.slice(0, 16).map(([n, k]) => `${n}×${k}`).join('、')}${candTop.length > 16 ? ' …' : ''}`);
  console.log(`  ④ 去括号后同名：${dupes.length} 组` + (dupes.length ? ` → ${dupes.slice(0, 6).map(([k, v]) => `${k}(${v.length})`).join('、')}${dupes.length > 6 ? ' …' : ''}` : ''));

  if (write && missingVariants.length) {
    for (const { c, variant } of missingVariants) c.aliases = [...new Set([...(c.aliases || []), variant])].filter((a) => a !== c.name);
    fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
    console.log(`  ✓ 已补 ${missingVariants.length} 个译名变体别名`);
  }
}
console.log('\n提示：③ 是人名候选（含地名人名的误报），人工确认后用编辑器或补丁脚本补进人物；① 建议按"字号/简称/译名"补别名。');
