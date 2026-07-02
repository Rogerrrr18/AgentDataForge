import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type CompanySeed = {
  ticker: string;
  cik: string;
  name: string;
  thesisTag: string;
};

type FactRecord = {
  concept: string;
  label: string;
  unit: string;
  value: number;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  end?: string;
  frame?: string;
};

type FilingRecord = {
  ticker: string;
  companyName: string;
  cik: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  accessionNumber: string;
  primaryDocument: string;
  description: string | null;
  secUrl: string;
  agentUse: string[];
};

type PriceRecord = {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sourceUrl: string;
};

type MacroRecord = {
  indicatorId: string;
  indicatorName: string;
  frequencyHint: string;
  date: string;
  value: number | null;
  unit: string;
  sourceUrl: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const outputDir = join(repoRoot, "data", "finance-research");
const docsDir = join(repoRoot, "docs");

const runDate = process.env.RUN_DATE ?? new Date().toISOString().slice(0, 10);
const userAgent =
  process.env.SEC_USER_AGENT ?? "AgentDataForge finance research demo roger@example.com";

const companies: CompanySeed[] = [
  { ticker: "AAPL", cik: "0000320193", name: "Apple Inc.", thesisTag: "consumer hardware + services" },
  { ticker: "MSFT", cik: "0000789019", name: "Microsoft Corporation", thesisTag: "cloud + AI platform" },
  { ticker: "NVDA", cik: "0001045810", name: "NVIDIA Corporation", thesisTag: "AI compute infrastructure" },
  { ticker: "JPM", cik: "0000019617", name: "JPMorgan Chase & Co.", thesisTag: "systemically important bank" },
  { ticker: "XOM", cik: "0000034088", name: "Exxon Mobil Corporation", thesisTag: "energy cash-flow proxy" },
];

const metricConcepts = [
  {
    key: "revenue",
    label: "Revenue",
    concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues"],
    unit: "USD",
  },
  {
    key: "net_income",
    label: "Net income",
    concepts: ["NetIncomeLoss", "ProfitLoss"],
    unit: "USD",
  },
  {
    key: "operating_income",
    label: "Operating income",
    concepts: ["OperatingIncomeLoss"],
    unit: "USD",
  },
  {
    key: "operating_cash_flow",
    label: "Operating cash flow",
    concepts: ["NetCashProvidedByUsedInOperatingActivities"],
    unit: "USD",
  },
  {
    key: "capex",
    label: "Capital expenditures",
    concepts: ["PaymentsToAcquirePropertyPlantAndEquipment"],
    unit: "USD",
  },
  {
    key: "research_and_development",
    label: "Research and development expense",
    concepts: ["ResearchAndDevelopmentExpense"],
    unit: "USD",
  },
  {
    key: "assets",
    label: "Assets",
    concepts: ["Assets"],
    unit: "USD",
  },
  {
    key: "liabilities",
    label: "Liabilities",
    concepts: ["Liabilities"],
    unit: "USD",
  },
  {
    key: "equity",
    label: "Stockholders' equity",
    concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    unit: "USD",
  },
  {
    key: "diluted_eps",
    label: "Diluted EPS",
    concepts: ["EarningsPerShareDiluted"],
    unit: "USD/shares",
  },
] as const;

const macroIndicators = [
  { id: "DGS10", name: "10-Year Treasury Constant Maturity Rate", unit: "percent", frequencyHint: "daily" },
  { id: "DGS2", name: "2-Year Treasury Constant Maturity Rate", unit: "percent", frequencyHint: "daily" },
  { id: "T10Y2Y", name: "10-Year Minus 2-Year Treasury Spread", unit: "percentage points", frequencyHint: "daily" },
  { id: "FEDFUNDS", name: "Effective Federal Funds Rate", unit: "percent", frequencyHint: "monthly" },
  { id: "CPIAUCSL", name: "Consumer Price Index for All Urban Consumers", unit: "index", frequencyHint: "monthly" },
  { id: "UNRATE", name: "Unemployment Rate", unit: "percent", frequencyHint: "monthly" },
  { id: "VIXCLS", name: "CBOE Volatility Index: VIX", unit: "index", frequencyHint: "daily" },
];

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(docsDir, { recursive: true });

  const companySnapshots = [];
  const filings: FilingRecord[] = [];
  const prices: PriceRecord[] = [];

  for (const company of companies) {
    const submissions = await fetchJson(secSubmissionsUrl(company.cik), secHeaders());
    await sleep(250);
    const facts = await fetchJson(secCompanyFactsUrl(company.cik), secHeaders());
    await sleep(250);

    const annualMetrics = extractMetricSet(facts, "10-K");
    const quarterlyMetrics = extractMetricSet(facts, "10-Q");
    const recentFilings = extractFilings(company, submissions).slice(0, 10);
    filings.push(...recentFilings);

    const companyPriceRows = await fetchNasdaqPrices(company.ticker);
    prices.push(...companyPriceRows);

    const latestPrice = companyPriceRows[0] ?? null;
    const oldestPrice = companyPriceRows.at(-1) ?? null;
    const approxPriceChangePct =
      latestPrice && oldestPrice ? round(((latestPrice.close - oldestPrice.close) / oldestPrice.close) * 100, 2) : null;

    companySnapshots.push({
      recordType: "company_research_snapshot",
      ticker: company.ticker,
      companyName: company.name,
      cik: company.cik,
      thesisTag: company.thesisTag,
      secEntity: {
        sic: submissions.sic ?? null,
        sicDescription: submissions.sicDescription ?? null,
        fiscalYearEnd: submissions.fiscalYearEnd ?? null,
        exchanges: submissions.exchanges ?? [],
        tickers: submissions.tickers ?? [],
      },
      latestAnnualMetrics: annualMetrics,
      latestQuarterlyMetrics: quarterlyMetrics,
      latestFilings: recentFilings.slice(0, 3).map((filing) => ({
        form: filing.form,
        filingDate: filing.filingDate,
        description: filing.description,
        secUrl: filing.secUrl,
      })),
      latestMarketSnapshot: latestPrice
        ? {
            date: latestPrice.date,
            close: latestPrice.close,
            volume: latestPrice.volume,
            approxWindowChangePct: approxPriceChangePct,
            source: "Nasdaq historical quote API",
          }
        : null,
      agentReadyFields: [
        "company identity",
        "SEC filing provenance",
        "latest annual and quarterly XBRL facts",
        "recent filing event stream",
        "recent OHLCV market context",
      ],
      sourceUrls: [
        secSubmissionsUrl(company.cik),
        secCompanyFactsUrl(company.cik),
        nasdaqHistoricalUrl(company.ticker),
      ],
      generatedAt: runDate,
    });
  }

  const macroRows = await fetchMacroRows();
  const researchCards = buildResearchCards(companySnapshots, filings, macroRows, prices);
  const sourceCatalog = buildSourceCatalog();

  await writeJsonl(join(outputDir, "company_snapshots.jsonl"), companySnapshots);
  await writeJsonl(join(outputDir, "latest_sec_filings.jsonl"), filings);
  await writeCsv(join(outputDir, "company_metrics.csv"), flattenCompanyMetrics(companySnapshots));
  await writeCsv(join(outputDir, "macro_indicators_latest.csv"), macroRows);
  await writeCsv(join(outputDir, "recent_market_prices.csv"), prices);
  await writeJsonl(join(outputDir, "pm_research_cards.jsonl"), researchCards);
  await writeJson(join(outputDir, "source_catalog.json"), sourceCatalog);
  await writeFile(join(docsDir, "finance-research-data-pack.md"), buildMarkdown(companySnapshots, macroRows, sourceCatalog));

  console.log(`Generated finance research pack in ${outputDir}`);
  console.log(`Generated client brief at ${join(docsDir, "finance-research-data-pack.md")}`);
}

