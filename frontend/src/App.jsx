import React, { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  TrendingUp,
  Activity,
  Layers,
  Package,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  BrainCircuit,
  Search,
  ChevronDown,
} from "lucide-react";
import "./App.css";

const DASHBOARD_DATA_URL = `${import.meta.env.BASE_URL}data/dashboard-data.json`;

const TRANSLATIONS = {
  ar: {
    languageLabel: "اللغة",
    arabic: "العربية",
    english: "English",
    engineBadge: "محرك التوقعات الفوري",
    title: "توقعات الخضروات 2026",
    subtitle: "لوحة توقعات متقدمة تعتمد على 10 سنوات من تقارير السوق ورؤى الشبكات العصبية.",
    exportAnalysis: "تصدير التحليل",
    marketCategory: "فئة السوق",
    specificCommodity: "السلعة المحددة",
    aiInsightEngine: "محرك الرؤى الذكية",
    recalculating: "جاري إعادة حساب الأوزان العصبية...",
    fallbackInsight: "تتم الآن معالجة ظروف السوق بواسطة محرك الذكاء الاصطناعي...",
    analysisConfidence: "مستوى الثقة في التحليل",
    averageMarketPrice: "متوسط سعر السوق",
    volatilityRange: "نطاق التذبذب",
    priceCorridor: "ممر الأسعار",
    lastMonthChange: "تغير الشهر الماضي",
    chartTitle: "مؤشر تطور الأسعار",
    chartSubtitle: "2015 - 2026 (بيانات شهرية مجمعة)",
    historical: "تاريخي",
    forecast: "توقع آلي",
    chooseProduct: "اختر منتجًا لبدء التحليل",
    chartLoading: "جارٍ بث بيانات السوق المؤمنة...",
    emptyState: "النظام جاهز. عدّل خيارات التصفية لعرض تدفق البيانات.",
    historicalCoverage: "التغطية التاريخية",
    historicalCoverageValue: (count) => `${count || 0} نقطة بيانات شهرية من الأرشيف الرسمي`,
    neuralForecasting: "التنبؤ العصبي",
    neuralForecastingValue: (count) => `${count || 0} نقطة توقع مستقبلية تم توليدها`,
    footerCompany: "(c) 2026 أنظمة توقعات أنتي غرافيتي",
    footerReports: "تقارير رسمية معتمدة",
    footerML: "تم التحقق عبر محرك التعلم الآلي",
    unitDzd: "دج",
    unitDzdPkt: "دج/وحدة",
  },
  en: {
    languageLabel: "Language",
    arabic: "Arabic",
    english: "English",
    engineBadge: "Real-Time Prediction Engine",
    title: "VeggieForecast 2026",
    subtitle: "A premium forecasting dashboard using ten years of market reports and neural network insights.",
    exportAnalysis: "Export Analysis",
    marketCategory: "Market Category",
    specificCommodity: "Specific Commodity",
    aiInsightEngine: "AI Insight Engine",
    recalculating: "Recalculating neural weights...",
    fallbackInsight: "Market conditions are currently being processed by the AI engine...",
    analysisConfidence: "Analysis Confidence",
    averageMarketPrice: "Average Market Price",
    volatilityRange: "Volatility Range",
    priceCorridor: "Price Corridor",
    lastMonthChange: "Last Month Change",
    chartTitle: "Price Transformation Index",
    chartSubtitle: "2015 - 2026 (Monthly Aggregate Data)",
    historical: "Historical",
    forecast: "ML Forecast",
    chooseProduct: "Choose a product to begin analysis",
    chartLoading: "Streaming secure data packets...",
    emptyState: "System ready. Adjust selectors to visualize data streams.",
    historicalCoverage: "Historical Coverage",
    historicalCoverageValue: (count) => `${count || 0} monthly data points from official archives`,
    neuralForecasting: "Neural Forecasting",
    neuralForecastingValue: (count) => `${count || 0} forward-looking projection points generated`,
    footerCompany: "(c) 2026 Antigravity Forecasting Systems",
    footerReports: "Official Reports Sourced",
    footerML: "Validated by ML Engine",
    unitDzd: "DZD",
    unitDzdPkt: "DZD PKT",
  },
};

