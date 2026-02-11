from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import os
from pathlib import Path
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
    "Vegetables": ["potato", "tomato", "onion", "lettuce", "squash", "carrots", "peppers_sweet", "peppers_hot", "green_beans", "beetroot", "garlic"],
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

    product_name = str(cleaned["product"].iloc[0]).strip().lower() if "product" in cleaned.columns and not cleaned.empty else ""
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
        trend_value = float(recent_trend.at[idx]) if pd.notna(recent_trend.at[idx]) else local_value

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
            best_candidate = min(valid_candidates, key=lambda candidate: abs(candidate - reference_value))
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
            chart_data.append({
                "date": f"{int(row['year'])}-{int(row['month']):02d}",
                "price": round(row['retail'], 2),
                "type": "Historical"
            })
        
    if not p_preds.empty:
        p_preds = p_preds.sort_values(["year", "month"])
        for _, row in p_preds.iterrows():
            chart_data.append({
                "date": f"{int(row['year'])}-{int(row['month']):02d}",
                "price": round(row['predicted_retail'], 2),
                "type": "Prediction"
            })
        
    return chart_data

class ChatRequest(BaseModel):
    message: str
    product: str

@app.post("/api/chat")
async def chat(request: ChatRequest):
    # Expanded insights
    insights = {
        "potato": "Market data shows prices reaching 60-90 DZD. Recent reports indicate high demand.",
        "meat": "Local red meat remains expensive despite government imports. Sheep meat is particularly volatile reaching 2500 DZD/kg.",
        "eggs": "Egg prices have seen recent stabilization but remain sensitive to feed costs.",
        "semolina": "State-subsidized prices help keep semolina stable at 1000 DZD per 25kg bag."
    }
    
    # Dynamic insight generation
    prod = request.product.lower()
    insight = insights.get(prod, f"The current trend for {prod} shows seasonal sensitivity. Weather impacts in major production wilayas are being monitored for yield impacts.")
    
    return {"response": insight}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
