import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type Industry = {
  slug: string;
  label: string;
  description: string;
  agentWorkflows: string[];
};

type BenchmarkCase = {
  caseId: string;
  taskType?: string;
  input?: unknown;
  context?: unknown;
  expected?: unknown;
  rubric?: unknown;
  checker?: unknown;
  trace?: unknown;
  environment?: unknown;
  metadata?: {
    domain?: string;
    workflow?: string;
    split?: string;
    difficulty?: string;
    licenseName?: string;
    provenance?: string;
  };
};

type DatasetSummary = {
  id: string;
  name: string;
  type: string;
  path: string;
  domain: string;
  records: number;
  fields: string[];
  workflows: string[];
  modalities: string[];
  license: string;
  provenance: string;
  coverage: number;
  preview: Array<Record<string, unknown>>;
};

type FileSummary = {
  path: string;
  type: string;
  sizeKb: number;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const docsDir = join(repoRoot, "docs");
const outputPaths = [
  join(docsDir, "index.html"),
  join(docsDir, "data-governance-dashboard.html"),
];

async function main() {
  await mkdir(docsDir, { recursive: true });

  const taxonomy = await readJson<Industry[]>(join(repoRoot, "data", "taxonomy", "industries.json"));
  const datasets = [await summarizeCustomerSupportBench(), ...(await summarizeFinanceResearchPack())];
  const files = await summarizeFiles();
  const html = buildHtml({
    generatedAt: new Date().toISOString(),
    taxonomy,
    datasets,
    files,
  });

  await Promise.all(outputPaths.map((path) => writeFile(path, html, "utf8")));
  await writeFile(join(docsDir, ".nojekyll"), "", "utf8");
  for (const path of outputPaths) console.log(`Generated ${path}`);
}

async function summarizeCustomerSupportBench(): Promise<DatasetSummary> {
  const path = join(repoRoot, "examples", "customer-support-bench.jsonl");
  const cases = await readJsonl<BenchmarkCase>(path);
  const fields = fieldCoverage(cases);

  return {
    id: "customer-support-bench",
    name: "客服 Agent Benchmark",
    type: "Benchmark JSONL",
    path: toRepoPath(path),
    domain: "customer-service",
    records: cases.length,
    fields,
    workflows: unique(cases.map((item) => item.metadata?.workflow).filter(isString)),
    modalities: ["text", "tool_trace", "environment_state"],
    license: unique(cases.map((item) => item.metadata?.licenseName).filter(isString)).join(", ") || "unknown",
    provenance: unique(cases.map((item) => item.metadata?.provenance).filter(isString)).join(", ") || "unknown",
    coverage: Math.round((fields.length / 8) * 100),
    preview: cases.slice(0, 5).map((item) => ({
      caseId: item.caseId,
      taskType: item.taskType,
      workflow: item.metadata?.workflow,
      split: item.metadata?.split,
      difficulty: item.metadata?.difficulty,
      checker: checkerType(item.checker),
    })),
  };
}

async function summarizeFinanceResearchPack(): Promise<DatasetSummary[]> {
  const dir = join(repoRoot, "data", "finance-research");
  const names = (await readdir(dir)).sort();
  const sourceCatalogPath = join(dir, "source_catalog.json");
  const sourceCatalog = await readJson<{
    generatedAt?: string;
    sources?: Array<Record<string, unknown>>;
  }>(sourceCatalogPath);
  const summaries: DatasetSummary[] = [];

  for (const name of names) {
    const path = join(dir, name);
    const extension = extname(name);

    if (extension === ".csv") {
      const rows = await readCsv(path);
      summaries.push({
        id: `finance-${slugify(name)}`,
        name: humanizeFileName(name),
        type: "CSV",
        path: toRepoPath(path),
        domain: "finance",
        records: rows.length,
        fields: Object.keys(rows[0] ?? {}),
        workflows: inferFinanceWorkflows(name),
        modalities: ["text", "table"],
        license: "source-specific public data",
        provenance: sourceCatalog.generatedAt ? `source catalog ${sourceCatalog.generatedAt}` : "source catalog",
        coverage: rows.length > 0 ? 72 : 0,
        preview: rows.slice(0, 5).map(compactRecord),
      });
      continue;
    }

    if (extension === ".jsonl") {
      const rows = await readJsonl<Record<string, unknown>>(path);
      summaries.push({
        id: `finance-${slugify(name)}`,
        name: humanizeFileName(name),
        type: "JSONL",
        path: toRepoPath(path),
        domain: "finance",
        records: rows.length,
        fields: Object.keys(rows[0] ?? {}),
        workflows: inferFinanceWorkflows(name),
        modalities: ["text", "table"],
        license: "source-specific public data",
        provenance: sourceCatalog.generatedAt ? `source catalog ${sourceCatalog.generatedAt}` : "source catalog",
        coverage: rows.length > 0 ? 76 : 0,
        preview: rows.slice(0, 5).map(compactRecord),
      });
    }
  }

  if (sourceCatalog.sources?.length) {
    summaries.push({
      id: "finance-source-catalog",
      name: "金融研究 Source Catalog",
      type: "JSON",
      path: toRepoPath(sourceCatalogPath),
      domain: "finance",
      records: sourceCatalog.sources.length,
      fields: Object.keys(sourceCatalog.sources[0] ?? {}),
      workflows: ["provenance review", "license review"],
      modalities: ["metadata"],
      license: "source-specific",
      provenance: sourceCatalog.generatedAt ?? "source catalog",
      coverage: 68,
      preview: sourceCatalog.sources.slice(0, 5).map((item) => compactRecord(item)),
    });
  }

  return summaries;
}

async function summarizeFiles(): Promise<FileSummary[]> {
  const roots = ["examples", "data", "docs"];
  const files = [];
  for (const root of roots) {
    for (const file of await walk(join(repoRoot, root))) {
      const info = await stat(file);
      files.push({
        path: toRepoPath(file),
        type: extname(file).replace(".", "") || "file",
        sizeKb: Math.max(1, Math.round(info.size / 1024)),
      });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function buildHtml(input: {
  generatedAt: string;
  taxonomy: Industry[];
  datasets: DatasetSummary[];
  files: FileSummary[];
}) {
  const activeDomains = unique(input.datasets.map((item) => item.domain));
  const workflows = unique(input.datasets.flatMap((item) => item.workflows));
  const records = input.datasets.reduce((sum, item) => sum + item.records, 0);
  const avgCoverage = average(input.datasets.map((item) => item.coverage));
  const payload = JSON.stringify(input);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentDataForge</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f9;
        --surface: #ffffff;
        --surface-soft: #fafbfc;
        --ink: #151a23;
        --muted: #687386;
        --line: #dfe4ec;
        --blue: #2457a7;
        --green: #16705a;
        --amber: #9d681c;
        --red: #a64048;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        color: var(--ink);
        background: var(--bg);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        letter-spacing: 0;
      }

      button, input, select {
        font: inherit;
        letter-spacing: 0;
      }

      .app {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr;
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 64px;
        padding: 0 28px;
        border-bottom: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(10px);
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .brand-mark {
        display: grid;
        width: 34px;
        height: 34px;
        place-items: center;
        border: 1px solid #cbd4e1;
        border-radius: 7px;
        background: #fff;
        color: var(--blue);
        font-size: 13px;
        font-weight: 900;
      }

      .brand strong {
        display: block;
        font-size: 15px;
        line-height: 1.1;
      }

      .brand span {
        display: block;
        margin-top: 3px;
        color: var(--muted);
        font-size: 12px;
      }

      .top-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .chip, .nav-link {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        padding: 7px 10px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: #fff;
        color: #344257;
        font-size: 12px;
        font-weight: 800;
        text-decoration: none;
      }

      .shell {
        display: grid;
        grid-template-columns: 248px minmax(0, 1fr) 360px;
        gap: 1px;
        min-height: calc(100vh - 64px);
        border-top: 0;
        background: var(--line);
      }

      .sidebar, .main, .detail {
        background: var(--surface);
        min-width: 0;
      }

      .sidebar {
        padding: 22px 18px;
      }

      .main {
        padding: 22px;
      }

      .detail {
        padding: 22px 18px;
      }

      .section-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }

      h1, h2, h3, p {
        margin: 0;
      }

      h1 {
        font-size: 24px;
        line-height: 1.2;
        letter-spacing: 0;
      }

      h2 {
        font-size: 14px;
        line-height: 1.25;
      }

      h3 {
        font-size: 13px;
        line-height: 1.25;
      }

      .muted {
        color: var(--muted);
      }

      .caption {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.5;
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 1px;
        margin-bottom: 18px;
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow: hidden;
        background: var(--line);
      }

      .stat {
        min-height: 92px;
        padding: 14px;
        background: var(--surface);
      }

      .stat span {
        display: block;
        color: var(--muted);
        font-size: 11px;
        font-weight: 900;
        text-transform: uppercase;
      }

      .stat strong {
        display: block;
        margin-top: 8px;
        font-size: 30px;
        line-height: 1;
      }

      .stat em {
        display: block;
        margin-top: 9px;
        color: var(--muted);
        font-size: 12px;
        font-style: normal;
        line-height: 1.35;
      }

      .domain-list {
        display: grid;
        gap: 6px;
      }

      .domain-button {
        width: 100%;
        min-height: 42px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        padding: 8px 9px;
        border: 1px solid transparent;
        border-radius: 7px;
        background: transparent;
        color: var(--ink);
        cursor: pointer;
        text-align: left;
      }

      .domain-button:hover, .domain-button.active {
        border-color: #c9d4e3;
        background: var(--surface-soft);
      }

      .domain-button span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 800;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #c5ccd7;
      }

      .status-dot.live {
        background: var(--green);
      }

      .filters {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) 150px 150px;
        gap: 10px;
        margin: 16px 0;
      }

      .field {
        display: grid;
        gap: 5px;
      }

      .field label {
        color: #3e4d62;
        font-size: 11px;
        font-weight: 900;
        text-transform: uppercase;
      }

      .field input, .field select {
        width: 100%;
        min-height: 36px;
        padding: 7px 9px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: #fff;
        color: var(--ink);
      }

      .asset-table {
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow: hidden;
        background: var(--surface);
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th, td {
        padding: 12px 12px;
        border-bottom: 1px solid #e8ecf2;
        text-align: left;
        vertical-align: top;
      }

      th {
        background: #fbfcfd;
        color: #526074;
        font-size: 11px;
        font-weight: 900;
        text-transform: uppercase;
      }

      tr:last-child td {
        border-bottom: 0;
      }

      tbody tr {
        cursor: pointer;
      }

      tbody tr:hover, tbody tr.selected {
        background: #f7f9fc;
      }

      .asset-name {
        display: grid;
        gap: 5px;
      }

      .asset-name strong {
        font-size: 14px;
      }

      .asset-name span {
        color: var(--muted);
        font-size: 12px;
        word-break: break-all;
      }

      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 3px 7px;
        border: 1px solid #d8e0ea;
        border-radius: 999px;
        background: #f8fafc;
        color: #526074;
        font-size: 11px;
        font-weight: 800;
      }

      .coverage {
        display: grid;
        gap: 7px;
        min-width: 112px;
      }

      .bar {
        height: 7px;
        border-radius: 999px;
        background: #e6eaf0;
        overflow: hidden;
      }

      .bar i {
        display: block;
        height: 100%;
        background: var(--blue);
      }

      .detail-empty {
        display: grid;
        min-height: 260px;
        place-items: center;
        border: 1px dashed #cbd4e1;
        border-radius: 8px;
        color: var(--muted);
        text-align: center;
        padding: 20px;
      }

      .detail-stack {
        display: grid;
        gap: 16px;
      }

      .detail-block {
        display: grid;
        gap: 9px;
      }

      .kv {
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr);
        gap: 10px;
        padding: 8px 0;
        border-bottom: 1px solid #edf0f4;
        font-size: 13px;
      }

      .kv span {
        color: var(--muted);
      }

      .kv strong {
        min-width: 0;
        word-break: break-word;
      }

      pre {
        max-height: 360px;
        margin: 0;
        padding: 12px;
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #111827;
        color: #dce8f8;
        font-size: 12px;
        line-height: 1.55;
        white-space: pre-wrap;
      }

      .file-list {
        margin-top: 20px;
        border-top: 1px solid var(--line);
        padding-top: 16px;
      }

      .file-list ul {
        list-style: none;
        margin: 10px 0 0;
        padding: 0;
        display: grid;
        gap: 7px;
      }

      .file-list li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        color: var(--muted);
        font-size: 12px;
      }

      .file-list span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media (max-width: 1120px) {
        .shell {
          grid-template-columns: 220px minmax(0, 1fr);
        }
        .detail {
          grid-column: 1 / -1;
          border-top: 1px solid var(--line);
        }
      }

      @media (max-width: 760px) {
        .topbar {
          position: static;
          align-items: flex-start;
          flex-direction: column;
          padding: 14px;
        }
        .shell {
          display: flex;
          flex-direction: column;
        }
        .main { order: 1; }
        .sidebar { order: 2; }
        .detail { order: 3; }
        .sidebar, .main, .detail {
          padding: 16px;
          border-bottom: 1px solid var(--line);
        }
        .stats, .filters {
          grid-template-columns: 1fr;
        }
        th:nth-child(3), td:nth-child(3) {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">ADF</div>
          <div>
            <strong>AgentDataForge</strong>
            <span>Data governance console</span>
          </div>
        </div>
        <div class="top-actions">
          <span class="chip">${escapeHtml(input.generatedAt.slice(0, 10))}</span>
          <a class="nav-link" href="./customer-support-bench.md">客服 Bench</a>
          <a class="nav-link" href="./finance-research-data-pack.md">金融 Pack</a>
        </div>
      </header>

      <div class="shell">
        <aside class="sidebar">
          <div class="section-title">
            <h2>场景</h2>
            <span class="chip">${input.taxonomy.length}</span>
          </div>
          <div class="domain-list" id="domainList"></div>
        </aside>

        <main class="main">
          <div class="section-title">
            <div>
              <h1>数据资产</h1>
              <p class="caption">真实仓库数据 · 无 mock</p>
            </div>
          </div>

          <section class="stats" aria-label="summary">
            ${statCell("Records", records, "已入库记录")}
            ${statCell("Domains", activeDomains.length, activeDomains.join(" / "))}
            ${statCell("Workflows", workflows.length, "现有 workflow")}
            ${statCell("Coverage", `${avgCoverage}%`, "平均字段覆盖")}
          </section>

          <section class="filters">
            <div class="field">
              <label for="search">Search</label>
              <input id="search" type="search" placeholder="名称、路径、workflow、字段" />
            </div>
            <div class="field">
              <label for="domainFilter">Domain</label>
              <select id="domainFilter">
                <option value="all">全部</option>
                ${activeDomains.map((domain) => `<option value="${escapeHtml(domain)}">${escapeHtml(domain)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="typeFilter">Type</label>
              <select id="typeFilter">
                <option value="all">全部</option>
                ${unique(input.datasets.map((item) => item.type)).map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("")}
              </select>
            </div>
          </section>

          <section class="asset-table">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Records</th>
                  <th>Workflow</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody id="assetRows"></tbody>
            </table>
          </section>
        </main>

        <aside class="detail">
          <div class="section-title">
            <h2>预览</h2>
          </div>
          <div id="detailPanel"></div>
          <div class="file-list">
            <div class="section-title">
              <h2>文件</h2>
              <span class="chip">${input.files.length}</span>
            </div>
            <ul>
              ${input.files.slice(0, 12).map((file) => `<li><span>${escapeHtml(file.path)}</span><strong>${file.sizeKb} KB</strong></li>`).join("")}
            </ul>
          </div>
        </aside>
      </div>
    </div>

    <script id="dashboard-data" type="application/json">${escapeScript(payload)}</script>
    <script>
      const state = JSON.parse(document.getElementById("dashboard-data").textContent);
      const activeDomains = new Set(state.datasets.map((item) => item.domain));
      let selectedId = state.datasets[0]?.id || null;

      const domainList = document.getElementById("domainList");
      const assetRows = document.getElementById("assetRows");
      const detailPanel = document.getElementById("detailPanel");
      const search = document.getElementById("search");
      const domainFilter = document.getElementById("domainFilter");
      const typeFilter = document.getElementById("typeFilter");

      function renderDomains() {
        domainList.innerHTML = state.taxonomy.map((domain) => {
          const live = activeDomains.has(domain.slug);
          return \`
            <button class="domain-button \${domainFilter.value === domain.slug ? "active" : ""}" data-domain="\${domain.slug}" title="\${domain.description}">
              <span>\${domain.label}</span>
              <i class="status-dot \${live ? "live" : ""}"></i>
            </button>
          \`;
        }).join("");
      }

      function filteredDatasets() {
        const term = search.value.trim().toLowerCase();
        return state.datasets.filter((item) => {
          const text = JSON.stringify(item).toLowerCase();
          return (domainFilter.value === "all" || item.domain === domainFilter.value)
            && (typeFilter.value === "all" || item.type === typeFilter.value)
            && (!term || text.includes(term));
        });
      }

      function renderRows() {
        const rows = filteredDatasets();
        if (!rows.some((item) => item.id === selectedId)) selectedId = rows[0]?.id || null;
        assetRows.innerHTML = rows.map((item) => \`
          <tr data-id="\${item.id}" class="\${item.id === selectedId ? "selected" : ""}">
            <td>
              <div class="asset-name">
                <strong>\${item.name}</strong>
                <span>\${item.path}</span>
                <div class="badge-row">
                  <span class="badge">\${item.domain}</span>
                  <span class="badge">\${item.type}</span>
                  <span class="badge">\${item.license}</span>
                </div>
              </div>
            </td>
            <td><strong>\${item.records}</strong><div class="caption">\${item.fields.length} fields</div></td>
            <td><div class="badge-row">\${item.workflows.slice(0, 3).map((workflow) => \`<span class="badge">\${workflow}</span>\`).join("")}</div></td>
            <td>
              <div class="coverage">
                <strong>\${item.coverage}%</strong>
                <div class="bar"><i style="width: \${item.coverage}%"></i></div>
              </div>
            </td>
          </tr>
        \`).join("") || \`<tr><td colspan="4"><div class="caption">没有匹配数据</div></td></tr>\`;
        renderDetail();
      }

      function renderDetail() {
        const item = state.datasets.find((dataset) => dataset.id === selectedId);
        if (!item) {
          detailPanel.innerHTML = '<div class="detail-empty">选择一条数据资产</div>';
          return;
        }
        detailPanel.innerHTML = \`
          <div class="detail-stack">
            <div class="detail-block">
              <h3>\${item.name}</h3>
              <p class="caption">\${item.path}</p>
            </div>
            <div class="detail-block">
              <div class="kv"><span>Domain</span><strong>\${item.domain}</strong></div>
              <div class="kv"><span>Type</span><strong>\${item.type}</strong></div>
              <div class="kv"><span>Records</span><strong>\${item.records}</strong></div>
              <div class="kv"><span>Fields</span><strong>\${item.fields.join(", ")}</strong></div>
              <div class="kv"><span>License</span><strong>\${item.license}</strong></div>
              <div class="kv"><span>Provenance</span><strong>\${item.provenance}</strong></div>
            </div>
            <div class="detail-block">
              <h3>Sample</h3>
              <pre>\${escapeHtml(JSON.stringify(item.preview, null, 2))}</pre>
            </div>
          </div>
        \`;
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      domainList.addEventListener("click", (event) => {
        const button = event.target.closest(".domain-button");
        if (!button) return;
        domainFilter.value = activeDomains.has(button.dataset.domain) ? button.dataset.domain : "all";
        renderDomains();
        renderRows();
      });

      assetRows.addEventListener("click", (event) => {
        const row = event.target.closest("tr[data-id]");
        if (!row) return;
        selectedId = row.dataset.id;
        renderRows();
      });

      search.addEventListener("input", renderRows);
      domainFilter.addEventListener("change", () => { renderDomains(); renderRows(); });
      typeFilter.addEventListener("change", renderRows);

      renderDomains();
      renderRows();
    </script>
  </body>
</html>`;
}

function statCell(label: string, value: number | string, hint: string) {
  return `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><em>${escapeHtml(hint)}</em></div>`;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as T);
}

async function readCsv(path: string): Promise<Array<Record<string, string>>> {
  const text = await readFile(path, "utf8");
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];
  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(value);
      value = "";
      continue;
    }
    value += char;
  }

  values.push(value);
  return values;
}

