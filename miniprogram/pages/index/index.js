/**
 * 书脉小程序 · 图谱页
 * 数据全部来自 ../../data/*.js（构建时生成：含预计算布局），不联网。
 */
const { createGraph } = require('../../utils/graph.js');
const { drawGraph, screenToWorld } = require('../../utils/render.js');
const { drawCard } = require('../../utils/card.js');
const catalog = require('../../data/books.js');
const PACKS = {
  'one-hundred-years-of-solitude': require('../../data/one-hundred-years-of-solitude.js'),
  'crime-and-punishment': require('../../data/crime-and-punishment.js'),
  'three-kingdoms': require('../../data/three-kingdoms.js'),
};

const LAYOUTS = ['gen-v', 'gen-h', 'force'];
const LAYOUT_LABEL = { 'gen-v': '分组·纵', 'gen-h': '分组·横', force: '自由' };
const SIZES = ['all', 'mid', 'main'];
const SIZE_LABEL = { all: '全部', mid: '中等', main: '主要' };
const KIN_LABEL = { blood: '血缘', marriage: '婚姻', inlaw: '姻亲', adoptive: '收养', foster: '抚养', step: '继亲', sworn: '结义' };
const KIN_OPTIONS = [
  { v: 'blood', t: '血缘' }, { v: 'marriage', t: '婚姻 · 姻亲' }, { v: 'adopt', t: '收养 · 抚养 · 继亲' },
  { v: 'sworn', t: '结义' }, { v: 'none', t: '无亲缘标注（朋友/君臣/敌对…）' },
];
const STYLE_OPTIONS = [
  { v: 'solid', t: '实线 · 亲缘/同盟' }, { v: 'dashed', t: '虚线 · 对立/伤害' }, { v: 'dotted', t: '点线 · 情人/过去/间接' },
];
// v89：edgeKey 改用 utils/graph.js 导出的那一份（原来这里有一份手抄，会和 graph.js 漂移）

