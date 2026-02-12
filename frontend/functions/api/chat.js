const OPENROUTER_API_URL_DEFAULT = "https://openrouter.ai/api/v1/chat/completions";
const FIRECRAWL_API_URL_DEFAULT = "https://api.firecrawl.dev/v1/search";
const OPENROUTER_MODEL_DEFAULT = "stepfun/step-3.5-flash:free";
const OPENROUTER_FALLBACK_DEFAULT = "openrouter/free";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function parseProductSeries(item = []) {
  if (!Array.isArray(item)) {
    return [];
  }
  return item
    .map((point) => {
      const [yearRaw, monthRaw] = String(point?.date || "").split("-");
      const year = Number(yearRaw);
      const month = Number(monthRaw);
      const price = Number(point?.price);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(price)) {
        return null;
      }
      if (month < 1 || month > 12) {
        return null;
      }
      const dt = new Date(Date.UTC(year, month - 1, 1));
      if (Number.isNaN(dt.getTime())) {
        return null;
      }
      return {
        date: dt,
        iso: dt.toISOString().slice(0, 10),
        price,
        type: point?.type === "Prediction" ? "Prediction" : "Historical",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);
}

function addDaysUTC(referenceDay, deltaDays) {
  const clone = new Date(referenceDay.getTime());
  clone.setUTCDate(clone.getUTCDate() + deltaDays);
  return clone;
}

function parseUserDate(message, referenceDay) {
  const raw = String(message || "");
  const lower = raw.toLowerCase();

  const relativeMap = [
    {
      delta: 2,
      patterns: ["day after tomorrow", "after tomorrow", "apres-demain", "après-demain", "بعد غد"],
    },
    {
      delta: -2,
      patterns: ["day before yesterday", "avant-hier", "قبل أمس"],
    },
    {
      delta: 1,
      patterns: ["tomorrow", "tommorow", "tmrw", "demain", "غدا", "غداً"],
    },
    {
      delta: -1,
      patterns: ["yesterday", "hier", "أمس"],
    },
    {
      delta: 0,
      patterns: ["today", "today's", "aujourd'hui", "اليوم"],
    },
  ];

  for (const entry of relativeMap) {
    if (entry.patterns.some((token) => lower.includes(token))) {
      return addDaysUTC(referenceDay, entry.delta);
    }
  }

  const fullMatch = raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (fullMatch) {
    const year = Number(fullMatch[1]);
    const month = Number(fullMatch[2]);
    const day = Number(fullMatch[3]);
    const dt = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day) &&
      dt.getUTCFullYear() === year &&
      dt.getUTCMonth() + 1 === month &&
      dt.getUTCDate() === day
    ) {
      return dt;
    }
  }

  const ymMatch = raw.match(/\b(20\d{2})[-/](\d{1,2})\b/);
  if (ymMatch) {
    const year = Number(ymMatch[1]);
    const month = Number(ymMatch[2]);
    const dt = new Date(Date.UTC(year, month - 1, 15));
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      dt.getUTCFullYear() === year &&
      dt.getUTCMonth() + 1 === month
    ) {
      return dt;
    }
  }
  return null;
}

