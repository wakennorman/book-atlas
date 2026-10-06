#!/usr/bin/env node
/**
 * 小程序冒烟测试（不需要微信开发者工具）
 *
 * 做法：用假的 wx / Page / canvas 2D 上下文把 pages/index/index.js 真跑一遍，
 * 断言：数据加载、渲染调用、面板内容、章节/剧透/时间旅行、布局切换都不报错且形状正确。
 *
 * 用法：node miniprogram/test/smoke.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MP = path.resolve(HERE, '..');

/* ---------- 假 canvas 2D 上下文 ---------- */
const calls = { fillText: 0, arc: 0, stroke: 0, fillRect: 0 };
const ctx = {
  setLineDash() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
  quadraticCurveTo() {}, arc() { calls.arc++; }, rect() {},
  fill() {}, stroke() { calls.stroke++; }, save() {}, restore() {}, clip() {},
  translate() {}, scale() {}, clearRect() {},
  fillRect() { calls.fillRect++; }, fillText() { calls.fillText++; },
  measureText: (t) => ({ width: String(t).length * 6 }),
  globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', lineCap: '',
};
const fakeCanvas = { width: 0, height: 0, getContext: () => ctx };

/* ---------- 假 wx / Page ---------- */
const storage = new Map();
const toasts = [];
const albumSaves = [];
const shareMenus = [];
let pageDef = null;
globalThis.wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, v),
  showToast: (o) => { toasts.push((o && o.title) || ''); },
  showLoading: () => {}, hideLoading: () => {},
  showModal: () => {}, openSetting: () => {},
  showActionSheet: (o) => { if (o.success) o.success({ tapIndex: 0 }); },        // 选「保存到相册」
  saveImageToPhotosAlbum: (o) => { albumSaves.push(o.filePath); if (o.success) o.success({}); },
  showShareImageMenu: (o) => { shareMenus.push(o.path); },
  createOffscreenCanvas: (o) => ({ width: o.width, height: o.height, getContext: () => ctx }),
  canvasToTempFilePath: (o) => { if (o.success) o.success({ tempFilePath: 'wxfile://tmp/card.jpg' }); },
  getSystemInfoSync: () => ({ pixelRatio: 2 }),
  createSelectorQuery: () => ({
    select: () => ({ fields: () => ({ exec: (cb) => cb([{ node: fakeCanvas, width: 900, height: 620 }]) }) }),
  }),
};
globalThis.Page = (def) => { pageDef = def; };

require(path.join(MP, 'pages', 'index', 'index.js'));
if (!pageDef) { console.error('✗ 页面没有注册（Page() 没被调用）'); process.exit(1); }

/* ---------- 造一个页面实例 ---------- */
const inst = Object.assign({}, pageDef);
inst.data = JSON.parse(JSON.stringify(pageDef.data));
inst.setData = (obj) => Object.assign(inst.data, obj);

const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); else console.log('  ✓ ' + msg); };

console.log('— 加载与渲染 —');
inst.onLoad();
inst.onReady();
ok(inst.g && inst.g.pack.slug === 'one-hundred-years-of-solitude', '默认加载《百年孤独》');
ok(inst.data.bookTitles.length === 3, '书目有 3 本');
ok(calls.fillText > 0 && calls.arc > 0, `渲染真的画了（文本 ${calls.fillText} 次 / 圆 ${calls.arc} 次）`);
ok(/人 · \d+ 段关系/.test(inst.data.status), '状态行格式正确：' + inst.data.status);
ok(inst.view.scale > 0.01 && inst.view.scale < 3, 'fitView 缩放合理：' + inst.view.scale.toFixed(3));

console.log('— 面板：人物 / 关系 / 章节 —');
inst.openChar('ursula');
ok(inst.data.panel && inst.data.panel.kind === 'char', '点人物出人物面板');
ok(inst.data.panel.rels.length > 0 && inst.data.panel.life.length > 0, `人物面板有 ${inst.data.panel.rels.length} 条关系 / ${inst.data.panel.life.length} 条事件`);
ok(/血缘|婚姻|收养|抚养|继亲|姻亲|结义|/.test(inst.data.panel.rels.map((r) => r.kin).join('')), '关系带亲属徽章字段');
const someRel = inst.g.visible().links[0];
inst.openRel(someRel);
ok(inst.data.panel.kind === 'rel' && inst.data.panel.evs.length > 0, `点连线出关系面板（${inst.data.panel.evs.length} 条依据事件）`);
inst.openChapter();
ok(inst.data.panel.kind === 'chapter', '章节面板打开');
ok(typeof inst.data.panel.sub === 'string' && inst.data.panel.sub.length > 4, '章节摘要：' + inst.data.panel.sub.slice(0, 40));

