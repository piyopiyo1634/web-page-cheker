// REV: 2026-03-16T02:43:02+09:00
// Usage: node normalize_html.js "https://example.com" > normalized.html

import fetch from "node-fetch";
import { minify } from "html-minifier-terser";
import * as cheerio from "cheerio";

const VOLATILE_ATTRS = [
  "nonce",
  "integrity",
  "crossorigin",
  "style",
  "srcset",
  "imagesrcset",
  "fetchpriority",
  "loading",
  "decoding",
  "tabindex",
  "hidden",
  "open"
];

const VOLATILE_META_NAMES = [
  "csrf-token",
  "request-id",
  "generator",
  "shopify-checkout-api-token",
  "shopify-digital-wallet",
  "shopify-web-interactivity"
];

const TRACKING_QUERY_PARAMS = new Set([
  "_",
  "_ga",
  "_gl",
  "_ke",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "sca_ref",
  "shpxid",
  "si",
  "timestamp",
  "utm_campaign",
  "utm_content",
  "utm_id",
  "utm_medium",
  "utm_name",
  "utm_source",
  "utm_term",
  "v"
]);

const TIMESTAMP_PATTERNS = [
  /\b20\d{2}[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\s+[0-2]\d:[0-5]\d:[0-5]\d\b/g,
  /\b20\d{2}[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/g,
  /\b\d{10,13}\b/g
];

function looksDynamicId(value) {
  return (
    /^(shopify-section-|section-)/.test(value) ||
    /^(shopify-block-|block-)/.test(value) ||
    /^(template--|ImageWrapper-)/.test(value) ||
    /[a-f0-9]{8,}/i.test(value) ||
    /\d{6,}/.test(value)
  );
}

function normalizeUrl(raw) {
  if (!raw) {
    return raw;
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed, "https://example.com");

    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_QUERY_PARAMS.has(key) || key.startsWith("utm_")) {
        parsed.searchParams.delete(key);
      }
    }

    if (/\.(css|js|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot)$/i.test(parsed.pathname)) {
      parsed.search = "";
    }

    const normalized =
      parsed.origin === "https://example.com"
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : parsed.toString();

    return normalized.replace(/\?$/, "");
  } catch {
    return trimmed
      .replace(/([?&])(utm_[^=&]+|fbclid|gclid|_ga|_gl|mc_cid|mc_eid|v|timestamp)=[^&#]*/gi, "$1")
      .replace(/[?&]$/, "");
  }
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeDom($) {
  // 1) head/script/style/noscript are not meaningful page content for diffing.
  $("head, script, style, noscript, template, svg defs").remove();

  // 1.5) Remove storefront helper UI that can appear without representing a content change.
  $("#a11y-refresh-page-message, #locksmith-spinner-wrapper").remove();

  // 2) Remove volatile meta tags that contain request/session/build-specific values.
  for (const name of VOLATILE_META_NAMES) {
    $(`meta[name="${name}"]`).remove();
  }

  // 3) Remove obvious time/timestamp elements and machine-readable time nodes.
  $(".time, .timestamp, [data-time], [data-timestamp], time").remove();

  // 4) Strip comments and empty text-only nodes left behind by removals.
  $("*")
    .contents()
    .each((_, node) => {
      if (node.type === "comment") {
        $(node).remove();
      }
    });

  // 5) Remove or mask attributes that commonly change across requests without changing content.
  $("*").each((_, element) => {
    const el = $(element);
    const attrs = { ...(element.attribs || {}) };

    for (const attr of VOLATILE_ATTRS) {
      if (attr in attrs) {
        el.removeAttr(attr);
      }
    }

    for (const attrName of Object.keys(attrs)) {
      if (attrName.startsWith("data-")) {
        el.removeAttr(attrName);
      }
      if (
        /^aria-(describedby|live|busy|hidden|controls|owns|labelledby)$/i.test(attrName) ||
        attrName === "role"
      ) {
        el.removeAttr(attrName);
      }
    }

    const id = el.attr("id");
    if (id && looksDynamicId(id)) {
      el.removeAttr("id");
    }

    // Classes are mostly presentation state; drop them after selector-based removals.
    if (el.attr("class")) {
      el.removeAttr("class");
    }

    // Normalize href/src to keep destination changes while removing tracking/cache-busters.
    for (const attrName of ["href", "src", "poster"]) {
      const value = el.attr(attrName);
      if (value) {
        el.attr(attrName, normalizeUrl(value));
      }
    }

    // Mask obvious token-like attribute values if they still remain.
    for (const attrName of Object.keys(element.attribs || {})) {
      const value = el.attr(attrName);
      if (!value) {
        continue;
      }

      if (
        /(token|nonce|request|trace|session|visitor|fingerprint)/i.test(attrName) ||
        /[a-f0-9]{16,}/i.test(value)
      ) {
        el.attr(attrName, "MASKED");
      }
    }
  });

  // 6) Normalize text nodes so cosmetic spacing does not trigger diffs.
  $("*")
    .contents()
    .each((_, node) => {
      if (node.type === "text") {
        node.data = normalizeText(node.data || "");
      }
    });

  // 7) Remove empty attributes/tags created by normalization, but keep meaningful media/links.
  $("*").each((_, element) => {
    const el = $(element);
    for (const attrName of Object.keys(element.attribs || {})) {
      if (!el.attr(attrName)) {
        el.removeAttr(attrName);
      }
    }

    const tag = (element.tagName || "").toLowerCase();
    const text = normalizeText(el.text() || "");
    const hasChildren = el.children().length > 0;
    const keepEmptyTag = ["img", "video", "source", "a", "br"].includes(tag);

    if (!keepEmptyTag && !hasChildren && !text) {
      el.remove();
    }
  });
}

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

  // 8) Minify first to drop comments and normalize raw HTML before DOM-based cleanup.
  html = await minify(html, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: true,
    minifyJS: false
  });

  const $ = cheerio.load(html, { decodeEntities: false });
  normalizeDom($);

  let out = $.html();

  // 9) Put each tag on its own line to make text diffs stable and readable.
  out = out.replace(/></g, ">\n<");

  // 10) Mask leftover timestamps/unix epochs that may appear in text content.
  for (const pattern of TIMESTAMP_PATTERNS) {
    out = out.replace(pattern, "TIMESTAMP");
  }

  process.stdout.write(`${out.trim()}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
