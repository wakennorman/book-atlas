#!/usr/bin/env node
/**
 * 【已归档】2026-10-12　v0.195 债二 B1：一次性补丁，用完即归档。
 *                     结论去向：CHANGELOG.md 的 v0.191 段
 *                     留在这里是为了留痕「当时怎么改的」，不再是可执行入口。
 * 《百年孤独》查漏补缺（v0.191）。
 *
 * ## 线索从哪来、证据从哪来（这条必须写清楚）
 *
 * 用户给了知乎/豆瓣同一篇文章：
 *   《2万字解构：人物关系图（十代人+死亡顺序+小镇演变）…》（作者「河汁札記」，2024-05-22）
 *   https://zhuanlan.zhihu.com/p/699274908 ／ https://book.douban.com/review/15955149/
 *
 * ⚠ 那是**二手**（读者的解构），而本仓铁律是「改数据必须带**原著**逐字依据」。
 *   ⇒ 那篇文章只用来**指路**：它点名了谁、哪件事，我们就回原著 grep 一遍；
 *     `locate` 里放的全是**原著原句**，不是文章里的话。
 *   ⇒ 文章自己也有错（它把「何塞·拉克尔·蒙卡达」拆成两个人、把 阿尔卡蒂奥 的
 *     行刑者记成 阿基莱斯·里卡多），所以**不能照抄**。见 ①。
 *
 * ## 做了四件事
 *
 * ① **修一条事实错误**：`阿基莱斯·里卡多 → 阿尔卡蒂奥（对阵／处决）` 挂错了人。
 *    里卡多在原著里**只出现在剧院那一场**（他是驻军首领，拦住奥雷里亚诺·何塞搜查），
 *    阿尔卡蒂奥的行刑队首领是罗格·卡尔尼塞罗（数据里已有这条边，e32 也写着）。
 *    ⇒ 把这条边改成 `阿基莱斯·里卡多 → 奥雷里亚诺·何塞（枪杀／同夜被杀）`。
 *
 * ② **补 5 个原著有、数据里没有的人**：
 *    尼卡诺尔·乌略亚、丽贝卡·蒙铁尔（丽贝卡的父母，托孤信里写明）、
 *    特奥菲洛·巴尔加斯将军、洛伦索·加比兰、帕特里夏·布朗。
 *    后三位正是 v0.190 新加的「间隔号全名」规则报出来的真漏人。
 *
 * ③ **补 9 条关系**（含 ② 里那 5 位的连带边，以及三条"原文有、图里没有"的边：
 *    神甫与老何塞的跳棋、特里斯特找房被丽贝卡枪指、奥雷里亚诺第二接丽贝卡养老被拒）。
 *    ⚠ 其中 **2 条会吸收同向的推导边**（十七个奥雷里亚诺↔奥雷里亚诺第二 的「伯叔侄」、
 *      丽贝卡↔十七个奥雷里亚诺 的「姑侄」）：`derive-kin.mjs` 对"已有手写边"的人对
 *      **不再推导**，所以称谓必须写进 `type`（`伯叔侄／…`），否则叔侄关系会从图上消失。
 *      这也是 derive-kin 在 ③ 之后必须重跑的原因。
 *
 * ## kin 字段：非亲属**不写这个键**（不是 `null`、也不是 `'-'`）
 *
 * 数据里 52 条非亲属关系一律**没有 `kin` 键**。`kin.mjs` 的 `checkKin` 虽把 `'-'`
 * 归一成空、不报错，但数据里从未用过 ⇒ 写了就是自造第二种编码，且会让
 * validate 的「亲属关系 N 条：血缘 a · 婚姻 b · 姻亲 c · 收养 d」里 a+b+c+d ≠ N。
 *
 * ④ **补 3 件顶层事件**：开河道与血腥狂欢节、大胃王比赛、隐身医生与子宫托。
 *
 * ## 落盘方式：**整段字面拼接**（不是 parse→stringify）
 *
 * 这个文件的排版不是 `JSON.stringify(x, null, 2)` 的产物：
 * 后期用字面拼接加进去的 7 个事件，`chars` 是**单行**（`["gaston"]`），
 * 而 v0.9x 那批是**多行**。parse→stringify 会把整个文件重写一遍
 * （实测 7 个 hunk / 212 行）⇒ diff 炸开，看不出真正改了什么。
 * ⇒ 只在原文里定位那一个数组、按**它自己的排版**插入，其余字节一个不动；
 *   写完再 parse 一遍与预期对象深比对，不一致就 exit 1（不留半成品）。
 *
 * ## 用法
 *   node scripts/fix-100y-v191.mjs           # 预览（默认，不落盘）
 *   node scripts/fix-100y-v191.mjs --write   # 落盘
 *
 * ⚠ 改完**不要**跑 `derive-kin.mjs --write`（它会把整个文件按 JSON.stringify 重排，
 *   平白多出 264 行与本次改动无关的 diff）。本脚本 ⑤ 已经把推导链的那 2 条删除
 *   就地做掉了；想核对就在**副本**上跑一次，预期输出
 *   「推导边 82 → 80 条」，且**没有**任何新增推导边。
 *   之后照常跑 `make-slim-packs.mjs` + `make-miniprogram-packs.mjs`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bookSourcePath } from './lib/book-sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'one-hundred-years-of-solitude.json');
const WRITE = process.argv.includes('--write');
const SLUG = 'one-hundred-years-of-solitude';

/* ── 原著文本：**直接读 txt**，不用 loadBookSource() ──────────────────
 * ⚠ 铁律 9：`loadBookSource()` 会把间隔号 `·` 一起删掉，于是拿
 *   「尼卡诺尔乌略亚」也能在正文里"查到"，**造出假通过**。
 *   这里只压空白，保留 `·` ⇒ 查的是**印刷版逐字**。 */
const SRC = bookSourcePath(SLUG);
if (!SRC || !fs.existsSync(SRC)) {
  console.error(`✗ 找不到原著文本：${SRC}\n  本脚本依赖本机 %TEMP%\\opencode\\ba-books\\百年孤独.txt，缺了不能判。`);
  process.exit(1);
}
const RAWBOOK = fs.readFileSync(SRC, 'utf8').replace(/\s+/g, '');
const hasQuote = (q) => RAWBOOK.includes(String(q).replace(/\s+/g, ''));

