#!/usr/bin/env node
/**
 * 生成微信小程序用的数据包（miniprogram/data/*.js）
 *
 * 为什么在构建时算好坐标：
 *   - 小程序里不想背 ECharts（1MB+），改用自绘 canvas；自绘就需要坐标
 *   - 分组布局（分组·纵 / 分组·横）是确定性的，构建时算一次即可
 *   - 力导向布局在 Node 里跑一个简单的 Fruchterman-Reingold（固定种子，可复现）
 *
 * 用法：node scripts/make-miniprogram-packs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'miniprogram', 'data');
const chOf = (s) => { const m = String(s || '').match(/(\d+)/); return m ? Number(m[1]) : null; };
/* 稳定的字符串比较（按码点）。
   不能用 localeCompare：它走 ICU，Windows 与 Ubuntu 对中文名的排序不同，
   同一份数据在两个系统上会生成不同的布局 ⇒ CI 上"重新生成 + git diff"天天红。 */
const cmpStr = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

/* ---------- 与网页版同口径的基础量 ---------- */
function prepare(book) {
  const byId = new Map(book.characters.map((c) => [c.id, c]));
  const deg = new Map(book.characters.map((c) => [c.id, 0]));
  for (const r of book.relations) {
    if (byId.has(r.from)) deg.set(r.from, (deg.get(r.from) || 0) + 1);
    if (byId.has(r.to)) deg.set(r.to, (deg.get(r.to) || 0) + 1);
  }
  const maxDeg = Math.max(1, ...[...deg.values()]);
  const symbolSize = (id) => Math.max(13, Math.min(40, 13 + 27 * Math.sqrt((deg.get(id) || 0) / maxDeg)));
  return { byId, deg, maxDeg, symbolSize };
}

/* ---------- 分组布局（网页版 buildGenerationPositions 的简化版） ---------- */
function groupLayout(book, view, { byId, deg, symbolSize }) {
  const isGen = (book.meta.groupMode || 'generation') === 'generation';
  const groupKeyOf = (c) => (isGen ? `g${c.generation}` : `f${c.faction || 'other'}`);
  const factionOrder = new Map((book.factions || []).map((f, i) => [f.key, i]));
  const groups = [...new Set(book.characters.map(groupKeyOf))];
  groups.sort((a, b) => (isGen ? Number(a.slice(1)) - Number(b.slice(1)) : (factionOrder.get(a.slice(1)) ?? 99) - (factionOrder.get(b.slice(1)) ?? 99)));
  const byGen = new Map(groups.map((g) => [g, []]));
  for (const c of book.characters) byGen.get(groupKeyOf(c)).push(c);
  for (const list of byGen.values()) {
    list.sort((a, b) => (isGen ? ((factionOrder.get(a.faction) ?? 99) - (factionOrder.get(b.faction) ?? 99)) : (a.generation - b.generation))
      || ((deg.get(b.id) || 0) - (deg.get(a.id) || 0))
      || cmpStr(String(a.name), String(b.name)));
  }
  const maxCount = Math.max(1, ...groups.map((g) => byGen.get(g).length));
  const maxSymbol = Math.max(15, ...book.characters.map((c) => symbolSize(c.id)));
  const crossStep = Math.max(34, maxSymbol + 10);
  const mainStep = 240;
  const mainLen = Math.max(600, (groups.length - 1) * mainStep);
  const crossLen = Math.max(600, (maxCount - 1) * crossStep);
  const pos = {};
  const bands = {};
  groups.forEach((g, gi) => {
    const center = groups.length === 1 ? 0 : -mainLen / 2 + (mainLen * gi) / (groups.length - 1);
    bands[g] = center;
    const list = byGen.get(g);
    const step = list.length > 1 ? crossLen / (list.length - 1) : 0;
    list.forEach((c, ci) => {
      const off = list.length === 1 ? 0 : -crossLen / 2 + ci * step;
      pos[c.id] = view === 'gen-h' ? [center, off] : [off, center];
    });
  });
  return { pos, bands, groups };
}