function estimateDailyPrice(points, targetDay) {
  if (!Array.isArray(points) || points.length === 0 || !targetDay) {
    return null;
  }

  const sorted = [...points].sort((a, b) => a.date - b.date);
  const targetMs = targetDay.getTime();

  if (targetMs <= sorted[0].date.getTime()) {
    return {
      price: Number(sorted[0].price.toFixed(2)),
      method: "nearest",
      period: sorted[0].iso,
      based_on: [sorted[0].type],
    };
  }
  if (targetMs >= sorted[sorted.length - 1].date.getTime()) {
    const last = sorted[sorted.length - 1];
    return {
      price: Number(last.price.toFixed(2)),
      method: "nearest",
      period: last.iso,
      based_on: [last.type],
    };
  }

  for (let idx = 0; idx < sorted.length - 1; idx += 1) {
    const left = sorted[idx];
    const right = sorted[idx + 1];
    const start = left.date.getTime();
    const end = right.date.getTime();
    if (targetMs >= start && targetMs <= end) {
      const total = Math.max(1, end - start);
      const alpha = (targetMs - start) / total;
      const interpolated = left.price + (right.price - left.price) * alpha;
      return {
        price: Number(interpolated.toFixed(2)),
        method: "interpolated",
        period: `${left.iso}..${right.iso}`,
        based_on: [left.type, right.type],
      };
    }
  }

  return null;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

function buildPriceContext({ message, product, dataPoints, referenceDay }) {
  const historical = dataPoints.filter((point) => point.type === "Historical");
  const predictions = dataPoints.filter((point) => point.type === "Prediction");

  const requestedDay = parseUserDate(message, referenceDay);
  const estimatedDayPrice = estimateDailyPrice(dataPoints, requestedDay);

  const historicalPrices = historical.map((point) => point.price);

  return {
    product,
    reference_day: referenceDay.toISOString().slice(0, 10),
    reference_weekday: referenceDay.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
    requested_day: requestedDay ? requestedDay.toISOString().slice(0, 10) : null,
    estimated_day_price: estimatedDayPrice,
    stats: {
      historical_points: historical.length,
      prediction_points: predictions.length,
      latest_historical: historical.length
        ? { date: historical[historical.length - 1].iso, price: Number(historical[historical.length - 1].price.toFixed(2)) }
        : null,
      first_prediction: predictions.length
        ? { date: predictions[0].iso, price: Number(predictions[0].price.toFixed(2)) }
        : null,
      avg_historical_price: average(historicalPrices),
      min_historical_price:
        historicalPrices.length > 0 ? Number(Math.min(...historicalPrices).toFixed(2)) : null,
      max_historical_price:
        historicalPrices.length > 0 ? Number(Math.max(...historicalPrices).toFixed(2)) : null,
    },
    series: dataPoints.map((point) => ({
      date: point.iso,
      price: Number(point.price.toFixed(2)),
      type: point.type,
    })),
  };
}

function buildFallbackResponse(priceContext) {
  const lines = [];
  const displayName = String(priceContext?.product || "product").replaceAll("_", " ");
  const estimated = priceContext?.estimated_day_price;
  const requestedDay = priceContext?.requested_day;
  const stats = priceContext?.stats || {};

  if (requestedDay && estimated) {
    lines.push(
      `Estimated price for ${displayName} on ${requestedDay}: ${estimated.price} DZD (method: ${estimated.method}, based on monthly data).`
    );
  } else if (requestedDay) {
    lines.push(`I could not estimate an exact value for ${requestedDay} from current monthly points.`);
  }

  if (stats.latest_historical) {
    lines.push(
      `Latest historical point: ${stats.latest_historical.price} DZD at ${stats.latest_historical.date}.`
    );
  }
  if (stats.first_prediction) {
    lines.push(
      `Forecast starts at ${stats.first_prediction.date} with ${stats.first_prediction.price} DZD.`
    );
  }
  if (
    stats.avg_historical_price !== null &&
    stats.min_historical_price !== null &&
    stats.max_historical_price !== null
  ) {
    lines.push(
      `Historical range is ${stats.min_historical_price}-${stats.max_historical_price} DZD with average ${stats.avg_historical_price} DZD.`
    );
  }

  if (lines.length === 0) {
    return `I used your local dataset for ${displayName}, but I need more details to estimate a target day.`;
  }
  return lines.join(" ");
}

function parseOpenRouterContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => (item && typeof item.text === "string" ? item.text.trim() : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function getModelCandidates(env) {
  const primary = String(env.OPENROUTER_MODEL || OPENROUTER_MODEL_DEFAULT).trim();
  const fallbackRaw = String(env.OPENROUTER_FALLBACK_MODELS || OPENROUTER_FALLBACK_DEFAULT);
  const fallbacks = fallbackRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [primary, ...fallbacks.filter((item) => item !== primary)];
}

async function fetchFirecrawlContext({ message, product, env, referenceDay }) {
  const apiKey = String(env.FIRECRAWL_API_KEY || "").trim();
  if (!apiKey) {
    return { status: "disabled_no_api_key", sources: [] };
  }

  const messageHint = String(message || "").replace(/\s+/g, " ").trim().slice(0, 140);
  const currentYear = referenceDay.getUTCFullYear();
  const referenceIso = referenceDay.toISOString().slice(0, 10);

  const queries = [
    `latest Algeria ${product.replaceAll("_", " ")} ${messageHint} ${currentYear}`,
    `${product.replaceAll("_", " ")} Algeria price weather agriculture policy ${referenceIso}`,
    `Algeria agriculture ${product.replaceAll("_", " ")} imports drought rainfall latest`,
    `Algeria food inflation ${product.replaceAll("_", " ")} market update ${currentYear}`,
  ];

  const apiUrl = String(env.FIRECRAWL_API_URL || FIRECRAWL_API_URL_DEFAULT);
  const seen = new Set();
  const collected = [];

  for (const query of queries) {
    try {
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, limit: 3 }),
      });
      if (!resp.ok) {
        continue;
      }
      const payload = await resp.json();
      const rawData = payload?.data;
      const rows = [];
      if (Array.isArray(rawData)) {
        rows.push(...rawData);
      } else if (rawData && typeof rawData === "object") {
        for (const key of ["web", "news", "results", "items"]) {
          if (Array.isArray(rawData[key])) {
            rows.push(...rawData[key]);
          }
        }
      }

      for (const row of rows) {
        if (!row || typeof row !== "object") {
          continue;
        }
        const url = String(row.url || "").trim();
        if (!url || seen.has(url)) {
          continue;
        }
        seen.add(url);
        const title = String(row.title || "Untitled source").trim();
        let snippet = String(row.description || row.snippet || row.markdown || "").trim();
        if (snippet.length > 280) {
          snippet = `${snippet.slice(0, 277)}...`;
        }
        collected.push({ title, url, snippet });
        if (collected.length >= 8) {
          break;
        }
      }

      if (collected.length >= 8) {
        break;
      }
    } catch {
      // Continue with the next query.
    }
  }

  return {
    status: collected.length > 0 ? "ok" : "no_results",
    sources: collected,
  };
}