Page({
  data: {
    bookTitles: [], bookIndex: 0,
    layoutLabel: '分组·纵', sizeLabel: '全部',
    showMinor: false, showMentioned: false, showDerived: true, allLabels: false,
    timeTravel: false, chapter: 1, timeCeil: 20, progress: null,
    spoilerOptions: [], chapterHint: '', status: '',
    searchText: '',
    pathAId: '', pathBId: '', pathALabel: '人物 A', pathBLabel: '人物 B',
    pathPick: '', pathQuery: '', pathList: [],
    filterOpen: false,
    displayOpen: false, paletteOn: false, fontSize: 'm',
    kinOptions: KIN_OPTIONS.map((o) => ({ v: o.v, t: o.t, checked: false })),
    styleOptions: STYLE_OPTIONS.map((o) => ({ v: o.v, t: o.t, checked: false })),
    edgeKins: [], edgeStyles: [], edgeFilterLabel: '关系：全部',
    panel: null,
  },

  onLoad() {
    const books = catalog.books;
    this.highlight = null;
    this.setData({ bookTitles: books.map((b) => b.title), bookIndex: 0 });
    this.loadBook(books[0].slug);
  },

  onReady() { this.initCanvas(); },

  /* ---------------- 数据 / 画布 ---------------- */
  loadBook(slug) {
    this.g = createGraph(PACKS[slug]);
    const g = this.g;
    try {
      const s = wx.getStorageSync('ba-spoiler-' + slug);
      if (s && s.on) g.state.progress = s.ch;
      const ch = wx.getStorageSync('ba-chapter-' + slug);
      if (ch) g.state.chapter = ch;
      const disp = wx.getStorageSync('ba-display');
      if (disp) {
        g.state.a11yPalette = !!disp.palette;
        g.state.fontSize = ['s', 'm', 'l'].includes(disp.fontSize) ? disp.fontSize : 'm';
      }
    } catch (e) { /* 忽略 */ }
    g.state.chapter = Math.max(1, Math.min(g.maxChapter(), g.state.chapter || g.state.progress || 1));
    const total = g.maxChapter();
    this.highlight = null;
    this.setData({
      chapter: g.state.chapter,
      timeCeil: g.timeCeiling(),
      progress: g.state.progress,
      spoilerOptions: ['关闭剧透保护'].concat(Array.from({ length: total }, (_, i) => `我读到第 ${i + 1} 章`)),
      pathA: -1, pathB: -1, pathHint: '', searchText: '', panel: null,
      edgeKins: g.state.edgeKins.slice(), edgeStyles: g.state.edgeStyles.slice(),
      edgeFilterLabel: '关系：全部', filterOpen: false,
      displayOpen: false, paletteOn: !!g.state.a11yPalette, fontSize: g.state.fontSize,
      kinOptions: KIN_OPTIONS.map((o) => ({ v: o.v, t: o.t, checked: false })),
      styleOptions: STYLE_OPTIONS.map((o) => ({ v: o.v, t: o.t, checked: false })),
    });
    this.refreshSelectable();
    if (this.ctx) { this.fitView(); this.render(); }
  },

  /** 两人关系的可选人物（吃剧透/折叠/时间旅行）——选择面板里按需过滤 */
  refreshSelectable() {
    this._selectable = this.g.selectable();
  },
  filterCandidates(q) {
    const s = String(q || '').trim();
    return (this._selectable || this.g.selectable())
      .filter((c) => !s || c.name.indexOf(s) >= 0 || (c.aliases || []).some((a) => a.indexOf(s) >= 0))
      .slice(0, 80)
      .map((c) => ({ id: c.id, name: c.name, deg: this.g.deg.get(c.id) || 0 }));
  },

  initCanvas() {
    const q = wx.createSelectorQuery();
    q.select('#graph').fields({ node: true, size: true }).exec((res) => {
      const item = res && res[0];
      if (!item || !item.node) return;
      const dpr = (wx.getSystemInfoSync && wx.getSystemInfoSync().pixelRatio) || 2;
      const node = item.node;
      node.width = item.width * dpr;
      node.height = item.height * dpr;
      const ctx = node.getContext('2d');
      ctx.scale(dpr, dpr);
      this.canvas = node;
      this.ctx = ctx;
      this.size = { width: item.width, height: item.height };
      this.view = { scale: 1, tx: item.width / 2, ty: item.height / 2 };
      this.fitView();
      this.render();
    });
  },

  fitView() {
    if (!this.g || !this.size) return;
    const pos = (this.g.pack.layouts[this.g.state.layout] || this.g.pack.layouts['gen-v']).pos;
    // 适配"当前画出来的人"（大书里被折叠的人会把包围盒撑得很大，图就会缩成一小团）
    const ids = this.g.visible().nodes.map((c) => c.id).filter((id) => pos[id]);
    /* v89：高亮（＝锁定）时图上只画高亮集合内的人，包围盒要按**他们**算 ——
       否则适配的是全图，锁定后那两三个人会缩成中间一个点。 */
    const hl = this.highlight;
    const lockedIds = hl && hl.nodes && hl.nodes.size ? [...hl.nodes].filter((id) => pos[id]) : null;
    const use = (lockedIds && lockedIds.length) ? lockedIds : (ids.length ? ids : Object.keys(pos));
    const xs = [], ys = [];
    for (const id of use) { xs.push(pos[id][0]); ys.push(pos[id][1]); }
    if (!xs.length) return;
    const spanX = Math.max(40, Math.max.apply(null, xs) - Math.min.apply(null, xs));
    const spanY = Math.max(40, Math.max.apply(null, ys) - Math.min.apply(null, ys));
    const pad = 36;
    const scale = Math.max(0.04, Math.min(3, Math.min((this.size.width - pad * 2) / spanX, (this.size.height - pad * 2) / spanY)));
    const cx = (Math.max.apply(null, xs) + Math.min.apply(null, xs)) / 2;
    const cy = (Math.max.apply(null, ys) + Math.min.apply(null, ys)) / 2;
    this.view = { scale, tx: this.size.width / 2 - cx * scale, ty: this.size.height / 2 - cy * scale };
  },

  /** 把某个节点移到画布中央（搜索/关系链用） */
  centerOn(id, minScale) {
    const pos = (this.g.pack.layouts[this.g.state.layout] || this.g.pack.layouts['gen-v']).pos[id];
    if (!pos || !this.size) return;
    const scale = Math.max(this.view.scale, minScale || 0.8);
    this.view = { scale, tx: this.size.width / 2 - pos[0] * scale, ty: this.size.height / 2 - pos[1] * scale };
  },

  render() {
    if (!this.g || !this.ctx) return;
    const g = this.g;
    const st = g.state;
    const n = g.visible();
    const status = `${g.pack.title} · ${LAYOUT_LABEL[st.layout]}` +
      (st.timeTravel ? ` · 🕰 第 ${g.asOf()} 章` : '') +
      (this.data.edgeKins.length + this.data.edgeStyles.length ? ` · 关系筛选 ${this.data.edgeKins.length + this.data.edgeStyles.length} 项` : '') +
      ` · ${n.nodes.length} / ${g.pack.characters.length} 人 · ${n.links.length} 段关系`;
    drawGraph(this.ctx, g, {
      width: this.size.width, height: this.size.height,
      scale: this.view.scale, tx: this.view.tx, ty: this.view.ty,
      theme: 'light', allLabels: this.data.allLabels, status,
      highlight: this.highlight,
    });
    this.setData({ status });
  },

  /* ---------------- 手势 ---------------- */
  onTouchStart(e) {
    const t = e.touches;
    if (!t || !t.length) return;
    this.touch = {
      x: t[0].x, y: t[0].y, moved: 0,
      pinch: t.length > 1 ? Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y) : 0,
      tx: this.view.tx, ty: this.view.ty, scale: this.view.scale,
    };
  },
  onTouchMove(e) {
    const t = e.touches;
    if (!this.touch || !t || !t.length) return;
    if (t.length > 1 && this.touch.pinch) {
      const k = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y) / this.touch.pinch;
      const ns = Math.max(0.04, Math.min(6, this.touch.scale * k));
      const cx = (t[0].x + t[1].x) / 2, cy = (t[0].y + t[1].y) / 2;
      const wx0 = (cx - this.touch.tx) / this.touch.scale;
      const wy0 = (cy - this.touch.ty) / this.touch.scale;
      this.view = { scale: ns, tx: cx - wx0 * ns, ty: cy - wy0 * ns };
    } else {
      const dx = t[0].x - this.touch.x, dy = t[0].y - this.touch.y;
      this.touch.moved = Math.max(this.touch.moved, Math.hypot(dx, dy));
      this.view = { scale: this.touch.scale, tx: this.touch.tx + dx, ty: this.touch.ty + dy };
    }
    this.render();
  },
  onTouchEnd(e) {
    const wasTap = this.touch && this.touch.moved < 8;
    this.touch = null;
    if (!wasTap) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    if (!t) return;
    const now = Date.now();
    if (this.lastTap && now - this.lastTap < 300) { this.lastTap = 0; this.highlight = null; this.fitView(); this.render(); return; }
    this.lastTap = now;
    const w = screenToWorld(this.view, t.x, t.y);
    const hit = this.g.hitTest(w[0], w[1], this.view.scale, this.highlight);
    if (hit && hit.kind === 'node') this.openChar(hit.id);
    else if (hit && hit.kind === 'edge') this.openRel(hit.rel);
    else { this.highlight = null; this.setData({ panel: null }); this.render(); }
  },

  /* ---------------- 搜索 ---------------- */
  onSearchInput(e) { this.setData({ searchText: e.detail.value }); },
  onSearchConfirm() {
    const q = String(this.data.searchText || '').trim();
    if (!q) return;
    const r = this.g.findChar(q);
    if (r && r.hit) {
      if (r.hidden) {                        // 被折叠的人：自动展开那一层
        const g = this.g;
        if (g.isMinor(r.hit)) { g.state.showMinor = true; this.setData({ showMinor: true }); }
        if (g.isMentioned(r.hit)) { g.state.showMentioned = true; this.setData({ showMentioned: true }); }
        this.refreshSelectable();
      }
      this.centerOn(r.hit.id, 0.9);
      this.render();
      this.openChar(r.hit.id);
      return;
    }
    if (r && r.locked) { wx.showToast({ title: `「${q}」第 ${this.g.charCh(r.locked)} 章才出场（剧透保护中）`, icon: 'none' }); return; }
    wx.showToast({ title: `没找到「${q}」`, icon: 'none' });
  },

  /* ---------------- 两人关系 ---------------- */
  openPathPick(e) {
    const which = (e.currentTarget && e.currentTarget.dataset.which) || 'A';
    this.setData({ pathPick: which, pathQuery: '', pathList: this.filterCandidates(''), panel: null });
  },
  closePathPick() { this.setData({ pathPick: '' }); },
  onPathQuery(e) { this.setData({ pathQuery: e.detail.value, pathList: this.filterCandidates(e.detail.value) }); },
  pickPath(e) {
    const { id, name } = e.currentTarget.dataset;
    if (this.data.pathPick === 'A') this.setData({ pathAId: id, pathALabel: name, pathPick: '' });
    else this.setData({ pathBId: id, pathBLabel: name, pathPick: '' });
  },
  runPath() {
    const { pathAId, pathBId } = this.data;
    if (!pathAId || !pathBId) { wx.showToast({ title: '先选两个人', icon: 'none' }); return; }
    const g = this.g;
    const steps = g.bfs(pathAId, pathBId);
    if (!steps) { this.setData({ pathHint: '在图里找不到通路', panel: null }); return; }
    this.setData({ pathHint: `最短 ${steps.length} 跳` });
    const nodes = new Set([pathAId]);
    const edges = new Set();
    for (const s of steps) { nodes.add(s.to); edges.add(g.edgeKey(s.from, s.to)); }
    this.highlight = { nodes, edges };
    this.fitView();          // v89：图上只剩这条链了，视野要跟着适配过去
    this.render();
    const html = steps.map((s, i) => {
      const evs = g.visibleRelEvents(s.rel);
      const hidden = (s.rel.events || []).length - evs.length;
      return {
        idx: i + 1,
        from: g.charName(s.from), to: g.charName(s.to), type: s.rel.type,
        kin: s.rel.kin ? (KIN_LABEL[s.rel.kin] || '') : '',
        period: g.periodText(s.rel),
        evs: evs.map((e) => ({ text: e.text, chapter: e.chapter || '', place: e.place ? g.placeName(e.place) : '' })),
        hidden,
      };
    });
    this.setData({
      panel: {
        kind: 'path',
        title: `关系链：${g.charName(pathAId)} → ${g.charName(pathBId)}`,
        sub: `共 ${steps.length} 跳 · 每一跳的「关系」与依据事件`,
        steps: html,
      },
    });
  },
  clearPath() {
    this.setData({ pathAId: '', pathBId: '', pathALabel: '人物 A', pathBLabel: '人物 B', pathHint: '' });
    this.highlight = null;
    this.render();
  },

  /* ---------------- 关系过滤 ---------------- */
  openFilter() { this.setData({ filterOpen: true, panel: null }); },
  closeFilter() { this.setData({ filterOpen: false }); },
  onKinChange(e) { this.applyFilter(e.detail.value, this.data.edgeStyles); },
  onStyleChange(e) { this.applyFilter(this.data.edgeKins, e.detail.value); },
  applyFilter(kins, styles) {
    const g = this.g;
    g.state.edgeKins = (kins || []).slice();
    g.state.edgeStyles = (styles || []).slice();
    const n = g.state.edgeKins.length + g.state.edgeStyles.length;
    this.setData({
      edgeKins: g.state.edgeKins,
      edgeStyles: g.state.edgeStyles,
      edgeFilterLabel: n ? `关系：筛选 ${n} 项` : '关系：全部',
      kinOptions: KIN_OPTIONS.map((o) => ({ v: o.v, t: o.t, checked: g.state.edgeKins.indexOf(o.v) >= 0 })),
      styleOptions: STYLE_OPTIONS.map((o) => ({ v: o.v, t: o.t, checked: g.state.edgeStyles.indexOf(o.v) >= 0 })),
    });
    this.highlight = null;
    this.render();
  },
  preset(e) {
    const k = e.currentTarget.dataset.k;
    if (k === 'kin') this.applyFilter(['blood', 'marriage', 'adopt', 'sworn'], []);
    else if (k === 'enemy') this.applyFilter([], ['dashed']);
    else this.applyFilter([], []);
  },

  /* ---------------- 显示设置（无障碍：配色 / 字号） ---------------- */
  openDisplay() { this.setData({ displayOpen: true, panel: null, pathPick: '', filterOpen: false }); },
  closeDisplay() { this.setData({ displayOpen: false }); },
  setPalette(e) {
    const on = (e.currentTarget.dataset.palette === 'a11y');
    this.g.state.a11yPalette = on;
    this.saveDisplay();
    this.setData({ paletteOn: on });
    this.render();
  },
  setFont(e) {
    const s = e.currentTarget.dataset.font;
    this.g.state.fontSize = ['s', 'm', 'l'].includes(s) ? s : 'm';
    this.saveDisplay();
    this.setData({ fontSize: this.g.state.fontSize });
    this.render();
  },
  saveDisplay() {
    try {
      wx.setStorageSync('ba-display', { palette: this.g.state.a11yPalette, fontSize: this.g.state.fontSize });
    } catch (e) { /* 忽略 */ }
  },

  /* ---------------- 工具栏 ---------------- */
  onBook(e) {
    const idx = Number(e.detail.value) || 0;
    this.setData({ bookIndex: idx });
    this.loadBook(catalog.books[idx].slug);
  },
  cycleLayout() {
    const st = this.g.state;
    st.layout = LAYOUTS[(LAYOUTS.indexOf(st.layout) + 1) % LAYOUTS.length];
    this.setData({ layoutLabel: LAYOUT_LABEL[st.layout] });
    this.highlight = null;
    this.fitView();
    this.render();
  },
  cycleSize() {
    const st = this.g.state;
    st.sizeFilter = SIZES[(SIZES.indexOf(st.sizeFilter) + 1) % SIZES.length];
    this.setData({ sizeLabel: SIZE_LABEL[st.sizeFilter] });
    this.refreshSelectable();
    this.render();
  },
  toggleMinor() {
    const st = this.g.state;
    st.showMinor = !st.showMinor;
    this.setData({ showMinor: st.showMinor });
    this.refreshSelectable();
    this.render();
  },
  toggleMentioned() {
    const st = this.g.state;
    st.showMentioned = !st.showMentioned;
    this.setData({ showMentioned: st.showMentioned });
    this.refreshSelectable();
    this.render();
  },
  toggleDerived() {
    const st = this.g.state;
    st.showDerived = !st.showDerived;
    this.setData({ showDerived: st.showDerived });
    this.render();
  },
  toggleLabels() {
    this.setData({ allLabels: !this.data.allLabels });
    this.render();
  },

  /* ---------------- 分享卡片 ---------------- */
  async makeShareCard() {
    if (this.shareBusy) return;
    this.shareBusy = true;
    wx.showLoading({ title: '正在生成…' });
    try {
      const W = 1200, H = 900;
      if (!this.shareCanvas) this.shareCanvas = wx.createOffscreenCanvas({ type: '2d', width: W, height: H });
      const ctx = this.shareCanvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      drawCard(ctx, this.g, { width: W, height: H, theme: 'light', layoutLabel: LAYOUT_LABEL[this.g.state.layout] });
      const path = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas: this.shareCanvas, fileType: 'jpg', quality: 0.92,
          success: (r) => resolve(r.tempFilePath),
          fail: (e) => reject(new Error((e && e.errMsg) || 'canvasToTempFilePath 失败')),
        });
      });
      this.shareImage = path;
      wx.hideLoading();
      const tap = await new Promise((resolve) => {
        wx.showActionSheet({
          itemList: ['保存到相册', '发送给好友'],
          success: (r) => resolve(r.tapIndex),
          fail: () => resolve(-1),
        });
      });
      if (tap === 0) await this.saveShareImage(path);
      else if (tap === 1) this.sendShareImage(path);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '生成失败：' + ((e && e.message) || e), icon: 'none' });
    } finally {
      this.shareBusy = false;
    }
  },
  saveShareImage(path) {
    return new Promise((resolve) => {
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success: () => { wx.showToast({ title: '已保存到相册', icon: 'success' }); resolve(true); },
        fail: (e) => {
          const msg = String((e && e.errMsg) || '');
          if (/auth|deny/i.test(msg)) {
            wx.showModal({
              title: '需要相册权限', content: '请在设置里允许「保存到相册」', confirmText: '去设置',
              success: (r) => { if (r.confirm && wx.openSetting) wx.openSetting({}); },
            });
          } else wx.showToast({ title: '保存失败', icon: 'none' });
          resolve(false);
        },
      });
    });
  },
  sendShareImage(path) {
    if (wx.showShareImageMenu) {
      wx.showShareImageMenu({ path, fail: () => wx.showToast({ title: '分享失败（基础库需 2.14.4+）', icon: 'none' }) });
    } else {
      wx.showToast({ title: '当前基础库不支持图片分享', icon: 'none' });
    }
  },
  onShareAppMessage() {
    return {
      title: this.g ? `《${this.g.pack.title}》人物关系图 · 书脉` : '书脉 BookAtlas',
      path: '/pages/index/index',
      imageUrl: this.shareImage || '',
    };
  },
  onShareTimeline() {
    return {
      title: this.g ? `《${this.g.pack.title}》人物关系图 · 书脉` : '书脉 BookAtlas',
      imageUrl: this.shareImage || '',
    };
  },

  /* ---------------- 剧透保护 / 章节 / 时间旅行 ---------------- */
  onSpoiler(e) {
    const idx = Number(e.detail.value) || 0;
    const g = this.g;
    g.state.progress = idx === 0 ? null : idx;
    if (g.state.timeTravel) g.state.chapter = Math.min(g.state.chapter, g.timeCeiling());
    try { wx.setStorageSync('ba-spoiler-' + g.pack.slug, { on: idx !== 0, ch: idx }); } catch (err) { /* 忽略 */ }
    this.highlight = null;
    this.setData({ progress: g.state.progress, timeCeil: g.timeCeiling(), chapter: g.state.chapter, pathHint: '' });
    this.refreshSelectable();
    this.render();
  },
  prevChapter() { this.setChapter(this.g.state.chapter - 1); },
  nextChapter() { this.setChapter(this.g.state.chapter + 1); },
  setChapter(n) {
    const g = this.g;
    g.state.chapter = Math.max(1, Math.min(g.maxChapter(), n || 1));
    try { wx.setStorageSync('ba-chapter-' + g.pack.slug, g.state.chapter); } catch (e) { /* 忽略 */ }
    this.setData({ chapter: g.state.chapter });
    if (g.state.timeTravel) { this.highlight = null; this.refreshSelectable(); this.render(); }
  },
  toggleTime() {
    const g = this.g;
    g.state.timeTravel = !g.state.timeTravel;
    if (g.state.timeTravel) g.state.chapter = Math.min(g.state.chapter, g.timeCeiling());
    this.highlight = null;
    this.setData({ timeTravel: g.state.timeTravel, chapter: g.state.chapter, pathHint: '' });
    this.refreshSelectable();
    this.render();
  },
  onTimeSlide(e) {
    this.setChapter(Number(e.detail.value) || 1);
    this.render();
  },
  markRead() {
    const g = this.g;
    const ch = g.state.chapter;
    g.state.progress = ch;
    if (g.state.timeTravel) g.state.chapter = Math.min(g.state.chapter, g.timeCeiling());
    try { wx.setStorageSync('ba-spoiler-' + g.pack.slug, { on: true, ch }); } catch (e) { /* 忽略 */ }
    this.setData({ progress: ch, timeCeil: g.timeCeiling(), chapter: g.state.chapter });
    this.refreshSelectable();
    this.render();
    wx.showToast({ title: `已标记：读到第 ${ch} 章`, icon: 'none' });
  },

  /* ---------------- 底部面板 ---------------- */
  closePanel() { this.setData({ panel: null }); },
  openChapter() {
    const g = this.g;
    const n = this.data.chapter;
    const locked = g.state.progress !== null && n > g.state.progress;
    const d = g.chapterDigest(n);
    this.setData({
      panel: {
        kind: 'chapter', title: `第 ${n} 章`,
        sub: locked ? `🔒 你读到第 ${g.state.progress} 章` : `本章 ${d.charsHere.length} 人出场 · 新增关系 ${d.relsNew.length} 条 · 事件 ${d.events.length} 个 · 地点 ${d.places.length} 处`,
        locked,
        newChars: d.charsNew.map((c) => c.name),
        newRels: d.relsNew.slice(0, 10).map((r) => `${g.charName(r.from)} — ${r.type} — ${g.charName(r.to)}`),
        events: d.events.map((e) => ({ ch: e.ch, name: e.name, summary: e.summary })),
        places: d.places.map((id) => g.placeName(id)),
      },
    });
  },
  openChar(id) {
    const g = this.g;
    const c = g.byId.get(id);
    if (!c) return;
    if (g.charLocked(c)) { wx.showToast({ title: `第 ${g.charCh(c)} 章才出场（剧透保护中）`, icon: 'none' }); return; }
    const rels = g.pack.relations
      .filter((r) => (r.from === id || r.to === id) && !g.relLocked(r) && g.relVisibleAt(r) && g.relVisible(r))
      .sort((a, b) => (g.deg.get(b.from === id ? b.to : b.from) || 0) - (g.deg.get(a.from === id ? a.to : a.from) || 0))
      .slice(0, 12)
      .map((r) => {
        const other = r.from === id ? r.to : r.from;
        const ev = g.visibleRelEvents(r)[0];
        return {
          other: g.charName(other), type: r.type,
          kin: r.kin ? (KIN_LABEL[r.kin] || '') : '',
          period: g.periodText(r),
          ev: ev ? `${ev.text}${ev.chapter ? `（${ev.chapter}）` : ''}` : '',
        };
      });
    const life = g.pack.events
      .filter((e) => (e.chars || []).indexOf(id) >= 0 && !g.eventLocked(e))
      .sort((a, b) => (a.ch || 0) - (b.ch || 0))
      .slice(0, 12)
      .map((e) => ({ ch: e.ch, name: e.name, summary: e.summary }));
    const lockedRels = g.pack.relations.filter((r) => (r.from === id || r.to === id) && g.relLocked(r)).length;
    this.setData({
      panel: {
        kind: 'char', title: c.name,
        sub: [g.factionTextOf(c), c.gender === 'f' ? '♀ 女' : '♂ 男', c.title].filter(Boolean).join(' · '),
        aliases: (c.aliases || []).join('，'),
        desc: c.desc || '',
        fate: g.fateLocked(c) ? '🔒 在你读到的进度之后' : (c.fate || ''),
        relCount: (g.adj.get(id) || []).length,
        rels, life, lockedRels,
      },
    });
  },
  openRel(rel) {
    const g = this.g;
    const evs = g.visibleRelEvents(rel).map((e) => ({
      text: e.text, chapter: e.chapter || '', place: e.place ? g.placeName(e.place) : '',
    }));
    this.setData({
      panel: {
        kind: 'rel',
        title: `${g.charName(rel.from)} — ${rel.type} — ${g.charName(rel.to)}`,
        sub: [rel.kin ? (KIN_LABEL[rel.kin] || '') : '', g.periodText(rel), rel.derived ? '推导（原文没有直接互动）' : ''].filter(Boolean).join(' · '),
        evs,
      },
    });
  },
});
