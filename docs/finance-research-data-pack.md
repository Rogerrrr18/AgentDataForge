# Finance Research Agent Data Pack

Generated: 2026-06-25

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
| AAPL | Apple Inc. | consumer hardware + services | 416.16B USD (2025 FY) | 112.01B USD (2025 FY) | 293.08 on 2026-06-24 |
| MSFT | Microsoft Corporation | cloud + AI platform | 281.72B USD (2025 FY) | 101.83B USD (2025 FY) | 365.46 on 2026-06-24 |
| NVDA | NVIDIA Corporation | AI compute infrastructure | 215.94B USD (2026 FY) | 120.07B USD (2026 FY) | 199 on 2026-06-24 |
| JPM | JPMorgan Chase & Co. | systemically important bank | 182.45B USD (2025 FY) | 57.05B USD (2025 FY) | 333.45 on 2026-06-24 |
| XOM | Exxon Mobil Corporation | energy cash-flow proxy | 332.24B USD (2025 FY) | 28.84B USD (2025 FY) | 136.9 on 2026-06-24 |

## Latest macro context

| Indicator | Name | Date | Value |
| --- | --- | --- | ---: |
| VIXCLS | CBOE Volatility Index: VIX | 2026-06-23 | 19.49 index |
| UNRATE | Unemployment Rate | 2026-05-01 | 4.3 percent |
| CPIAUCSL | Consumer Price Index for All Urban Consumers | 2026-05-01 | 333.979 index |
| FEDFUNDS | Effective Federal Funds Rate | 2026-05-01 | 3.63 percent |
| T10Y2Y | 10-Year Minus 2-Year Treasury Spread | 2026-06-24 | 0.3 percentage points |
| DGS2 | 2-Year Treasury Constant Maturity Rate | 2026-06-23 | 4.16 percent |
| DGS10 | 10-Year Treasury Constant Maturity Rate | 2026-06-23 | 4.5 percent |

## Files

- `data/finance-research/company_snapshots.jsonl`: client-friendly company snapshots.
- `data/finance-research/company_metrics.csv`: normalized SEC concept table.
- `data/finance-research/latest_sec_filings.jsonl`: recent 10-K/10-Q/8-K/proxy events.
- `data/finance-research/macro_indicators_latest.csv`: latest FRED observations.
- `data/finance-research/recent_market_prices.csv`: recent Nasdaq OHLCV demo context.
- `data/finance-research/pm_research_cards.jsonl`: PM-facing dataset value cards.
- `data/finance-research/source_catalog.json`: provenance and production-risk notes.

## PM framing

The strongest product insight is not just "we can crawl data"; it is that a financial research Agent needs a provenance-first data layer:

1. Regulatory facts anchor the answer.
2. Filing events trigger workflows.
3. Macro indicators provide regime context.
4. Market data adds reaction context, but should use a licensed vendor in production.

## Source catalog

```json
{
  "generatedAt": "2026-06-25",
  "sources": [
    {
      "id": "sec-companyfacts",
      "name": "SEC EDGAR Company Facts API",
      "sourceType": "official_regulatory_api",
      "url": "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
      "highValueBecause": [
        "auditable financial facts",
        "standard XBRL concepts",
        "filing-level provenance"
      ],
      "redistributionRisk": "low_to_medium",
      "productionNotes": [
        "set a descriptive User-Agent",
        "cache responses",
        "respect SEC request-rate guidance"
      ]
    },
    {
      "id": "sec-submissions",
      "name": "SEC EDGAR Submissions API",
      "sourceType": "official_regulatory_api",
      "url": "https://data.sec.gov/submissions/CIK0000320193.json",
      "highValueBecause": [
        "latest filing stream",
        "primary document links",
        "event monitoring"
      ],
      "redistributionRisk": "low_to_medium",
      "productionNotes": [
        "normalize CIKs",
        "store accession numbers",
        "link every derived claim to source URL"
      ]
    },
    {
      "id": "fred",
      "name": "FRED CSV downloads",
      "sourceType": "public_macro_data_portal",
      "url": "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10",
      "highValueBecause": [
        "macro regime features",
        "simple CSV ingestion",
        "long history"
      ],
      "redistributionRisk": "medium",
      "productionNotes": [
        "retain series IDs",
        "show units and frequency",
        "check original source citation requirements"
      ]
    },
    {
      "id": "nasdaq-historical",
      "name": "Nasdaq historical quote endpoint",
      "sourceType": "public_market_data_endpoint",
      "url": "https://api.nasdaq.com/api/quote/AAPL/historical?assetclass=stocks&fromdate=2026-05-01&todate=2026-06-25&limit=9999",
      "highValueBecause": [
        "recent OHLCV context",
        "event-window analysis",
        "client-friendly price tables"
      ],
      "redistributionRisk": "high",
      "productionNotes": [
        "use only for prototype/demo",
        "replace with licensed market-data vendor in production"
      ]
    }
  ]
}
```
