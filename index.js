// index.js
import express from "express";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher"; // important: no default


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

async function runOnce(url) {
  let chrome;
  try {
    chrome = await chromeLauncher.launch({
      chromeFlags: [
        "--headless=new",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    });

    const options = {
      logLevel: "error",
      output: "json",
      port: chrome.port,
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
    };

    const runnerResult = await lighthouse(url, options);
    return { success: true, metrics: extractMetricsFromLHR(runnerResult.lhr) };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  } finally {
    if (chrome) {
      try { await chrome.kill(); } catch (e) {}
    }
  }
}

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

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/audit", async (req, res) => {
  const { url, runs } = req.query;
  if (!url) return res.status(400).json({ error: "Missing ?url parameter" });

  const numRuns = Math.max(1, parseInt(runs || "3", 10));
  const results = [];

  for (let i = 0; i < numRuns; i++) {
    // runs sequentially to avoid overload
    const result = await runOnce(url);
    results.push(result);
  }

  const avg = averageMetrics(results);
  res.json({ url, runs: numRuns, results, average: avg });
});

app.listen(PORT, () => {
  console.log(`✅ Lighthouse API running on http://localhost:${PORT}`);
});
