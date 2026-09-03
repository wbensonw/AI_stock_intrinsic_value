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
  const DEFAULT_SORT = { overview: ["估值區間", true], models: ["加權內在價值", false], bands: ["目前", true], metrics: ["ROE%", false], advice: ["AI推薦度", false] };

  let DATA = null;
  let tab = "overview";
  let sortKey = "估值區間";
  let sortAsc = true;
  let q = "";
  let market = "ALL";
  let band = "ALL";

  const themeBtn = $("#themeBtn");
  const saved = localStorage.getItem("iv-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  setTheme(saved);

  themeBtn.addEventListener("click", () => {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
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

  function rowsOf() {
    const sheet = TABS[tab].sheet;
    if (!sheet || !DATA?.sheets) return [];
    let rows = DATA.sheets[sheet] || [];
    if (q) {
      rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
    }
    if (market !== "ALL") {
      const mktOf = {};
      (DATA.sheets.overview || []).forEach((x) => { mktOf[x["代號"]] = x["市場"]; });
      rows = rows.filter((r) => (r["市場"] || mktOf[r["代號"]]) === market);
    }
    if (band !== "ALL") {
      rows = rows.filter((r) => (r["估值區間"] || r["目前"] || r["估值區間(模型)"]) === band);
    }
    return sortRows(rows);
  }

  function sortRows(rows) {
    const bandOrd = Object.fromEntries(BANDS.map((b, i) => [b, i]));
    const key = sortKey;
    const mul = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      let va = a[key], vb = b[key];
      if (key.includes("區間") || key === "目前") {
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
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
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
    const keys = rows[0] ? Object.keys(rows[0]) : [];
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
  }

  function renderStats() {
    const c = DATA?.band_counts || {};
    $("#stats").innerHTML = ["非常便宜", "便宜", "合理", "昂貴", "非常昂貴", "無法估值"]
      .map((k) => `<div class="stat"><b>${c[k] || 0}</b><span>${k}</span></div>`).join("");
  }

  function tableHtml(rows, keys) {
    const head = keys.map((k) => `<th data-k="${esc(k)}">${esc(k)}${k === sortKey ? `<span class="arr">${sortAsc ? "↑" : "↓"}</span>` : ""}</th>`).join("");
    const body = rows.map((r, i) => `<tr class="row-link" data-i="${i}">${keys.map((k) => `<td class="${toNum(r[k]) !== null ? "num" : ""}">${cell(k, r[k])}</td>`).join("")}</tr>`).join("");
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function cardsHtml(rows) {
    return `<div class="cards">${rows.map((r, i) => {
      const title = `${r["名稱"] || ""} ${r["代號"] || ""}`.trim();
      const bandv = r["估值區間"] || r["目前"] || r["估值區間(模型)"] || "";
      const head = r["一句話重點"] || r["一句話重點(不考慮價格)"] || r["行業"] || "";
      const ft = [r["現價"] != null ? `現價 ${fmt(r["現價"])}` : "", r["內在價值"] != null ? `IV ${fmt(r["內在價值"])}` : r["加權內在價值"] != null ? `IV ${fmt(r["加權內在價值"])}` : ""].filter(Boolean).join(" · ");
      return `<article class="item" data-i="${i}">
        <div class="item-hd"><div class="ico-sq">${(r["代號"] || "?").toString().slice(-2)}</div>
          <div><h3>${esc(title)}</h3><div class="band"><i class="dot ${esc(bandv)}"></i>${esc(bandv)}</div></div></div>
        <p>${esc(head)}</p>
        <div class="item-ft"><span>${esc(ft)}</span><span class="stars">${esc(r["評級"] || "")}</span></div>
      </article>`;
    }).join("")}</div>`;
  }

  function cell(k, v) {
    if (k.includes("區間") || k === "目前") return `<span class="band"><i class="dot ${esc(v || "")}"></i>${esc(v ?? "")}</span>`;
    if (k === "評級") return `<span class="stars">${esc(v || "")}</span>`;
    if (typeof v === "number") return esc(fmt(v));
    return esc(v ?? "");
  }

  function fmt(n) {
    if (n === null || n === undefined || n === "") return "—";
    const x = Number(n);
    if (!Number.isFinite(x)) return String(n);
    if (Math.abs(x) >= 1e6) return x.toLocaleString("zh-Hant", { maximumFractionDigits: 0 });
    return x.toLocaleString("zh-Hant", { maximumFractionDigits: 3 });
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
    $("#modalBody").innerHTML = `
      <h2 id="modalTitle">${esc(ov["名稱"] || "")} <small>${esc(ov["市場"] || "")} ${esc(code || "")}</small></h2>
      <p class="band"><i class="dot ${esc(ov["估值區間"] || "")}"></i>${esc(ov["估值區間"] || "")} · 信心 ${esc(ov["信心"] ?? "—")} · ${esc(ov["評級"] || "")}</p>
      <div class="kv">
        <b>現價</b><span>${fmt(ov["現價"])} ${esc(ov["幣別"] || "")}</span>
        <b>內在價值</b><span>${fmt(ov["內在價值"])}</span>
        <b>P25–P75</b><span>${fmt(ov["價值下限P25"])} – ${fmt(ov["價值上限P75"])}</span>
        <b>折溢價</b><span>${esc(ov["折溢價%"] ?? "—")}%</span>
        <b>安全買點</b><span>${fmt(ov["安全買點"])}（MOS ${esc(ov["安全邊際MOS%"] ?? "—")}% · ${esc(ov["達安全邊際"] || "")}）</span>
        <b>畫像</b><span>${esc(ov["畫像"] || "")}</span>
      </div>
      <p class="advice"><strong>💡 ${esc(adv["一句話重點(不考慮價格)"] || ov["一句話重點"] || "")}</strong><br>${esc(adv["200字投資建議"] || "")}</p>
      <h3>📐 八模型</h3>
      <div class="kv">${["①葛拉漢數字","②葛拉漢公式","③NCAV清算","④巴菲特業主盈餘","⑤EPV盈餘能力","⑥達摩達蘭FCFF","⑦剩餘收益PB","⑧股利折現"].map((k) => `<b>${k}</b><span>${fmt(mo[k])}</span>`).join("")}</div>
      <h3>🎚️ 五檔價位</h3>
      <div class="kv">${["非常便宜 ≤","便宜 ≤","合理 ≤","昂貴 ≤","非常昂貴 >"].map((k) => `<b>${k}</b><span>${fmt(bp[k])}</span>`).join("")}</div>
      <p class="hint">⚠️ ${esc(adv["主要風險"] || ov["警示"] || "—")}</p>
    `;
    $("#modal").hidden = false;
  }
  function closeModal() { $("#modal").hidden = true; }

  function methodHtml() {
    return `<article class="method">
      <h2>方法與免責</h2>
      <h3>① 資料來源</h3>
      <p>東方財富 F10 標準化財報（港股→港交所披露易；A 股→滬深北定期報告；美股→SEC 10-K/10-Q）。匯率與即時報價每日更新。</p>
      <h3>② 八個估值模型</h3>
      <p>格雷厄姆數字 / 修正公式 / NCAV、巴菲特業主盈餘 DCF、EPV、達摩達蘭 FCFF、剩餘收益 PB、股利折現。依公司畫像加權，並輸出 P25–P75 區間。</p>
      <h3>③ 五檔區間</h3>
      <p>以 現價 / 內在價值 切分：≤0.50 非常便宜、≤0.75 便宜、≤1.15 合理、≤1.50 昂貴、&gt;1.50 非常昂貴。</p>
      <h3>④ 信心分數 0–100</h3>
      <p>系統自動計算（不用手填）：資料完整 28% + 歷史年數 17% + 模型分歧 27% + 獲利連續 13% + 可用模型數 15%。低於 50 只宜當篩選線索。</p>
      <h3>⑤ 安全邊際 MOS</h3>
      <p>全域預設 25%，watchlist 的 mos= 可覆寫個股。安全買點 = IV × (1−MOS)。這是買入紀律，不會改五檔區間。</p>
      <h3>⑥ AI</h3>
      <p>阿里雲百煉千問：qwen-long 核對精簡 Excel，qwen-plus 思考後給推薦度與 200 字建議。只能使用系統提供的數字。</p>
      <h3>⑦ 免責</h3>
      <p>${esc(DATA?.disclaimer || "本頁為程式化研究輔助，非投資建議。")}</p>
    </article>`;
  }
})();
