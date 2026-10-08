#!/usr/bin/env node
/**
 * v0.151：修三处「id 撞车」造成的**关系挂错 id**。
 *
 * 起因：v0.147/v0.148 修完「吴懿—刘璋 / 孟达—邓贤」后，用「关系事件章节跨度」扫全库，
 * 又抓到三处同族缺陷 —— 都不是「没拆」，而是**关系挂错了 id**（其中两处的「正确 id」其实早就存在）。
 *
 * ① `zhang-bao`（黄巾张宝）挂着一条第 96 章「孔明令张苞接应赵云」的关系 ——
 *    张苞是张飞之子，**已有独立 id** `zhang-bao-zhangfei`（firstCh 82）。⇒ 改指。
 *
 * ② `li-feng`（李封，**吕布**副将，第 12 回被许褚斩）混进了两种「李丰」：
 *    · `li-yan -> li-feng | 父子`（第 101 章「孔明用李严之子李丰为长史」）——
 *      而 `li-yan -> li-feng-liyan | 父子` **早已存在** ⇒ 这条是**重复且错误**的边，**直接删**。
 *      （它连锁推导出一条「li-feng 与 li-feng-liyan 同父异母的兄弟」的假边，删边后重跑 derive 即消失。）
 *    · `yuan-shu -> li-feng | 君臣`、`lv-bu -> li-feng | 敌对`（第 17 章袁术部将李丰）——
 *      无独立 id ⇒ 新建 `li-feng-yuanshu`。
 *    另：`li-feng` 的 note 原写「袁术部将」，与 title「吕布部将」**自相矛盾** ——
 *    原文第 12 回：「吕布…召副将薛兰、李封曰…」⇒ 李封是**吕布**副将。
 *
 * ③ `zhang-wen` 挂着 4 条第 86 章关系（孙权遣张温使蜀、秦宓难张温…）—— 那是**东吴张温**，
 *    与档案里的「汉司空张温（第 8 回被董卓斩）」是两个人。原文第 8 回注释说得最清楚：
 *    「同时有两张温。此一张温，乃汉张温也；后孙权使张温至蜀，乃吴张温也。」
 *    ⇒ 新建 `zhang-wen-wu`，4 条改指；`zhang-wen` 的 aliases「惠恕」是**吴**张温的字，一并移过去。
 *
 * 用法：node scripts/fix-id-collisions-v151.mjs
 */
import fs from 'node:fs';

const P = 'data/three-kingdoms.json';
const b = JSON.parse(fs.readFileSync(P, 'utf8'));
const byId = new Map(b.characters.map((c) => [c.id, c]));

const fail = (m) => { console.error('✗ ' + m); process.exit(1); };

/** 定位**唯一**关系（多一条少一条都算异常，宁可停下）。 */
function rel(from, to) {
  const hit = b.relations.filter((r) => r.from === from && r.to === to);
  if (hit.length !== 1) fail(`期望 ${from}->${to} 恰有 1 条关系，实际 ${hit.length}`);
  return hit[0];
}
/** 断言关系事件文案里有某关键词（证明改的是对的那条）。 */
function assertText(r, kw) {
  const s = (r.events || []).map((e) => e.text || '').join(' ');
  if (!s.includes(kw)) fail(`${r.from}->${r.to} 的事件文案里没有「${kw}」（实际：${s}）`);
}
/** 把新角色插在某个已有角色后面（保持相关 id 相邻，diff 更清晰）。 */
function insertAfter(anchor, obj) {
  const i = b.characters.findIndex((c) => c.id === anchor);
  if (i < 0) fail(`找不到插入锚点 ${anchor}`);
  if (byId.has(obj.id)) fail(`角色 ${obj.id} 已存在`);
  b.characters.splice(i + 1, 0, obj);
  console.log(`✓ 新增角色 ${obj.id}（${obj.name}）→ 插在 ${anchor} 之后`);
}

/* ══════════ ① 张苞 ══════════ */
{
  const r = rel('zhuge-liang', 'zhang-bao');
  assertText(r, '张苞');
  r.to = 'zhang-bao-zhangfei';
  console.log('✓ ① zhuge-liang->zhang-bao 改指 zhang-bao-zhangfei（张飞之子张苞）');
}