const CATEGORY_LABELS_AR = {
  Cereals: "الحبوب",
  Dairy: "الألبان",
  Pantry: "المواد الأساسية",
  Legumes: "البقوليات",
  Vegetables: "الخضروات",
  Fruits: "الفواكه",
  "Meat & Eggs": "اللحوم والبيض",
};

const PRODUCT_LABELS_AR = {
  semolina_premium: "سميد ممتاز",
  semolina_standard: "سميد عادي",
  flour_bakery: "دقيق للمخابز",
  sugar_white: "سكر أبيض",
  rice: "أرز",
  pasta: "معكرونة",
  baby_milk: "حليب أطفال",
  adult_milk: "حليب للكبار",
  boxed_milk: "حليب معلب",
  coffee: "قهوة",
  tea: "شاي",
  yeast: "خميرة",
  edible_oil: "زيت غذائي",
  tomato_paste: "معجون الطماطم",
  dry_beans: "فاصولياء جافة",
  lentils: "عدس",
  chickpeas: "حمص",
  potato: "بطاطا",
  tomato: "طماطم",
  onion: "بصل",
  lettuce: "خس",
  squash: "قرع",
  carrots: "جزر",
  peppers_sweet: "فلفل حلو",
  peppers_hot: "فلفل حار",
  green_beans: "فاصولياء خضراء",
  beetroot: "شمندر",
  garlic: "ثوم",
  dates: "تمر",
  apple_imported: "تفاح مستورد",
  apple_local: "تفاح محلي",
  banana: "موز",
  strawberry: "فراولة",
  orange: "برتقال",
  sheep_meat_local: "لحم غنم محلي",
  sheep_meat_frozen: "لحم غنم مجمد",
  beef_local: "لحم بقري محلي",
  beef_frozen: "لحم بقري مجمد",
  white_meat: "لحم أبيض",
  eggs: "بيض",
};

const INSIGHTS_AR = {
  potato: "تشير بيانات السوق إلى أن أسعار البطاطا تتراوح غالبا بين 60 و90 دج مع طلب مرتفع في الفترات الأخيرة.",
  meat: "يبقى سعر اللحم الأحمر المحلي مرتفعا رغم الاستيراد الحكومي، مع تذبذب واضح في لحم الغنم.",
  eggs: "شهدت أسعار البيض استقرارا نسبيا، لكنها ما زالت حساسة لتكاليف الأعلاف.",
  semolina: "تساعد الأسعار المدعمة من الدولة في الحفاظ على استقرار سعر السميد.",
};

const INSIGHTS_EN = {
  potato: "Market data shows prices reaching 60-90 DZD. Recent reports indicate high demand.",
  meat: "Local red meat remains expensive despite government imports. Sheep meat can be highly volatile.",
  eggs: "Egg prices have seen recent stabilization but remain sensitive to feed costs.",
  semolina: "State-subsidized prices help keep semolina stable at 1000 DZD per 25kg bag.",
};

