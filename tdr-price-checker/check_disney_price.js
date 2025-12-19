import { chromium } from "playwright";

const url = process.env.TARGET_URL;
const threshold = Number(process.env.THRESHOLD_YEN || "117400");

// 「空室なし」系の日本語（実ページの表記ゆれに強め）
const NO_ROOMS_RE =
  /予約(は|が)ありません|空室がありません|該当する部屋がありません|対象の部屋がありません|該当するプランがありません/;

// 価格っぽい表記（最初に出てきた¥xxx,xxxを拾う簡易版）
const PRICE_RE = /¥\s*([\d,]+)/;

async function main() {
  if (!url) {
    console.error("TARGET_URL is not set");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log("open:", url);

    // まずはページを開く（ここは軽めに）
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180_000 });

    // 「空室なし」 or 「価格(¥)」 のどちらかが出たら終了する（二択待ち）
    const result = await Promise.race([
      page
        .waitForSelector(`text=${NO_ROOMS_RE.source}`, { timeout: 120_000 })
        .then(() => "NO_ROOMS"),
      page.waitForSelector("text=¥", { timeout: 120_000 }).then(() => "HAS_PRICE")
    ]).catch(() => "TIMEOUT");

    if (result === "NO_ROOMS") {
      console.log("No rooms available. Exit normally.");
      return; // 正常終了（通知もしない）
    }

    if (result === "TIMEOUT") {
      console.log("Timeout: neither rooms nor 'no rooms' message appeared.");
      await page.screenshot({ path: "timeout.png", fullPage: true });
      // 必要ならHTMLも保存
      // const html = await page.content();
      // require("fs").writeFileSync("timeout.html", html);
      process.exitCode = 1;
      return;
    }

    // 価格抽出（簡易：bodyテキストから最初の ¥xxx を拾う）
    const bodyText = await page.textContent("body");
    const m = bodyText && bodyText.match(PRICE_RE);

    if (!m) {
      console.log("Price mark was detected but price could not be parsed.");
      await page.screenshot({ path: "price_parse_failed.png", fullPage: true });
      process.exitCode = 1;
      return;
    }

    const price = Number(m[1].replace(/,/g, ""));
    console.log("Found price:", price, "threshold:", threshold);

    if (price < threshold) {
      console.log("CHEAPER_THAN_THRESHOLD");
      // ここであなたの既存通知処理（LINE等）を呼ぶ想定なら呼ぶ
      // 例: await notify(...)
    } else {
      console.log("NOT_CHEAPER");
    }
  } finally {
    await browser.close();
  }
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