console.log('— 章节 / 剧透 / 时间旅行 —');
inst.setChapter(6);
ok(inst.data.chapter === 6, '翻到第 6 章');
inst.markRead();
ok(inst.data.progress === 6, '「我读到这一章了」把进度设为 6');
inst.setChapter(9);
inst.openChar('ursula');
ok(inst.data.panel.lockedRels === undefined || inst.data.panel.lockedRels >= 0, '剧透保护下面板仍可打开（带锁定计数）');
inst.toggleTime();
ok(inst.data.timeTravel === true && inst.g.asOf() === 6, '时间旅行打开后上限夹到第 6 章（asOf=' + inst.g.asOf() + '）');
inst.setChapter(3);
ok(inst.g.asOf() === 3, '时间旅行拨到第 3 章');
inst.onTimeSlide({ detail: { value: 5 } });
ok(inst.g.asOf() === 5 && inst.data.chapter === 5, '滑块拨到第 5 章');
inst.toggleTime();
ok(inst.data.timeTravel === false, '关掉时间旅行');

console.log('— 布局 / 过滤 / 手势 —');
const before = inst.g.state.layout;
inst.cycleLayout();
ok(inst.g.state.layout !== before && inst.data.layoutLabel.length > 0, `布局切换：${before} → ${inst.g.state.layout}（${inst.data.layoutLabel}）`);
inst.cycleSize();
ok(['mid', 'main'].indexOf(inst.g.state.sizeFilter) >= 0, '人数过滤切换：' + inst.data.sizeLabel);
inst.cycleSize(); inst.cycleSize(); inst.cycleSize();
inst.toggleMinor();
ok(inst.data.showMinor === true, '次要人物开关');
inst.toggleLabels();
ok(inst.data.allLabels === true, '标签开关');
// 手势：拖动（平移）与轻点（命中）
inst.onTouchStart({ touches: [{ x: 400, y: 300 }] });
inst.onTouchMove({ touches: [{ x: 460, y: 330 }] });
inst.onTouchEnd({ changedTouches: [{ x: 460, y: 330 }] });
ok(true, '拖动不报错（平移 ' + Math.round(inst.view.tx) + ',' + Math.round(inst.view.ty) + '）');
const pos = inst.g.pack.layouts[inst.g.state.layout].pos;
const firstId = inst.g.pack.characters[0].id;
const p = pos[firstId];
const sx = p[0] * inst.view.scale + inst.view.tx;
const sy = p[1] * inst.view.scale + inst.view.ty;
inst.onTouchStart({ touches: [{ x: sx, y: sy }] });
inst.onTouchEnd({ changedTouches: [{ x: sx, y: sy }] });
ok(inst.data.panel && inst.data.panel.kind === 'char', '轻点节点 → 命中并打开面板（' + inst.data.panel.title + '）');
inst.closePanel();
ok(inst.data.panel === null, '关闭面板');

console.log('— 切书 —');
inst.onBook({ detail: { value: 2 } });
ok(inst.g.pack.slug === 'three-kingdoms', '切到《三国演义》');
/* 868 = 871 − 3：
 *   v0.100 删了 3 个只在《三国志》里、《三国演义》原文 0 次的人物（陶商 / 陶应 / 公孙晃）
 *   v0.106 删了 1 个（诸葛珪，原文 0 次）
 *   v0.112 **加了 1 个**（孙河）—— 修正 v0.105 把他误并进「孙和」的错误。
 *     「孙河」在原文里 0 次，但**人确实存在**：原文写「其父名河，本姓俞氏，
 *     孙策爱之，赐姓孙」。姓是孙策刚赐的，所以原文里不写"孙河"。
 *   v0.116 又**加了 8 个**（刘繇/朱隽/赵范/陈应/鲍隆/杨陵/徐氏/张皇后）——
 *   v0.117 合并了误建的朱隽（与原有朱儁实为一人，正文作朱隽）⇒ 净 +7
 *     换用「X曰」说话人信号找到的，逐条回原文核过（audit-search 那份
 *     "姓氏+1字"的清单产出的是「养父子、伏兵、连环计」这类普通词，没法用）。
 * ⚠ 这个数字是**硬编码的期望值**，故意不写成"读数据里的长度" ——
 *   那样写就等于"数据是多少就认为多少"，人数被误删也照样绿。 */