function secHeaders() {
  return {
    "User-Agent": userAgent,
    Accept: "application/json",
  };
}

function secSubmissionsUrl(cik: string) {
  return `https://data.sec.gov/submissions/CIK${cik}.json`;
}

function secCompanyFactsUrl(cik: string) {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
}

function nasdaqHistoricalUrl(ticker: string) {
  return `https://api.nasdaq.com/api/quote/${ticker}/historical?assetclass=stocks&fromdate=2026-05-01&todate=${runDate}&limit=9999`;
}

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const text = await fetchText(url, headers);
  return JSON.parse(text);
}

async function fetchText(url: string, headers: Record<string, string> = {}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      const text = await response.text();
      if (response.ok && !text.includes("Request Rate Threshold Exceeded")) {
        return text;
      }
      lastError = new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 160)}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(800 * (attempt + 1));
  }
  throw lastError;
}

function extractMetricSet(companyFacts: any, form: "10-K" | "10-Q") {
  const usGaap = companyFacts?.facts?.["us-gaap"] ?? {};
  const metrics: Record<string, FactRecord | null> = {};

  for (const metric of metricConcepts) {
    const candidates: FactRecord[] = [];
    for (const concept of metric.concepts) {
      const fact = usGaap[concept];
      const unitRecords = fact?.units?.[metric.unit] ?? Object.values(fact?.units ?? {})[0];
      if (!Array.isArray(unitRecords)) {
        continue;
      }
      const candidate = latestFact(unitRecords, form, concept, metric.label, metric.unit);
      if (candidate) {
        candidates.push(candidate);
      }
    }
    metrics[metric.key] = candidates.sort((a, b) => `${b.filed}-${b.end}`.localeCompare(`${a.filed}-${a.end}`))[0] ?? null;
  }

  return metrics;
}

