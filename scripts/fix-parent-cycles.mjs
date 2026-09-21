#!/usr/bin/env node
/**
 * 修亲子关系方向：按**人工核对过的方向表**修正，并把可疑的单向边报告出来
 *
 * 为什么不用自动判据：
 *   · "谁孩子多谁像父母" → 曹操孩子多，会把「曹操是曹嵩之父」这种反向边当成对的
 *   · "父母先出场"（firstCh）→ 三国里伏完第 20 章才出场、女儿第 13 章就是皇后了，会把正确方向翻反
 *   ⇒ 常识方向只能人工核对。脚本负责：① 按表修正 ② 报告可疑项（firstCh 明显倒挂）③ 亲子环检测
 *
 * 用法：
 *   node scripts/fix-parent-cycles.mjs --all            # 预览
 *   node scripts/fix-parent-cycles.mjs --all --write
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const files = argv.includes('--all')
  ? fs.readdirSync(path.join(process.cwd(), 'data')).filter((f) => f.endsWith('.json') && f !== 'books.json' && !f.startsWith('.')).map((f) => path.join(process.cwd(), 'data', f))
  : argv.filter((a) => !a.startsWith('--'));

if (!files.length) { console.error('用法：node scripts/fix-parent-cycles.mjs data/xx.json [--write]  |  --all [--write]'); process.exit(1); }

const PARENT_CHILD = /^(亲生)?(父|母)(子|女)$|^养(父|母)(子|女)$/;
const isPC = (r) => PARENT_CHILD.test(String(r.type || '').replace(/[（(].*$/, '').trim());

/** 人工核对过的方向：[父母, 子女] —— 只列"数据里写反过"的 */
const CANON = {
  'one-hundred-years-of-solitude': [
    ['jose-arcadio-2', 'arcadio'],              // 巨人（第二代）是阿尔卡蒂奥（第三代）之父
    ['jose-arcadio-buendia', 'amaranta'],       // 老何塞是阿玛兰妲之父
    ['ursula', 'amaranta'],                     // 乌尔苏拉是阿玛兰妲之母
    ['ursula-father', 'ursula'],                // 奥雷里亚诺·伊瓜兰是乌尔苏拉之父（已是正确方向）
    ['apolinar-moscote', 'remedios-moscote'],   // 莫科特是蕾梅黛丝之父（已是正确方向）
  ],
  'three-kingdoms': [
    ['cao-song', 'cao-cao'], ['he-taihou', 'liu-bian'], ['fu-wan', 'fu-houhou'],
    ['wu-tai-furen', 'sun-quan'], ['gongsun-du', 'gongsun-kang'],
    ['liu-bei', 'liu-feng'], ['guan-yu', 'guan-xing'], ['zhuge-liang', 'zhuge-zhan'],
  ],
};

for (const file of files) {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const slug = path.basename(file, '.json');
  const byId = new Map((book.characters || []).map((c) => [c.id, c]));
  const name = (id) => (byId.get(id) || {}).name || id;
  const pc = (book.relations || []).filter((r) => isPC(r) && byId.has(r.from) && byId.has(r.to));

  const drop = new Set();
  const notes = [];
  for (const [p, c] of CANON[slug] || []) {
    const right = pc.find((r) => r.from === p && r.to === c);
    const wrong = pc.find((r) => r.from === c && r.to === p);
    if (right && wrong) { drop.add(wrong); notes.push(`   ✓ 删掉反向边「${name(c)} —${wrong.type}→ ${name(p)}」（保留 ${name(p)} → ${name(c)}）`); }
    else if (!right && wrong) {
      const t = wrong.from; wrong.from = wrong.to; wrong.to = t;   // 只有反向边 ⇒ 翻过来
      notes.push(`   ⇄ 翻转「${name(c)} —${wrong.type}→ ${name(p)}」为「${name(p)} → ${name(c)}」`);
    } else if (right) notes.push(`   · 方向已经正确：${name(p)} → ${name(c)}`);
    else notes.push(`   · （表中这对在数据里不存在：${name(p)} / ${name(c)}）`);
  }

  // 可疑项（只报告，不改）：单向边但"父母"出场章明显晚于"子女"
  const sus = [];
  for (const r of pc) {
    const fa = Number((byId.get(r.from) || {}).firstCh);
    const fb = Number((byId.get(r.to) || {}).firstCh);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa - fb >= 3) {
      sus.push(`   ⚠ 可疑方向（不改，请人工确认）：「${name(r.from)} —${r.type}→ ${name(r.to)}」—— ${name(r.from)} 第 ${fa} 章才出场，${name(r.to)} 第 ${fb} 章`);
    }
  }

  const cycles = (relList) => {
    const adj = new Map();
    for (const r of relList.filter(isPC)) { if (!adj.has(r.from)) adj.set(r.from, []); adj.get(r.from).push(r.to); }
    const color = new Map(); const out = [];
    const dfs = (u, stack) => {
      color.set(u, 1); stack.push(u);
      for (const v of adj.get(u) || []) {
        if (color.get(v) === 1) { const i = stack.indexOf(v); out.push(stack.slice(i).concat(v).map(name).join(' → ')); }
        else if (!color.get(v)) dfs(v, stack);
      }
      stack.pop(); color.set(u, 2);
    };
    for (const k of adj.keys()) if (!color.get(k)) dfs(k, []);
    return [...new Set(out)];
  };

  const left = cycles(book.relations || []);
  console.log(`\n▶ ${path.basename(file)}：亲子边 ${pc.length} 条，按表修正 ${drop.size + notes.filter((n) => n.includes('⇄')).length} 条`);
  notes.slice(0, 20).forEach((l) => console.log(l));
  sus.slice(0, 8).forEach((l) => console.log(l));
  if (sus.length > 8) console.log(`   … 另有 ${sus.length - 8} 条可疑方向`);
  console.log(left.length ? `   ⚠ 仍有 ${left.length} 个亲子环：\n      ${left.slice(0, 8).join('\n      ')}` : '   ✓ 没有亲子环');

  if (write) {
    fs.writeFileSync(file, JSON.stringify(book, null, 2) + '\n', 'utf8');
    console.log('   ✓ 已写回');
  } else {
    console.log('   （预览模式：加 --write 才写回）');
  }
}
