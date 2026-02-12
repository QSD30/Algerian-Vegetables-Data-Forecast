from datetime import date, datetime, timedelta
import json
import os
from pathlib import Path
import re
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import pandas as pd
from pydantic import BaseModel

app = FastAPI()

# Enable CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT_DIR = Path(__file__).resolve().parent.parent


def load_local_env_files():
    candidate_paths = [
        Path(__file__).resolve().parent / ".env",
        ROOT_DIR / ".env",
    ]
    for path in candidate_paths:
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_local_env_files()

OPENROUTER_API_URL = os.getenv(
    "OPENROUTER_API_URL", "https://openrouter.ai/api/v1/chat/completions"
)
FIRECRAWL_API_URL = os.getenv("FIRECRAWL_API_URL", "https://api.firecrawl.dev/v1/search")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "stepfun/step-3.5-flash:free")
OPENROUTER_FALLBACK_MODELS = [
    model.strip()
    for model in os.getenv("OPENROUTER_FALLBACK_MODELS", "openrouter/free").split(",")
    if model.strip()
]
API_TIMEOUT_SECONDS = float(os.getenv("AI_HTTP_TIMEOUT_SECONDS", "30"))


def resolve_data_path(env_var: str, default_filename: str) -> Path:
    raw = os.getenv(env_var)
    if raw:
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            candidate = ROOT_DIR / candidate
        return candidate
    return ROOT_DIR / default_filename


PREDICTIONS_FILE = resolve_data_path("PREDICTIONS_FILE", "predictions_2026.csv")
HISTORICAL_FILE = resolve_data_path("HISTORICAL_FILE", "extracted_prices.csv")


def get_data():
    if not PREDICTIONS_FILE.exists() or not HISTORICAL_FILE.exists():
        return None, None
    preds = pd.read_csv(PREDICTIONS_FILE)
    hist = pd.read_csv(HISTORICAL_FILE)
    return hist, preds


