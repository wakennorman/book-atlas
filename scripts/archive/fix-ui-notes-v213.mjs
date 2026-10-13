#!/usr/bin/env node
/**
 * 【已归档】2026-10-13　v0.213 债：一次性补丁，用完即归档。
 *                     结论去向：CHANGELOG.md 的 v0.213 段
 *                     留在这里是为了留痕「当时怎么改的」，不再是可执行入口。

 * 【一次性】v0.213　把 data 里「施工台账」从**渲染字段**里剥掉 —— 用完即归档。
 *                      结论去向：CHANGELOG.md 的 v0.213 段 + 门禁 check-ui-notes.mjs
 *
 * ## 起因
 *
 * 用户点人物卡时看到：「安帕萝·摩斯科特 …… 用户 2026-10-04 报"搜不到"的人之一」——
 * 内部施工备注（谁什么时候报的、哪一版合并拆分了谁）直接渲染给了读者。
 * 原话：「都说了不要把这种对用户无用的信息显示出来」。
 *
 * ## 排查结论（全类扫描，不止用户看到的那 2 处）
 *
 * 渲染面（浏览器直取的源文件）：`data/<slug>.json` 的 characters[].note / desc / fate /
 * title、relations[].events[].text、meta.note / meta.style，以及 data/annotations/<slug>.json。
 * 命中 **29 处 note**（三国 22 + 百年孤独 7）+ 1 处 relations[].note（罪与罚）+
 * 1 处 relations[].events[].text（百年孤独）+ 2 处 meta.style + 1 处 annotations note。
 * `*-ok.json` 等台账**不入镜**（浏览器从不 fetch 它们，只被门禁脚本读）⇒ 不在本脚本范围。
 *
 * ## 清法原则（每条改动都遵守）
 *
 *   剥掉施工框架，保留对读者有用的事实：原文引用、同名区分、身份澄清、出处说明。
 *   **删多于改**：版本号（v0.x）、「本轮」「用户 20xx-xx-xx 报」「曾误并/误建」「请人工复核」
 *   `id=`、`docs/` 引用、事件 id（e-92-3）一律删；事实句改写为读者视角。
 *   不新增任何未经原著验证的断言 —— 每条新文案都由旧 note 的片段拼成。
 *   sun-huan 整条 note 删除：其唯一实质（「孙桓请兵破蜀，孙权许之」）原著无此逐字句，
 *   且「封左都督、朱然为右都督」已由 sun-huan→zhu-ran 同僚边承载 ⇒ 无可留读者信息。
 *
 * ## 为什么用定点替换（而不是 JSON.stringify 整体重写）
 *
 * `data/three-kingdoms.json` 不是 `JSON.stringify(book, null, 2)` 的输出：
 * 实测往返差 12659 行（relations 尾段是紧凑混排格式：2 空格缩进 + 单行 events 对象）。
 * 整体重写会产生纯格式噪声、淹没 diff。本脚本对每个目标字段做**序列化后全文替换**
 * （替换锚 = 旧值的 JSON.stringify 形式，必须恰好出现 1 次），自检两阶段：
 *   ① 每个 from 子串在目标字段里恰好出现 1 次；
 *   ② 落盘结果的 JSON.parse 与「内存里同步变换后的对象」逐字相等（格式化无关）。
 *
 * 用法：
 *   node scripts/fix-ui-notes-v213.mjs          # 预览（不落盘）
 *   node scripts/fix-ui-notes-v213.mjs --write  # 落盘（幂等：已是目标值则跳过）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

/* ── 编辑清单 ──────────────────────────────────────────────────────────────
 * at  ：char:<id> / rel:<from>|<to> / meta / root
 * field：'note' | 'style' | 'events[0].text'
 * subs：[[from, to], …]  from 在字段值里必须恰好出现 1 次
 * drop：true = 删除整个字段（sun-huan）
 * ──────────────────────────────────────────────────────────────────────── */
