// index.js
import express from "express";
import lighthouse from "lighthouse";
import puppeteer from "puppeteer";
import PQueue from "p-queue"; // lightweight queue to prevent overlaps

// Metrics extraction
function extractMetricsFromLHR(lhr) {
  const audits = (lhr && lhr.audits) || {};
  const categories = (lhr && lhr.categories) || {};
  return {
    performance: categories.performance?.score != null ? categories.performance.score * 100 : null,
    lcp: audits["largest-contentful-paint"]?.numericValue || null,
    fcp: audits["first-contentful-paint"]?.numericValue || null,
    cls: audits["cumulative-layout-shift"]?.numericValue || null,
    tbt: audits["total-blocking-time"]?.numericValue || null,
    inp:
      audits["experimental-interaction-to-next-paint"]?.numericValue ||
      audits["interaction-to-next-paint"]?.numericValue ||
      null,
  };
}

// Average calculation
function averageMetrics(results) {
  const keys = ["performance", "lcp", "fcp", "cls", "tbt", "inp"];
  const sums = {};
  const counts = {};
  keys.forEach((k) => { sums[k] = 0; counts[k] = 0; });

  results.forEach((r) => {
    if (!r.success) return;
    keys.forEach((k) => {
      const v = r.metrics[k];
      if (v !== null && v !== undefined && !Number.isNaN(v)) {
        sums[k] += v;
        counts[k] += 1;
      }
    });
  });

  const avg = {};
  keys.forEach((k) => { avg[k] = counts[k] ? sums[k] / counts[k] : null; });
  return avg;
}

// Launch Puppeteer once at startup
let browser;
async function startBrowser() {
  browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // system Chromium
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });
}

// Lighthouse run using existing browser
async function runLighthouse(url) {
  const wsEndpoint = browser.wsEndpoint();
  const port = new URL(wsEndpoint).port;

  const options = {
    logLevel: "error",
    output: "json",
    port: port,
    throttlingMethod: "simulate",
    throttling: {
      rttMs: 150,
      throughputKbps: 1638.4,
      cpuSlowdownMultiplier: 4,
    },
    formFactor: "mobile",
    screenEmulation: {
      mobile: true,
      width: 412,
      height: 823,
      deviceScaleFactor: 1.75,
    },
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

// Express setup
const app = express();
const PORT = process.env.PORT || 3000;

// Queue to serialize requests
const queue = new PQueue({ concurrency: 1 });

app.get("/audit", async (req, res) => {
  const { url, runs } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url parameter" });
  const numRuns = Math.max(1, parseInt(runs || "3", 10));

  try {
    const results = await queue.add(async () => {
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

    const avg = averageMetrics(results);
    res.json({ url, runs: numRuns, results, average: avg });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Start browser and server
startBrowser().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Lighthouse API running on port ${PORT}`);
  });
}).catch(err => {
  console.error("❌ Failed to start Puppeteer browser:", err);
  process.exit(1);
});