/* ── 章号：用 epub 分卷定位（与 fix-100y-v099.mjs 同一套口径）── */
const EPUB_PARTS = '<你的临时目录>/opencode/epub-parts.json';
let chapterOf = () => null;
if (fs.existsSync(EPUB_PARTS)) {
  const parts = JSON.parse(fs.readFileSync(EPUB_PARTS, 'utf8'));
  const norm = (s) => s.replace(/\s+/g, '');
  chapterOf = (quote) => {
    const q = norm(quote).slice(0, 24);
    const hit = parts.find((p) => norm(p.text).includes(q));
    return hit ? hit.chapter : null;
  };
}

const raw = fs.readFileSync(FILE, 'utf8');
const book = JSON.parse(raw);
const byId = new Map(book.characters.map((c) => [c.id, c]));
const nm = (id) => byId.get(id)?.name ?? id;
const problems = [];
const need = (q, why) => { if (!hasQuote(q)) problems.push(`原文里查不到（${why}）：「${q}」`); };

/* ══════════════════════════════════════════════════════════════
 * ① 修错：阿基莱斯·里卡多 的边挂错了人
 * ══════════════════════════════════════════════════════════════ */
const RICARDO_SRC = [
  '市政大权实际落在驻军首领阿基莱斯·里卡多上尉手中',
  '奥雷里亚诺·何塞才发现阿基莱斯·里卡多带着两个荷枪实弹的士兵在搜查过往人流',
  '而阿基莱斯·里卡多上尉，本是这天夜晚注定要死的人，确实比奥雷里亚诺·何塞早死了四个小时',
  '行刑队的首领是个擅长紧急枪决的老手，他拥有罗格·卡尔尼塞罗',
];
RICARDO_SRC.forEach((q, i) => need(q, `① 修错 ${i + 1}`));

/* ══════════════════════════════════════════════════════════════
 * ② 补人
 * ══════════════════════════════════════════════════════════════ */
const NEW_CHARS = [
  {
    id: 'nicanor-ulloa', name: '尼卡诺尔·乌略亚', gender: 'm', generation: 0,
    faction: 'outsider', tier: 'mentioned',
    title: '丽贝卡的生父（托孤信里写明）',
    desc: '托孤信里写的丽贝卡生父，信里称他「难忘的挚友」；信末说他和妻子已在天国安息，随信一并送来两人的骨殖。',
    fate: '写信时已死；骨殖随女儿送到马孔多，起初没有墓地，暂存在布恩迪亚家。',
    note: '原文：「她是难忘的挚友尼卡诺尔·乌略亚和他可敬的妻子丽贝卡·蒙铁尔的女儿，愿他们在天国安息，一并送来他们的骨殖，盼以基督徒的礼仪安葬云云。」'
      + '信里还说这孩子「算乌尔苏拉的远房表妹，因而也是何塞·阿尔卡蒂奥·布恩迪亚的亲人，尽管关系上要更远些」——'
      + '⚠ **这一层亲戚关系图里没有编码**（丽贝卡在图上的父母只有乌略亚与蒙铁尔），本仓只把它当"信里的说法"记在这里。'
      + '⚠ 何塞·阿尔卡蒂奥·布恩迪亚和乌尔苏拉**都不记得有这些亲戚，也从不认识叫这个名字的写信人** —— 信里的说法原著没有坐实。'
      + '本仓照抄原著的「信里这么说」，不替它判定。',
    locate: '她是难忘的挚友尼卡诺尔·乌略亚和他可敬的妻子丽贝卡·蒙铁尔的女儿',
  },
  {
    id: 'rebeca-montiel', name: '丽贝卡·蒙铁尔', gender: 'f', generation: 0,
    faction: 'outsider', tier: 'mentioned',
    title: '丽贝卡的生母（托孤信里写明）',
    desc: '托孤信里写的丽贝卡生母。养女「丽贝卡」的名字就是从她这儿来的。',
    fate: '写信时已死；骨殖随女儿一起送到马孔多。',
    note: '原文：「她是难忘的挚友尼卡诺尔·乌略亚和他可敬的妻子丽贝卡·蒙铁尔的女儿」；'
      + '「家人只好根据信中她母亲的名字叫她丽贝卡」。'
      + '⚠ 与养女 `rebeca`（丽贝卡）**不是同一个人**，只是同名 —— 本仓用全名 `丽贝卡·蒙铁尔` 区分（同名多人用全名/括号区分，铁律 3）。',
    locate: '家人只好根据信中她母亲的名字叫她丽贝卡',
  },
  {
    id: 'teofilo-vargas', name: '特奥菲洛·巴尔加斯将军', gender: 'm', generation: 2,
    faction: 'war',
    title: '起义军里的强权人物',
    desc: '内战后期起义军将领内讧时冒出来的强权人物：「他是纯印第安人，出身山野，大字不识，却暗藏祸心，同时拥有救世主般的感召力」。'
      + '在短短几个小时内就让最优秀的将领组成的联盟土崩瓦解，抢在奥雷里亚诺·布恩迪亚上校之前攫取了总指挥权。',
    fate: '夺权十五天后遇伏，「在乱刀下被剁成肉酱」，大权落到奥雷里亚诺·布恩迪亚上校手中。',
    note: '原文：「就在这鱼龙混杂中一位居心叵测的强权人物脱颖而出——特奥菲洛·巴尔加斯将军」；'
      + '「但特奥菲洛·巴尔加斯将军抢在了他前面：在短短几个小时内就让最优秀的将领组成的联盟土崩瓦解，攫取了总指挥权」；'
      + '「十五天后特奥菲洛·巴尔加斯将军遇伏，在乱刀下被剁成肉酱，大权落到奥雷里亚诺·布恩迪亚上校手中」。'
      + '⚠ v0.190 新加的「间隔号全名」规则把它列为**真漏人**，本轮补。',
    locate: '一位居心叵测的强权人物脱颖而出——特奥菲洛·巴尔加斯将军',
  },
  {
    id: 'lorenzo-gavilan', name: '洛伦索·加比兰', gender: 'm', generation: 4,
    faction: 'outsider',
    title: '流亡到马孔多的墨西哥革命上校',
    desc: '墨西哥革命中的一位上校，流亡到马孔多，常说自己曾亲眼见证战友阿尔特米奥·克鲁斯的事迹。'
      + '大罢工被镇压后，他与何塞·阿尔卡蒂奥第二一起被拖出家、戴上五公斤重的脚镣关进省监狱。',
    fate: '原著未交代结局；只写他与何塞·阿尔卡蒂奥第二同批被捕入狱。',
    note: '原文：「但到星期一晚上，领导人被逐个拖出家来，戴上五公斤重的脚镣，关进省监狱。这其中有何塞·阿尔卡蒂奥第二和洛伦索·加比兰，'
      + '后者是墨西哥革命中的一位上校，流亡到了马孔多，他常说自己曾亲眼见证战友阿尔特米奥·克鲁斯…」。'
      + '⚠ 译者注写明：洛伦索·加比兰（Lorenzo Gavilán）与阿尔特米奥·克鲁斯（Artemio Cruz）皆为墨西哥作家卡洛斯·富恩特斯长篇小说中的人物 ——'
      + '马尔克斯在这里是**互文引用**，不是笔误。⚠ v0.190 的「间隔号全名」规则把它列为真漏人，本轮补。',
    locate: '这其中有何塞·阿尔卡蒂奥第二和洛伦索·加比兰',
  },
  {
    id: 'patricia-brown', name: '帕特里夏·布朗', gender: 'f', generation: 5,
    faction: 'company',
    title: '梅梅的三个美国女友之一',
    desc: '梅梅的三个美国女友之一：「她们钻出电网鸡笼和马孔多的少女们建立了友谊。其中一个叫帕特里夏·布朗」。'
      + '梅梅正是坐她的车、由汽修学徒马乌里肖·巴比伦当司机，才认识了后来的恋人。',
    fate: '原著未交代结局。',
    note: '原文：「梅梅的女友中有三个美国姑娘，她们钻出电网鸡笼和马孔多的少女们建立了友谊。其中一个叫帕特里夏·布朗」；'
      + '「一天下午，她和帕特里夏·布朗想找一辆汽车到种植园里兜风，当时司机病了，他便被派来开车」。'
      + '⚠ v0.190 的「间隔号全名」规则把它列为真漏人，本轮补。',
    locate: '其中一个叫帕特里夏·布朗',
  },
];
NEW_CHARS.forEach((c) => need(c.locate, `② 补人 ${c.name}`));

