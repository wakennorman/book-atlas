#!/usr/bin/env node
/**
 * v0.53 效力变化（lordHistory）：三国里"换主公"的人（旧主 → 新主）
 *
 * 数据约定：
 *   characters[].lordHistory = [{ lord: '人物 id' | ''（空＝自立/无主）, fromCh, label }]
 *   · 按 fromCh 升序；lord 必须是本书人物的 id（空字符串表示自立）
 *   · 与 factionHistory 的区别：faction 是"阵营归属"（魏蜀吴…），lord 是"具体主公"
 *     —— 吕布 丁原→董卓→自立，阵营一直是"群雄"，只有 lordHistory 能表达
 *   · 只写有把握的
 */
import fs from 'node:fs';

const FILE = 'data/three-kingdoms.json';
const b = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const byId = new Map(b.characters.map((c) => [c.id, c]));
const missing = [];

const HIST = {
  'lv-bu':        [{ lord: 'ding-yuan', fromCh: 3, label: '丁原（义父）' }, { lord: 'dong-zhuo', fromCh: 4, label: '董卓（义父）' }, { lord: '', fromCh: 12, label: '自立（据徐州）' }],
  'zhang-liao':   [{ lord: 'lv-bu', fromCh: 3, label: '吕布帐下' }, { lord: 'cao-cao', fromCh: 20, label: '白门楼后归曹操' }],
  'chen-gong':    [{ lord: 'cao-cao', fromCh: 4, label: '中牟县令随曹操' }, { lord: 'lv-bu', fromCh: 11, label: '转投吕布' }, { lord: '', fromCh: 19, label: '白门楼不降，赴死' }],
  'jia-xu':       [{ lord: 'dong-zhuo', fromCh: 9, label: '董卓帐下' }, { lord: 'li-jue', fromCh: 11, label: '李傕帐下' }, { lord: 'zhang-xiu', fromCh: 18, label: '张绣帐下' }, { lord: 'cao-cao', fromCh: 23, label: '随张绣降曹操' }],
  'zhang-he':     [{ lord: 'yuan-shao', fromCh: 22, label: '袁绍帐下' }, { lord: 'cao-cao', fromCh: 30, label: '官渡战降曹操' }],
  'xu-shu':       [{ lord: 'liu-bei', fromCh: 35, label: '刘备帐下' }, { lord: 'cao-cao', fromCh: 36, label: '母亲被扣，被迫归曹操' }],
  'zhao-yun':     [{ lord: 'gongsun-zan', fromCh: 7, label: '公孙瓒帐下' }, { lord: 'liu-bei', fromCh: 28, label: '古城相会，归刘备' }],
  'taishi-ci':   [{ lord: '', fromCh: 11, label: '扬州刘繇帐下' }, { lord: 'sun-ce', fromCh: 15, label: '归孙策' }],
  'gan-ning':     [{ lord: 'huang-zu', fromCh: 38, label: '江夏黄祖帐下' }, { lord: 'sun-quan', fromCh: 39, label: '投孙权' }],
  'wen-pin':      [{ lord: 'liu-biao', fromCh: 34, label: '刘表帐下' }, { lord: 'cao-cao', fromCh: 41, label: '刘琮降曹后归曹操' }],
  'wei-yan':      [{ lord: 'han-xuan', fromCh: 41, label: '长沙韩玄帐下' }, { lord: 'liu-bei', fromCh: 53, label: '长沙归刘备' }],
  'huang-zhong':  [{ lord: 'han-xuan', fromCh: 41, label: '长沙韩玄帐下' }, { lord: 'liu-bei', fromCh: 53, label: '长沙归刘备' }],
  'fa-zheng':     [{ lord: 'liu-zhang', fromCh: 59, label: '刘璋帐下' }, { lord: 'liu-bei', fromCh: 60, label: '迎刘备入蜀' }],
  'ma-chao':      [{ lord: 'ma-teng', fromCh: 10, label: '随父马腾起兵' }, { lord: 'han-sui', fromCh: 58, label: '与韩遂联兵' }, { lord: 'zhang-lu', fromCh: 64, label: '兵败投张鲁' }, { lord: 'liu-bei', fromCh: 65, label: '葭萌关归刘备' }],
  'pang-de':      [{ lord: 'ma-chao', fromCh: 58, label: '随马超起兵' }, { lord: 'zhang-lu', fromCh: 64, label: '随马超投张鲁' }, { lord: 'cao-cao', fromCh: 67, label: '随张鲁降曹操' }],
  'jiang-wei':    [{ lord: 'ma-zun', fromCh: 92, label: '天水太守马遵帐下' }, { lord: 'zhuge-liang', fromCh: 93, label: '归降诸葛亮' }],
};

let n = 0;
for (const [id, list] of Object.entries(HIST)) {
  const c = byId.get(id);
  if (!c) { missing.push(id); continue; }
  const bad = list.filter((s) => s.lord && !byId.has(s.lord));
  if (bad.length) { missing.push(id + '（人物 id 不存在：' + bad.map((x) => x.lord).join(',') + '）'); continue; }
  c.lordHistory = [...list].sort((a, b2) => a.fromCh - b2.fromCh);
  n++;
}
fs.writeFileSync(FILE, JSON.stringify(b, null, 2) + '\n', 'utf8');
console.log(`已写入 lordHistory：${n} 人${missing.length ? '（跳过：' + missing.join('、') + '）' : ''}`);
console.log('示例：', byId.get('lv-bu').name, JSON.stringify(byId.get('lv-bu').lordHistory.map((s) => (s.lord ? byId.get(s.lord).name : '自立') + '@' + s.fromCh)));
