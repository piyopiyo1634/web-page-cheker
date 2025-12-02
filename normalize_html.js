// normalize_html.js
// 使い方: node normalize_html.js "https://example.com" > normalized.html

import fetch from "node-fetch";
import { minify } from "html-minifier-terser";
import * as cheerio from "cheerio";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node normalize_html.js <URL>");
    process.exit(1);
  }

  const res = await fetch(url);
  if (!res.ok) {
    console.error("Fetch failed:", res.status);
    process.exit(1);
  }
  let html = await res.text();

  // 1) ミニファイ
  html = await minify(html, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: false
  });

  const $ = cheerio.load(html);

  // 2) 動的っぽいタグをざっくり削除
  $("script").remove();
  $("style").remove();
  $("noscript").remove();

  // 毎回変わりそうな meta の例
  $('meta[name="csrf-token"]').remove();
  $('meta[name="request-id"]').remove();

  // time / timestamp 的なクラス名は丸ごと削除
  $(".time, .timestamp").remove();

  // よくある tracking 属性は値をマスク
  $("[data-tracking-id]").attr("data-tracking-id", "MASKED");
  $("[data-random]").attr("data-random", "MASKED");

  let out = $.html();

  // 日付＋時刻っぽい文字列をざっくりマスク（必要なら）
  out = out.replace(
    /\b20[2-3][0-9][-\/.](0[1-9]|1[0-2])[-\/.](0[1-9]|[12][0-9]|3[01])\s+[0-2][0-9]:[0-5][0-9]:[0-5][0-9]\b/g,
    "YYYY-MM-DD HH:MM:SS"
  );

  process.stdout.write(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
