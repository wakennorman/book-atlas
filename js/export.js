/**
 * 书脉 BookAtlas · 导出模块（按需加载）
 *
 * 用户点击「⬇️ 导出」时才动态 import() 加载此文件。
 * 核心逻辑通过 window.__ba 调用 app.js 暴露的方法。
 */
(function () {
  'use strict';

  const BA = window.__ba;
  if (!BA) return;

  const { state } = BA;
  const $ = (sel) => document.querySelector(sel);

  function downloadBlob(filename, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function downloadText(filename, text, mime = 'text/plain') {
    downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
  }

  async function runExport(kind) {
    const slug = state.book.meta.slug || 'book';
    switch (kind) {
      case 'html': {
        const html = await BA.buildStandaloneHtml();
        downloadText(`${slug}-书脉.html`, html, 'text/html');
        break;
      }
      case 'png': {
        const dataUrl = await BA.buildSharePng();
        if (!dataUrl) { BA.toast('生成失败'); return; }
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${slug}-关系图.png`;
        a.click();
        break;
      }
      case 'svg': {
        const svg = BA.buildPrintSvg();
        if (!svg) { BA.toast('生成失败'); return; }
        downloadText(`${slug}-打印版.svg`, svg, 'image/svg+xml');
        break;
      }
      case 'epub': {
        const epub = await BA.buildCompanionEpub();
        if (!epub) { BA.toast('生成失败'); return; }
        downloadBlob(`${slug}-阅读伴侣.epub`, new Blob([epub], { type: 'application/epub+zip' }));
        break;
      }
      case 'json': {
        downloadText(`${slug}-数据.json`, JSON.stringify(state.book, null, 2), 'application/json');
        break;
      }
    }
  }

  // 暴露给 app.js 调用
  window.__BA_EXPORT__ = { runExport };
})();