function latestFact(records: any[], form: "10-K" | "10-Q", concept: string, label: string, unit: string): FactRecord | null {
  const filtered = records
    .filter((record) => record.form === form && typeof record.val === "number" && record.filed && record.end)
    .sort((a, b) => `${b.filed}-${b.end}`.localeCompare(`${a.filed}-${a.end}`));

  const record = filtered[0];
  if (!record) {
    return null;
  }

  return {
    concept,
    label,
    unit,
    value: record.val,
    fy: record.fy,
    fp: record.fp,
    form: record.form,
    filed: record.filed,
    end: record.end,
    frame: record.frame,
  };
}

function extractFilings(company: CompanySeed, submissions: any): FilingRecord[] {
  const recent = submissions?.filings?.recent ?? {};
  const forms: string[] = recent.form ?? [];
  const keepForms = new Set(["10-K", "10-Q", "8-K", "DEF 14A"]);
  const rows: FilingRecord[] = [];

  for (let index = 0; index < forms.length; index += 1) {
    const form = forms[index];
    if (!keepForms.has(form)) {
      continue;
    }

    const accessionNumber = recent.accessionNumber?.[index];
    const primaryDocument = recent.primaryDocument?.[index];
    if (!accessionNumber || !primaryDocument) {
      continue;
    }

    rows.push({
      ticker: company.ticker,
      companyName: company.name,
      cik: company.cik,
      form,
      filingDate: recent.filingDate?.[index] ?? "",
      reportDate: recent.reportDate?.[index] || null,
      accessionNumber,
      primaryDocument,
      description: recent.primaryDocDescription?.[index] || null,
      secUrl: secArchiveUrl(company.cik, accessionNumber, primaryDocument),
      agentUse: filingAgentUse(form),
    });
  }

  return rows;
}