/* ② 里 nicanor-ulloa 的 note 还多引了托孤信的一句（"图里没编码的那层亲戚"），单独核一遍 */
const NOTE_SRC = [
  '孩子算乌尔苏拉的远房表妹，因而也是何塞·阿尔卡蒂奥·布恩迪亚的亲人，尽管关系上要更远些',
];
NOTE_SRC.forEach((q, i) => need(q, `② note 引文 ${i + 1}`));

/* ══════════════════════════════════════════════════════════════
 * ③ 补关系
 * ══════════════════════════════════════════════════════════════ */
const NEW_RELS = [
  {
    from: 'nicanor-ulloa', to: 'rebeca', type: '父女', kin: 'blood',
    text: '托孤信里说丽贝卡是尼卡诺尔·乌略亚与丽贝卡·蒙铁尔的女儿，随信送来的还有两人的骨殖；'
      + '何塞·阿尔卡蒂奥·布恩迪亚与乌尔苏拉都不记得有这些亲戚，仍按信里的嘱托收留了她。',
    chapter: '第3章', place: 'casa',
    locate: '她是难忘的挚友尼卡诺尔·乌略亚和他可敬的妻子丽贝卡·蒙铁尔的女儿',
  },
  {
    from: 'rebeca-montiel', to: 'rebeca', type: '母女', kin: 'blood',
    text: '托孤信里说丽贝卡是尼卡诺尔·乌略亚与丽贝卡·蒙铁尔的女儿；家人无从确认她的本名，'
      + '「只好根据信中她母亲的名字叫她丽贝卡」。',
    chapter: '第3章', place: 'casa',
    locate: '家人只好根据信中她母亲的名字叫她丽贝卡',
  },
  {
    from: 'father-nicanor', to: 'jose-arcadio-buendia', type: '棋友／敬其睿智',
    text: '尼卡诺尔·雷伊纳神甫与何塞·阿尔卡蒂奥·布恩迪亚下跳棋；神甫「越来越惊叹于何塞·阿尔卡蒂奥·布恩迪亚的睿智」，'
      + '便问他怎么会被绑在树上。',
    chapter: '第5章', place: 'castano',
    locate: '他越来越惊叹于何塞·阿尔卡蒂奥·布恩迪亚的睿智，便问他怎么会被绑在树上',
  },
  {
    /* ⚠ 方向**必须**是长辈→晚辈，且称谓要进 type —— 这条边会**吸收**掉
     *   derive-kin 现有的 `十七个奥雷里亚诺 —伯叔侄（伯叔父与侄）（推导）— 奥雷里亚诺第二`。
     *   推导边写着「原文没有直接互动」，而这里恰恰**有**（特里斯特接受了邀请）；
     *   若不把称谓写进 type，derive-kin 会因「这对人已有手写边」而不再推导，
     *   ⇒ 叔侄关系会**从图上消失**。 */
    from: 'aurelianos-17', to: 'aureliano-segundo', type: '伯叔侄／邀请定居·建制冰厂', kin: 'blood',
    text: '十七个奥雷里亚诺里，只有奥雷里亚诺·特里斯特接受了奥雷里亚诺第二的邀请留下来，'
      + '随后在市郊建起一座制冰厂 —— 那正是当年老何塞痴迷发明时梦想过的事。',
    chapter: '第11章', place: 'macondo',
    locate: '唯一接受邀请的人是奥雷里亚诺·特里斯特',
  },
  {
    /* 同上：吸收 `丽贝卡 —姑侄（姑母与侄）（推导）— 十七个奥雷里亚诺`。 */
    from: 'rebeca', to: 'aurelianos-17', type: '姑侄／找房被枪指', kin: 'blood',
    text: '奥雷里亚诺·特里斯特四处找房子准备把母亲和妹妹接来，撞开了广场角上那座废弃的宅子，'
      + '「险些没有察觉到那女人正用一把老旧的军用手枪指着他」—— 里面是闭门幽居的丽贝卡。',
    chapter: '第11章', place: 'casa',
    locate: '险些没有察觉到那女人正用一把老旧的军用手枪指着他',
  },
  {
    from: 'aureliano-segundo', to: 'rebeca', type: '接她养老被拒',
    text: '乌尔苏拉记忆里的丽贝卡被"净化"以后，奥雷里亚诺第二决定接她回家好生照料，'
      + '「但他的好意遭到丽贝卡的断然拒绝」—— 她不肯拿孤独特权去换一个被怜悯打扰的晚年。',
    chapter: '第11章', place: 'casa',
    locate: '奥雷里亚诺第二决定接她回家好生照料，但他的好意遭到丽贝卡的断然拒绝',
  },
  {
    from: 'teofilo-vargas', to: 'aureliano-colonel', type: '夺权／被除',
    text: '特奥菲洛·巴尔加斯将军抢在奥雷里亚诺·布恩迪亚上校前面攫取了起义军总指挥权；'
      + '十五天后他遇伏被剁成肉酱，大权落到上校手中。',
    chapter: '第9章', place: 'macondo',
    locate: '十五天后特奥菲洛·巴尔加斯将军遇伏，在乱刀下被剁成肉酱，大权落到奥雷里亚诺·布恩迪亚上校手中',
  },
  {
    from: 'lorenzo-gavilan', to: 'jose-arcadio-segundo', type: '同囚／战友',
    text: '大罢工被镇压后，罢工领导人被逐个拖出家、戴上脚镣关进省监狱，其中就有何塞·阿尔卡蒂奥第二和洛伦索·加比兰。',
    chapter: '第15章', place: 'macondo',
    locate: '这其中有何塞·阿尔卡蒂奥第二和洛伦索·加比兰',
  },
  {
    /* ⚠ type 用 `好友` 而不是 `女友`：`guessKin` 的 BLOOD 里有一个**裸 `女`**
     *   （为了抓「母女/子女」），于是 `女友` 被判成血缘 ⇒ validate 多报一条
     *   「像是亲属关系…建议补 kin: "blood"」的**假警告**。
     *   这是 `scripts/kin.mjs` 与 `js/editor.js` 共享正则的一个潜在假阳性，
     *   本轮只避开它（改用仓库既有的「好友/挚友/密友」那套措辞），没去改正则
     *   —— 改它要同时改前端那份，会牵出一次 sw 版本号。 */
    from: 'patricia-brown', to: 'meme', type: '好友',
    text: '帕特里夏·布朗是梅梅的三个美国女友之一；一天下午梅梅和她想找一辆汽车到种植园里兜风，'
      + '司机病了，厂里派来开车的正是马乌里肖·巴比伦。',
    chapter: '第14章', place: 'macondo',
    locate: '她和帕特里夏·布朗想找一辆汽车到种植园里兜风',
  },
];
NEW_RELS.forEach((r) => need(r.locate, `③ 补关系 ${r.from} → ${r.to}`));

