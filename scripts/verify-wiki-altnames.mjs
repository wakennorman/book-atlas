/**
 * 核实 S5（中文维基百科《百年孤独》词条）那 3 条 altNames，并记录判定。
 * v0.100 · 用户要求"网络通了先把 Wikipedia 那 3 条核实掉再推送"。
 *
 * 结论：
 *   ① 3 条全部**证实**在页面的「早期译名」列里，且 zh-hans / zh-tw / ?oldformat=true
 *      三个独立渲染版本给出一致文本 ⇒ 不是搜索引擎自己编的摘要。
 *   ② 但**页面仍然打不开**：`zh.wikipedia.org` 的 443 与 80 端口都不可达，
 *      而同一时刻 `github.com:443` 与 `www.guancha.cn:443` 都通
 *      ⇒ 依旧是这个执行环境到 *.wikipedia.org 的出口被挡，不是维基本身不可用。
 *      所以证据等级是「页面文本（经搜索通道取得，多版本互证）」，
 *      不是「我打开了页面」。这一点必须写在出处文件里，不能含糊过去。
 *   ③ 顺带发现**维基那一列自己有错** ⇒ 同一来源里另外 9 个候选必须**拒绝**，
 *      否则就是把上游的错误抄进数据。
 *
 * 用法：node scripts/verify-wiki-altnames.mjs          # 预览
 *      node scripts/verify-wiki-altnames.mjs --write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'one-hundred-years-of-solitude.altnames-sources.json');
const WRITE = process.argv.includes('--write');

/** 页面「早期译名」列里，**已被采用**的 3 条。 */
const VERIFIED = [
  { 人物: '美人儿蕾梅黛丝', 又译: '雷梅迪奥斯' },
  { 人物: '梅梅（雷纳塔·蕾梅黛丝）', 又译: '美美' },
  { 人物: '蕾梅黛丝·摩斯科特', 又译: '莫氏柯蒂' },
];

/**
 * 同一列里另外 9 个候选，**全部拒绝**，逐条写明理由。
 * 这一节的作用是**防止以后有人把它们抄进去**——
 * 「有出处」不等于「可以用」，出处本身可能是错的。
 */
const REJECTED = [
  { 又译: '亚玛伦塔', 页面挂在: '阿玛兰塔·波恩地亚 与 阿玛兰塔·乌苏拉·波恩地亚 两处',
    拒绝理由: '★ 同一个词被挂在**两个不同的人**名下（阿玛兰妲 与 阿玛兰妲·乌尔苏拉）——这是维基表格自己的复制粘贴错误。一个译名不可能同时是两个人的早期译法，说明这一格不可信。另：阿玛兰妲的 S1 出处已给出「阿玛兰塔」，够用了。' },
  { 又译: '阿克迪亚', 页面挂在: '阿尔卡迪欧 Arcadio',
    拒绝理由: '这条本身没有内部矛盾，但「阿克迪亚」是**地名 Macondo 的旧译**（阿卡迪亚），被安到人名 Arcadio 头上属于维基的错配；而且范晔本对「阿尔卡蒂奥」的选择有自己的说明（见 CHANGELOG），另有人名改译争议，不宜由维基这一列定。' },
  { 又译: '奥雷里亚诺', 页面挂在: '其馀十七个奥雷里亚诺',
    拒绝理由: '这不是「异译」，只是把名字写成裸的名。写进 altNames 会让搜索多命中一次无意义的结果。' },
  { 又译: '奥雷里亚诺约赛', 页面挂在: '奥雷里亚诺·荷西·波恩地亚',
    拒绝理由: '「荷西／约赛」是**名的音译差异**，不是姓氏译法差异；且本书已有 S4 出处的「十七个奥雷连诺」等更可靠的姓氏异译覆盖同一人群。此条增益低、出处弱，不采用。' },
  { 又译: '小邦迪亚／邦迪亚上校', 页面挂在: '奥雷里亚诺·波恩地亚（上校）',
    拒绝理由: 'S1（观察者网六译本并排引用，已是**正式出版译本**）已给出「邦迪亚上校」，出处等级高于维基。按"就近取最强出处"原则不重复登记。' },
  { 又译: '莉比卡', 页面挂在: '蕾贝卡 Rebeca',
    拒绝理由: 'S1 已给出「雷蓓卡」，同样是正式译本并排引用，出处更强。' },
  { 又译: '亚卡底奥', 页面挂在: '荷西·阿尔卡迪欧（第五代）',
    拒绝理由: '本书该人物的定名是「何塞·阿尔卡蒂奥（第五代）」，S1/S4 已覆盖其姓氏异译；「亚卡底奥」只换了名字的写法，且来源是维基单一列，不采用。' },
  { 又译: '倭良若', 页面挂在: '奥雷里亚诺·巴比隆尼亚',
    拒绝理由: '「倭良若」是把 Aureliano 生造为汉字音译，属**译者自造词**而非既有译本的写法；且 S1 已给出「奥雷良诺·巴比洛尼亚」。' },
];

