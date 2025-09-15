import express from "express";
import lighthouse from "lighthouse";
import puppeteer from "puppeteer";
import Bottleneck from "bottleneck";

// Metrics extraction
function extractMetricsFromLHR(lhr) {
  const audits = lhr?.audits || {};
  const categories = lhr?.categories || {};
  return {
    performance: categories.performance?.score != null ? categories.performance.score * 100 : null,
    lcp: audits["largest-contentful-paint"]?.numericValue || null,
    fcp: audits["first-contentful-paint"]?.numericValue || null,
    cls: audits["cumulative-layout-shift"]?.numericValue || null,
    tbt: audits["total-blocking-time"]?.numericValue || null,
    inp: audits["experimental-interaction-to-next-paint"]?.numericValue ||
         audits["interaction-to-next-paint"]?.numericValue ||
         null,
  };
}

// Launch Puppeteer once
let browser;
async function startBrowser() {
  browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });
}

// Run Lighthouse
async function runLighthouse(url) {
  const wsEndpoint = browser.wsEndpoint();
  const port = new URL(wsEndpoint).port;

  const options = {
    logLevel: "error",
    output: "json",
    port,
    throttlingMethod: "simulate",
    throttling: {
      rttMs: 150,
      throughputKbps: 1638.4,
      cpuSlowdownMultiplier: 4,
    },
    formFactor: "mobile",
    screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75 },
    onlyCategories: ["performance"],
    onlyAudits: [
      "first-contentful-paint",
      "largest-contentful-paint",
      "cumulative-layout-shift",
      "total-blocking-time",
      "interaction-to-next-paint"
    ]
  };

  const runnerResult = await lighthouse(url, options);
  return extractMetricsFromLHR(runnerResult.lhr);
}

// Express
const app = express();
const PORT = process.env.PORT || 3000;

// Bottleneck: max 1 concurrent, min 5s between
const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 5000 });

app.get("/audit", async (req, res) => {
  const { url, runs } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url parameter" });
  const numRuns = Math.max(1, parseInt(runs || "3", 10));

  try {
    const results = await limiter.schedule(async () => {
      const runResults = [];
      for (let i = 0; i < numRuns; i++) {
        try {
          const metrics = await runLighthouse(url);
          runResults.push({ success: true, metrics });
        } catch (err) {
          runResults.push({ success: false, error: String(err) });
        }
      }
      return runResults;
    });

    // Compute averages only for successful runs
    const averages = {};
    const keys = ["performance", "lcp", "fcp", "cls", "tbt", "inp"];
    keys.forEach(k => {
      const vals = results.filter(r => r.success).map(r => r.metrics[k]).filter(v => v != null);
      averages[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });

    res.json({ url, runs: numRuns, results, average: averages });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Start server
startBrowser().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Lighthouse API running on port ${PORT}`);
  });
}).catch(err => {
  console.error("❌ Failed to start Puppeteer browser:", err);
  process.exit(1);
});
