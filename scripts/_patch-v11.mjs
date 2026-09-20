/** 补丁 v0.11 前置：给《罪与罚》补短名别名（搜索 + 文案校验都要用），并修《百年孤独》一处文案 */
import fs from 'node:fs';

const ALIAS = {
  raskolnikov: ['拉斯柯尔尼科夫'],
  pulkheria: ['普尔赫莉雅'],
  dunya: ['杜尼娅', '杜涅奇卡', '杜尼雅'],
  razumikhin: ['拉祖米欣', '符拉祖米欣'],
  marmeladov: ['玛尔美拉朵夫', '玛尔美拉多夫'],
  katerina: ['卡捷琳娜', '卡捷莉娜'],
  sonya: ['索尼娅', '索尼雅', '索涅奇卡'],
  polina: ['波莉卡', '波连卡'],
  alyona: ['阿辽娜'],
  lizaveta: ['丽扎维达'],
  svidrigailov: ['斯维德利盖洛夫', '斯维里加洛夫'],
  marfa: ['玛尔法'],
  luzhin: ['卢仁'],
  lebezyatnikov: ['列别齐亚特尼科夫'],
  landlady: ['普拉斯科维雅'],
  nastasya: ['娜斯达霞'],
  amalia: ['阿玛丽雅'],
  zosimov: ['左西莫夫'],
  zametov: ['扎麦托夫'],
  nikodim: ['尼科丁'],
  ilya: ['伊里亚'],
  porfiry: ['波尔菲利'],
  nikolai: ['米科莱', '尼古拉什卡', '尼古拉'],
  mityka: ['米季卡', '米特莱']
};

const cf = 'data/crime-and-punishment.json';
const cp = JSON.parse(fs.readFileSync(cf, 'utf8'));
let added = 0;
for (const c of cp.characters) {
  const extra = ALIAS[c.id] || [];
  const before = new Set(c.aliases || []);
  c.aliases = [...new Set([...(c.aliases || []), ...extra])];
  if (c.aliases.length !== before.size) added++;
}
fs.writeFileSync(cf, JSON.stringify(cp, null, 2), 'utf8');

const of = 'data/one-hundred-years-of-solitude.json';
const op = JSON.parse(fs.readFileSync(of, 'utf8'));
let fixed = 0;
for (const r of op.relations) {
  for (const ev of r.events || []) {
    if (ev.text.includes('没人知道他救过弟弟的命')) {
      ev.text = '没人知道何塞·阿尔卡蒂奥（第二代，绰号「巨人」）救过弟弟奥雷里亚诺的命：他从不向任何人提起阻止行刑那件事。';
      fixed++;
    }
  }
}
fs.writeFileSync(of, JSON.stringify(op, null, 2), 'utf8');

console.log(`✅ 罪与罚：${added} 个角色补了别名；百年孤独：修 ${fixed} 处文案`);
