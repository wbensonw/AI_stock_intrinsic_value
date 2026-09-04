(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const TABS = {
    overview: { label: "投資總覽", sheet: "overview" },
    models: { label: "估值模型", sheet: "models" },
    bands: { label: "五檔價位", sheet: "bands" },
    metrics: { label: "財務指標", sheet: "metrics" },
    advice: { label: "AI 建議", sheet: "advice" },
    method: { label: "方法免責", sheet: null },
  };

  const BANDS = ["非常便宜", "便宜", "合理", "昂貴", "非常昂貴", "無法估值"];
  const MARKETS = ["HK", "CN", "US"];
  const DEFAULT_SORT = {
    overview: ["估值區間", true], models: ["加權內在價值", false], bands: ["目前", true],
    metrics: ["ROE%", false], advice: ["AI推薦度", false],
  };
  const HIDE_COLS = new Set(["現價", "模型權重", "關鍵假設"]);
  const MODEL_COLS = ["①葛拉漢數字", "②葛拉漢公式", "③NCAV清算", "④巴菲特業主盈餘",
    "⑤EPV盈餘能力", "⑥達摩達蘭FCFF", "⑦剩餘收益PB", "⑧股利折現"];
  const MODEL_KEYS = {
    graham_number: "①葛拉漢數字", graham_formula: "②葛拉漢公式", ncav: "③NCAV清算",
    buffett_oe: "④巴菲特業主盈餘", epv: "⑤EPV盈餘能力", damodaran_fcff: "⑥達摩達蘭FCFF",
    ri_pb: "⑦剩餘收益PB", ddm: "⑧股利折現",
  };
  const CHART_ICO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V6"/><path d="M4 19h16"/><path d="M7 15l4-5 3 3 5-7"/></svg>`;

  let DATA = null;
  let tab = "overview";
  let sortKey = "估值區間";
  let sortAsc = true;
  let q = "";
  let market = "ALL";
  let band = "ALL";
  let chartInst = null;
  let chartJsPromise = null;

  const themeBtn = $("#themeBtn");
  const saved = localStorage.getItem("iv-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  setTheme(saved);

  themeBtn.addEventListener("click", () => {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    if (chartInst) applyChartTheme(chartInst);
  });
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("iv-theme", t);
    themeBtn.textContent = t === "dark" ? "☀" : "☾";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#121212" : "#F5F5F7");
  }

  $$(".nav-btn").forEach((b) => b.addEventListener("click", () => {
    tab = b.dataset.tab;
    $$(".nav-btn").forEach((x) => x.classList.toggle("active", x === b));
    const d = DEFAULT_SORT[tab];
    if (d) { sortKey = d[0]; sortAsc = d[1]; }
    render();
  }));

  $("#q").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); render(); });
  $("#sortDir").addEventListener("click", () => { sortAsc = !sortAsc; render(); });
  $("#sortKey").addEventListener("change", (e) => { sortKey = e.target.value; render(); });
  $("#modalClose").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  $("#chartClose").addEventListener("click", closeChart);
  $("#chartModal").addEventListener("click", (e) => { if (e.target.id === "chartModal") closeChart(); });

  fetch("./data/latest.json", { cache: "no-store" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { DATA = d; boot(); })
    .catch(() => {
      $("#metaLine").textContent = "尚未產生 latest.json。請先執行 python report_feishu.py --no-send";
      $("#main").innerHTML = `<p class="empty">沒有可顯示的資料。</p>`;
    });

  function boot() {
    $("#metaLine").textContent = `v1.0 · 更新 ${DATA.generated_at || DATA.asof || ""} · ${DATA.count || 0} 檔`;
    if (DATA.excel) {
      $("#excelLink").href = `./reports/${DATA.excel}`;
      $("#excelLink").textContent = `下載 ${DATA.excel}`;
    }
    const f = $("#filters");
    f.innerHTML = "";
    f.append(chip("ALL", "全部市場", "market", true, true));
    MARKETS.forEach((m) => f.append(chip(m, m, "market", false, true)));
    f.append(chip("ALL", "全部區間", "band", true, true));
    BANDS.forEach((b) => f.append(chip(b, b, "band", false, true)));
    render();
  }

  function chip(val, label, kind, on, wide) {
    const b = document.createElement("button");
    b.className = `chip${wide ? " wide" : ""}${on ? " on" : ""}`;
    b.textContent = label;
    b.title = val;
    b.addEventListener("click", () => {
      if (kind === "market") market = val;
      else band = val;
      render();
    });
    b.dataset.kind = kind;
    b.dataset.val = val;
    return b;
  }

  function overviewIndex() {
    const idx = {};
    (DATA.sheets.overview || []).forEach((x) => { idx[x["代號"]] = x; });
    return idx;
  }

  function ovOf(r) {
    return overviewIndex()[r["代號"]] || {};
  }

  function bandOf(r, ov) {
    const o = ov || ovOf(r);
    return o["估值區間"] || r["估值區間"] || r["目前"] || r["估值區間(模型)"] || "";
  }

  function applySearchMarket(rows) {
    const ov = overviewIndex();
    let out = rows || [];
    if (q) {
      out = out.filter((r) => {
        const o = ov[r["代號"]] || {};
        const blob = `${r["代號"] || ""} ${r["名稱"] || ""} ${o["行業"] || ""} ${o["標籤"] || ""} ${o["市場"] || ""}`.toLowerCase();
        return blob.includes(q) || JSON.stringify(r).toLowerCase().includes(q);
      });
    }
    if (market !== "ALL") {
      out = out.filter((r) => (ov[r["代號"]]?.["市場"] || r["市場"]) === market);
    }
    return out;
  }

  function rowsBase() {
    const sheet = TABS[tab].sheet;
    if (!sheet || !DATA?.sheets) return [];
    return applySearchMarket(DATA.sheets[sheet] || []);
  }

  function rowsOf() {
    let rows = rowsBase();
    if (band !== "ALL") {
      const ov = overviewIndex();
      rows = rows.filter((r) => bandOf(r, ov[r["代號"]]) === band);
    }
    return sortRows(rows);
  }

  function sortRows(rows) {
    const bandOrd = Object.fromEntries(BANDS.map((b, i) => [b, i]));
    const key = sortKey;
    const mul = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      let va = a[key], vb = b[key];
      if ((key && String(key).includes("區間")) || key === "目前") {
        va = bandOrd[va] ?? 9; vb = bandOrd[vb] ?? 9;
        return (va - vb) * mul;
      }
      const na = toNum(va), nb = toNum(vb);
      if (na !== null && nb !== null) return (na - nb) * mul;
      return String(va ?? "").localeCompare(String(vb ?? ""), "zh-Hant") * mul;
    });
  }

  function toNum(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    const n = Number(String(v).replace(/,/g, "").replace(/%/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function visibleKeys(rows) {
    const keys = rows[0] ? Object.keys(rows[0]) : [];
    return keys.filter((k) => !HIDE_COLS.has(k));
  }

  function render() {
    $$("#filters .chip").forEach((c) => {
      const kind = c.dataset.kind, val = c.dataset.val;
      c.classList.toggle("on", kind === "market" ? market === val : band === val);
    });
    renderStats();
    if (tab === "method") {
      $("#main").innerHTML = methodHtml();
      return;
    }
    const rows = rowsOf();
    const keys = visibleKeys(rows);
    const sel = $("#sortKey");
    sel.innerHTML = keys.map((k) => `<option value="${esc(k)}" ${k === sortKey ? "selected" : ""}>${esc(k)}</option>`).join("");
    $("#sortDir").textContent = sortAsc ? "小 → 大" : "大 → 小";
    if (!rows.length) {
      $("#main").innerHTML = `<p class="empty">沒有符合篩選的項目。</p>`;
      return;
    }
    $("#main").innerHTML = tableHtml(rows, keys) + cardsHtml(rows);
    $$("th[data-k]").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.k;
      if (sortKey === k) sortAsc = !sortAsc;
      else { sortKey = k; sortAsc = false; }
      render();
    }));
    $$("[data-i]").forEach((el) => el.addEventListener("click", () => openDetail(rows[+el.dataset.i])));
    $$("[data-chart]").forEach((el) => el.addEventListener("click", (e) => {
      e.stopPropagation();
      openChart(rows[+el.dataset.chart]);
    }));
  }

  function renderStats() {
    const ov = overviewIndex();
    const counts = Object.fromEntries(BANDS.map((k) => [k, 0]));
    applySearchMarket(DATA?.sheets?.overview || []).forEach((r) => {
      const b = bandOf(r, ov[r["代號"]]);
      if (b in counts) counts[b] += 1;
    });
    $("#stats").innerHTML = BANDS.map((k) =>
      `<button type="button" class="stat${band === k ? " on" : ""}" data-band="${esc(k)}"><b>${counts[k] || 0}</b><span>${k}</span></button>`
    ).join("");
    $$("#stats .stat").forEach((el) => el.addEventListener("click", () => {
      const v = el.dataset.band;
      band = band === v ? "ALL" : v;
      render();
    }));
  }

  function tableHtml(rows, keys) {
    const head = `<th class="th-chart"></th>` + keys.map((k) =>
      `<th data-k="${esc(k)}">${esc(k)}${k === sortKey ? `<span class="arr">${sortAsc ? "↑" : "↓"}</span>` : ""}</th>`).join("");
    const body = rows.map((r, i) => `<tr class="row-link" data-i="${i}">
      <td class="td-chart"><button type="button" class="chart-btn" data-chart="${i}" title="時間序列" aria-label="時間序列">${CHART_ICO}</button></td>
      ${keys.map((k) => `<td class="${toNum(r[k]) !== null ? "num" : ""} ${toneClass(k, r[k])}">${cell(k, r[k])}</td>`).join("")}
    </tr>`).join("");
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function cardsHtml(rows) {
    return `<div class="cards">${rows.map((r, i) => {
      const ov = ovOf(r);
      const code = r["代號"] || "";
      const name = r["名稱"] || ov["名稱"] || "";
      const mkt = ov["市場"] || r["市場"] || "";
      const bandv = bandOf(r, ov);
      return `<article class="item" data-i="${i}">
        <div class="item-hd">
          <div class="ico-sq">${esc(code)}</div>
          <div class="item-id">
            <h3>${esc(name)}</h3>
            <div class="item-meta"><span class="mkt">${esc(mkt)}</span><span class="band"><i class="dot ${esc(bandv)}"></i>${esc(bandv)}</span></div>
          </div>
          <button type="button" class="chart-btn" data-chart="${i}" title="時間序列" aria-label="時間序列">${CHART_ICO}</button>
        </div>
        ${cardBody(r, ov)}
      </article>`;
    }).join("")}</div>`;
  }

  function kvGrid(pairs) {
    const cells = pairs.filter((p) => p && p[1] != null && p[1] !== "").map(([k, v, cls]) =>
      `<div><span>${esc(k)}</span><b class="${cls || ""}">${v}</b></div>`);
    return cells.length ? `<div class="mini-kv">${cells.join("")}</div>` : "";
  }

  function cardBody(r, ov) {
    if (tab === "overview") {
      return kvGrid([
        ["內在價值", fmt(ov["內在價值"] ?? r["內在價值"])],
        ["折溢價", fmtPct(ov["折溢價%"], true), toneClass("折溢價%", ov["折溢價%"])],
        ["安全買點", fmt(ov["安全買點"])],
        ["達標", ov["達安全邊際"] || "—", toneClass("達安全邊際", ov["達安全邊際"])],
        ["評級", `<span class="stars">${esc(ov["評級"] || "")}</span>`],
        ["推薦", ov["AI推薦度"] != null ? `${ov["AI推薦度"]}/10` : "—"],
      ]) + (ov["一句話重點"] ? `<p class="card-note">${esc(ov["一句話重點"])}</p>` : "");
    }
    if (tab === "models") {
      const pairs = [["加權 IV", fmt(r["加權內在價值"])]];
      MODEL_COLS.forEach((k) => { if (r[k] != null) pairs.push([k.replace(/^[①②③④⑤⑥⑦⑧]/, ""), fmt(r[k])]); });
      return kvGrid(pairs.slice(0, 7));
    }
    if (tab === "bands") {
      return kvGrid([
        ["非常便宜 ≤", fmt(r["非常便宜 ≤"])],
        ["便宜 ≤", fmt(r["便宜 ≤"])],
        ["合理 ≤", fmt(r["合理 ≤"])],
        ["昂貴 ≤", fmt(r["昂貴 ≤"])],
        ["非常昂貴 >", fmt(r["非常昂貴 >"])],
        ["P/IV", fmt(r["P/IV"])],
      ]);
    }
    if (tab === "metrics") {
      return kvGrid([
        ["毛利率", fmtPct(r["毛利率%"]), toneClass("毛利率%", r["毛利率%"])],
        ["ROE", fmtPct(r["ROE%"]), toneClass("ROE%", r["ROE%"])],
        ["FCF率", fmtPct(r["FCF率%"])],
        ["負債率", fmtPct(r["負債率%"]), toneClass("負債率%", r["負債率%"])],
        ["營收CAGR3", fmtPct(r["營收CAGR3%"], true), toneClass("營收CAGR3%", r["營收CAGR3%"])],
        ["流動比率", fmt(r["流動比率"]), toneClass("流動比率", r["流動比率"])],
      ]);
    }
    if (tab === "advice") {
      const paras = splitAdvice(r["一句話重點(不考慮價格)"]);
      return `<div class="card-ai">
        <div class="card-ai-score"><span class="stars">${esc(r["評級"] || "")}</span>${r["AI推薦度"] != null ? `${r["AI推薦度"]}/10` : ""}</div>
        ${paras.map((p) => `<p>${esc(p)}</p>`).join("")}
      </div>`;
    }
    return "";
  }

  function cell(k, v) {
    if (k.includes("區間") || k === "目前") return `<span class="band"><i class="dot ${esc(v || "")}"></i>${esc(v ?? "")}</span>`;
    if (k === "評級") return `<span class="stars">${esc(v || "")}</span>`;
    if (k === "達安全邊際") return esc(v ?? "");
    if (typeof v === "number") return esc(fmt(v));
    return esc(v ?? "");
  }

  function toneClass(k, v) {
    const n = toNum(v);
    if (k === "折溢價%") {
      if (n === null) return "";
      return n < 0 ? "tone-good" : n > 8 ? "tone-bad" : "";
    }
    if (k === "達安全邊際") return v === "是" ? "tone-good" : v === "否" ? "tone-bad" : "";
    if (k === "淨現金" && n !== null) return n >= 0 ? "tone-good" : "tone-bad";
    if (k === "負債率%" && n !== null) return n > 70 ? "tone-bad" : n < 40 ? "tone-good" : "";
    if (k === "流動比率" && n !== null) return n >= 2 ? "tone-good" : n < 1.5 ? "tone-bad" : "";
    if (k === "利息保障" && n !== null) return n >= 8 ? "tone-good" : n < 3 ? "tone-bad" : "";
    if ((k === "毛利率%" || k === "ROE%" || k === "ROIC%" || k === "營業利益率%" || k === "淨利率%" || k === "FCF率%") && n !== null) {
      if (n < 0) return "tone-bad";
      if ((k === "ROE%" || k === "ROIC%") && n >= 15) return "tone-good";
      if (k === "毛利率%" && n >= 30) return "tone-good";
    }
    if (String(k).includes("CAGR") && n !== null) return n > 0 ? "tone-good" : n < 0 ? "tone-bad" : "";
    if (k === "估值區間" || k === "目前" || k === "估值區間(模型)" || k === "估值區間(AI)") {
      if (v === "非常便宜" || v === "便宜") return "tone-good";
      if (v === "非常昂貴") return "tone-bad";
      if (v === "昂貴") return "tone-warn";
    }
    if (k === "P/IV" && n !== null) return n <= 0.75 ? "tone-good" : n > 1.5 ? "tone-bad" : "";
    return "";
  }

  function fmt(n) {
    if (n === null || n === undefined || n === "") return "—";
    const x = Number(n);
    if (!Number.isFinite(x)) return String(n);
    if (Math.abs(x) >= 1e6) return x.toLocaleString("zh-Hant", { maximumFractionDigits: 0 });
    return x.toLocaleString("zh-Hant", { maximumFractionDigits: 3 });
  }

  function fmtPct(n, signed) {
    if (n === null || n === undefined || n === "") return "—";
    const x = Number(n);
    if (!Number.isFinite(x)) return String(n);
    const s = x.toLocaleString("zh-Hant", { maximumFractionDigits: 2 });
    if (signed) return `${x > 0 ? "+" : ""}${s}%`;
    return `${s}%`;
  }

  function splitAdvice(text) {
    const t = String(text || "").trim();
    if (!t) return [];
    return t.split(/(?<=[。！？；;])\s*/).map((s) => s.trim()).filter(Boolean);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function openDetail(r) {
    const code = r["代號"];
    const ov = (DATA.sheets.overview || []).find((x) => x["代號"] === code) || r;
    const adv = (DATA.sheets.advice || []).find((x) => x["代號"] === code) || {};
    const mo = (DATA.sheets.models || []).find((x) => x["代號"] === code) || {};
    const bp = (DATA.sheets.bands || []).find((x) => x["代號"] === code) || {};
    const km = (DATA.sheets.metrics || []).find((x) => x["代號"] === code) || {};
    const headline = adv["一句話重點(不考慮價格)"] || ov["一句話重點"] || "";
    const paras = splitAdvice(adv["200字投資建議"] || "");
    const risks = adv["主要風險"] || ov["警示"] || "";
    $("#modalBody").innerHTML = `
      <h2 id="modalTitle">${esc(ov["名稱"] || "")} <small>${esc(ov["市場"] || "")} ${esc(code || "")}</small></h2>
      <p class="band ${toneClass("估值區間", ov["估值區間"])}"><i class="dot ${esc(ov["估值區間"] || "")}"></i>${esc(ov["估值區間"] || "")} · 信心 ${esc(ov["信心"] ?? "—")} · <span class="stars">${esc(ov["評級"] || "")}</span></p>
      <div class="kv">
        <b>資料日</b><span>${esc(ov["估值日"] || DATA.asof || "—")} · ${esc(ov["幣別"] || "")}</span>
        <b>內在價值</b><span>${fmt(ov["內在價值"])}</span>
        <b>P25–P75</b><span>${fmt(ov["價值下限P25"])} – ${fmt(ov["價值上限P75"])}</span>
        <b>折溢價</b><span class="${toneClass("折溢價%", ov["折溢價%"])}">${fmtPct(ov["折溢價%"], true)}</span>
        <b>安全買點</b><span>${fmt(ov["安全買點"])}（MOS ${esc(ov["安全邊際MOS%"] ?? "—")}% · <span class="${toneClass("達安全邊際", ov["達安全邊際"])}">${esc(ov["達安全邊際"] || "")}</span>）</span>
        <b>畫像</b><span>${esc(ov["畫像"] || "")}</span>
        <b>毛利率 / ROE</b><span class="${toneClass("毛利率%", km["毛利率%"])}">${fmtPct(km["毛利率%"])}</span> / <span class="${toneClass("ROE%", km["ROE%"])}">${fmtPct(km["ROE%"])}</span>
      </div>
      <div class="advice">
        <p class="lead">💡 ${esc(headline)}</p>
        ${paras.map((p) => `<p>${esc(p)}</p>`).join("") || ""}
      </div>
      <h3>📐 八模型</h3>
      <div class="kv">${MODEL_COLS.map((k) => `<b>${k}</b><span>${fmt(mo[k])}</span>`).join("")}</div>
      <h3>🎚️ 五檔價位</h3>
      <div class="kv">${["非常便宜 ≤", "便宜 ≤", "合理 ≤", "昂貴 ≤", "非常昂貴 >"].map((k) => `<b>${k}</b><span>${fmt(bp[k])}</span>`).join("")}</div>
      ${risks ? `<p class="warn-box">⚠️ ${esc(risks)}</p>` : ""}
    `;
    $("#modal").hidden = false;
  }
  function closeModal() { $("#modal").hidden = true; }

  function methodHtml() {
    return `<article class="method">
      <h2>方法與免責</h2>
      <p><a class="method-link" href="./method.html">📖 詳細方法 — 八模型公式、數值含義與限制</a></p>
      <h3>① 資料來源</h3>
      <p>東方財富 F10 標準化財報（港股→港交所披露易；A 股→滬深北定期報告；美股→SEC 10-K/10-Q）。匯率與即時報價於程式更新時寫入，網頁不即時報價。</p>
      <h3>② 八個估值模型</h3>
      <p>格雷厄姆數字 / 修正公式 / NCAV、巴菲特業主盈餘 DCF、EPV、達摩達蘭 FCFF、剩餘收益 PB、股利折現。依公司畫像加權，並輸出 P25–P75 區間。</p>
      <h3>③ 五檔區間</h3>
      <p>以資料日價格 / 內在價值 切分：≤0.50 非常便宜、≤0.75 便宜、≤1.15 合理、≤1.50 昂貴、&gt;1.50 非常昂貴。</p>
      <h3>④ 信心分數 0–100</h3>
      <p>系統自動計算（不用手填）：資料完整 28% + 歷史年數 17% + 模型分歧 27% + 獲利連續 13% + 可用模型數 15%。低於 50 只宜當篩選線索。</p>
      <h3>⑤ 安全邊際 MOS</h3>
      <p>全域預設 25%，watchlist 的 mos= 可覆寫個股。安全買點 = IV × (1−MOS)。這是買入紀律，不會改五檔區間。</p>
      <h3>⑥ AI</h3>
      <p>阿里雲百煉千問：qwen-long 核對精簡 Excel，qwen-plus 思考後給推薦度與建議。只能使用系統提供的數字。</p>
      <h3>⑦ 免責</h3>
      <p>${esc(DATA?.disclaimer || "本頁為程式化研究輔助，非投資建議。")}</p>
    </article>`;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function loadChartJs() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (chartJsPromise) return chartJsPromise;
    chartJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
      s.onload = () => resolve(window.Chart);
      s.onerror = () => reject(new Error("chart"));
      document.head.appendChild(s);
    });
    return chartJsPromise;
  }

  function applyChartTheme(ch) {
    if (!ch) return;
    const muted = cssVar("--muted");
    const text = cssVar("--text");
    ch.options.plugins.legend.labels.color = text;
    ch.options.scales.x.ticks.color = muted;
    ch.options.scales.y.ticks.color = muted;
    ch.options.scales.x.grid.color = cssVar("--line");
    ch.options.scales.y.grid.color = cssVar("--line");
    ch.update();
  }

  function openChart(r) {
    const code = r["代號"];
    const ov = ovOf(r);
    const s = (DATA.series || {})[code] || { annual: [], daily: [] };
    $("#chartTitle").textContent = `${ov["名稱"] || code} · ${TABS[tab].label}`;
    const dailyN = (s.daily || []).length;
    const annualN = (s.annual || []).length;
    let hint = tab === "metrics"
      ? `年度財報序列 ${annualN} 點（來自歷史年報）`
      : `日估值序列 ${dailyN} 點（每次跑 valuation 累積）`;
    if (tab !== "metrics" && dailyN < 2) hint += "。目前點數不足，曲線會在多次更新後更完整。";
    $("#chartHint").textContent = hint;
    $("#chartModal").hidden = false;
    if (chartInst) { chartInst.destroy(); chartInst = null; }
    loadChartJs().then((Chart) => {
      const cfg = chartConfig(s, Chart);
      if (!cfg) {
        $("#chartHint").textContent = "這個分頁目前沒有可畫的序列。";
        return;
      }
      const ctx = $("#chartCanvas");
      chartInst = new Chart(ctx, cfg);
    }).catch(() => {
      $("#chartHint").textContent = "無法載入圖表套件（需連網載入 Chart.js）。";
    });
  }

  function closeChart() {
    $("#chartModal").hidden = true;
    if (chartInst) { chartInst.destroy(); chartInst = null; }
  }

  function palette() {
    return ["#ff9500", "#0a84ff", "#30d158", "#af52de", "#ff375f", "#64d2ff", "#ffd60a", "#ac8e68", "#8e8e93"];
  }

  function lineDs(label, labels, values, color, yAxis = "y") {
    return {
      label, yAxisID: yAxis,
      data: labels.map((_, i) => values[i]),
      borderColor: color, backgroundColor: color + "22",
      tension: 0.25, pointRadius: labels.length < 8 ? 4 : 2, borderWidth: 2, spanGaps: true,
    };
  }

  function chartConfig(s) {
    const muted = cssVar("--muted");
    const text = cssVar("--text");
    const grid = cssVar("--line");
    const colors = palette();
    let labels = [];
    let datasets = [];
    if (tab === "metrics") {
      const rows = (s.annual || []).filter((x) => x.year);
      if (!rows.length) return null;
      labels = rows.map((x) => x.year);
      datasets = [
        lineDs("營收", labels, rows.map((x) => x.revenue), colors[0]),
        lineDs("歸母淨利", labels, rows.map((x) => x.net_income_parent), colors[1]),
        lineDs("經營現金流", labels, rows.map((x) => x.cfo), colors[2]),
        lineDs("自由現金流", labels, rows.map((x) => x.fcf), colors[4]),
      ];
    } else {
      const rows = s.daily || [];
      if (!rows.length) return null;
      labels = rows.map((x) => x.asof);
      if (tab === "overview") {
        datasets = [
          lineDs("內在價值", labels, rows.map((x) => x.iv), colors[0]),
          lineDs("P/IV", labels, rows.map((x) => x.ratio), colors[1], "y1"),
        ];
      } else if (tab === "models") {
        datasets.push(lineDs("加權 IV", labels, rows.map((x) => x.iv), colors[0]));
        Object.entries(MODEL_KEYS).forEach(([k, lab], i) => {
          datasets.push(lineDs(lab, labels, rows.map((x) => (x.models || {})[k] ?? null), colors[(i + 1) % colors.length]));
        });
      } else if (tab === "bands") {
        datasets = [
          lineDs("P/IV", labels, rows.map((x) => x.ratio), colors[0]),
          lineDs("便宜 0.75", labels, labels.map(() => 0.75), "#30d158"),
          lineDs("合理 1.15", labels, labels.map(() => 1.15), "#ffd60a"),
          lineDs("昂貴 1.50", labels, labels.map(() => 1.50), "#ff3b30"),
        ];
        datasets[1].borderDash = [5, 4]; datasets[1].pointRadius = 0; datasets[1].borderWidth = 1;
        datasets[2].borderDash = [5, 4]; datasets[2].pointRadius = 0; datasets[2].borderWidth = 1;
        datasets[3].borderDash = [5, 4]; datasets[3].pointRadius = 0; datasets[3].borderWidth = 1;
      } else if (tab === "advice") {
        datasets = [lineDs("AI 推薦度", labels, rows.map((x) => x.score), colors[0])];
      } else {
        return null;
      }
    }
    const extraY = datasets.some((d) => d.yAxisID === "y1");
    return {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: text, boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}` } },
        },
        scales: {
          x: { ticks: { color: muted, maxRotation: 45, font: { size: 11 } }, grid: { color: grid } },
          y: { ticks: { color: muted }, grid: { color: grid } },
          ...(extraY ? { y1: { position: "right", ticks: { color: muted }, grid: { drawOnChartArea: false } } } : {}),
        },
      },
    };
  }
})();