/* ① 那条就地改写的边（⚠ 键序必须与 relBlock 一致，否则深比对会报"不一致"） */
const FIXED_REL = {
  from: 'achilles-ricardo', to: 'aureliano-jose', type: '枪杀／同夜被杀', style: 'solid',
  events: [{
    text: '奥雷里亚诺·何塞在剧院门口被保守党驻军首领阿基莱斯·里卡多上尉拦住搜查，他出言挑衅后拔腿就跑，'
      + '被一发步枪子弹从背后打穿；同一天夜里，里卡多本人也被两发来路不明的子弹击中，比奥雷里亚诺·何塞早死了四个小时。',
    chapter: '第8章', place: 'macondo', evidence: 'paraphrase',
  }],
};

/* ══════════════════════════════════════════════════════════════
 * ④ 补顶层事件
 * ══════════════════════════════════════════════════════════════ */
const NEW_EVENTS = [
  {
    id: 'e40', phase: 'p4', order: 8, ch: 10, name: '开河道、法国女郎与血腥狂欢节',
    place: 'macondo',
    chars: ['jose-arcadio-segundo', 'aureliano-segundo', 'petra-cotes', 'remedios-beauty', 'fernanda'],
    summary: '何塞·阿尔卡蒂奥第二拍卖斗鸡、招募人手，砸碎石块、挖掘河道、铲除暗礁甚至填平瀑布，一心想把马孔多通到海；'
      + '航道没打通，却带回一火车的法国女郎。她们发起血腥狂欢节，使马孔多陷入三日的疯狂 ——'
      + '「唯一长久的成果就是奥雷里亚诺第二获得了认识费尔南达·德尔·卡皮奥的机会」。',
    impact: '狂欢节上美人儿蕾梅黛丝被选为女王，引来政府军化装偷袭；奥雷里亚诺第二趁乱救出扮成女王的费尔南达，六个月后与她成婚。',
    quote: '正是她们发起了那场血腥狂欢节，使马孔多陷入三日的疯狂，唯一长久的成果就是奥雷里亚诺第二获得了认识费尔南达·德尔·卡皮奥的机会。',
    locate: '为的是清理河道开发航路',
  },
  {
    id: 'e41', phase: 'p5', order: 8, ch: 13, name: '大胃王比赛与「母象」',
    place: 'casa',
    chars: ['aureliano-segundo', 'fernanda'],
    summary: '奥雷里亚诺第二以「无所顾忌的大胃王」之名享誉全国，一个绰号「母象」的女人专程离开学校和家庭来与他比试；'
      + '她第一眼就断定他不会输在胃上、却会输在性格上 —— 他果然因为说笑太多先撑不住了。',
    impact: '这场闹剧反倒让费尔南达挽回了些夫妻情分。',
    quote: '来与这个以无所顾忌的大胃王之名享誉全国的男人比试',
    locate: '以无所顾忌的大胃王之名享誉全国的男人',
  },
  {
    id: 'e42', phase: 'p5', order: 9, ch: 17, name: '隐身医生与子宫托',
    place: 'casa',
    chars: ['fernanda'],
    summary: '费尔南达与从未谋面的「隐身医生」频繁通信求医，屡屡拖延后按约定把自己关进卧室、头向北躺着、周身只裹一条白床单；'
      + '医生们回信说查不出她反复描述的症状，只查出子宫下垂，建议用子宫托矫正，此后再不回信。',
    impact: '那个陌生的词成了她心头的重负；她最终在内衣里加缝了一个衣袋，把儿子寄来的子宫托藏在其中，'
      + '丢了以后还当作是隐身医生们的报复。',
    quote: '她与隐身医生频繁的通信以失败告终',
    locate: '通过心灵感应实施手术的外科医生们只查出她子宫下垂，建议用子宫托加以矫正',
  },
];
NEW_EVENTS.forEach((e) => need(e.locate, `④ 补事件 ${e.id}`));