const VERIFY_NOTE = {
  核实时间: '2026-10-05',
  核实方式: [
    '直接抓取页面：**失败**。zh.wikipedia.org / zh.m.wikipedia.org / w/index.php?action=raw',
    '/ api/rest_v1/page/html 全部在 21 秒后 "Unable to connect"；同一次测试里 github.com:443 与',
    'www.guancha.cn:443 都通 ⇒ 是这个执行环境到 *.wikipedia.org 的出口被挡，不是维基本身不可用。',
    '退而求其次：用搜索通道取回**页面正文文本**，并要求 zh-hans / zh-tw / ?oldformat=true',
    '三个独立渲染版本**给出一致的「早期译名：X」文本** ⇒ 不是搜索引擎自己编的摘要。',
  ],
  证据等级: '页面文本（经搜索通道取得、三个版本互证）。**不是**"我打开了页面逐字读过"。',
  结论: '3 条全部证实可留；同列另外 9 个候选全部拒绝（见「已拒绝的候选」），其中「亚玛伦塔」一条暴露了维基该列自身的复制粘贴错误。',
};

const f = JSON.parse(fs.readFileSync(FILE, 'utf8'));

console.log('=== 核实结论 ===');
console.log(`  已采用并证实：${VERIFIED.length} 条`);
for (const v of VERIFIED) console.log(`    ✓ ${v.人物}  ← ${v.又译}`);
console.log(`  已拒绝：${REJECTED.length} 条`);
for (const r of REJECTED) console.log(`    ✗ ${r.又译}（${r.拒绝理由.slice(0, 42)}…）`);

// 写进出处文件
f['S5核实记录'] = VERIFY_NOTE;
f['已拒绝的候选'] = REJECTED.map((r) => ({ 又译: r.又译, 页面挂在: r.页面挂在, 拒绝理由: r.拒绝理由 }));
f['来源'].S5.note = `${f['来源'].S5.note}　【${VERIFY_NOTE.核实时间} 复核】3 条已采用的全部在页面的「早期译名」列里，`
  + 'zh-hans / zh-tw / oldformat 三版本一致；但**页面在本执行环境仍不可达**，'
  + '证据是「搜索通道取得的页面文本」而非「打开页面逐字读」。同列另外 9 个候选已拒绝，见「已拒绝的候选」。';

// 核对已采用的 3 条确实在明细里
for (const v of VERIFIED) {
  const row = (f['明细'] ?? []).find((x) => x.人物 === v.人物);
  const ok = row && (row.又译 ?? []).includes(v.又译) && row.出处 === 'S5';
  console.log(`  ${ok ? '✓' : '✗'} 明细里 ${v.人物} ← ${v.又译}（出处 ${row ? row.出处 : '无'}）`);
  if (!ok) process.exitCode = 1;
}

if (WRITE) {
  fs.writeFileSync(FILE, JSON.stringify(f, null, 2) + '\n', 'utf8');
  console.log(`\n写入 ${path.relative(ROOT, FILE)}`);
} else {
  console.log('\n（预览模式，加 --write 才落盘）');
}
