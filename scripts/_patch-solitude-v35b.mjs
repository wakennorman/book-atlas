#!/usr/bin/env node
/**
 * 百年孤独·人物补全（第二轮，v0.35b）
 *  抽查发现前期整理时漏掉的人物：加泰罗尼亚智者 + 他的三个同乡（阿尔瓦罗/赫尔曼/阿方索）、阿基莱斯·里卡多上校
 *  原则不变：有出场/行动 → 入图；每条关系都要写得出"定义关系的小事件"；宁缺勿错
 */
import fs from 'node:fs';

const FILE = 'data/one-hundred-years-of-solitude.json';
const b = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(b.characters.map((c) => [c.id, c]));
const log = [];

const ADD = [
  {
    id: 'catalan-sage', name: '加泰罗尼亚智者', aliases: ['加泰罗尼亚人', '书店老板'], generation: 1, faction: 'outsider',
    title: '书店老板 · 加泰罗尼亚人',
    desc: '在马孔多开了间书店，由着奥雷里亚诺·巴比伦白看书，还给他讲欧洲的风物；几个加泰罗尼亚人每天在他店里争论。',
    fate: '卖掉书店回了故乡，后来又写信说想念马孔多、还想回来。',
    gender: 'm', firstCh: 11,
  },
  {
    id: 'alvaro', name: '阿尔瓦罗', aliases: [], generation: 1, faction: 'outsider',
    title: '加泰罗尼亚人 · 书店常客', desc: '书店那一伙加泰罗尼亚人里最健谈的一个，下午聚在书店后间争论不休。',
    fate: '在马孔多耗着，始终没动身回故乡。', gender: 'm', firstCh: 12,
  },
  {
    id: 'herman', name: '赫尔曼', aliases: [], generation: 1, faction: 'outsider',
    title: '加泰罗尼亚人 · 书店常客', desc: '和阿尔瓦罗一起在书店里争论、听留声机，也拉着奥雷里亚诺·巴比伦用纸牌算命。',
    fate: '和同乡们一样，把回乡的日子一拖再拖。', gender: 'm', firstCh: 12,
  },
  {
    id: 'alfonso', name: '阿方索', aliases: [], generation: 1, faction: 'outsider',
    title: '加泰罗尼亚人 · 书店常客', desc: '书店那几个加泰罗尼亚人中最年轻的一个，跟着他们一泡就是一下午。',
    fate: '最后一批离开马孔多的人里，就有他。', gender: 'm', firstCh: 12,
  },
  {
    id: 'achilles-ricardo', name: '阿基莱斯·里卡多上校', aliases: ['阿基莱斯·里卡多'], generation: 1, faction: 'gov',
    title: '政府军上校', desc: '保守党／政府军一方的军官，率部攻下被自由党人占据的马孔多。',
    fate: '攻下马孔多后，据守的阿尔卡蒂奥被擒处决。', gender: 'm', firstCh: 7,
  },
];

for (const c of ADD) {
  if (byId.has(c.id)) continue;
  b.characters.push({ ...c, aliases: c.aliases || [] });
  byId.set(c.id, b.characters[b.characters.length - 1]);
  log.push('＋ 人物：' + c.name);
}

const hasRel = (a, c) => b.relations.some((r) => (r.from === a && r.to === c) || (r.from === c && r.to === a));
const addRel = (rel, label) => {
  if (hasRel(rel.from, rel.to)) { log.push('· 已存在：' + label); return; }
  b.relations.push(rel);
  log.push('＋ 关系：' + label);
};

addRel({
  from: 'catalan-sage', to: 'aureliano-babilonia', type: '忘年交／启蒙', kin: '', style: 'solid',
  events: [{ text: '小奥雷里亚诺几乎每个下午都泡在加泰罗尼亚人的书店里看那些没人买的书，店主由着他看，还给他讲欧洲的事。', chapter: '第12章', place: 'macondo' }],
}, '加泰罗尼亚智者 —忘年交／启蒙— 奥雷里亚诺·巴比伦（第12章）');

addRel({
  from: 'catalan-sage', to: 'alvaro', type: '同乡／旧友', kin: '', style: 'solid',
  events: [{ text: '几个加泰罗尼亚人每天下午在书店后间争论，生意冷清，谁也没真打算回故乡。', chapter: '第12章', place: 'macondo' }],
}, '加泰罗尼亚智者 —同乡／旧友— 阿尔瓦罗（第12章）');

addRel({
  from: 'alvaro', to: 'aureliano-babilonia', type: '朋友', kin: '', style: 'solid',
  events: [{ text: '阿尔瓦罗和赫尔曼、阿方索把奥雷里亚诺·巴比伦拉进他们的下午：争论、听留声机、用纸牌算命。', chapter: '第12章', place: 'macondo' }],
}, '阿尔瓦罗 —朋友— 奥雷里亚诺·巴比伦（第12章）');

addRel({
  from: 'herman', to: 'aureliano-babilonia', type: '朋友', kin: '', style: 'solid',
  events: [{ text: '赫尔曼用纸牌给奥雷里亚诺·巴比伦算命，说他哪儿也去不了——这话后来应验了。', chapter: '第12章', place: 'macondo' }],
}, '赫尔曼 —朋友— 奥雷里亚诺·巴比伦（第12章）');

addRel({
  from: 'alfonso', to: 'aureliano-babilonia', type: '朋友', kin: '', style: 'solid',
  events: [{ text: '阿方索是那伙人里最年轻的；他们一起在马孔多耗掉一个个下午，直到最后一个一个离开。', chapter: '第13章', place: 'macondo' }],
}, '阿方索 —朋友— 奥雷里亚诺·巴比伦（第13章）');

addRel({
  from: 'achilles-ricardo', to: 'arcadio', type: '对阵／处决', kin: '', style: 'dashed',
  events: [{ text: '阿基莱斯·里卡多上校率政府军攻下马孔多；据守的阿尔卡蒂奥被擒，随后被枪决。', chapter: '第7章', place: 'escuela' }],
}, '阿基莱斯·里卡多上校 —对阵／处决— 阿尔卡蒂奥（第7章）');

fs.writeFileSync(FILE, JSON.stringify(b, null, 2) + '\n', 'utf8');
console.log(log.join('\n'));
console.log('\n现在：人物 ' + b.characters.length + ' / 关系 ' + b.relations.length + ' / 事件 ' + b.events.length);
