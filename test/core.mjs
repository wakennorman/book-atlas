#!/usr/bin/env node
/**
 * 共享核心逻辑单元测试（用 shared/graph-core.js）
 *
 * 测试：
 *   · BFS 最短路正确性
 *   · 剧透过滤（人物/关系/事件锁定）
 *   · 时间旅行关系切换
 *   · 章节摘要数据完整性
 *   · 关系过滤（线条/亲缘）
 *
 * 用法：node test/core.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGraphCore } from '../shared/graph-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function section(name) {
  console.log(`\n▶ ${name}`);
}

/* ---------------- 加载数据并创建 core ---------------- */
function loadCore(slug, stateOverrides = {}) {
  const book = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${slug}.json`), 'utf8'));
  const byId = new Map(book.characters.map((c) => [c.id, c]));
  const adj = new Map(book.characters.map((c) => [c.id, []]));
  const deg = new Map(book.characters.map((c) => [c.id, 0]));
  for (const r of book.relations) {
    if (!byId.has(r.from) || !byId.has(r.to)) continue;
    adj.get(r.from).push({ to: r.to, rel: r });
    adj.get(r.to).push({ to: r.from, rel: r });
    deg.set(r.from, (deg.get(r.from) || 0) + 1);
    deg.set(r.to, (deg.get(r.to) || 0) + 1);
  }
  const state = {
    progress: null,
    chapter: 1,
    timeTravel: false,
    showMinor: false,
    showMentioned: false,
    showDerived: true,
    sizeFilter: 'all',
    focus: null,
    edgeStyles: [],
    edgeKins: [],
    a11yPalette: false,
    fontSize: 'm',
    ...stateOverrides,
  };
  const core = createGraphCore({ pack: book, adj, byId, deg, state });
  return { book, core, state };
}

/* ---------------- 测试 ---------------- */
const books = ['one-hundred-years-of-solitude', 'crime-and-punishment', 'three-kingdoms'];

for (const slug of books) {
  const { book, core, state } = loadCore(slug);

  section(`${book.meta.title}（${slug}）`);

  // 1. BFS 最短路
  if (book.relations.length > 0) {
    const r0 = book.relations[0];
    const steps = core.bfs(r0.from, r0.to);
    assert(steps !== null, `BFS 能找到路径：${r0.from} → ${r0.to}`);
    if (steps && steps.length > 0) {
      assert(steps[0].from === r0.from, `BFS 起点正确`);
      assert(steps[steps.length - 1].to === r0.to, `BFS 终点正确`);
    }
  }

  // 2. 剧透过滤
  state.progress = 5;
  const lockedChar = book.characters.find((c) => c.firstCh > 5);
  if (lockedChar) {
    assert(core.charLocked(lockedChar), `人物被锁定：${lockedChar.name}（firstCh=${lockedChar.firstCh}）`);
  }
  const visibleChar = book.characters.find((c) => c.firstCh <= 5);
  if (visibleChar) {
    assert(!core.charLocked(visibleChar), `人物可见：${visibleChar.name}（firstCh=${visibleChar.firstCh}）`);
  }
  state.progress = null;

  // 3. 时间旅行
  state.timeTravel = true;
  state.chapter = 10;
  const relWithTime = book.relations.find((r) => typeof r.fromCh === 'number');
  if (relWithTime) {
    const visible = core.relVisibleAt(relWithTime);
    assert(typeof visible === 'boolean', `时间旅行关系可见性：${relWithTime.from} → ${relWithTime.to}`);
  }
  state.timeTravel = false;
  state.chapter = 1;

  // 4. 章节摘要
  const digest = core.chapterDigest(1);
  assert(digest.n === 1, `章节摘要：第 1 章`);
  assert(Array.isArray(digest.charsNew), `章节摘要：新人物列表`);
  assert(Array.isArray(digest.events), `章节摘要：事件列表`);

  // 5. 关系过滤
  state.edgeStyles = ['solid'];
  const solidRel = book.relations.find((r) => r.style === 'solid');
  if (solidRel) {
    assert(core.passEdge(solidRel), `线条过滤：solid 通过`);
  }
  const dashedRel = book.relations.find((r) => r.style === 'dashed');
  if (dashedRel) {
    assert(!core.passEdge(dashedRel), `线条过滤：dashed 被过滤`);
  }
  state.edgeStyles = [];

  // 6. 亲缘过滤
  state.edgeKins = ['blood'];
  const bloodRel = book.relations.find((r) => r.kin === 'blood');
  if (bloodRel) {
    assert(core.passEdge(bloodRel), `亲缘过滤：blood 通过`);
  }
  const swornRel = book.relations.find((r) => r.kin === 'sworn');
  if (swornRel) {
    assert(!core.passEdge(swornRel), `亲缘过滤：sworn 被过滤`);
  }
  state.edgeKins = [];

  // 7. 节点大小
  const degMap = new Map(book.characters.map((c) => [c.id, 0]));
  for (const r of book.relations) {
    if (degMap.has(r.from)) degMap.set(r.from, (degMap.get(r.from) || 0) + 1);
    if (degMap.has(r.to)) degMap.set(r.to, (degMap.get(r.to) || 0) + 1);
  }
  const mainChar = book.characters.find((c) => (degMap.get(c.id) || 0) > 5);
  if (mainChar) {
    const size = core.symbolSize(mainChar.id);
    assert(size >= 13 && size <= 40, `节点大小在范围内：${mainChar.name} = ${size}`);
  }

  // 8. 分组
  const groupKey = core.groupKeyOf(book.characters[0]);
  assert(typeof groupKey === 'string' && groupKey.length > 0, `分组键存在：${groupKey}`);

  // 9. 阵营
  const factionKey = core.effectiveFactionKey(book.characters[0]);
  assert(typeof factionKey === 'string', `阵营键存在：${factionKey}`);

  // 10. 人物最后出场章
  const lastCh = core.charLastCh(book.characters[0]);
  assert(typeof lastCh === 'number' && lastCh > 0, `最后出场章：${book.characters[0].name} = ${lastCh}`);
}

/* ---------------- 结果 ---------------- */
console.log(`\n${'='.repeat(40)}`);
console.log(`通过：${passed}  失败：${failed}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('全部通过');
}
