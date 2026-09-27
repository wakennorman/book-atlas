#!/usr/bin/env node
/**
 * v0.44 阵营变化（factionHistory）：一本三国里"先在这个阵营、后来改投"的人
 *
 * 数据约定（新增字段）：
 *   characters[].factionHistory = [{ faction, fromCh, label }]
 *   · 按 fromCh 升序；最后一段应当等于 characters[].faction（最终归属）
 *   · 剧情保护开着的读者，看到的是"他读到那一回时"的阵营（颜色/分组都跟着变）
 *
 * 只写**有把握**的（回号来自原著情节，宁缺勿错）。
 */
import fs from 'node:fs';

const FILE = 'data/three-kingdoms.json';
const b = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(b.characters.map((c) => [c.id, c]));
const factionKeys = new Set(b.factions.map((f) => f.key));

const HIST = {
  'zhang-liao':  [{ faction: 'qunxiong', fromCh: 3, label: '吕布帐下' }, { faction: 'wei', fromCh: 20, label: '白门楼后归曹操' }],
  'jia-xu':      [{ faction: 'qunxiong', fromCh: 9, label: '董卓／李傕帐下' }, { faction: 'wei', fromCh: 23, label: '随张绣降曹操' }],
  'zhang-he':    [{ faction: 'qunxiong', fromCh: 22, label: '袁绍帐下' }, { faction: 'wei', fromCh: 30, label: '官渡战降曹操' }],
  'xu-shu':      [{ faction: 'shu', fromCh: 35, label: '刘备帐下' }, { faction: 'wei', fromCh: 36, label: '母亲被扣，被迫归曹操' }],
  'gan-ning':    [{ faction: 'qunxiong', fromCh: 38, label: '江夏黄祖帐下' }, { faction: 'wu', fromCh: 39, label: '投孙权' }],
  'wei-yan':     [{ faction: 'qunxiong', fromCh: 41, label: '长沙韩玄帐下' }, { faction: 'shu', fromCh: 53, label: '长沙归刘备' }],
  'huang-zhong': [{ faction: 'qunxiong', fromCh: 41, label: '长沙韩玄帐下' }, { faction: 'shu', fromCh: 53, label: '长沙归刘备' }],
  'fa-zheng':    [{ faction: 'qunxiong', fromCh: 59, label: '刘璋帐下' }, { faction: 'shu', fromCh: 60, label: '迎刘备入蜀' }],
  'ma-chao':     [{ faction: 'qunxiong', fromCh: 10, label: '西凉起兵' }, { faction: 'shu', fromCh: 65, label: '兵败后投刘备' }],
  'jiang-wei':   [{ faction: 'wei', fromCh: 92, label: '天水魏将' }, { faction: 'shu', fromCh: 93, label: '归降诸葛亮' }],
  'tai-shi-ci':  [{ faction: 'qunxiong', fromCh: 11, label: '扬州刘繇帐下' }, { faction: 'wu', fromCh: 15, label: '归孙策' }],
};

let n = 0;
const miss = [];
for (const [id, list] of Object.entries(HIST)) {
  const c = byId.get(id);
  if (!c) { miss.push(id); continue; }
  const bad = list.filter((s) => !factionKeys.has(s.faction));
  if (bad.length) { miss.push(id + '（阵营 key 不存在：' + bad.map((x) => x.faction).join(',') + '）'); continue; }
  const sorted = [...list].sort((a, b2) => a.fromCh - b2.fromCh);
  c.factionHistory = sorted;
  const last = sorted[sorted.length - 1];
  if (last.faction !== c.faction) {
    console.log(`   · ${c.name}：最终阵营 ${c.faction} → 按历史改为 ${last.faction}（${last.label}）`);
    c.faction = last.faction;
  }
  n++;
}
fs.writeFileSync(FILE, JSON.stringify(b, null, 2) + '\n', 'utf8');
console.log(`已写入 factionHistory：${n} 人${miss.length ? '（跳过：' + miss.join('、') + '）' : ''}`);