/* ---------- 力导向（Fruchterman-Reingold：斥力 k²/d + 引力 d²/k + 温度限幅） ---------- */
function forceLayout(book, { symbolSize }) {
  const ids = book.characters.map((c) => c.id);
  const n = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const xs = new Float64Array(n), ys = new Float64Array(n);
  const disp = new Float64Array(n * 2);
  let seed = 20260927;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const R = Math.max(400, Math.sqrt(n) * 42);
  for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R; xs[i] = Math.cos(a) * r; ys[i] = Math.sin(a) * r; }
  const links = [];
  for (const r of book.relations) {
    const a = idx.get(r.from), b = idx.get(r.to);
    if (a === undefined || b === undefined || a === b) continue;
    links.push([a, b]);
  }
  const k = Math.sqrt((R * R * 4) / Math.max(1, n));       // 理想边长
  let t = k * 0.9;                                          // 温度（每轮衰减）
  const iters = n > 500 ? 90 : n > 200 ? 160 : 320;
  for (let it = 0; it < iters; it++) {
    disp.fill(0);
    // 斥力（n 大时用网格近似，只和邻格互斥）
    if (n <= 400) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let dx = xs[i] - xs[j], dy = ys[i] - ys[j];
        const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
        const f = (k * k) / d;
        const ux = dx / d, uy = dy / d;
        disp[i * 2] += ux * f; disp[i * 2 + 1] += uy * f;
        disp[j * 2] -= ux * f; disp[j * 2 + 1] -= uy * f;
      }
    } else {
      const cell = k * 2;
      const grid = new Map();
      const key = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
      for (let i = 0; i < n; i++) {
        const gk = key(xs[i], ys[i]);
        if (!grid.has(gk)) grid.set(gk, []);
        grid.get(gk).push(i);
      }
      for (let i = 0; i < n; i++) {
        const gx = Math.floor(xs[i] / cell), gy = Math.floor(ys[i] / cell);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const arr = grid.get(`${gx + ox}:${gy + oy}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;
            let dx = xs[i] - xs[j], dy = ys[i] - ys[j];
            const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
            const f = (k * k) / d;
            const ux = dx / d, uy = dy / d;
            disp[i * 2] += ux * f; disp[i * 2 + 1] += uy * f;
            disp[j * 2] -= ux * f; disp[j * 2 + 1] -= uy * f;
          }
        }
      }
    }
    // 引力（沿边）
    for (const [a, b] of links) {
      let dx = xs[a] - xs[b], dy = ys[a] - ys[b];
      const d = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
      const f = (d * d) / k;
      const ux = dx / d, uy = dy / d;
      disp[a * 2] -= ux * f; disp[a * 2 + 1] -= uy * f;
      disp[b * 2] += ux * f; disp[b * 2 + 1] += uy * f;
    }
    // 按温度限幅移动（这一步是稳定性的关键：不限幅就会爆成 Infinity/NaN）
    for (let i = 0; i < n; i++) {
      const dx = disp[i * 2], dy = disp[i * 2 + 1];
      const d = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
      const lim = Math.min(d, t) / d;
      xs[i] += dx * lim;
      ys[i] += dy * lim;
      xs[i] *= 0.999; ys[i] *= 0.999;                        // 轻微向心
    }
    t *= 0.94;
  }
  // 兜底：任何非有限坐标都归位到 0（宁可堆在中心，也不要 NaN 传到 JSON 里变成 null）
  let bad = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) { xs[i] = 0; ys[i] = 0; bad++; }
  }
  if (bad) console.warn(`  ⚠ 力导向有 ${bad} 个坐标非有限，已归零`);
  const pos = {};
  for (let i = 0; i < n; i++) pos[ids[i]] = [Math.round(xs[i]), Math.round(ys[i])];
  return { pos, bands: {}, groups: [] };
}

/* ---------- 主流程 ---------- */
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'books.json'), 'utf8'));
fs.mkdirSync(OUT_DIR, { recursive: true });
const index = [];
for (const entry of catalog.books) {
  const book = JSON.parse(fs.readFileSync(path.join(ROOT, entry.file), 'utf8'));
  const base = prepare(book);
  const genV = groupLayout(book, 'gen-v', base);
  const genH = groupLayout(book, 'gen-h', base);
  const force = forceLayout(book, base);
  const pack = {
    schema: 1,
    slug: entry.slug,
    title: entry.title,
    author: entry.author,
    links: entry.links || [],
    meta: book.meta,
    factions: book.factions,
    characters: book.characters,
    relations: book.relations,
    places: book.places || [],
    phases: book.phases || [],
    events: book.events || [],
    degree: Object.fromEntries(base.deg),
    layouts: { 'gen-v': genV, 'gen-h': genH, force },
  };
  const file = path.join(OUT_DIR, `${entry.slug}.js`);
  fs.writeFileSync(file, `module.exports = ${JSON.stringify(pack)};\n`, 'utf8');
  const kb = Math.round(fs.statSync(file).size / 1024);
  index.push({ slug: entry.slug, title: entry.title, author: entry.author, file: `./${entry.slug}.js`, kb });
  console.log(`✓ ${entry.slug}.js  ${kb} KB  （${book.characters.length} 人 / ${book.relations.length} 关系 / 布局 3 套）`);
}
fs.writeFileSync(path.join(OUT_DIR, 'books.js'), `module.exports = ${JSON.stringify({ books: index }, null, 2)};\n`, 'utf8');
console.log(`✓ books.js（${index.length} 本）→ ${path.relative(ROOT, OUT_DIR)}`);
const total = index.reduce((s, x) => s + x.kb, 0);
/* v85：主包余量检查。
 *
 * 重要：小程序是**引流位**，不是主要分发渠道 ——
 * 2026-09-30 与作者确认：网站（GitHub Pages）会持续加书，小程序就固定这几本，
 * 目的是让人看到后去网站看更多。所以这里**只警告、不失败**。
 * 早先写成 headroom < 1000 就 exit 1，结果"余量 951 KB"直接卡死了
 * 数据包重新生成 —— 而这个仓库根本不往小程序加书，那道门槛只会挡路。
 *
 * 另外要说清楚：以前那句「数据按分包/按需加载（单包上限 2MB）」描述的是
 * 一个**并不存在**的机制 —— app.json 没有 subpackages、project.config.json
 * 没有 packOptions，所有 miniprogram/data/*.js 都在主包里。
 * 真要加书到小程序才必须先分包；不打算加的话就别把这句话留着误导人。
 */
const LIMIT_KB = 2 * 1024;
const headroom = LIMIT_KB - total;
console.log('');
console.log(`主包内数据合计 ${total} KB / 上限 ${LIMIT_KB} KB（余量 ${headroom} KB）`);
const NEED_PER_BOOK = 1000;   // 三国规模（现有最大的一本）约需这么多
if (headroom < NEED_PER_BOOK) {
  console.warn(`⚠ 余量 ${headroom} KB 放不下又一本同规模的书（三国约需 ${NEED_PER_BOOK} KB）。`);
  console.warn('  小程序当前定位是引流位、书固定这几本，所以**这不是错误**，脚本照常完成。');
  console.warn('  万一以后真要往小程序加书，必须先做分包：');
  console.warn('    · miniprogram/app.json 加 subpackages');
  console.warn('    · miniprogram/project.config.json 加 packOptions');
  console.warn('  否则要到点"上传"那一刻才会失败（2 MB 单包硬上限，微信侧的规则，改不了）。');
} else {
  console.log(`✓ 余量 ${headroom} KB，够再放约 ${Math.floor(headroom / NEED_PER_BOOK)} 本同规模的书`);
}