function secArchiveUrl(cik: string, accessionNumber: string, primaryDocument: string) {
  const cikNoLeadingZeroes = String(Number(cik));
  const accessionNoDashes = accessionNumber.replaceAll("-", "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeroes}/${accessionNoDashes}/${primaryDocument}`;
}

function filingAgentUse(form: string) {
  if (form === "10-K") return ["annual business/risk extraction", "financial statement grounding", "management discussion retrieval"];
  if (form === "10-Q") return ["quarterly update monitor", "trend and guidance comparison", "working capital change extraction"];
  if (form === "8-K") return ["event detection", "material change alerts", "deal/executive/earnings trigger extraction"];
  return ["governance signal extraction", "shareholder proposal analysis", "board and compensation review"];
}

async function fetchNasdaqPrices(ticker: string): Promise<PriceRecord[]> {
  const url = nasdaqHistoricalUrl(ticker);
  const data = await fetchJson(url, {
    "User-Agent": "Mozilla/5.0 AgentDataForge finance research demo",
    Accept: "application/json, text/plain, */*",
    Origin: "https://www.nasdaq.com",
    Referer: "https://www.nasdaq.com/",
  });
  const rows = data?.data?.tradesTable?.rows ?? [];
  return rows
    .map((row: any) => ({
      ticker,
      date: toIsoDate(row.date),
      open: moneyToNumber(row.open),
      high: moneyToNumber(row.high),
      low: moneyToNumber(row.low),
      close: moneyToNumber(row.close),
      volume: integerToNumber(row.volume),
      sourceUrl: url,
    }))
    .filter((row: PriceRecord) => row.date && Number.isFinite(row.close));
}

async function fetchMacroRows(): Promise<MacroRecord[]> {
  const rows: MacroRecord[] = [];
  for (const indicator of macroIndicators) {
    const sourceUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${indicator.id}`;
    const csv = await fetchText(sourceUrl);
    const observations = parseFredCsv(csv)
      .map((row) => ({
        date: row.DATE ?? row.observation_date,
        value: row[indicator.id] === "." || row[indicator.id] === "" ? null : Number(row[indicator.id]),
      }))
      .filter((row) => row.date && row.value !== null && Number.isFinite(row.value))
      .slice(-24);

    for (const observation of observations) {
      rows.push({
        indicatorId: indicator.id,
        indicatorName: indicator.name,
        frequencyHint: indicator.frequencyHint,
        date: observation.date,
        value: observation.value,
        unit: indicator.unit,
        sourceUrl,
      });
    }
  }
  return rows;
}

function parseFredCsv(csv: string) {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function buildResearchCards(companySnapshots: any[], filings: FilingRecord[], macroRows: MacroRecord[], prices: PriceRecord[]) {
  const cards = [
    {
      cardId: "dataset-sec-xbrl-fundamentals",
      title: "SEC XBRL fundamentals for company-level analysis",
      targetUserQuestion: "这家公司收入、利润、现金流、研发、资产负债的最新趋势是什么？",
      valueForResearchAgent: "用官方 XBRL facts 给 Agent 提供可引用的财务事实层，降低幻觉和口径混乱。",
      structuredFields: ["ticker", "cik", "concept", "unit", "value", "fy", "fp", "form", "filed", "end"],
      exampleTickers: companySnapshots.map((row) => row.ticker),
      sourceUrls: ["https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json"],
      licenseAndRiskNote: "SEC EDGAR 数据公开可访问；商用产品仍需保留来源、访问频率和用户代理合规。",
    },
    {
      cardId: "dataset-sec-filing-events",
      title: "Recent SEC filing event stream",
      targetUserQuestion: "最近有哪些 10-K、10-Q、8-K、Proxy 事件值得投研跟进？",
      valueForResearchAgent: "可以驱动 Agent 的事件监控、公告摘要、风险变化检测和 RAG 引用。",
      structuredFields: ["ticker", "form", "filingDate", "reportDate", "description", "secUrl", "agentUse"],
      exampleRecordCount: filings.length,
      sourceUrls: ["https://data.sec.gov/submissions/CIK0000320193.json"],
      licenseAndRiskNote: "SEC filing URL 可回溯到原始公告，适合展示给客户验证。",
    },
    {
      cardId: "dataset-fred-macro-panel",
      title: "FRED macro panel for market regime context",
      targetUserQuestion: "利率、曲线、通胀、就业、波动率环境对公司叙事有什么影响？",
      valueForResearchAgent: "把公司财务分析和宏观 regime 连接起来，适合做研报前置信息面板。",
      structuredFields: ["indicatorId", "indicatorName", "date", "value", "unit", "sourceUrl"],
      indicatorCount: new Set(macroRows.map((row) => row.indicatorId)).size,
      sourceUrls: macroIndicators.map((indicator) => `https://fred.stlouisfed.org/series/${indicator.id}`),
      licenseAndRiskNote: "FRED 是公开宏观数据入口；不同原始发布机构可能有独立引用要求。",
    },
    {
      cardId: "dataset-nasdaq-recent-ohlcv",
      title: "Recent Nasdaq OHLCV context",
      targetUserQuestion: "财报/公告前后，股票价格和成交量有没有异常？",
      valueForResearchAgent: "给公告分析加市场反应上下文，但不建议作为生产行情主数据源。",
      structuredFields: ["ticker", "date", "open", "high", "low", "close", "volume", "sourceUrl"],
      exampleRecordCount: prices.length,
      sourceUrls: companies.map((company) => nasdaqHistoricalUrl(company.ticker)),
      licenseAndRiskNote: "适合 demo 和原型验证；商用行情数据建议接入正式授权供应商。",
    },
  ];

  return cards.map((card) => ({ ...card, generatedAt: runDate }));
}