PRODUCT_CATEGORIES = {
    "Vegetables": [
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
    "Fruits": ["dates", "apple_imported", "apple_local", "banana", "strawberry", "orange"],
}

ALLOWED_PRODUCTS = {product for products in PRODUCT_CATEGORIES.values() for product in products}

TOMATO_2018_OVERRIDES = {
    1: 50.0,
    2: 52.0,
    3: 54.0,
    5: 56.0,
    6: 60.0,
    9: 66.0,
    10: 69.0,
    11: 69.05,
    12: 79.0,
}


def sanitize_historical_prices(product_hist: pd.DataFrame) -> pd.DataFrame:
    if product_hist.empty:
        return product_hist

    cleaned = product_hist.copy()
    cleaned["year"] = pd.to_numeric(cleaned["year"], errors="coerce")
    cleaned["month"] = pd.to_numeric(cleaned["month"], errors="coerce")
    cleaned["retail"] = pd.to_numeric(cleaned["retail"], errors="coerce")
    cleaned = cleaned.dropna(subset=["year", "month", "retail"])
    cleaned = cleaned[(cleaned["year"] >= 2015) & (cleaned["year"] <= 2035)]
    cleaned = cleaned[(cleaned["month"] >= 1) & (cleaned["month"] <= 12)]
    cleaned = cleaned[cleaned["retail"] > 0]

    if cleaned.empty:
        return cleaned[["year", "month", "retail"]]

    product_name = (
        str(cleaned["product"].iloc[0]).strip().lower()
        if "product" in cleaned.columns and not cleaned.empty
        else ""
    )
    monthly = cleaned.groupby(["year", "month"], as_index=False)["retail"].mean()
    monthly = monthly.sort_values(["year", "month"]).reset_index(drop=True)

    if len(monthly) < 6:
        return monthly[["year", "month", "retail"]]

    median_price = float(monthly["retail"].median())
    q20 = float(monthly["retail"].quantile(0.20))
    q80 = float(monthly["retail"].quantile(0.80))

    min_reasonable = max(1.0, median_price * 0.20, q20 * 0.50)
    max_reasonable = min(1000.0, median_price * 3.00, q80 * 2.00)

    local_median = monthly["retail"].rolling(5, center=True, min_periods=3).median()
    local_median = local_median.fillna(median_price)
    safe_local = local_median.replace(0, median_price if median_price > 0 else 1.0)
    ratio = monthly["retail"] / safe_local

    recent_trend = monthly["retail"].shift(1).rolling(6, min_periods=3).median()
    recent_trend = recent_trend.fillna(median_price)
    safe_trend = recent_trend.replace(0, median_price if median_price > 0 else 1.0)
    trend_ratio = monthly["retail"] / safe_trend

    jump_up = (trend_ratio > 1.90) & (monthly["retail"] > median_price * 1.30)
    jump_down = (trend_ratio < 0.45) & (monthly["retail"] < median_price * 0.70)

    anomaly_mask = (
        (ratio > 2.60)
        | (ratio < 0.38)
        | (monthly["retail"] > max_reasonable)
        | (monthly["retail"] < min_reasonable)
        | jump_up
        | jump_down
    )

    # Try OCR-like numeric correction first (extra leading digit / misplaced decimal),
    # then fallback to local median replacement.
    anomaly_indexes = monthly.index[anomaly_mask]
    for idx in anomaly_indexes:
        value = float(monthly.at[idx, "retail"])
        local_value = float(local_median.at[idx])
        trend_value = (
            float(recent_trend.at[idx]) if pd.notna(recent_trend.at[idx]) else local_value
        )

        if bool(jump_up.at[idx]):
            reference_value = min(local_value, trend_value * 1.15)
        elif bool(jump_down.at[idx]):
            reference_value = max(local_value, trend_value * 0.85)
        else:
            reference_value = local_value

        reference_value = max(reference_value, 1.0)

        candidates = [
            value,
            value - 1000.0,
            value - 100.0,
            value / 10.0,
            value / 100.0,
        ]
        valid_candidates = [
            candidate
            for candidate in candidates
            if candidate > 0 and candidate >= min_reasonable * 0.5 and candidate <= max_reasonable * 1.5
        ]

        if valid_candidates:
            best_candidate = min(
                valid_candidates, key=lambda candidate: abs(candidate - reference_value)
            )
            old_error = abs(value - reference_value)
            new_error = abs(best_candidate - reference_value)

            if new_error <= old_error * 0.65:
                monthly.at[idx, "retail"] = best_candidate
                continue

        monthly.at[idx, "retail"] = reference_value

    monthly["retail"] = monthly["retail"].clip(lower=min_reasonable, upper=max_reasonable)

    # 2018 tomato extraction has repeated OCR cross-matches in source PDFs.
    # Use month-level corrected values derived from the 2018 reports.
    if product_name == "tomato":
        for month, value in TOMATO_2018_OVERRIDES.items():
            row_mask = (monthly["year"] == 2018) & (monthly["month"] == month)
            if row_mask.any():
                monthly.loc[row_mask, "retail"] = value

    return monthly[["year", "month", "retail"]]


def sanitize_predictions(product_preds: pd.DataFrame) -> pd.DataFrame:
    if product_preds.empty:
        return product_preds

    cleaned = product_preds.copy()
    cleaned["year"] = pd.to_numeric(cleaned["year"], errors="coerce")
    cleaned["month"] = pd.to_numeric(cleaned["month"], errors="coerce")
    cleaned["predicted_retail"] = pd.to_numeric(cleaned["predicted_retail"], errors="coerce")
    cleaned = cleaned.dropna(subset=["year", "month", "predicted_retail"])
    cleaned = cleaned[(cleaned["year"] >= 2015) & (cleaned["year"] <= 2035)]
    cleaned = cleaned[(cleaned["month"] >= 1) & (cleaned["month"] <= 12)]
    cleaned = cleaned[cleaned["predicted_retail"] > 0]
    cleaned = cleaned[cleaned["predicted_retail"] <= 1000]
    return cleaned


def parse_user_date(message: str, reference_day: date | None = None) -> date | None:
    if reference_day is None:
        reference_day = date.today()

    lowered = message.strip().lower()
    normalized = re.sub(r"\s+", " ", lowered)

    relative_day_map = {
        0: [
            "today",
            "today's",
            "aujourd'hui",
            "اليوم",
        ],
        1: [
            "tomorrow",
            "tommorow",
            "tmrw",
            "demain",
            "غدا",
            "غداً",
        ],
        -1: [
            "yesterday",
            "hier",
            "أمس",
        ],
        2: [
            "day after tomorrow",
            "after tomorrow",
            "apres-demain",
            "après-demain",
            "بعد غد",
        ],
        -2: [
            "day before yesterday",
            "avant-hier",
            "قبل أمس",
        ],
    }

    for delta, keywords in relative_day_map.items():
        for keyword in keywords:
            if keyword in normalized:
                return reference_day + timedelta(days=delta)

    full_date = re.search(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b", message)
    if full_date:
        year, month, day = map(int, full_date.groups())
        try:
            return date(year, month, day)
        except ValueError:
            return None

    year_month = re.search(r"\b(20\d{2})[-/](\d{1,2})\b", message)
    if year_month:
        year, month = map(int, year_month.groups())
        try:
            return date(year, month, 15)
        except ValueError:
            return None

    return None


def monthly_frame_to_points(frame: pd.DataFrame, price_column: str, source_type: str):
    points: list[dict[str, Any]] = []
    if frame.empty:
        return points

    sorted_frame = frame.sort_values(["year", "month"]).copy()
    for _, row in sorted_frame.iterrows():
        points.append(
            {
                "date": date(int(row["year"]), int(row["month"]), 1),
                "price": float(row[price_column]),
                "type": source_type,
            }
        )
    return points


def estimate_daily_price(monthly_points: list[dict[str, Any]], target_day: date):
    if not monthly_points:
        return None

    sorted_points = sorted(monthly_points, key=lambda item: item["date"])
    target_dt = datetime.combine(target_day, datetime.min.time())
    point_dts = [datetime.combine(item["date"], datetime.min.time()) for item in sorted_points]

    if target_dt <= point_dts[0]:
        first = sorted_points[0]
        return {
            "price": round(float(first["price"]), 2),
            "method": "nearest",
            "period": first["date"].isoformat(),
            "based_on": [first["type"]],
        }
    if target_dt >= point_dts[-1]:
        last = sorted_points[-1]
        return {
            "price": round(float(last["price"]), 2),
            "method": "nearest",
            "period": last["date"].isoformat(),
            "based_on": [last["type"]],
        }

    for idx in range(len(point_dts) - 1):
        start_dt = point_dts[idx]
        end_dt = point_dts[idx + 1]
        if start_dt <= target_dt <= end_dt:
            left = sorted_points[idx]
            right = sorted_points[idx + 1]
            total_days = max((end_dt - start_dt).days, 1)
            passed_days = (target_dt - start_dt).days
            alpha = passed_days / total_days
            interpolated = float(left["price"]) + (float(right["price"]) - float(left["price"])) * alpha
            return {
                "price": round(interpolated, 2),
                "method": "interpolated",
                "period": f"{left['date'].isoformat()}..{right['date'].isoformat()}",
                "based_on": [left["type"], right["type"]],
            }

    return None


def build_price_context(
    message: str,
    product: str,
    hist: pd.DataFrame,
    preds: pd.DataFrame,
    reference_day: date | None = None,
):
    if reference_day is None:
        reference_day = date.today()

    product_hist = sanitize_historical_prices(hist[hist["product"] == product].copy())
    product_preds = sanitize_predictions(preds[preds["product"] == product].copy())

    hist_points = monthly_frame_to_points(product_hist, "retail", "Historical")
    pred_points = monthly_frame_to_points(product_preds, "predicted_retail", "Prediction")
    combined_points = sorted(hist_points + pred_points, key=lambda item: item["date"])

    requested_day = parse_user_date(message, reference_day=reference_day)
    estimated = estimate_daily_price(combined_points, requested_day) if requested_day else None

    stats = {
        "historical_points": len(hist_points),
        "prediction_points": len(pred_points),
        "latest_historical": (
            {
                "date": hist_points[-1]["date"].isoformat(),
                "price": round(hist_points[-1]["price"], 2),
            }
            if hist_points
            else None
        ),
        "first_prediction": (
            {
                "date": pred_points[0]["date"].isoformat(),
                "price": round(pred_points[0]["price"], 2),
            }
            if pred_points
            else None
        ),
        "avg_historical_price": (
            round(sum(point["price"] for point in hist_points) / len(hist_points), 2)
            if hist_points
            else None
        ),
        "min_historical_price": (
            round(min(point["price"] for point in hist_points), 2) if hist_points else None
        ),
        "max_historical_price": (
            round(max(point["price"] for point in hist_points), 2) if hist_points else None
        ),
    }

    compact_series = [
        {"date": point["date"].isoformat(), "price": round(point["price"], 2), "type": point["type"]}
        for point in combined_points
    ]

    return {
        "product": product,
        "reference_day": reference_day.isoformat(),
        "reference_weekday": reference_day.strftime("%A"),
        "requested_day": requested_day.isoformat() if requested_day else None,
        "estimated_day_price": estimated,
        "stats": stats,
        "series": compact_series,
    }


def build_fallback_response(message: str, price_context: dict[str, Any]):
    stats = price_context.get("stats", {})
    estimated = price_context.get("estimated_day_price")
    requested_day = price_context.get("requested_day")
    product = price_context.get("product", "this product")
    display_name = product.replace("_", " ")

    lines = []
    if requested_day and estimated:
        lines.append(
            f"Estimated price for {display_name} on {requested_day}: {estimated['price']} DZD (method: {estimated['method']}, based on monthly data)."
        )
    elif requested_day:
        lines.append(
            f"I could not estimate a specific value for {requested_day}, but I used the latest available monthly data for {display_name}."
        )

    latest = stats.get("latest_historical")
    if latest:
        lines.append(
            f"Latest historical point: {latest['price']} DZD at {latest['date']}."
        )

    first_prediction = stats.get("first_prediction")
    if first_prediction:
        lines.append(
            f"Forecast series starts at {first_prediction['date']} with {first_prediction['price']} DZD."
        )

    avg_price = stats.get("avg_historical_price")
    min_price = stats.get("min_historical_price")
    max_price = stats.get("max_historical_price")
    if avg_price is not None and min_price is not None and max_price is not None:
        lines.append(
            f"Historical range is {min_price}-{max_price} DZD, with average {avg_price} DZD."
        )

    if not lines:
        lines.append(
            f"I used your local dataset for {display_name}, but I need more details in your question to estimate a target day."
        )
    return " ".join(lines)


async def fetch_firecrawl_context(product: str, message: str, reference_day: date | None = None):
    if not FIRECRAWL_API_KEY:
        return []
    if reference_day is None:
        reference_day = date.today()

    message_hint = message.strip().replace("\n", " ")
    if len(message_hint) > 140:
        message_hint = message_hint[:140]
    current_year = reference_day.year
    reference_iso = reference_day.isoformat()

    queries = [
        f"latest Algeria {product.replace('_', ' ')} {message_hint} {current_year}",
        f"{product.replace('_', ' ')} Algeria price weather agriculture policy {reference_iso}",
        f"Algeria agriculture {product.replace('_', ' ')} imports drought rainfall latest",
        f"Algeria food inflation {product.replace('_', ' ')} market update {current_year}",
    ]

    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json",
    }
    seen_urls = set()
    collected: list[dict[str, str]] = []

    async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:
        for query in queries:
            try:
                response = await client.post(
                    FIRECRAWL_API_URL,
                    headers=headers,
                    json={
                        "query": query,
                        "limit": 3,
                    },
                )
                if response.status_code >= 400:
                    continue

                payload = response.json()
                raw_data = payload.get("data", [])
                results = []

                if isinstance(raw_data, list):
                    results = raw_data
                elif isinstance(raw_data, dict):
                    for key in ("web", "news", "results", "items"):
                        candidate = raw_data.get(key)
                        if isinstance(candidate, list):
                            results.extend(candidate)

                for item in results:
                    if not isinstance(item, dict):
                        continue
                    url = str(item.get("url") or "").strip()
                    if not url or url in seen_urls:
                        continue
                    seen_urls.add(url)

                    title = str(item.get("title") or "Untitled source").strip()
                    snippet = str(
                        item.get("description")
                        or item.get("snippet")
                        or item.get("markdown")
                        or ""
                    ).strip()
                    if len(snippet) > 280:
                        snippet = snippet[:277] + "..."

                    collected.append(
                        {
                            "title": title,
                            "url": url,
                            "snippet": snippet,
                        }
                    )
                    if len(collected) >= 8:
                        break
            except Exception:
                continue

            if len(collected) >= 8:
                break

    return collected


def serialize_openrouter_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text.strip())
        return "\n".join(part for part in parts if part).strip()
    return ""


