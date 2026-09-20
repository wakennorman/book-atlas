#!/usr/bin/env node
/**
 * EPUB 抽文工具（零依赖：Node 内置 zlib 解 zip）
 * 用法：node scripts/extract-epub.mjs <book.epub> <out.txt> [--split 目录]
 * 输出：按 spine 顺序拼接的纯文本，段落之间用空行分隔，每个文档前加 ==== [序号] 标题 ==== 标记
 * 说明：只用于本地校对（例如核对章节号、人名写法），不要把书的正文提交进仓库。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [src, out, ...rest] = process.argv.slice(2);
if (!src || !out) {
  console.error('用法：node scripts/extract-epub.mjs <book.epub> <out.txt> [--split 目录]');
  process.exit(1);
}
const splitDir = rest.includes('--split') ? rest[rest.indexOf('--split') + 1] : null;

/* ---------- 最小 ZIP 读取 ---------- */
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/epub');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.set(name, { method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { buf, entries };
}
function readEntry(zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  const { buf } = zip;
  const nameLen = buf.readUInt16LE(e.localOff + 26);
  const extraLen = buf.readUInt16LE(e.localOff + 28);
  const start = e.localOff + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return raw;
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error('不支持的压缩方式：' + e.method + '（' + name + '）');
}

/* ---------- 文本清洗 ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', mdash: '—', hellip: '…' };
function clean(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
      if (g[0] === '#') {
        const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENT[g] !== undefined ? ENT[g] : m;
    })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------- 主流程 ---------- */
const zip = readZip(src);
const container = readEntry(zip, 'META-INF/container.xml');
if (!container) throw new Error('EPUB 缺少 META-INF/container.xml');
const opfPath = String(container).match(/full-path="([^"]+)"/i)?.[1];
if (!opfPath) throw new Error('container.xml 里没有 full-path');
const opf = String(readEntry(zip, opfPath));
const baseDir = path.posix.dirname(opfPath);

const manifest = new Map();
for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
  const tag = m[0];
  const id = tag.match(/\bid="([^"]+)"/i)?.[1];
  const href = tag.match(/\bhref="([^"]+)"/i)?.[1];
  if (id && href) manifest.set(id, decodeURIComponent(href));
}
const spineIds = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/gi)].map((m) => m[1]);

const docs = [];
for (const id of spineIds) {
  const href = manifest.get(id);
  if (!href) continue;
  const full = baseDir === '.' ? href : path.posix.join(baseDir, href);
  const raw = readEntry(zip, full);
  if (!raw) continue;
  const text = clean(String(raw));
  if (text) docs.push({ href, text });
}

const parts = docs.map((d, i) => `\n\n==== [${String(i + 1).padStart(3, '0')}] ${d.href} ====\n\n${d.text}`);
const all = parts.join('\n');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, all, 'utf8');

if (splitDir) {
  fs.mkdirSync(splitDir, { recursive: true });
  docs.forEach((d, i) => {
    const safe = d.href.replace(/[\\/:*?"<>|]/g, '_');
    fs.writeFileSync(path.join(splitDir, `${String(i + 1).padStart(3, '0')}_${safe}.txt`), d.text, 'utf8');
  });
}

const total = all.length;
console.log(`✅ 抽出 ${docs.length} 个文档，共 ${total} 字 → ${out}`);
console.log(`   首文档标题/开头：${docs[0] ? docs[0].text.slice(0, 60).replace(/\n/g, ' ') : '(空)'}`);
if (splitDir) console.log(`   已按文档拆分到：${splitDir}`);