/* ── 核验不通过就停：宁可什么都不改 ── */
if (problems.length) {
  console.error('✗ 有依据查不到，**一个字都没改**：');
  for (const p of problems) console.error('   · ' + p);
  process.exit(1);
}
console.log(`✓ ${NEW_CHARS.length + NEW_RELS.length + NEW_EVENTS.length + RICARDO_SRC.length + NOTE_SRC.length} 条依据全部在原著里逐字命中\n`);

/* ══════════════════════════════════════════════════════════════
 * 排版：按文件自己的样子生成片段
 * ══════════════════════════════════════════════════════════════ */
const j = (x) => JSON.stringify(x);
const EOL = raw.includes('\r\n') ? '\r\n' : '\n';

function charBlock(c, ind = '    ') {
  const L = [ind + '{'];
  L.push(ind + '  "id": ' + j(c.id) + ',');
  L.push(ind + '  "name": ' + j(c.name) + ',');
  L.push(ind + '  "aliases": [],');
  L.push(ind + '  "generation": ' + c.generation + ',');
  L.push(ind + '  "gender": ' + j(c.gender) + ',');
  L.push(ind + '  "firstCh": ' + c.firstCh + ',');
  L.push(ind + '  "faction": ' + j(c.faction) + ',');
  L.push(ind + '  "title": ' + j(c.title) + ',');
  if (c.tier) L.push(ind + '  "tier": ' + j(c.tier) + ',');
  L.push(ind + '  "desc": ' + j(c.desc) + ',');
  L.push(ind + '  "fate": ' + j(c.fate) + ',');
  L.push(ind + '  "note": ' + j(c.note));
  L.push(ind + '}');
  return L.join(EOL);
}

function relBlock(r, ind = '    ') {
  const L = [ind + '{'];
  L.push(ind + '  "from": ' + j(r.from) + ',');
  L.push(ind + '  "to": ' + j(r.to) + ',');
  L.push(ind + '  "type": ' + j(r.type) + ',');
  L.push(ind + '  "style": ' + j(r.style) + ',');
  L.push(ind + '  "events": [');
  r.events.forEach((e, i) => {
    L.push(ind + '    {');
    L.push(ind + '      "text": ' + j(e.text) + ',');
    L.push(ind + '      "chapter": ' + j(e.chapter) + ',');
    if (e.place) L.push(ind + '      "place": ' + j(e.place) + ',');
    L.push(ind + '      "evidence": ' + j(e.evidence));
    L.push(ind + '    }' + (i < r.events.length - 1 ? ',' : ''));
  });
  /* ⚠ 非亲属关系在数据里是**整个 kin 字段不写**（现有 52 条全都如此），
   *   不是 `null` 也不是 `'-'`。`kin.mjs` 虽然把 `'-'` 归一成空、不会报错，
   *   但数据里从没用过 ⇒ 写了就是**自造第二种编码**，而且会让 validate 的
   *   「亲属关系 N 条：血缘 a · 婚姻 b · 姻亲 c · 收养 d」里 a+b+c+d ≠ N
   *   （`rels.filter(r => r.kin)` 把 `'-'` 也算成亲属）。 */
  L.push(ind + '  ]' + (r.kin ? ',' : ''));
  if (r.kin) L.push(ind + '  "kin": ' + j(r.kin));
  L.push(ind + '}');
  return L.join(EOL);
}

function evBlock(e, ind = '    ') {
  const L = [ind + '{'];
  L.push(ind + '  "id": ' + j(e.id) + ',');
  L.push(ind + '  "phase": ' + j(e.phase) + ',');
  L.push(ind + '  "order": ' + e.order + ',');
  L.push(ind + '  "ch": ' + e.ch + ',');
  L.push(ind + '  "name": ' + j(e.name) + ',');
  /* ⚠ `chars` 写成**单行**：文件里最近加进去的那 7 个事件都是这个样式
   *   （v0.9x 那批是多行）⇒ 跟着邻居走，别让"非规范格式"的范围变大。
   *   代价是与 `JSON.stringify` 的产物仍差 3 个 hunk，`assertLayout` 只判缩进不判这个。 */
  L.push(ind + '  "chars": [' + e.chars.map(j).join(', ') + '],');
  L.push(ind + '  "summary": ' + j(e.summary) + ',');
  L.push(ind + '  "impact": ' + j(e.impact) + ',');
  if (e.place) L.push(ind + '  "place": ' + j(e.place) + ',');
  if (e.quote) L.push(ind + '  "quote": ' + j(e.quote) + ',');
  L.push(ind + '  "evidence": ' + j(e.evidence));
  L.push(ind + '}');
  return L.join(EOL);
}

/* ── 字符串感知的括号配对 ── */
function matchBracket(s, open, o = '[', c = ']') {
  let depth = 0, inStr = false, esc = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === o) depth++;
    else if (ch === c) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 在 `"key": [` 那个数组的**最后一个元素之后**插入 blocks（自动补逗号）。
 *  ⚠ 锚点必须带**行首缩进**（顶层键是 2 空格）：关系对象里也有一个 `"events": [`，
 *    只找 `"events": [` 会把顶层事件插进某条关系的 events 里（踩过一次，深比对拦住了）。 */