def get_model_candidates():
    candidates: list[str] = [OPENROUTER_MODEL]
    for fallback in OPENROUTER_FALLBACK_MODELS:
        if fallback not in candidates:
            candidates.append(fallback)
    return candidates


async def generate_llm_response(
    message: str,
    product: str,
    language: str,
    price_context: dict[str, Any],
    web_context: list[dict[str, str]],
):
    if not OPENROUTER_API_KEY:
        return None, None

    product_display = product.replace("_", " ")
    reference_day = str(price_context.get("reference_day") or date.today().isoformat())
    reference_weekday = str(price_context.get("reference_weekday") or date.today().strftime("%A"))
    system_prompt = (
        "You are an expert market analyst for Algerian vegetables and fruits. "
        "Always prioritize the provided local dataset context for price answers. "
        "Use web context only as extra factors (weather, politics, imports, logistics, inflation). "
        f"Current reference date is {reference_day} ({reference_weekday}). Treat this as 'today'. "
        "If the user asks for an exact day, explain that base data is monthly and provide a precise estimate from the provided context. "
        "Be concise, numeric, and clear. Mention uncertainty when needed."
    )

    user_prompt = (
        f"Language preference: {language}\n"
        f"Today reference: {reference_day} ({reference_weekday})\n"
        f"Selected product: {product_display}\n"
        f"User question: {message}\n\n"
        f"Local price context JSON:\n{json.dumps(price_context, ensure_ascii=False)}\n\n"
        f"Web factors JSON:\n{json.dumps(web_context, ensure_ascii=False)}"
    )

    payload = {
        "temperature": 0.2,
        "max_tokens": 700,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Algerian Veggies Dashboard",
    }

    model_candidates = get_model_candidates()
    last_model = model_candidates[0] if model_candidates else OPENROUTER_MODEL

    async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:
        for model in model_candidates:
            payload["model"] = model
            last_model = model
            try:
                response = await client.post(OPENROUTER_API_URL, headers=headers, json=payload)
                response.raise_for_status()
                response_json = response.json()
            except Exception:
                continue

            choices = response_json.get("choices", [])
            if not choices:
                continue

            message_obj = choices[0].get("message", {})
            content = serialize_openrouter_content(message_obj.get("content"))
            if not content:
                continue

            return content, response_json.get("model") or model

    return None, last_model


