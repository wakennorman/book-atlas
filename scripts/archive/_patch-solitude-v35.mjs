#!/usr/bin/env node
/**
 * 百年孤独·人物与别名补全（v0.35）
 *  · 补漏：卡塔乌雷（比西塔西翁之兄，失眠症再起时连夜逃走）
 *  · 别名：把**其他译本的写法**加进 aliases（换译本的人搜不到是硬伤）
 */
import fs from 'node:fs';

const FILE = 'data/one-hundred-years-of-solitude.json';
const b = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(b.characters.map((c) => [c.id, c]));
const log = [];

/* ---------- 1. 补人物：卡塔乌雷 ---------- */
if (!byId.has('cataure')) {
  b.characters.push({
    id: 'cataure',
    name: '卡塔乌雷',
    aliases: ['卡塔乌雷王子'],
    generation: 1,
    faction: 'outsider',
    title: '瓜希拉王国的王子 · 比西塔西翁之兄',
    desc: '比西塔西翁的哥哥，兄妹俩为躲避家乡的失眠症逃到马孔多；他比谁都先认出失眠症又来了。',
    fate: '失眠症重新出现时，他连夜逃走，从此再没回来。',
    gender: 'm',
    firstCh: 2,
  });
  byId.set('cataure', b.characters[b.characters.length - 1]);
  log.push('＋ 新增人物：卡塔乌雷（cataure）');
}

/* ---------- 2. 补关系：卡塔乌雷 ↔ 比西塔西翁 / 布恩迪亚家 ---------- */
const hasRel = (a, c) => b.relations.some((r) => (r.from === a && r.to === c) || (r.from === c && r.to === a));
if (!hasRel('cataure', 'visitacion')) {
  b.relations.push({
    from: 'cataure', to: 'visitacion', type: '兄妹', kin: 'blood', style: 'solid',
    events: [{
      text: '卡塔乌雷与妹妹比西塔西翁（维希塔香）一起从瓜希拉王国逃到马孔多，躲的就是家乡那场失眠症。',
      chapter: '第2章', place: 'macondo',
    }],
  });
  log.push('＋ 关系：卡塔乌雷 —兄妹— 比西塔西翁（第2章）');
}
if (!hasRel('cataure', 'ursula')) {
  b.relations.push({
    from: 'cataure', to: 'ursula', type: '寄居／辞别', style: 'dotted',
    events: [{
      text: '卡塔乌雷和妹妹寄住在布恩迪亚家；他一认出失眠症又回来了，就连夜逃走，乌尔苏拉再也没见过他。',
      chapter: '第2章', place: 'casa',
    }],
  });
  log.push('＋ 关系：卡塔乌雷 —寄居／辞别— 乌尔苏拉（第2章）');
}

/* ---------- 3. 事件里挂上卡塔乌雷 ---------- */
const ev = b.events.find((e) => e.id === 'e03');
if (ev) {
  const set = new Set(ev.chars || []);
  if (!set.has('cataure')) { set.add('cataure'); ev.chars = [...set]; log.push('＋ 事件「' + ev.name + '」chars 加卡塔乌雷'); }
  if (!set.has('visitacion')) { set.add('visitacion'); ev.chars = [...set]; log.push('＋ 事件「' + ev.name + '」chars 加维希塔香'); }
}

/* ---------- 4. 别名：其他译本的写法（换译本也能搜到） ---------- */
const ALIASES = {
  'jose-arcadio-buendia': ['霍塞·阿卡迪奥·布恩迪亚', '霍塞·阿卡迪奥'],
  'ursula': ['乌苏拉', '乌苏拉·伊瓜兰'],
  'jose-arcadio-2': ['霍塞·阿卡迪奥（第二代）', '霍塞·阿卡迪奥第二'],
  'aureliano-colonel': ['奥雷良诺·布恩迪亚上校', '奥雷良诺上校'],
  'aureliano-jose': ['奥雷良诺·霍塞'],
  'aureliano-segundo': ['奥雷良诺第二'],
  'jose-arcadio-segundo': ['霍塞·阿卡迪奥第二'],
  'amaranta': ['阿玛兰塔'],
  'rebeca': ['雷贝卡'],
  'melquiades': ['墨尔基阿德斯'],
  'pilar-ternera': ['皮拉·苔列娜'],
  'remedios-moscote': ['雷梅苔丝·莫科特', '雷梅黛丝·莫科特'],
  'remedios-beauty': ['美人儿雷梅苔丝', '俏姑娘雷梅苔丝'],
  'fernanda': ['菲南达'],
  'santa-sofia': ['圣索菲亚·德·拉·彼达'],
  'visitacion': ['比西塔西翁'],
  'arcadio': ['阿卡迪奥'],
  'meme': ['梅梅'],
  'mauricio': ['马乌里肖'],
  'mr-brown': ['布朗先生', '杰克·布朗'],
  'herbert': ['赫伯特先生'],
  'petra-cotes': ['佩特拉·科特斯'],
  'aureliano-babilonia': ['奥雷良诺·巴比伦尼亚', '奥雷良诺·布恩迪亚（第六代）'],
};
for (const [id, list] of Object.entries(ALIASES)) {
  const c = byId.get(id);
  if (!c) continue;
  const before = (c.aliases || []).length;
  c.aliases = [...new Set([...(c.aliases || []), ...list])].filter((a) => a && a !== c.name);
  if (c.aliases.length !== before) log.push(`别名 + ${c.name}：${c.aliases.slice(before).join('、')}`);
}

fs.writeFileSync(FILE, JSON.stringify(b, null, 2) + '\n', 'utf8');
console.log(log.join('\n'));
console.log('\n现在：人物 ' + b.characters.length + ' / 关系 ' + b.relations.length + ' / 事件 ' + b.events.length);