async function generateOpenRouterResponse({ message, language, product, priceContext, webContext, env }) {
  const apiKey = String(env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) {
    return { text: null, model: String(env.OPENROUTER_MODEL || OPENROUTER_MODEL_DEFAULT) };
  }

  const referenceDay = String(priceContext.reference_day || "");
  const referenceWeekday = String(priceContext.reference_weekday || "");
  const productDisplay = String(product || "").replaceAll("_", " ");
  const apiUrl = String(env.OPENROUTER_API_URL || OPENROUTER_API_URL_DEFAULT);

  const systemPrompt =
    "You are an expert market analyst for Algerian vegetables and fruits. " +
    "Always prioritize the provided local dataset context for price answers. " +
    "Use web context only as extra factors (weather, politics, imports, logistics, inflation). " +
    `Current reference date is ${referenceDay} (${referenceWeekday}). Treat this as 'today'. ` +
    "If the user asks for an exact day, explain that base data is monthly and provide a precise estimate from the provided context. " +
    "Be concise, numeric, and clear. Mention uncertainty when needed.";

  const userPrompt =
    `Language preference: ${language}\n` +
    `Today reference: ${referenceDay} (${referenceWeekday})\n` +
    `Selected product: ${productDisplay}\n` +
    `User question: ${message}\n\n` +
    `Local price context JSON:\n${JSON.stringify(priceContext)}\n\n` +
    `Web factors JSON:\n${JSON.stringify(webContext)}`;

  const modelCandidates = getModelCandidates(env);
  let lastModel = modelCandidates[0] || OPENROUTER_MODEL_DEFAULT;

  for (const model of modelCandidates) {
    lastModel = model;
    try {
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://algerian-vegetables-data-forecast.pages.dev",
          "X-Title": "Algerian Veggies Dashboard",
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 700,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!resp.ok) {
        continue;
      }
      const payload = await resp.json();
      const content = parseOpenRouterContent(payload?.choices?.[0]?.message?.content);
      if (!content) {
        continue;
      }
      return { text: content, model: payload?.model || model };
    } catch {
      // Try next model.
    }
  }

  return { text: null, model: lastModel };
}

async function loadDashboardData(request) {
  const assetUrl = new URL("/data/dashboard-data.json", request.url);
  const resp = await fetch(assetUrl.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!resp.ok) {
    throw new Error(`Failed to load dashboard-data.json (${resp.status})`);
  }
  return resp.json();
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    const message = String(body?.message || "").trim();
    const product = String(body?.product || "").trim().toLowerCase();
    const language = String(body?.language || "en").trim().toLowerCase();

    if (!message) {
      return jsonResponse(400, { detail: "message is required" });
    }
    if (!product) {
      return jsonResponse(400, { detail: "product is required" });
    }

    const data = await loadDashboardData(request);
    const dataByProduct = data?.dataByProduct || {};
    const productSeries = parseProductSeries(dataByProduct[product] || []);
    if (productSeries.length === 0) {
      return jsonResponse(404, { detail: "Product not available in this dashboard" });
    }

    const now = new Date();
    const referenceDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const priceContext = buildPriceContext({
      message,
      product,
      dataPoints: productSeries,
      referenceDay,
    });

    const firecrawl = await fetchFirecrawlContext({
      message,
      product,
      env,
      referenceDay,
    });
    const llm = await generateOpenRouterResponse({
      message,
      language,
      product,
      priceContext,
      webContext: firecrawl.sources,
      env,
    });

    const responseText = llm.text || buildFallbackResponse(priceContext);
    return jsonResponse(200, {
      response: responseText,
      product,
      requested_day: priceContext.requested_day,
      estimated_day_price: priceContext.estimated_day_price,
      data_stats: priceContext.stats,
      server_today: priceContext.reference_day,
      sources: firecrawl.sources,
      web_context_status: firecrawl.status,
      model: llm.model,
    });
  } catch (error) {
    return jsonResponse(500, {
      detail: "Chat service failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