@app.get("/api/products")
async def get_products():
    hist, _ = get_data()
    if hist is None:
        return {}

    available = set(hist[hist["product"].isin(ALLOWED_PRODUCTS)]["product"].dropna().unique())
    categorized = {}

    for cat, items in PRODUCT_CATEGORIES.items():
        matched = [item for item in items if item in available]
        if matched:
            categorized[cat] = sorted(matched)

    return categorized


@app.get("/api/data/{product}")
async def get_product_data(product: str):
    if product not in ALLOWED_PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not available in this dashboard")

    hist, preds = get_data()
    if hist is None or preds is None:
        raise HTTPException(status_code=404, detail="Data not found")

    p_hist = sanitize_historical_prices(hist[hist["product"] == product].copy())
    p_preds = sanitize_predictions(preds[preds["product"] == product].copy())

    chart_data = []
    if not p_hist.empty:
        p_hist_cleaned = p_hist.sort_values(["year", "month"])

        for _, row in p_hist_cleaned.iterrows():
            chart_data.append(
                {
                    "date": f"{int(row['year'])}-{int(row['month']):02d}",
                    "price": round(row["retail"], 2),
                    "type": "Historical",
                }
            )

    if not p_preds.empty:
        p_preds = p_preds.sort_values(["year", "month"])
        for _, row in p_preds.iterrows():
            chart_data.append(
                {
                    "date": f"{int(row['year'])}-{int(row['month']):02d}",
                    "price": round(row["predicted_retail"], 2),
                    "type": "Prediction",
                }
            )

    return chart_data