/* ══════════ ② 李封 / 李丰 ══════════ */
{
  const dup = rel('li-yan', 'li-feng');
  assertText(dup, '李严之子李丰');
  if (!b.relations.some((x) => x.from === 'li-yan' && x.to === 'li-feng-liyan')) fail('li-yan->li-feng-liyan 不存在，不能删重复边');
  b.relations = b.relations.filter((x) => x !== dup);
  console.log('✓ ② 删除重复且错误的 li-yan->li-feng 父子边（正确边 li-yan->li-feng-liyan 已在）');

  for (const [from, to] of [['yuan-shu', 'li-feng'], ['lv-bu', 'li-feng']]) {
    const r = rel(from, to);
    assertText(r, '李丰');
    r.to = 'li-feng-yuanshu';
    console.log(`✓ ② ${from}->li-feng 改指 li-feng-yuanshu（袁术部将李丰）`);
  }

  const c = byId.get('li-feng');
  c.note = '吕布副将，第12回与薛兰守兖州，被许褚两合斩于马下。⚠ 勿与「袁术部将李丰」（li-feng-yuanshu）、「李严之子李丰」（li-feng-liyan）混。';
  console.log('✓ ② li-feng 的 note 更正（原写「袁术部将」，与 title「吕布部将」矛盾）');

  insertAfter('li-feng', {
    id: 'li-feng-yuanshu', name: '李丰', aliases: [], generation: 1, gender: 'm',
    firstCh: 17, faction: 'qunxiong', title: '袁术部将',
    desc: '为催进使接应七路，守寿春',
    fate: '寿春城破被曹操生擒，斩于市',
    note: '袁术部将。与吕布副将「李封」（li-feng）、李严之子「李丰」（li-feng-liyan）均非一人。',
    tier: 'minor',
  });
}

/* ══════════ ③ 张温（汉 / 吴） ══════════ */
{
  const MOVES = [
    ['sun-quan', 'zhang-wen'],
    ['zhang-wen', 'deng-zhi'],
    ['qin-mi', 'zhang-wen'],
    ['zhuge-liang', 'zhang-wen'],
  ];
  for (const [from, to] of MOVES) {
    const r = rel(from, to);
    const ch = (r.events || [])[0]?.chapter || '';
    if (!ch.includes('86')) fail(`${from}->${to} 的章节不是第 86 章（实际「${ch}」）`);
    if (from === 'zhang-wen') r.from = 'zhang-wen-wu';
    else r.to = 'zhang-wen-wu';
    console.log(`✓ ③ ${from}->${to} 改指 zhang-wen-wu（东吴张温，第 86 章）`);
  }

  const c = byId.get('zhang-wen');
  c.aliases = [];
  c.note = '汉司空，第8回被董卓诬为结连袁术、命吕布揪下堂斩之。原文第8回注释：「同时有两张温。此一张温，乃汉张温也；后孙权使张温至蜀，乃吴张温也。」东吴张温见 zhang-wen-wu。';
  console.log('✓ ③ zhang-wen 的 note 更正 + aliases「惠恕」移走（惠恕是**吴**张温的字）');

  insertAfter('zhang-wen', {
    id: 'zhang-wen-wu', name: '张温', aliases: ['惠恕'], generation: 1, gender: 'm',
    firstCh: 86, faction: 'wu', title: '东吴使臣',
    desc: '孙权遣其与邓芝入川通好，秦宓以天为问折之',
    fate: '使蜀后还吴',
    note: '东吴张温（字惠恕）。与汉司空张温（zhang-wen，第8回被董卓斩）是两个人 —— 原文第8回注释明言「同时有两张温」。',
    tier: 'minor',
  });
}

/* ══════════ 写回 ══════════ */
fs.writeFileSync(P, JSON.stringify(b, null, 2) + '\n');
console.log(`\n✓ 写回 ${P}（角色 ${b.characters.length} · 关系 ${b.relations.length}）`);
