#!/usr/bin/env node
/**
 * 本地小接收器：把浏览器里的数据直接存成本地文件
 *
 * 用途：编辑器里点「导出 JSON」在无头/受控浏览器里可能落不到磁盘；
 * 起了这个接收器之后，导出的 JSON 会直接写进 data/（也可以自己 POST）。
 *
 * 用法：
 *   node tools/local-sink.mjs                 # 监听 8766，写进 data/
 *   node tools/local-sink.mjs 8766 data       # 指定端口与目标目录
 *
 * 页面里（编辑器「导出 JSON」已经内置这一步，失败会自动退回下载）：
 *   fetch('http://localhost:8766/save?name=three-kingdoms.json', { method: 'POST', body: json })
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] || 8766);
const dir = path.resolve(process.argv[3] || 'data');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'POST' || !url.pathname.startsWith('/save')) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('POST /save?name=xx.json');
    return;
  }
  const name = path.basename(url.searchParams.get('name') || 'draft.json');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const text = Buffer.concat(chunks).toString('utf8');
      JSON.parse(text);   // 只收合法 JSON，坏数据不落盘
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, name);
      fs.writeFileSync(target, text.endsWith('\n') ? text : text + '\n', 'utf8');
      console.log(`✓ saved ${name}（${text.length} 字符）→ ${target}`);
      res.writeHead(200, { 'content-type': 'text/plain' }).end(`saved ${name}`);
    } catch (e) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end(String(e.message));
    }
  });
}).listen(port, () => console.log(`local-sink: http://localhost:${port} → ${dir}（Ctrl+C 停止）`));