function buildSourceCatalog() {
  return {
    generatedAt: runDate,
    sources: [
      {
        id: "sec-companyfacts",
        name: "SEC EDGAR Company Facts API",
        sourceType: "official_regulatory_api",
        url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
        highValueBecause: ["auditable financial facts", "standard XBRL concepts", "filing-level provenance"],
        redistributionRisk: "low_to_medium",
        productionNotes: ["set a descriptive User-Agent", "cache responses", "respect SEC request-rate guidance"],
      },
      {
        id: "sec-submissions",
        name: "SEC EDGAR Submissions API",
        sourceType: "official_regulatory_api",
        url: "https://data.sec.gov/submissions/CIK0000320193.json",
        highValueBecause: ["latest filing stream", "primary document links", "event monitoring"],
        redistributionRisk: "low_to_medium",
        productionNotes: ["normalize CIKs", "store accession numbers", "link every derived claim to source URL"],
      },
      {
        id: "fred",
        name: "FRED CSV downloads",
        sourceType: "public_macro_data_portal",
        url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10",
        highValueBecause: ["macro regime features", "simple CSV ingestion", "long history"],
        redistributionRisk: "medium",
        productionNotes: ["retain series IDs", "show units and frequency", "check original source citation requirements"],
      },
      {
        id: "nasdaq-historical",
        name: "Nasdaq historical quote endpoint",
        sourceType: "public_market_data_endpoint",
        url: nasdaqHistoricalUrl("AAPL"),
        highValueBecause: ["recent OHLCV context", "event-window analysis", "client-friendly price tables"],
        redistributionRisk: "high",
        productionNotes: ["use only for prototype/demo", "replace with licensed market-data vendor in production"],
      },
    ],
  };
}

function flattenCompanyMetrics(companySnapshots: any[]) {
  const rows = [];
  for (const company of companySnapshots) {
    for (const [periodType, metrics] of [
      ["annual", company.latestAnnualMetrics],
      ["quarterly", company.latestQuarterlyMetrics],
    ] as const) {
      for (const [metricKey, metric] of Object.entries(metrics)) {
        if (!metric) continue;
        rows.push({
          ticker: company.ticker,
          companyName: company.companyName,
          cik: company.cik,
          periodType,
          metricKey,
          concept: (metric as FactRecord).concept,
          label: (metric as FactRecord).label,
          unit: (metric as FactRecord).unit,
          value: (metric as FactRecord).value,
          fy: (metric as FactRecord).fy ?? "",
          fp: (metric as FactRecord).fp ?? "",
          form: (metric as FactRecord).form ?? "",
          filed: (metric as FactRecord).filed ?? "",
          end: (metric as FactRecord).end ?? "",
          sourceUrl: secCompanyFactsUrl(company.cik),
        });
      }
    }
  }
  return rows;
}

