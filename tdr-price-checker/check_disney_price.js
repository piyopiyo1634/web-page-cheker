import fs from "node:fs";
import { chromium } from "playwright";

const URL = process.env.TARGET_URL;
const THRESHOLD = parseInt(process.env.THRESHOLD_YEN ?? "117400", 10);

function yenToInt(text) {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : null;
}

function writeOutputs(lines) {
  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) return;
  fs.appendFileSync(outPath, lines.map((l) => l + "\n").join(""));
}

(async () => {
  const outputs = [];
  try {
    if (!URL) throw new Error("TARGET_URL is empty");

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);

    await page.goto(URL, { waitUntil:"networkidle", timeout: 180000  });
    await page.waitForTimeout(1500);

    const bodyText = (await page.textContent("body")) ?? "";
    const queueHints = ["現在アクセスが集中", "順番にご案内", "temporarily busy", "queue"];
    if (queueHints.some((h) => bodyText.includes(h))) {
      outputs.push("changed=false");
      outputs.push("status=queue_or_busy");
      outputs.push("min_price_yen=");
      writeOutputs(outputs);
      await browser.close();
      return;
    }

    const candidates = await page.locator('text=/円|￥|yen/i').allTextContents();
    const prices = candidates
      .map(yenToInt)
      .filter((n) => Number.isFinite(n))
      .filter((n) => n >= 10000 && n <= 2000000);

    const minPrice = prices.length ? Math.min(...prices) : null;

    if (minPrice === null) {
      outputs.push("changed=false");
      outputs.push("status=no_price_found");
      outputs.push("min_price_yen=");
      writeOutputs(outputs);
      await browser.close();
      return;
    }

    outputs.push(`changed=${minPrice < THRESHOLD ? "true" : "false"}`);
    outputs.push(`min_price_yen=${minPrice}`);
    outputs.push("status=ok");
    writeOutputs(outputs);

    await browser.close();
  } catch (e) {
    outputs.push("changed=false");
    outputs.push("status=error");
    outputs.push("min_price_yen=");
    writeOutputs(outputs);
    console.error(e);
    process.exit(1);
  }
})();