function appendToArray(text, key, blocks) {
  const anchor = text.indexOf(EOL + '  ' + j(key) + ': [');
  if (anchor < 0) throw new Error(`找不到顶层数组 ${key}`);
  const open = text.indexOf('[', anchor);
  const close = matchBracket(text, open);
  if (close < 0) throw new Error(`数组 ${key} 括号不配对`);
  /* 往回跳过空白，落在最后一个元素的 `}` 上 */
  let end = close - 1;
  while (end > open && /\s/.test(text[end])) end--;
  if (text[end] !== '}') throw new Error(`数组 ${key} 的最后一个元素不是对象（${JSON.stringify(text.slice(end - 20, end + 1))}）`);
  return text.slice(0, end + 1) + ',' + EOL + blocks.join(',' + EOL) + text.slice(end + 1);
}

/** 在顶层 `relations` 里，把手写边插到**第一条推导边之前**。
 *
 *  ⚠ 为什么不能用 appendToArray（追加到末尾）：`derive-kin.mjs` 每次都用
 *    `[...手写边, ...推导边]` 重建整个数组，**HEAD 的文件正是这个不动点**
 *    （在副本上验过：对 HEAD 跑一次 derive-kin，顺序一模一样、82 → 82）。
 *    把新手写边追加到数组最末尾，它们就排在推导边**之后**，文件随即不再是
 *    不动点 —— 下次谁跑一次 derive-kin，就会看到这 10 条边整段搬家。
 *    语义上无所谓，但那是一处凭空多出来的、与本次改动无关的 diff。
 */
function insertRelations(text, blocks) {
  const anchor = text.indexOf(EOL + '  ' + j('relations') + ': [');
  if (anchor < 0) throw new Error('找不到顶层数组 relations');
  const open = text.indexOf('[', anchor);
  const d = text.indexOf('"derived": true', open);
  if (d < 0) return appendToArray(text, 'relations', blocks);   // 没有推导边，照常追加
  /* `derived` 在关系对象里排在 `events` **之前**，所以往回最近的那个 `{`
   * 就是这条关系对象自己的开头（不会落到 events 里的对象上）。 */
  const brace = text.lastIndexOf('{', d);
  const lineStart = text.lastIndexOf('\n', brace) + 1;
  if (!/^[ \t]*$/.test(text.slice(lineStart, brace))) {
    throw new Error(`推导边前的排版不认识（\`{\` 不在行首）：${JSON.stringify(text.slice(brace - 40, brace + 5))}`);
  }
  /* ⚠ 必须从**行首**切，不能从 `{` 的索引切：`slice(0, brace)` 会连"这一行自己的
   *   4 空格缩进"一起留下，于是插进去的第一个块变成 8 空格缩进、被顶下去的那条
   *   推导边丢掉缩进（踩过一次，深比对只看 JSON 语义所以抓不到，见 assertLayout）。 */
  return text.slice(0, lineStart) + blocks.join(',' + EOL) + ',' + EOL + text.slice(lineStart);
}

/** 在含 `"id": "val"` 的字符对象里，插一个字段到 `"birthRank"` 那行之后（没有就插到 note 之前）。 */
function insertField(text, idVal, fieldText) {
  const at = text.indexOf('"id": ' + j(idVal));
  if (at < 0) throw new Error(`找不到人物 ${idVal}`);
  const open = text.lastIndexOf('{', at);
  const close = matchBracket(text, open, '{', '}');
  const body = text.slice(open, close);
  const lines = body.split(EOL);
  let idx = lines.findIndex((l) => l.includes('"birthRank"'));
  if (idx < 0) idx = lines.findIndex((l) => l.includes('"note"')) - 1;
  if (idx < 0) throw new Error(`人物 ${idVal} 里找不到可用的插入点`);
  lines.splice(idx + 1, 0, '      ' + fieldText);
  return text.slice(0, open) + lines.join(EOL) + text.slice(close);
}

/** 从顶层 relations 里**整段删掉**一条关系（按 from+to+type 三者精确定位）。
 *
 *  ⚠ 为什么不是跑 `derive-kin.mjs --write` 让它自己重建：
 *    那个脚本用 `JSON.stringify(book, null, 2)` **整体重写**文件，会把 7 个事件的
 *    单行 `chars`、以及一处历史缩进问题一起重排 —— 实测 264 行，全是与本次改动
 *    无关的噪声。而这次推导链的真实变化在副本上量过：**恰好就是这 2 条删除、
 *    0 条新增**（因为新边吸收了同向的推导边，其余人对的族谱没变）。⇒ 就地删即可。
 *
 *  ⚠ 匹配到 0 块或 >1 块都**抛错**：静默跳过会留下"推导边还在、手写边也进了"
 *    的半成品，而那看起来是成功的。
 */
function removeRelBlock(text, from, to, type) {
  const needle = '"to": ' + j(to);
  const hits = [];
  for (let p = text.indexOf(needle); p >= 0; p = text.indexOf(needle, p + 1)) {
    const open = text.lastIndexOf('{', p);
    const close = matchBracket(text, open, '{', '}');
    const body = text.slice(open, close + 1);
    if (body.includes('"from": ' + j(from)) && body.includes('"type": ' + j(type))) hits.push({ open, close });
  }
  if (hits.length !== 1) {
    throw new Error(`删关系失败：from=${from} to=${to} type=${type} 匹配到 ${hits.length} 块（应为 1）`);
  }
  const { open, close } = hits[0];
  const lineStart = text.lastIndexOf('\n', open) + 1;
  if (!/^[ \t]*$/.test(text.slice(lineStart, open))) {
    throw new Error(`删关系失败：块的 \`{\` 不在行首：${JSON.stringify(text.slice(open - 30, open + 5))}`);
  }
  /* ⚠ 从**行首**起删，而且要连"这一行自己的换行符"一起删：
   *   从 `{` 的索引起删会把前一行末尾的 4 空格缩进留下，于是原地多出一行
   *   **只有 4 个空格**的"空行"（踩过一次；深比对只看 JSON 语义，抓不到）。
   *   逗号：优先吃**自己后面**那个（中间元素）；自己已是最后一个元素时吃**前面**那个。 */
  let s = lineStart;
  if (text[s - 2] === '\r' && text[s - 1] === '\n') s -= 2;
  else if (text[s - 1] === '\n') s -= 1;
  let e = close + 1;
  if (text[e] === ',') e += 1;
  else if (text[s - 1] === ',') s -= 1;
  else throw new Error(`删关系失败：from=${from} to=${to} 后面没逗号、前面也没有`);
  return text.slice(0, s) + text.slice(e);
}