ok(inst.g.pack.characters.length === 875, '三国 875 人');
inst.render();
ok(/三国演义/.test(inst.data.status), '状态行跟着书变：' + inst.data.status);
inst.setChapter(31);
inst.toggleTime();
ok(inst.g.asOf() === 31, '三国 · 时间旅行拨到第 31 章');
const caoYuan = inst.g.visible().links.filter((r) => (r.from === 'cao-cao' && r.to === 'yuan-shao') || (r.from === 'yuan-shao' && r.to === 'cao-cao'));
ok(caoYuan.length === 1 && caoYuan[0].type === '敌对', `第 31 章 曹操↔袁绍 只剩「${caoYuan.length ? caoYuan[0].type : '（空）'}」这一条（阶段关系生效）`);

console.log('— 搜索 —');
if (inst.data.timeTravel) inst.toggleTime();      // 先关掉时间旅行（否则第 31 章时诸葛亮还没出场）
inst.setData({ searchText: '孔明' });
inst.onSearchConfirm();
ok(inst.data.panel && inst.data.panel.kind === 'char' && /诸葛亮/.test(inst.data.panel.title), `按字号搜到：${inst.data.panel && inst.data.panel.title}`);
const viewBefore = inst.view.tx;
inst.setData({ searchText: '孟德' });
inst.onSearchConfirm();
ok(inst.data.panel && /曹操/.test(inst.data.panel.title) && Math.abs(inst.view.tx - viewBefore) > 1,
  `按字搜到并居中：${inst.data.panel && inst.data.panel.title}（tx ${Math.round(viewBefore)} → ${Math.round(inst.view.tx)}）`);
inst.markRead();                                  // 当前章节 = 31 → 开剧透保护
inst.setData({ searchText: '姜维' });
const toastBefore = toasts.length;
inst.onSearchConfirm();
ok(toasts.length > toastBefore && /才出场/.test(toasts[toasts.length - 1]), '搜未来人物会被剧透保护挡住：' + toasts[toasts.length - 1]);
inst.onSpoiler({ detail: { value: 0 } });          // 关掉保护
inst.setData({ searchText: '不存在的人' });
inst.onSearchConfirm();
ok(/没找到/.test(toasts[toasts.length - 1]), '搜不到会提示：' + toasts[toasts.length - 1]);

console.log('— 两人关系 —');
inst.openPathPick({ currentTarget: { dataset: { which: 'A' } } });
ok(inst.data.pathPick === 'A' && inst.data.pathList.length > 0, `选择面板打开（候选 ${inst.data.pathList.length} 人）`);
inst.onPathQuery({ detail: { value: '曹操' } });
ok(inst.data.pathList.length >= 1 && /曹操/.test(inst.data.pathList[0].name), '面板里可搜（' + inst.data.pathList[0].name + '）');
inst.pickPath({ currentTarget: { dataset: { id: inst.data.pathList[0].id, name: inst.data.pathList[0].name } } });
ok(inst.data.pathAId === 'cao-cao' && inst.data.pathALabel === '曹操', '选中 A：' + inst.data.pathALabel);
inst.openPathPick({ currentTarget: { dataset: { which: 'B' } } });
inst.onPathQuery({ detail: { value: '刘备' } });
inst.pickPath({ currentTarget: { dataset: { id: inst.data.pathList[0].id, name: inst.data.pathList[0].name } } });
ok(inst.data.pathBId === 'liu-bei', '选中 B：' + inst.data.pathBLabel);
inst.runPath();
ok(inst.data.panel && inst.data.panel.kind === 'path', '关系链面板打开：' + inst.data.panel.title);
ok(inst.data.panel.steps.length >= 1 && inst.data.panel.steps[0].evs.length > 0, `每一跳带依据事件（${inst.data.panel.steps.length} 跳）`);
ok(inst.highlight && inst.highlight.nodes.size >= 2 && inst.highlight.edges.size >= 1, '关系链在图上高亮');
inst.clearPath();
ok(!inst.highlight && inst.data.pathAId === '', '清除高亮与选择');

