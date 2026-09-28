#!/usr/bin/env node
/**
 * v0.36 别名补全：字号 / 异体译名 / 常用俗称（三本书）
 *
 * 为什么：读者习惯用「字/号/俗称/自己那版译名」搜索——数据里只有全名就搜不到。
 * 规则（写进 README）：`aliases` 收全名以外的所有叫法：字、号、俗称、小名、异体译名、简称。
 * 只加**确定**的（不确定的字宁可留空）。
 */
import fs from 'node:fs';

const table = {
  // ── 三国演义：字 / 号 / 俗称 ──
  'data/three-kingdoms.json': {
    'li-jue': ['稚然'],
    'cao-song': ['巨高'],
    'cao-teng': ['季兴'],
    'chen-tai': ['玄伯'],
    'li-ru': ['文优'],
    'wang-ping': ['子均'],
    'huang-quan': ['公衡'],
    'sun-jun': ['子远'],
    'liao-hua': ['元俭'],
    'liu-feng': ['寇封'],
    'he-jin': ['遂高'],
    'meng-da': ['子度'],
    'cao-hong': ['子廉'],
    'xiahou-ba': ['仲权'],
    'cao-zhang': ['子文'],
    'chen-gong': ['公台'],
    'yuan-shang': ['显甫'],
    'hua-xin': ['子鱼'],
    'pang-de': ['令明'],
    'guo-huai': ['伯济'],
    'gongsun-zan': ['白马将军'],
    'chen-deng': ['元龙'],
    'cao-ren': ['子孝'],
    'jia-xu': ['文和'],
    'xun-you': ['公达'],
    'liu-yu': ['伯安'],
    'zhuge-ke': ['元逊'],
    'sun-yi': ['叔弼'],
    'cao-chun': ['子和'],
    'cheng-pu': ['德谋'],
    'han-dang': ['义公'],
    'tao-qian': ['恭祖'],
    'mi-zhu': ['子仲'],
    'zhang-lu': ['公祺'],
    'zhuge-jin': ['子瑜'],
    'zhou-tai': ['幼平'],
    'li-dian': ['曼成'],
    'wang-lang': ['景兴'],
    'guan-lu': ['公明'],
    'zhang-xiu': ['张绣（北地枪王）'],
    'yan-liang': ['颜良（河北名将）'],
    'wen-chou': ['文丑（河北名将）'],
    'guan-ping': ['关平（关羽之子）'],
    'liu-cong': ['刘琮（刘表次子）'],
    'liu-qi': ['刘琦（刘表长子）'],
    'ma-dai': ['马岱（马超从弟）'],
    'yang-feng': ['杨奉（白波帅）'],
    'zhuge-zhan': ['思远'],
  },
  // ── 百年孤独：异体译名 ──
  'data/one-hundred-years-of-solitude.json': {
    'victorio-medina': ['维多里奥·梅迪纳', '维多里奥·梅迪纳将军', '麦丁纳将军'],
    'pietro-crespi': ['皮埃特罗·克雷斯皮', '克雷斯皮', '克雷斯比'],
    'aurelianos-17': ['奥雷里亚诺·特里斯特（修铁路的那个）', '奥雷里亚诺·森特诺', '奥雷里亚诺·塞拉多'],
    'jose-arcadio-5': ['霍塞·阿卡迪奥（第五代）'],
    'amaranta-ursula': ['阿玛兰塔·乌苏拉'],
    'apolinar-moscote': ['摩斯科特', '阿波利纳尔·摩斯科特', '莫科特市长'],
    'petra-cotes': ['佩特拉', '科特斯'],
    'mr-brown': ['布朗先生（香蕉公司）'],
    'mauricio': ['马乌里肖·巴比伦尼亚'],
    'cataure': ['卡塔乌雷王子', '瓜希拉王子'],
    'visitacion': ['比西塔西翁', '维希塔香'],
    'remedios-beauty': ['美人儿雷梅苔丝', '俏姑娘雷梅苔丝'],
    'aureliano-babilonia': ['奥雷良诺·巴比伦尼亚', '小奥雷里亚诺'],
    'ursula': ['乌苏拉', '乌苏拉·伊瓜兰'],
    'jose-arcadio-buendia': ['霍塞·阿卡迪奥·布恩迪亚', '霍塞·阿卡迪奥', '老布恩迪亚'],
  },
  // ── 罪与罚：异体译名 / 小名 ──
  'data/crime-and-punishment.json': {
    'zosimov': ['佐西莫夫'],
    'raskolnikov': ['罗佳', '罗吉昂', '拉斯科利尼科夫', '拉斯柯尼科夫'],
    'dunya': ['杜涅奇卡', '杜尼娅', '杜妮亚'],
    'sonya': ['索尼娅', '索尼雅', '索涅奇卡'],
    'katerina': ['卡佳', '卡捷琳娜·伊万诺夫娜', '卡捷琳娜·伊凡诺芙娜'],
    'pulkheria': ['普尔赫莉娅', '普莉赫丽雅·亚历山大罗芙娜'],
    'razumikhin': ['拉祖米兴', '德米特利·拉祖米欣'],
    'porfiry': ['波尔费利', '预审官波尔菲利'],
    'svidrigailov': ['斯维德里盖洛夫'],
    'marmeladov': ['马尔梅拉多夫'],
    'luzhin': ['卢津'],
    'lebezyatnikov': ['列别佳特尼科夫'],
    'alyona': ['阿廖娜·伊万诺夫娜', '阿辽娜·伊凡诺芙娜'],
    'lizaveta': ['丽扎维达·伊万诺夫娜'],
    'katerina-daughter': ['波莲卡', '波琳娜'],
  },
};

for (const [file, map] of Object.entries(table)) {
  if (!fs.existsSync(file)) { console.log('（跳过，文件不存在）' + file); continue; }
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map(b.characters.map((c) => [c.id, c]));
  let added = 0, missIds = [];
  for (const [id, list] of Object.entries(map)) {
    const c = byId.get(id);
    if (!c) { missIds.push(id); continue; }
    const before = (c.aliases || []).length;
    c.aliases = [...new Set([...(c.aliases || []), ...list])].filter((a) => a && a !== c.name);
    added += c.aliases.length - before;
  }
  fs.writeFileSync(file, JSON.stringify(b, null, 2) + '\n', 'utf8');
  console.log(`${file}：+${added} 个别名${missIds.length ? `（找不到的 id：${missIds.join('、')}）` : ''}`);
}