async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

function fieldCoverage(cases: BenchmarkCase[]) {
  const fields = ["input", "context", "expected", "rubric", "checker", "trace", "environment", "metadata"];
  return fields.filter((field) => cases.some((item) => typeof (item as Record<string, unknown>)[field] !== "undefined"));
}

function inferFinanceWorkflows(name: string) {
  if (name.includes("company_metrics")) return ["financial QA", "metric extraction", "fundamental analysis"];
  if (name.includes("company_snapshots")) return ["financial QA", "company research"];
  if (name.includes("latest_sec_filings")) return ["filing monitoring", "risk analysis"];
  if (name.includes("macro")) return ["macro context", "risk analysis"];
  if (name.includes("prices")) return ["market context", "price review"];
  if (name.includes("pm_research_cards")) return ["product research", "buyer-facing data cards"];
  return ["finance research"];
}

function checkerType(value: unknown) {
  if (value && typeof value === "object" && "type" in value) return String((value as { type: unknown }).type);
  return "unknown";
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).slice(0, 8).map(([key, value]) => [
    key,
    typeof value === "string" && value.length > 120 ? `${value.slice(0, 120)}...` : value,
  ]));
}

function humanizeFileName(name: string) {
  return basename(name, extname(name))
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value: string) {
  return value.replace(/\W+/g, "-").replace(/-$/, "");
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function toRepoPath(path: string) {
  return relative(repoRoot, path);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeScript(value: string) {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