console.log('— 关系过滤 —');
const allLinks = inst.g.visible().links.length;
inst.applyFilter(['blood', 'marriage', 'adopt', 'sworn'], []);
const kinLinks = inst.g.visible().links.length;
ok(kinLinks > 0 && kinLinks < allLinks, `只看亲缘：${allLinks} → ${kinLinks} 条`);
ok(/筛选 4 项/.test(inst.data.edgeFilterLabel), '按钮文案：' + inst.data.edgeFilterLabel);
ok(inst.data.kinOptions.filter((o) => o.checked).length === 4, '复选框状态同步');
inst.preset({ currentTarget: { dataset: { k: 'enemy' } } });
const dashed = inst.g.visible().links;
ok(dashed.length > 0 && dashed.every((r) => r.style === 'dashed'), `只看对立·伤害：${dashed.length} 条且全是 dashed`);
const a2 = 'cao-cao', b2 = 'liu-bei';
const steps2 = inst.g.bfs(a2, b2);
ok(steps2 === null || steps2.every((s) => s.rel.style === 'dashed'),
  `两人关系只走可见的边（过滤后 ${steps2 ? steps2.length + ' 跳全是虚线' : '找不到通路'}）`);
inst.preset({ currentTarget: { dataset: { k: 'reset' } } });
ok(inst.g.visible().links.length === allLinks && inst.data.edgeFilterLabel === '关系：全部', '重置恢复全部');

console.log('— 分享卡片 —');
const textBefore = calls.fillText;
await inst.makeShareCard();
ok(inst.shareImage === 'wxfile://tmp/card.jpg', '生成卡片并拿到临时文件：' + inst.shareImage);
ok(calls.fillText > textBefore + 3, `卡片真的画了（新增 ${calls.fillText - textBefore} 次文本绘制）`);
ok(albumSaves.length === 1 && albumSaves[0] === inst.shareImage, '「保存到相册」被调用');
const share = inst.onShareAppMessage();
ok(/三国演义/.test(share.title) && share.imageUrl === inst.shareImage, '转发卡片就绪：' + share.title);
const timeline = inst.onShareTimeline();
ok(/三国演义/.test(timeline.title) && timeline.imageUrl === inst.shareImage, '朋友圈分享就绪');

console.log('— 无障碍（配色 / 字号） —');
const c0 = inst.g.factionColorOf(inst.g.byId.get('cao-cao'));
inst.setPalette({ currentTarget: { dataset: { palette: 'a11y' } } });
const c1 = inst.g.factionColorOf(inst.g.byId.get('cao-cao'));
ok(c0 !== c1 && /^#[0-9A-Fa-f]{6}$/.test(c1), `色盲友好配色生效：${c0} → ${c1}`);
ok(inst.g.factionColorByKey('wei') !== inst.g.factionColorByKey('wu'), '不同阵营拿到不同颜色');
const labelsM = inst.g.labels(0.5).length;
inst.setFont({ currentTarget: { dataset: { font: 'l' } } });
const labelsL = inst.g.labels(0.5).length;
ok(inst.g.fontScale() === 1.2, '字号档位 = ' + inst.g.fontScale());
ok(labelsL <= labelsM, `字号变大后标签数不增（${labelsM} → ${labelsL}）`);
ok(!!wx.getStorageSync('ba-display'), '显示设置存到本机');
inst.setFont({ currentTarget: { dataset: { font: 'm' } } });
inst.setPalette({ currentTarget: { dataset: { palette: 'default' } } });
ok(inst.g.fontScale() === 1 && inst.g.state.a11yPalette === false, '恢复默认');

console.log('');
if (fail.length) {
  console.error(`✗ 失败 ${fail.length} 项：\n  - ` + fail.join('\n  - '));
  if (toasts.length) console.error('  （页面 toast：' + toasts.slice(-4).join(' | ') + '）');
  process.exit(1);
}
console.log('✓ 全部通过（小程序页面逻辑冒烟）');
