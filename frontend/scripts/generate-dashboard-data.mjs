import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCT_CATEGORIES = {
  Vegetables: [
    "potato",
    "tomato",
    "onion",
    "lettuce",
    "squash",
    "carrots",
    "peppers_sweet",
    "peppers_hot",
    "green_beans",
    "beetroot",
    "garlic",
  ],
  Fruits: ["dates", "apple_imported", "apple_local", "banana", "strawberry", "orange"],
};

const TOMATO_2018_OVERRIDES = {
  1: 50.0,
  2: 52.0,
  3: 54.0,
  5: 56.0,
  6: 60.0,
  9: 66.0,
  10: 69.0,
  11: 69.05,
  12: 79.0,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "..");
const workspaceDir = path.resolve(frontendDir, "..");
const historicalPath = path.join(workspaceDir, "extracted_prices.csv");
const predictionsPath = path.join(workspaceDir, "predictions_2026.csv");
const outputDir = path.join(frontendDir, "public", "data");
const outputPath = path.join(outputDir, "dashboard-data.json");

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseCsv(csvText) {
  const lines = csvText.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length < 2) {
    return [];
  }

  const headers = lines[0].split(",").map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row = {};

    headers.forEach((header, index) => {
      row[header] = (values[index] ?? "").trim();
    });

    return row;
  });
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sanitizeHistorical(rows, product) {
  const points = rows
    .map((row) => ({
      year: toNumber(row.year),
      month: toNumber(row.month),
      retail: toNumber(row.retail),
    }))
    .filter(
      (row) =>
        row.year !== null &&
        row.month !== null &&
        row.retail !== null &&
        row.year >= 2015 &&
        row.year <= 2035 &&
        row.month >= 1 &&
        row.month <= 12 &&
        row.retail > 0,
    );

  const monthlyMap = new Map();
  for (const point of points) {
    const monthKey = `${Math.round(point.year)}-${String(Math.round(point.month)).padStart(2, "0")}`;
    const current = monthlyMap.get(monthKey);
    if (!current) {
      monthlyMap.set(monthKey, {
        year: Math.round(point.year),
        month: Math.round(point.month),
        total: point.retail,
        count: 1,
      });
      continue;
    }

    current.total += point.retail;
    current.count += 1;
  }

  const aggregated = Array.from(monthlyMap.values())
    .map((item) => ({
      year: item.year,
      month: item.month,
      retail: item.total / item.count,
    }))
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year));

  if (product === "tomato") {
    for (const row of aggregated) {
      if (row.year === 2018 && TOMATO_2018_OVERRIDES[row.month]) {
        row.retail = TOMATO_2018_OVERRIDES[row.month];
      }
    }
  }

  return aggregated;
}

function sanitizePredictions(rows) {
  return rows
    .map((row) => ({
      year: toNumber(row.year),
      month: toNumber(row.month),
      predicted_retail: toNumber(row.predicted_retail),
    }))
    .filter(
      (row) =>
        row.year !== null &&
        row.month !== null &&
        row.predicted_retail !== null &&
        row.year >= 2015 &&
        row.year <= 2035 &&
        row.month >= 1 &&
        row.month <= 12 &&
        row.predicted_retail > 0 &&
        row.predicted_retail <= 1000,
    )
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year));
}

function buildChartData(historicalRows, predictionRows) {
  const historical = historicalRows.map((row) => ({
    date: `${row.year}-${String(row.month).padStart(2, "0")}`,
    price: Number(row.retail.toFixed(2)),
    type: "Historical",
  }));

  const predictions = predictionRows.map((row) => ({
    date: `${row.year}-${String(row.month).padStart(2, "0")}`,
    price: Number(row.predicted_retail.toFixed(2)),
    type: "Prediction",
  }));

  return historical.concat(predictions);
}

async function main() {
  const hasHistoricalCsv = await fileExists(historicalPath);
  const hasPredictionsCsv = await fileExists(predictionsPath);

  if (!hasHistoricalCsv || !hasPredictionsCsv) {
    const hasExistingOutput = await fileExists(outputPath);
    if (hasExistingOutput) {
      console.warn("CSV sources not found. Using existing public/data/dashboard-data.json.");
      return;
    }

    throw new Error("CSV sources are missing and no fallback dashboard-data.json exists.");
  }

  const [historicalCsv, predictionsCsv] = await Promise.all([
    readFile(historicalPath, "utf8"),
    readFile(predictionsPath, "utf8"),
  ]);

  const historicalRows = parseCsv(historicalCsv);
  const predictionRows = parseCsv(predictionsCsv);

  const allowedProducts = new Set(Object.values(PRODUCT_CATEGORIES).flat());
  const availableProducts = new Set(
    historicalRows
      .map((row) => (row.product || "").trim())
      .filter((product) => product && allowedProducts.has(product)),
  );

  const categories = {};
  for (const [category, products] of Object.entries(PRODUCT_CATEGORIES)) {
    const matched = products.filter((product) => availableProducts.has(product)).sort();
    if (matched.length > 0) {
      categories[category] = matched;
    }
  }

  const dataByProduct = {};
  for (const product of Object.values(categories).flat()) {
    const productHistorical = sanitizeHistorical(
      historicalRows.filter((row) => row.product === product),
      product,
    );
    const productPredictions = sanitizePredictions(predictionRows.filter((row) => row.product === product));
    dataByProduct[product] = buildChartData(productHistorical, productPredictions);
  }

  const payload = {
    categories,
    dataByProduct,
    generatedAt: new Date().toISOString(),
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload), "utf8");

  console.log(`Generated ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to generate dashboard data:", error);
  process.exitCode = 1;
});