const OPS = [
  /* ===== data/three-kingdoms.json ===== */
  { file: 'data/three-kingdoms.json', at: 'char:zhu-jun', field: 'note',
    subs: [['。v0.117 合并了 v0.116 误建的同一人。', '。']] },
  { file: 'data/three-kingdoms.json', at: 'char:cao-jie', field: 'note', subs: [
    ['⚠ 原先此节点同时混着「中常侍曹节（宦官）」与「曹操之女曹后」两个人（note 曾写「非曹节宦官」却没拆）。v0.126 已拆：曹操之女那一位移到 id=`cao-hou`「曹后」。★ 第120回注释第45条原文：',
     '⚠ 本节点是开篇那个宦官曹节。第120回注释第45条原文：'],
    ['本节点=开篇那个宦官，与「操曾祖曹节，字元伟」**不是同一人**（那个未建节点）。',
     '与「操曾祖曹节，字元伟」**不是同一人**；与曹操之女「曹后」也不是同一个人。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:lv-boshe', field: 'note',
    subs: [['※ v0.128 title 留空：第4回', '第4回']] },
  { file: 'data/three-kingdoms.json', at: 'char:li-bie', field: 'note', subs: [
    ['※ v0.120 改名：李别 → 李利。正文「李利」4 次；', '正文作「李利」（出现 4 次）；'],
    ['。与 v0.119 关纯→闵纯 同类。（正文用「李利」，「李别」是第120回注释里的写法。）', '—— 那个写法不是正文用字。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:wang-qi', field: 'note', subs: [
    ['此指邓艾部将，或与董卓部将王颀同名 ※ 已与第116回「天水太守王颀」（邓艾部将）拆分 —— 二人相隔 65 年（190 vs 255），是两个人。 ⚠ 与第116回「天水太守王颀」（邓艾部将，id=wang-qi-tianshui）**同名，是两个人**：本位于第9回长安国难殉难，那位在第116回领兵。原文两处都写作「王颀」。',
     '与第116回「天水太守王颀」（邓艾部将）**同名，是两个人**：本位于第9回长安国难殉难，那位在第116回领兵（二人相隔 65 年）。原文两处都写作「王颀」。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:huangfu-li', field: 'note',
    subs: [['※ v0.128 title 留空：原文只以', '原文只以']] },
  { file: 'data/three-kingdoms.json', at: 'char:yan-shi', field: 'note', subs: [
    ['吕布正妻，别于貂蝉、曹氏 ※ v0.128 复核：「正妻」是原文用语（第16回「先娶严氏为正妻」），同段还写明',
     '吕布正妻，别于貂蝉、曹氏。原文第16回「先娶严氏为正妻」；同段还写明'],
    ['。（我曾误以为"正"字是编的，回原文一查即证伪，未作修改。）', '。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:xu-gong-jia-ke', field: 'note',
    subs: [['三人合称 ※ v0.128 title 留空：第29回', '三人合称。第29回']] },
  { file: 'data/three-kingdoms.json', at: 'char:liu-xi', field: 'note', subs: [
    ['※ v0.120 改名：刘熙 → 刘靖。正文作「刘靖」；', '正文作「刘靖」；'],
    ['。（正文用「刘靖」，「刘熙」是第120回注释里的写法。）', '，不是正文用字。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:ma-dai', field: 'note',
    subs: [['。 ※ v0.125 原 fate 只有一个句号「。」，实为漏填。原文第104回', '。原文第104回']] },
  { file: 'data/three-kingdoms.json', at: 'char:lei-tong', field: 'note', subs: [
    ['⚠ v0.159 合并了被误拆的「雷同（巴西）」：原著只有一个雷同', '原著只有一个雷同'],
    ['。判据与教训见 docs/新书处理规程.md §2.7。', '。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:liu-shi-cao', field: 'note', subs: [
    [' ※ v0.125 与「liu-shi-caoang-mu」（原 desc：曹操夫人，生长子曹昂）合并 —— 原文里是同一人：第68回', '。生长子曹昂：第68回'],
    ['。原先拆成两个节点，一个只连儿子、一个只连曹操，图上看不出是一个人。合并时删掉了原文里不存在的别名「曹操刘夫人」。', '。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:sun-huan', field: 'note', drop: true },
  { file: 'data/three-kingdoms.json', at: 'char:sun-he', field: 'note',
    subs: [['。⚠ v0.105 曾把孙河（俞氏，孙策赐姓）与本者误并为一人，v0.112 已拆开。',
            '。孙河（本姓俞氏、孙策赐姓孙）是另一个人，不是他。']] },
  { file: 'data/three-kingdoms.json', at: 'char:pei-xu', field: 'note', subs: [
    ['。第92回两度出场（e-92-3 赚崔谅 / e-92-5 赚马遵）。⚠ 数据原先只记了崔谅那次、漏了马遵那次，本轮补上。⚠ 无关系边是有据的：原著里他不是任何人的亲属、也无长期交往，是一次性功能角色。',
     '。第92回两度出场（赚崔谅、赚马遵）。他不是任何人的亲属、也无长期交往，是一次性功能角色，所以没有关系边。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:dai-ling', field: 'note', subs: [
    ['。\n※ v0.120 改主名：戴陵 → 戴凌。\n※ v0.160 更正：本 note 原先写「只写姓氏『戴』，全名『戴陵』0 次（全名见《三国志·张郃传》）」—— 那句话只搜了**史书字形「戴陵」**，于是得出「原著不写全名」的错误印象。回原著逐字核：正文用的是',
     '。正文主名作'],
    ['「戴凌」，出现 **16 次**（第99–100回', '「戴凌」，第99–100回出现 16 次（如'],
    ['「懿令郃为先锋，戴凌为副将」「张郃、戴凌分付曰」「戴凌在左，张郃在右」「蜀兵困戴凌在垓心」「救出戴凌而回」「张虎、戴凌、乐綝」…），而「戴陵」**0 次**。\n⇒ 主名「戴凌」本来就是原书原样字；「戴陵」是《三国志》的写法，保留为别名。\n⚠ 原 note 写「原书未出现此人」是同一个错：查的是**字形**，不是人在不在。（本条原先在 data/three-kingdoms.name-form-ok.json 里有一条申报 —— 那也是多余的，v0.160 一并删了。）',
     '「懿令郃为先锋，戴凌为副将」「张虎、戴凌、乐綝」）；「戴陵」是《三国志》的写法，是别名不是原著用字。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:zhang-mao', field: 'note', subs: [
    ['字彦材 ※ v0.124 标注存疑：别名「彦材」**来源不明** —— 原文里「字彦材」只出现 1 处（参军傅干，字彦材），张茂（太子舍人，上表切谏兴造）从未被原文这样称呼。可能据史料补的，保留但请人工复核。',
     '字彦材（这个别名原著里没有：原文「字彦材」只出现 1 处，指的是参军傅干；张茂从未被原文这样称呼，可能是据史料补的）。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:guanqiu-jian', field: 'note', subs: [
    ['※ v0.121 与「qiu-jian」（上表报公孙渊造反）合并 —— 原文里是同一人：第105回「幽州刺史毌丘俭上表」、第110回「镇南都督毌丘俭」。原先拆成两个 id 且互为别名。',
     '第105回作「幽州刺史」（「幽州刺史毌丘俭上表」）、第110回作「镇南都督」（「镇南都督毌丘俭」），是同一个人的两任官职。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:liu-shi-cao-shuang', field: 'note',
    subs: [['※ v0.128 title 留空：第107回只写「其妻刘氏急出厅前，唤守府官问曰」——只说"曹爽的妻子"',
            '第107回只写「其妻刘氏急出厅前，唤守府官问曰」——只说曹爽的妻子']] },
  { file: 'data/three-kingdoms.json', at: 'char:sun-he-orig', field: 'note', subs: [
    ['。与孙权次子「孙和」是两个人，v0.105 曾误并为一人，v0.112 拆开。⚠ 原著从未交代孙河的父亲是谁（历史上是孙贲，小说没写），所以他在族谱里的绝对代号无从得知：现在 gen3 / 其子孙桓 gen4，只为了满足"父代号 < 子代号"。这个值**只影响布局，不影响推导** —derive-kin 与 check-kin-terms 都只读亲子边，不读 generation。',
     '。与孙权次子「孙和」是两个人。原著从未交代孙河的父亲是谁（历史上是孙贲，小说没写）。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:wang-qi-tianshui', field: 'note', subs: [
    ['。⚠ 与第9回越骑校尉王颀**非同一人**（相隔 65 年），原先被并成一个人。 ⚠ 与第9回「越骑校尉王颀」（id=wang-qi）**同名，是两个人**。',
     '。与第9回「越骑校尉王颀」同名，但是两个人（相隔 65 年）：那位在长安国难殉难，本人在第116回领兵。'],
  ] },
  { file: 'data/three-kingdoms.json', at: 'char:cao-hou', field: 'note',
    subs: [['※ v0.126 从「曹节」拆出。原文只以「曹后」称呼', '原文只以「曹后」称呼']] },

  /* ===== data/one-hundred-years-of-solitude.json ===== */
  { file: 'data/one-hundred-years-of-solitude.json', at: 'char:pedronila-iguaran', field: 'note', subs: [
    ['。⚠ 称谓**照抄原著**：', '。⚠ 称谓照抄原著：'],
    ['；本仓不替它推算辈分。⚠ 她是 v0.190 靠新增的「间隔号全名」规则才找出来的：姓氏规则看不见首字「佩」，而唯一锚得上的 `伊瓜兰` 又恰好是已知名 `乌尔苏拉·伊瓜兰` 的子串。', '。'],
  ] },
  { file: 'data/one-hundred-years-of-solitude.json', at: 'char:anapola-moscote', field: 'note',
    subs: [['。用户 2026-10-04 报"搜不到"的人之一。', '。']] },
  { file: 'data/one-hundred-years-of-solitude.json', at: 'char:tomas-escalona', field: 'note',
    subs: [['。用户 2026-10-04 报"搜不到"的人之一。', '。']] },
  { file: 'data/one-hundred-years-of-solitude.json', at: 'char:father-coronel', field: 'note', subs: [
    ['⚠ 用户曾误以为「新手」是安东尼奥·伊莎贝尔，原文里安东尼奥·伊莎贝尔是「“新手”的**继任者**」。',
     '安东尼奥·伊莎贝尔是「新手」的**继任者**，不是同一个人。'],
  ] },
  { file: 'data/one-hundred-years-of-solitude.json', at: 'char:francisco-el-aceptado', field: 'note', subs: [
    ['。【v0.100 更正】他的歌被**奥雷里亚诺第二**唱过（第10章哼着贴钞票、第20章拉手风琴演奏），⚠ 不是上校 —— 我原先挂错人了，见关系里的说明。',
     '。他的歌被**奥雷里亚诺第二**唱过（第10章哼着贴钞票、第20章拉手风琴演奏），不是上校。'],
  ] },
  { file: 'data/one-hundred-years-of-solitude.json', at: 'char:teofilo-vargas', field: 'note',
    subs: [['。⚠ v0.190 新加的「间隔号全名」规则把它列为**真漏人**，本轮补。', '。']] },
  { file: 'data/one-hundred-years-of-solitude.json', at: 'char:lorenzo-gavilan', field: 'note',
    subs: [['。⚠ v0.190 的「间隔号全名」规则把它列为真漏人，本轮补。', '。']] },
  { file: 'data/one-hundred-years-of-solitude.json', at: 'char:patricia-brown', field: 'note',
    subs: [['。⚠ v0.190 的「间隔号全名」规则把它列为真漏人，本轮补。', '。']] },
  { file: 'data/one-hundred-years-of-solitude.json', at: 'rel:aureliano-colonel|arcadio', field: 'events[0].text', subs: [
    ['（第6章。⚠ v0.102 更正：旧版此处是一句**转述被写成了引文**，拿 epub 全文逐字查不到，已按原文替换。）', '（第6章）'],
  ] },
  { file: 'data/one-hundred-years-of-solitude.json', at: 'meta', field: 'style',
    subs: [['事件与关系文案写作规范（v0.3 起）：', '事件与关系文案写作规范：']] },

  /* ===== data/crime-and-punishment.json ===== */
  { file: 'data/crime-and-punishment.json', at: 'rel:marmeladov|korya', field: 'note',
    subs: [['原标「父子 / 血缘」是错的。柯里亚是', '柯里亚是']] },

  /* ===== data/peak.json ===== */
  { file: 'data/peak.json', at: 'meta', field: 'style',
    subs: [['理论类书型（v0.206 新增）：', '理论类书型：']] },

  /* ===== data/annotations/three-kingdoms.json ===== */
  { file: 'data/annotations/three-kingdoms.json', at: 'root', field: 'note', subs: [
    ['拆书条目的依据是本项目 data/three-kingdoms.json 里已逐条核对过的 events（每条都有 summary / impact / quote / evidence 字段），events 字段列出的是这条拆解引用了哪些事件 id —— 可以逐条点开核对。',
     '拆书条目的依据是 events（每条都有 summary / impact / quote / evidence 字段）；items 里的 events 字段列出这条拆解引用了哪些事件 id，可以逐条点开核对。'],
    ['，素材见 docs/拆书素材-three-kingdoms*.md。', '。'],
  ] },

  /* ===== data/annotations/one-hundred-years-of-solitude.json =====
   * 门禁 check-ui-notes 首跑时追加发现（第 36 处）：同款施工语言 + 裸事件 id。
   * 该 note 浏览器不渲染（anno 只消费 items/global），但仍按渲染面口径清。 */
  { file: 'data/annotations/one-hundred-years-of-solitude.json', at: 'root', field: 'note', subs: [
    ['拆书条目的依据是本项目 data/one-hundred-years-of-solitude.json 里已逐条核对过的 events。', '拆书条目的依据是 events。'],
    ['只有 2 条带 quote（e01、e27），只有引用它们的两条标', '只有 2 条带 quote，只有引用它们的两条标'],
  ] },

  /* ===== data/annotations/crime-and-punishment.json =====
   * 第 37 处：补「内部数据文件引用」模式后门禁二次跑抓到（同款施工语言）。 */
  { file: 'data/annotations/crime-and-punishment.json', at: 'root', field: 'note', subs: [
    ['拆书条目的依据是本项目 data/crime-and-punishment.json 里已逐条核对过的 events（每条都有 summary / impact）。events 字段列出的是这条拆解引用了哪些事件 id —— 可以逐条点开核对。',
     '拆书条目的依据是 events（每条都有 summary / impact）；items 里的 events 字段列出这条拆解引用了哪些事件，可以逐条点开核对。'],
  ] },

  /* ===== data/annotations/peak.json =====
   * 第 38 处：同上；另把第一人称施工口吻（「我在原著里逐字核过」）改成无主语句。 */
  { file: 'data/annotations/peak.json', at: 'root', field: 'note', subs: [
    ['拆书条目的依据是本项目 data/peak.json 里已逐条核对过的 46 个事件与 44 个概念节点。',
     '拆书条目的依据是本书 46 个事件与 44 个概念节点。'],
    ['引号内只放我在原著里逐字核过的句子', '引号内只放在原著里逐字核过的句子'],
  ] },
];

/* ── 引擎 ─────────────────────────────────────────────────────────────── */

/** 定位目标对象（返回 {obj, label}；找不到返回 null）。 */
function resolve(book, op) {
  if (op.at.startsWith('char:')) {
    const id = op.at.slice(5);
    const obj = (book.characters || []).find((c) => c.id === id);
    return obj ? { obj, label: `${op.file} char:${id}(${obj.name})` } : null;
  }
  if (op.at.startsWith('rel:')) {
    const [from, to] = op.at.slice(4).split('|');
    const obj = (book.relations || []).find((r) => r.from === from && r.to === to);
    return obj ? { obj, label: `${op.file} rel:${from}→${to}` } : null;
  }
  if (op.at === 'meta') return { obj: book.meta || {}, label: `${op.file} meta` };
  if (op.at === 'root') return { obj: book, label: `${op.file} root` };
  return null;
}

const EV_RE = /^events\[(\d+)\]\.(\w+)$/;
function getField(obj, field) {
  const m = EV_RE.exec(field);
  if (m) { const e = (obj.events || [])[Number(m[1])]; return e ? e[m[2]] : undefined; }
  return obj[field];
}
function setField(obj, field, value) {
  const m = EV_RE.exec(field);
  if (m) { obj.events[Number(m[1])][m[2]] = value; return; }
  if (value === null) delete obj[field];
  else obj[field] = value;
}

/** 从 raw 文本里删掉目标字段所在的整行（note 恰为该对象最后一个字段的形态）。 */
function dropFieldLine(raw, field, value, label) {
  if (raw.includes('\r')) throw new Error(`${label}：文件含 CRLF，本脚本的按行删除只支持 LF`);
  const esc = JSON.stringify(value);
  const lines = raw.split('\n');
  const idx = lines.findIndex((l) => {
    const m = /^(\s*)"note": (.*?)(,?)$/.exec(l);
    return m && m[2] === esc;
  });
  if (idx < 0) throw new Error(`${label}：找不到「${field}」字段行（${esc.slice(0, 40)}…）`);
  const hadComma = lines[idx].endsWith(',');
  lines.splice(idx, 1);
  if (!hadComma) {
    /* note 是对象最后一个字段（行尾无逗号）⇒ 删行后上一行的尾逗号要一并去掉，
     * 否则 JSON 非法（尾逗号）。 */
    const prev = lines[idx - 1];
    if (prev !== undefined && prev.endsWith(',') && /^\s*[}\]]/.test(lines[idx] || '')) {
      lines[idx - 1] = prev.slice(0, -1);
    }
  }
  return lines.join('\n');
}

const files = new Map(); // relPath -> { raw, book, work, changed }
const entry = (rel) => {
  if (!files.has(rel)) {
    const abs = path.join(ROOT, rel);
    const raw = fs.readFileSync(abs, 'utf8');
    files.set(rel, { raw, book: JSON.parse(raw), work: JSON.parse(raw), changed: false });
  }
  return files.get(rel);
};

const problems = [];
const planned = [];

for (const op of OPS) {
  const e = entry(op.file);
  const t = resolve(e.work, op);
  if (!t) { problems.push(`${op.file} ${op.at}：定位失败（id 或 from/to 对不上）`); continue; }
  const cur = getField(t.obj, op.field);
  /* 幂等：drop 的字段已不在 ⇒ 已应用过。 */
  if (op.drop && (cur === undefined || cur === null)) {
    console.log(`  ＝ ${t.label}.${op.field} 已删除（跳过）`);
    continue;
  }
  if (typeof cur !== 'string' || !cur) {
    problems.push(`${t.label}.${op.field}：当前值不是非空字符串（${JSON.stringify(cur)?.slice(0, 40)}）`);
    continue;
  }
  let next = cur;
  let ok = true;
  for (const [from, to] of op.subs || []) {
    const n = next.split(from).length - 1;
    if (n !== 1) {
      /* 幂等判定：from 全不在、to 全在 ⇒ 上一轮已应用过 */
      const fromGone = (op.subs || []).every(([f]) => !next.includes(f));
      const toIn = (op.subs || []).every(([, x]) => next.includes(x));
      if (fromGone && toIn) { console.log(`  ＝ ${t.label} 已是目标值（跳过）`); next = cur; ok = false; break; }
      problems.push(`${t.label}.${op.field}：子串「${from.slice(0, 36)}…」出现 ${n} 次（期望恰好 1 次）`);
      ok = false; break;
    }
    next = next.replace(from, to);
  }
  if (!ok) continue;
  if (op.drop) {
    try { e.raw = dropFieldLine(e.raw, op.field, cur, t.label); }
    catch (err) { problems.push(err.message); continue; }
    setField(t.obj, op.field, null);
  } else {
    if (next === cur) { console.log(`  ＝ ${t.label} 已是目标值（跳过）`); continue; }
    const escOld = JSON.stringify(cur);
    const cnt = e.raw.split(escOld).length - 1;
    if (cnt !== 1) {
      problems.push(`${t.label}.${op.field}：旧值序列化在文件里出现 ${cnt} 次（期望恰好 1 次）`);
      continue;
    }
    e.raw = e.raw.replace(escOld, JSON.stringify(next));
    setField(t.obj, op.field, next);
  }
  e.changed = true;
  planned.push({ label: `${t.label}.${op.field}`, from: cur, to: next, drop: !!op.drop });
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} 处不能自动处理（未写任何文件）：`);
  for (const p of problems) console.error('   ✗ ' + p);
  process.exit(1);
}

/* 自检：落盘结果的 parse 必须与「内存里同步变换后的 work」逐字相等（格式化无关）。 */
for (const [rel, e] of files) {
  if (!e.changed) continue;
  const after = JSON.parse(e.raw);
  const a = JSON.stringify(after), b = JSON.stringify(e.work);
  if (a !== b) {
    console.error(`✗ 自检失败：${rel} 落盘结果与内存变换不一致`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error('  落盘：…' + a.slice(Math.max(0, i - 60), i + 60) + '…');
        console.error('  内存：…' + b.slice(Math.max(0, i - 60), i + 60) + '…');
        break;
      }
    }
    process.exit(1);
  }
}

console.log(`\n将修改 ${planned.length} 处字段（涉及 ${[...files].filter(([, e]) => e.changed).length} 个文件）：`);
for (const p of planned) {
  if (p.drop) {
    console.log(`  · ${p.label}　—— 删除整个字段（无读者信息可留）`);
    continue;
  }
  const clip = (s) => (s.length > 46 ? s.slice(0, 46) + '…' : s);
  console.log(`  · ${p.label}`);
  console.log(`      − ${clip(p.from.split('\n')[0])}${p.from.includes('\n') ? ' ⏎…' : ''}`);
  console.log(`      + ${clip(p.to.split('\n')[0])}${p.to.includes('\n') ? ' ⏎…' : ''}`);
}

if (!WRITE) { console.log('\n（预览）加 --write 才落盘。'); process.exit(0); }

for (const [rel, e] of files) {
  if (!e.changed) continue;
  fs.writeFileSync(path.join(ROOT, rel), e.raw, 'utf8');
  console.log(`✓ 已写入 ${rel}`);
}
console.log('\n下一步：node scripts/validate.mjs --all + 重生成三个产物（slim / miniprogram / anno-digest）');