function buildMarkdown(companySnapshots: any[], macroRows: MacroRecord[], sourceCatalog: any) {
  const latestMacro = [...macroRows].reverse().filter(uniqueBy((row) => row.indicatorId));
  const companyLines = companySnapshots
    .map((company) => {
      const revenue = company.latestAnnualMetrics.revenue;
      const netIncome = company.latestAnnualMetrics.net_income;
      const price = company.latestMarketSnapshot;
      return `| ${company.ticker} | ${company.companyName} | ${company.thesisTag} | ${formatFact(revenue)} | ${formatFact(netIncome)} | ${price ? `${price.close} on ${price.date}` : "n/a"} |`;
    })
    .join("\n");

  const macroLines = latestMacro
    .map((row) => `| ${row.indicatorId} | ${row.indicatorName} | ${row.date} | ${row.value} ${row.unit} |`)
    .join("\n");

  return `# Finance Research Agent Data Pack

Generated: ${runDate}

This is a compact, client-facing sample pack for a financial research Agent PM. It favors high-provenance public data over fragile scraping volume.

## What is included

- SEC company fundamentals from XBRL companyfacts.
- Recent SEC filing events with source URLs.
- FRED macro indicators for market-regime context.
- Recent Nasdaq OHLCV rows for demo-only market context.
- PM-facing research cards that explain how an Agent would use each dataset.

## Company sample

| Ticker | Company | Research angle | Latest annual revenue | Latest annual net income | Latest market close |
| --- | --- | --- | ---: | ---: | ---: |
${companyLines}

## Latest macro context

| Indicator | Name | Date | Value |
| --- | --- | --- | ---: |
${macroLines}

## Files

- \`data/finance-research/company_snapshots.jsonl\`: client-friendly company snapshots.
- \`data/finance-research/company_metrics.csv\`: normalized SEC concept table.
- \`data/finance-research/latest_sec_filings.jsonl\`: recent 10-K/10-Q/8-K/proxy events.
- \`data/finance-research/macro_indicators_latest.csv\`: latest FRED observations.
- \`data/finance-research/recent_market_prices.csv\`: recent Nasdaq OHLCV demo context.
- \`data/finance-research/pm_research_cards.jsonl\`: PM-facing dataset value cards.
- \`data/finance-research/source_catalog.json\`: provenance and production-risk notes.

## PM framing

The strongest product insight is not just "we can crawl data"; it is that a financial research Agent needs a provenance-first data layer:

1. Regulatory facts anchor the answer.
2. Filing events trigger workflows.
3. Macro indicators provide regime context.
4. Market data adds reaction context, but should use a licensed vendor in production.

## Source catalog

\`\`\`json
${JSON.stringify(sourceCatalog, null, 2)}
\`\`\`
`;
}

function formatFact(fact: FactRecord | null) {
  if (!fact) return "n/a";
  const compact = Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(fact.value);
  return `${compact} ${fact.unit} (${fact.fy ?? ""} ${fact.fp ?? ""})`;
}

function uniqueBy<T>(keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return (item: T) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(path: string, rows: unknown[]) {
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function writeCsv(path: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    await writeFile(path, "");
    return;
  }
  const headers = Object.keys(rows[0]);
  const csvRows = [headers.join(",")];
  for (const row of rows) {
    csvRows.push(headers.map((header) => csvEscape(row[header])).join(","));
  }
  await writeFile(path, `${csvRows.join("\n")}\n`);
}

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function moneyToNumber(value: string) {
  return Number(String(value ?? "").replace(/[$,]/g, ""));
}

function integerToNumber(value: string) {
  return Number(String(value ?? "").replace(/,/g, ""));
}

function toIsoDate(mmddyyyy: string) {
  const [month, day, year] = String(mmddyyyy).split("/");
  if (!month || !day || !year) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