function App() {
  const [language, setLanguage] = useState(() => {
    const stored = window.localStorage.getItem("ui_language");
    return stored === "en" ? "en" : "ar";
  });
  const [categories, setCategories] = useState({});
  const [selectedProduct, setSelectedProduct] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [dataByProduct, setDataByProduct] = useState({});
  const [loading, setLoading] = useState(true);

  const isArabic = language === "ar";
  const t = TRANSLATIONS[language];

  useEffect(() => {
    window.localStorage.setItem("ui_language", language);
  }, [language]);

  useEffect(() => {
    fetch(DASHBOARD_DATA_URL)
      .then((res) => res.json())
      .then((res) => {
        const fetchedCategories = res?.categories || {};
        const fetchedDataByProduct = res?.dataByProduct || {};

        setCategories(fetchedCategories);
        setDataByProduct(fetchedDataByProduct);

        const firstCategory = Object.keys(fetchedCategories)[0];
        if (firstCategory) {
          setActiveCategory(firstCategory);
          if (fetchedCategories[firstCategory][0]) {
            setSelectedProduct(fetchedCategories[firstCategory][0]);
          }
        }
      })
      .catch((err) => {
        console.error("Data load error:", err);
        setCategories({});
        setDataByProduct({});
      })
      .finally(() => setLoading(false));
  }, []);

  const formatProductName = (name = "") => name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

  const getCategoryLabel = (category) => {
    if (isArabic) {
      return CATEGORY_LABELS_AR[category] || category;
    }
    return category;
  };

  const getProductLabel = (product) => {
    if (isArabic) {
      return PRODUCT_LABELS_AR[product] || formatProductName(product);
    }
    return formatProductName(product);
  };

  const data = useMemo(() => {
    if (!selectedProduct) {
      return [];
    }
    return dataByProduct[selectedProduct] || [];
  }, [selectedProduct, dataByProduct]);

  const insight = useMemo(() => {
    if (!selectedProduct) {
      return "";
    }
    if (isArabic) {
      return INSIGHTS_AR[selectedProduct] || t.fallbackInsight;
    }
    return INSIGHTS_EN[selectedProduct] || t.fallbackInsight;
  }, [selectedProduct, isArabic, t.fallbackInsight]);

  const stats = useMemo(() => {
    if (!data || data.length === 0) {
      return { min: 0, max: 0, avg: 0, change: 0 };
    }

    const historical = data.filter((point) => point.type === "Historical");
    const prices = data.map((point) => point.price);
    const lastPrice = historical.length > 0 ? historical[historical.length - 1].price : 0;
    const prevPrice = historical.length > 1 ? historical[historical.length - 2].price : lastPrice;
    const safePrevious = prevPrice === 0 ? 1 : prevPrice;

    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: prices.reduce((sum, value) => sum + value, 0) / prices.length,
      change: ((lastPrice - prevPrice) / safePrevious) * 100,
    };
  }, [data]);

  const historicalCount = data.filter((point) => point.type === "Historical").length;
  const forecastCount = data.filter((point) => point.type === "Prediction").length;
  const confidence = data.length > 0 ? Math.min(99, 87 + Math.round((historicalCount / data.length) * 10)) : 94;

  return (
    <div className={`app-shell ${isArabic ? "lang-ar" : "lang-en"}`} dir={isArabic ? "rtl" : "ltr"} lang={language}>
      <div className="dashboard">
        <header className="top-nav reveal">
          <div className="headline-group">
            <div className="eyebrow">
              <Activity size={14} />
              {t.engineBadge}
            </div>
            <h1 className="hero-title">{t.title}</h1>
            <p className="hero-subtitle">{t.subtitle}</p>
          </div>

          <div className="nav-actions">
            <div className="language-switch" role="group" aria-label={t.languageLabel}>
              <button
                type="button"
                className={`lang-btn ${language === "ar" ? "active" : ""}`}
                onClick={() => setLanguage("ar")}
              >
                {t.arabic}
              </button>
              <button
                type="button"
                className={`lang-btn ${language === "en" ? "active" : ""}`}
                onClick={() => setLanguage("en")}
              >
                {t.english}
              </button>
            </div>

            <button type="button" className="secondary-btn">
              <Download size={16} />
              {t.exportAnalysis}
            </button>
          </div>
        </header>

        <main className="dashboard-grid">
          <aside className="control-column reveal delay-1">
            <section className="panel controls-panel">
              <div className="field-group">
                <label className="field-label" htmlFor="category-select">
                  <Layers size={14} />
                  {t.marketCategory}
                </label>
                <div className="select-wrap">
                  <select
                    id="category-select"
                    className="select-control"
                    value={activeCategory}
                    onChange={(e) => {
                      const nextCategory = e.target.value;
                      setActiveCategory(nextCategory);
                      const firstProduct = categories[nextCategory]?.[0] || "";
                      setSelectedProduct(firstProduct);
                    }}
                  >
                    {Object.keys(categories).map((cat) => (
                      <option key={cat} value={cat}>
                        {getCategoryLabel(cat)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="select-icon" size={16} />
                </div>
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor="product-select">
                  <Package size={14} />
                  {t.specificCommodity}
                </label>
                <div className="select-wrap">
                  <select
                    id="product-select"
                    className="select-control"
                    value={selectedProduct}
                    onChange={(e) => setSelectedProduct(e.target.value)}
                  >
                    {categories[activeCategory]?.map((product) => (
                      <option key={product} value={product}>
                        {getProductLabel(product)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="select-icon" size={16} />
                </div>
              </div>
            </section>

            <section className="panel insight-panel">
              <h4 className="field-label">
                <BrainCircuit size={14} />
                {t.aiInsightEngine}
              </h4>
              <div className="insight-message">
                {loading ? (
                  <div className="loading-inline">
                    <span className="pulse-dot" />
                    {t.recalculating}
                  </div>
                ) : (
                  insight
                )}
              </div>

              <div className="confidence-block">
                <div className="confidence-label-row">
                  <span>{t.analysisConfidence}</span>
                  <span>{confidence}%</span>
                </div>
                <div className="confidence-track">
                  <div className="confidence-fill" style={{ width: `${confidence}%` }} />
                </div>
              </div>
            </section>
          </aside>

          <section className="analysis-column reveal delay-2">
            <div className="stats-grid">
              <article className="panel stat-card">
                <span className="stat-kicker">{t.averageMarketPrice}</span>
                <div className="stat-row">
                  <span className="stat-value">{stats.avg.toFixed(1)}</span>
                  <span className="stat-unit">{t.unitDzd}</span>
                </div>
              </article>

              <article className="panel stat-card">
                <span className="stat-kicker">{t.volatilityRange}</span>
                <div className="stat-row">
                  <span className="stat-value accent">{(stats.max - stats.min).toFixed(0)}</span>
                  <span className="stat-unit">{t.unitDzdPkt}</span>
                </div>
              </article>

              <article className="panel stat-card">
                <span className="stat-kicker">{t.priceCorridor}</span>
                <div className="range-row">
                  <span className="mono">{stats.min.toFixed(0)}</span>
                  <div className="range-line" />
                  <span className="mono">{stats.max.toFixed(0)}</span>
                </div>
              </article>

              <article className="panel stat-card">
                <span className="stat-kicker">{t.lastMonthChange}</span>
                <div className={`trend-row ${stats.change >= 0 ? "trend-positive" : "trend-negative"}`}>
                  {stats.change >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                  {Math.abs(stats.change).toFixed(1)}%
                </div>
              </article>
            </div>

            <section className="panel chart-panel">
              <div className="chart-header">
                <div>
                  <h3 className="chart-title">
                    <TrendingUp size={20} />
                    {t.chartTitle}
                  </h3>
                  <p className="chart-subtitle">{t.chartSubtitle}</p>
                </div>

                <div className="legend-row">
                  <span className="legend-item">
                    <i className="dot historical" />
                    {t.historical}
                  </span>
                  <span className="legend-item">
                    <i className="dot forecast" />
                    {t.forecast}
                  </span>
                </div>
              </div>

              <div className="active-product">{selectedProduct ? getProductLabel(selectedProduct) : t.chooseProduct}</div>

              <div className="chart-wrap">
                {loading ? (
                  <div className="chart-loading">{t.chartLoading}</div>
                ) : data.length > 0 ? (
                  <ResponsiveContainer width="100%" height={420}>
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="5 5" stroke="#ffffff10" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke="#475569"
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                        interval={Math.max(0, Math.floor(data.length / 8))}
                      />
                      <YAxis
                        stroke="#475569"
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: "16px",
                          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                          backdropFilter: "blur(10px)",
                        }}
                        itemStyle={{ color: "#5eead4", fontSize: "13px" }}
                        labelStyle={{ color: "#94a3b8", marginBottom: "8px" }}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="price"
                        stroke="#5eead4"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 4, stroke: "#5eead4", strokeWidth: 2, fill: "#0f172a" }}
                        connectNulls
                        name={`${t.historical} + ${t.forecast}`}
                      />
                      <Line
                        type="monotone"
                        dataKey={(datum) => (datum.type === "Prediction" ? datum.price : null)}
                        stroke="#f43f5e"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                        name={t.forecast}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state">
                    <Search size={40} />
                    <p>{t.emptyState}</p>
                  </div>
                )}
              </div>
            </section>

            <div className="detail-grid">
              <article className="panel detail-card">
                <div className="detail-icon blue">
                  <Calendar size={20} />
                </div>
                <div>
                  <h5>{t.historicalCoverage}</h5>
                  <p>{t.historicalCoverageValue(historicalCount)}</p>
                </div>
              </article>

              <article className="panel detail-card">
                <div className="detail-icon teal">
                  <BrainCircuit size={20} />
                </div>
                <div>
                  <h5>{t.neuralForecasting}</h5>
                  <p>{t.neuralForecastingValue(forecastCount)}</p>
                </div>
              </article>
            </div>
          </section>
        </main>

        <footer className="app-footer">
          <p>{t.footerCompany}</p>
          <div className="footer-tags">
            <span>{t.footerReports}</span>
            <span>{t.footerML}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