class ChatRequest(BaseModel):
    message: str
    product: str
    language: str = "en"


@app.post("/api/chat")
async def chat(request: ChatRequest):
    product = request.product.strip().lower()
    if product not in ALLOWED_PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not available in this dashboard")

    hist, preds = get_data()
    if hist is None or preds is None:
        raise HTTPException(status_code=404, detail="Data not found")

    reference_day = date.today()
    price_context = build_price_context(
        request.message,
        product,
        hist,
        preds,
        reference_day=reference_day,
    )
    web_context = await fetch_firecrawl_context(
        product,
        request.message,
        reference_day=reference_day,
    )
    if not FIRECRAWL_API_KEY:
        web_context_status = "disabled_no_api_key"
    elif web_context:
        web_context_status = "ok"
    else:
        web_context_status = "no_results"

    llm_response = None
    used_model = None
    try:
        llm_response, used_model = await generate_llm_response(
            message=request.message,
            product=product,
            language=request.language,
            price_context=price_context,
            web_context=web_context,
        )
    except Exception:
        llm_response = None

    response_text = llm_response or build_fallback_response(request.message, price_context)

    return {
        "response": response_text,
        "product": product,
        "requested_day": price_context.get("requested_day"),
        "estimated_day_price": price_context.get("estimated_day_price"),
        "data_stats": price_context.get("stats"),
        "server_today": reference_day.isoformat(),
        "sources": web_context,
        "web_context_status": web_context_status,
        "model": used_model or OPENROUTER_MODEL,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