/** 排版自检 —— 深比对只比 JSON **语义**，缩进被顶掉、多出一行空格它一律看不见。
 *  这两条判据都是"形状"级的，与内容无关：
 *   ① 不许出现**只有空白字符**的行（删块时最容易留一行 4 空格）。
 *   ② 顶层数组 `characters` / `relations` / `events` 里，每个元素的 `{`
 *      必须**单独占一行、缩进恰好 4 空格**（8 空格或 0 空格都是 bug）。
 *  为什么非要有它：第一版三个插入/删除助手都是从 `{` 的**索引**切片而不是行首，
 *  结果一个块变成 8 空格缩进、一个丢掉缩进、还多出两行 4 空格 ——
 *  而深比对**全绿**（JSON 解析出来一模一样）。 */
function assertLayout(t, expect) {
  const problems = [];
  t.split(EOL).forEach((l, i) => {
    if (l.length && !l.trim()) problems.push(`第 ${i + 1} 行只有空白字符`);
  });
  for (const [key, want] of Object.entries(expect)) {
    const anchor = t.indexOf(EOL + '  ' + j(key) + ': [');
    if (anchor < 0) { problems.push(`找不到顶层数组 ${key}`); continue; }
    const open = t.indexOf('[', anchor);
    const close = matchBracket(t, open);
    const got = (t.slice(open + 1, close).match(/\n {4}\{/g) || []).length;
    if (got !== want) problems.push(`${key}：缩进 4 空格的元素 ${got} 个，应为 ${want} 个（有元素缩进不对）`);
  }
  if (problems.length) {
    console.error('✗ 排版自检没过（JSON 语义可能没问题，但缩进被弄坏了）：');
    for (const p of problems) console.error('   · ' + p);
    process.exit(1);
  }
}

/* ══════════════════════════════════════════════════════════════
 * 应用（先在**对象**上改，再在**文本**上拼，最后深比对）
 * ══════════════════════════════════════════════════════════════ */
const log = [];
let text = raw;
const next = JSON.parse(raw);          // 预期结果

/* ① 修错 */
{
  const wrong = next.relations.find((r) => r.from === 'achilles-ricardo' && r.to === 'arcadio');
  if (wrong) {
    const oldType = wrong.type;
    const idx = next.relations.indexOf(wrong);
    next.relations[idx] = JSON.parse(JSON.stringify(FIXED_REL));
    const at = text.indexOf('"from": "achilles-ricardo"');
    const open = text.lastIndexOf('{', at);
    const close = matchBracket(text, open, '{', '}');
    /* ⚠ 从**行首**切：从 `{` 的索引切会把这一行自己的 4 空格缩进留在前面，
     *   替换进去的块就变成 8 空格（见 assertLayout 的说明）。 */
    const lineStart = text.lastIndexOf('\n', open) + 1;
    text = text.slice(0, lineStart) + relBlock(FIXED_REL) + text.slice(close + 1);
    log.push(`① 改边：阿基莱斯·里卡多 → 阿尔卡蒂奥（${oldType}）  ⇒  阿基莱斯·里卡多 → 奥雷里亚诺·何塞（枪杀／同夜被杀）`);
  } else {
    log.push('① 那条错边已经不存在（跑过了），跳过');
  }
}

/* ② 补人 */
{
  const blocks = [];
  for (const c of NEW_CHARS) {
    if (next.characters.some((x) => x.id === c.id)) { log.push(`② 已存在，跳过：${c.name}`); continue; }
    const ch = chapterOf(c.locate);
    const rec = {
      id: c.id, name: c.name, aliases: [], generation: c.generation, gender: c.gender,
      firstCh: ch ?? c.firstCh, faction: c.faction, title: c.title,
    };
    if (c.tier) rec.tier = c.tier;
    rec.desc = c.desc; rec.fate = c.fate; rec.note = c.note;
    next.characters.push(rec);
    byId.set(c.id, rec);          // ⚠ 后面 ③ 要用它判"端点是否存在"，必须同步
    blocks.push(charBlock(rec));
    log.push(`② 补人：${c.name}（gen${c.generation} / ${c.gender} / firstCh ${rec.firstCh}）`);
  }
  if (blocks.length) text = appendToArray(text, 'characters', blocks);
}

/* ②b 丽贝卡的 parents —— ⚠ 字段**顺序**必须与文本插入位置一致，
 *     否则 JSON.stringify 深比对会报"不一致"（踩过一次）。 */
{
  const idx = next.characters.findIndex((c) => c.id === 'rebeca');
  const reb = next.characters[idx];
  if (reb && !reb.parents) {
    const parents = ['nicanor-ulloa', 'rebeca-montiel'];
    const rebuilt = {};
    let placed = false;
    for (const [k, v] of Object.entries(reb)) {
      if (!placed && k === 'note') { rebuilt.parents = parents; placed = true; }
      rebuilt[k] = v;
      if (k === 'birthRank') { rebuilt.parents = parents; placed = true; }
    }
    if (!placed) rebuilt.parents = parents;   // 既无 birthRank 也无 note：落末尾
    next.characters[idx] = rebuilt;
    /* 排版与文件里既有的那条 parents（安帕萝·摩斯科特）一致：**多行**数组。
     * 单行写法虽然合法，但 `derive-kin.mjs --write` 会按 JSON.stringify 重排，
     * 于是多出一处与本次改动无关的 diff。 */
    text = insertField(text, 'rebeca',
      '"parents": [' + EOL
      + parents.map((p) => '        ' + j(p)).join(',' + EOL) + EOL
      + '      ],');
    log.push('② 给 rebeca 登记 parents：[尼卡诺尔·乌略亚, 丽贝卡·蒙铁尔]');
  }
}

/* ③ 补关系 */
{
  const blocks = [];
  for (const r of NEW_RELS) {
    if (!byId.has(r.from) || !byId.has(r.to)) { log.push(`③ 端点缺失，跳过：${r.from} → ${r.to}`); continue; }
    /* ⚠ 只把**手写边**算作"已有同向边"。推导边（derived）不算 ——
     *   上面两条边正是要**取代**同向的推导边；拿推导边去重会把它们直接跳过，
     *   于是「吸收推导边」的意图静默落空（推导线还在、新边没进）。 */
    if (next.relations.some((x) => !x.derived && x.from === r.from && x.to === r.to)) {
      log.push(`③ 已有同向手写边，跳过：${nm(r.from)} → ${nm(r.to)}`);
      continue;
    }
    const rec = {
      from: r.from, to: r.to, type: r.type, style: 'solid',
      events: [{ text: r.text, chapter: r.chapter, place: r.place, evidence: 'paraphrase' }],
      kin: r.kin,
    };
    next.relations.push(rec);
    blocks.push(relBlock(rec));
    log.push(`③ 补关系：${nm(r.from)} → ${nm(r.to)}（${r.type}）`);
  }
  if (blocks.length) {
    /* ⚠ 顺序必须与文本一致：先把刚 push 的挪到「第一条推导边之前」，
     *   再让文本用同一个规则插入，否则深比对会报不一致。 */
    const pushed = blocks.length;
    const recs = next.relations.splice(next.relations.length - pushed, pushed);
    const at = next.relations.findIndex((x) => x.derived);
    next.relations.splice(at < 0 ? next.relations.length : at, 0, ...recs);
    text = insertRelations(text, blocks);
  }
}

/* ④ 补事件 */
{
  const blocks = [];
  for (const e of NEW_EVENTS) {
    if (next.events.some((x) => x.id === e.id)) { log.push(`④ 事件 ${e.id} 已存在，跳过`); continue; }
    const rec = {
      id: e.id, phase: e.phase, order: e.order, ch: e.ch, name: e.name,
      chars: e.chars, summary: e.summary, impact: e.impact,
      place: e.place, quote: e.quote, evidence: 'paraphrase',
    };
    next.events.push(rec);
    blocks.push(evBlock(rec));
    log.push(`④ 补事件：${e.id} ${e.name}（ch${e.ch}）`);
  }
  if (blocks.length) text = appendToArray(text, 'events', blocks);
}

/* ══════════════════════════════════════════════════════════════
 * ⑤ 删掉被 ③ 吸收掉的那两条**推导边**（derive-kin 的产物）
 *
 * ③ 里那两条手写边（伯叔侄／邀请定居·建制冰厂、姑侄／找房被枪指）与
 * derive-kin 早先推导出来的边是**同一对人**。`derive-kin.mjs` 的规则是
 * 「已有手写关系的人对不再推导」⇒ 下次跑它时这两条推导边**本来就会消失**。
 * 但它们现在还在文件里，且各自写着「原文没有直接互动」—— 而这两件事
 * 恰恰**有**直接互动。⇒ 现在就删掉，别让一句已经过期的说明留在图上。
 * ══════════════════════════════════════════════════════════════ */
const ABSORBED_DERIVED = [
  { from: 'rebeca', to: 'aurelianos-17', type: '姑侄（姑母与侄）（推导）' },
  { from: 'aurelianos-17', to: 'aureliano-segundo', type: '伯叔侄（伯叔父与侄）（推导）' },
];
for (const d of ABSORBED_DERIVED) {
  const i = next.relations.findIndex((r) => r.from === d.from && r.to === d.to && r.type === d.type);
  if (i < 0) { log.push(`⑤ 推导边已不在（跑过了），跳过：${nm(d.from)} → ${nm(d.to)}`); continue; }
  if (!next.relations[i].derived) { log.push(`⑤ 警告：${nm(d.from)} → ${nm(d.to)} 那条不是推导边，跳过`); continue; }
  next.relations.splice(i, 1);
  text = removeRelBlock(text, d.from, d.to, d.type);
  log.push(`⑤ 删被吸收的推导边：${nm(d.from)} — ${d.type} — ${nm(d.to)}`);
}

console.log(log.join('\n'));

/* ── 排版自检（**在**深比对之前）：语义对不代表文件没被弄乱 ── */
assertLayout(text, {
  characters: next.characters.length,
  relations: next.relations.length,
  events: next.events.length,
});

/* ── 深比对：拼出来的文本必须正好等于预期对象 ── */
let actual;
try { actual = JSON.parse(text); } catch (e) { console.error(`\n✗ 拼出来的文本不是合法 JSON：${e.message}`); process.exit(1); }
if (JSON.stringify(actual) !== JSON.stringify(next)) {
  console.error('\n✗ 拼出来的文本与预期对象**深比对不一致** ⇒ 拒绝落盘（不留半成品）');
  const A = JSON.stringify(actual), B = JSON.stringify(next);
  let i = 0; while (i < A.length && A[i] === B[i]) i++;
  console.error(`   第一处差异在第 ${i} 字符：\n   实得 …${A.slice(Math.max(0, i - 60), i + 60)}\n   预期 …${B.slice(Math.max(0, i - 60), i + 60)}`);
  process.exit(1);
}
console.log(`\n合计：角色 ${next.characters.length} · 关系 ${next.relations.length} · 事件 ${next.events.length}`);
console.log(`文本：${raw.length} → ${text.length} 字符（只增了 ${text.length - raw.length} 字符，其余字节未动）`);

if (!WRITE) {
  console.log('\n（预览模式，未落盘。加 --write 落盘）');
  process.exit(0);
}
fs.writeFileSync(FILE, text);
console.log(`\n✓ 已写入 ${path.relative(ROOT, FILE)}`);
