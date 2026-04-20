(function () {
  "use strict";

  const KEY = window.GACHA_PUBLISHED_STORAGE_KEY || "gacha-published-overrides-v1";
  const EXTRA_KEY = window.GACHA_EXTRA_PRODUCTS_KEY || "gacha-products-extra-v1";
  const SHEET_TOKEN_KEY = "gacha-admin-sheet-token-v1";

  function getStoredSheetToken() {
    try {
      const v = localStorage.getItem(SHEET_TOKEN_KEY);
      if (v != null) return String(v);
    } catch {
      /* ignore */
    }
    try {
      const v = sessionStorage.getItem(SHEET_TOKEN_KEY);
      if (v != null) return String(v);
    } catch {
      /* ignore */
    }
    return "";
  }

  function setStoredSheetToken(token) {
    const value = String(token || "").trim();
    try {
      localStorage.setItem(SHEET_TOKEN_KEY, value);
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.setItem(SHEET_TOKEN_KEY, value);
    } catch {
      /* ignore */
    }
  }

  /** @type {Record<string, unknown>[]} */
  let productsCache = [];

  /**
   * 轉成試算表可寫入的純值（陣列改 JSON 字串／逗號分隔）
   * @param {Record<string, unknown>} p
   */
  function productForSheet(p) {
    const o = { ...p };
    if (Array.isArray(o.specs)) o.specs = JSON.stringify(o.specs);
    if (Array.isArray(o.labels)) o.labels = o.labels.join(",");
    if (Array.isArray(o.gallery)) o.gallery = o.gallery.join("|");
    if (typeof o.jpy === "string") {
      const n = parseInt(o.jpy, 10);
      o.jpy = Number.isNaN(n) ? 0 : n;
    }
    return o;
  }

  /**
   * POST 至 Apps Script Web App，寫入試算表一列（需指令碼屬性 ADMIN_TOKEN）
   * @param {Record<string, unknown>} product
   * @param {string} token
   */
  function isCloudinaryConfigured() {
    const c = (window.GACHA_CLOUDINARY_CLOUD_NAME || "").trim();
    const p = (window.GACHA_CLOUDINARY_UPLOAD_PRESET || "").trim();
    return !!c && !!p;
  }

  /**
   * @param {Blob} blob
   * @returns {Promise<string>} secure_url
   */
  async function uploadBlobToCloudinary(blob) {
    const cloud = (window.GACHA_CLOUDINARY_CLOUD_NAME || "").trim();
    const preset = (window.GACHA_CLOUDINARY_UPLOAD_PRESET || "").trim();
    if (!cloud || !preset) throw new Error("未設定 GACHA_CLOUDINARY_CLOUD_NAME／UPLOAD_PRESET");
    const fd = new FormData();
    fd.append("file", blob, "gacha.jpg");
    fd.append("upload_preset", preset);
    const folder = (window.GACHA_CLOUDINARY_FOLDER || "").trim();
    if (folder) fd.append("folder", folder);
    const res = await fetch("https://api.cloudinary.com/v1_1/" + encodeURIComponent(cloud) + "/image/upload", {
      method: "POST",
      body: fd,
    });
    const data = await res.json().catch(function () {
      return {};
    });
    if (data.error) throw new Error(data.error.message || "Cloudinary 上傳失敗");
    if (!data.secure_url) throw new Error("Cloudinary 未回傳網址");
    return String(data.secure_url);
  }

  /**
   * 壓縮後上傳 Cloudinary（已設定時）或回傳 Data URL（未設定時）
   * @param {File} file
   * @returns {Promise<string>}
   */
  async function processImageFileForUpload(file) {
    const dataUrl = await compressImageFileToDataUrl(file);
    if (!isCloudinaryConfigured()) return dataUrl;
    const blob = await fetch(dataUrl)
      .then(function (r) {
        return r.blob();
      })
      .catch(function () {
        throw new Error("無法轉成圖片檔上傳");
      });
    return uploadBlobToCloudinary(blob);
  }

  async function postProductToSheet(product, token) {
    const url = (window.GACHA_DATA_URL || "").trim();
    if (!url) throw new Error("請在 js/data.js 設定 GACHA_DATA_URL（與讀取商品相同的 Web App 網址）");
    if (url.indexOf("/dev") !== -1) {
      console.warn("[admin] 請使用「部署」後的 /exec 網址，勿使用 /dev");
    }
    const t = String(token || "").trim();
    if (!t) throw new Error("請填寫 ADMIN_TOKEN");
    const body = JSON.stringify({ token: t, product: productForSheet(product) });
    const init = {
      method: "POST",
      body,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
    };
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      try {
        await fetch(url, { ...init, mode: "no-cors" });
      } catch {
        /* ignore */
      }
      throw new Error(
        "無法連線或取得回應（常見：瀏覽器跨網域限制）。請打開試算表看是否已新增列；若沒有，請到 Apps Script「執行作業」查看 doPost 錯誤。確認網址為部署的 https://script.google.com/.../exec（非 /dev）。"
      );
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + (errText ? "：" + errText.slice(0, 200) : ""));
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const preview = String(text).replace(/\s+/g, " ").slice(0, 160);
      throw new Error(
        "伺服器回傳非 JSON（前 160 字）：" +
          preview +
          "。請確認貼入的是 Web App「部署」網址（/exec），不是編輯器預覽連結。"
      );
    }
    if (!data.ok) {
      const err = String(data.error || "寫入失敗");
      if (err === "unauthorized") throw new Error("ADMIN_TOKEN 與指令碼屬性不一致");
      // 僅在伺服器明確回傳此字串時提示「未設定」（勿用 error 內含 ADMIN_TOKEN 就套用，以免掩蓋其他錯誤）
      if (err === "未設定 ADMIN_TOKEN")
        throw new Error(
          "Apps Script 讀不到指令碼屬性 ADMIN_TOKEN。請開啟「與 GACHA_DATA_URL 同一個」Apps Script 專案 → 齒輪 → 專案設定 → 指令碼屬性 → 新增鍵 ADMIN_TOKEN（全大寫）並儲存，再重試。"
        );
      if (err.indexOf("SPREADSHEET_ID") !== -1) throw new Error("Apps Script 未設定指令碼屬性 SPREADSHEET_ID");
      throw new Error(err);
    }
  }

  function setSheetSyncHint() {
    const el = document.getElementById("admin-sheet-sync-note");
    if (!el) return;
    const url = (window.GACHA_DATA_URL || "").trim();
    if (!url) {
      el.hidden = false;
      el.textContent =
        "若要寫入 Google 試算表：請先在 js/data.js 設定 GACHA_DATA_URL（Web App 部署後的 /exec 網址，勿用 /dev）。僅切換列表「上下架」並按「儲存設定」不會新增試算表列。";
      return;
    }
    el.hidden = false;
    el.textContent =
      "「新增商品」表單內請勾選「同步寫入試算表」並填 ADMIN_TOKEN，按下「加入商品」後才會在試算表新增一列。僅調整列表開關＋儲存設定＝只改本機上架狀態，不會寫入試算表。";
  }

  function loadExtraProducts() {
    try {
      const raw = localStorage.getItem(EXTRA_KEY);
      if (!raw) return [];
      const o = JSON.parse(raw);
      return Array.isArray(o) ? o : [];
    } catch {
      return [];
    }
  }

  function saveExtraProducts(list) {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(list));
  }

  /**
   * @param {Record<string, unknown>[]} base
   * @param {Record<string, unknown>[]} extras
   */
  function mergeWithExtras(base, extras) {
    const clean = extras.filter((e) => e && String(e.id || "").trim());
    const extraById = new Map(clean.map((e) => [String(e.id), e]));
    const baseIdSet = new Set(base.map((p) => String(p.id)));
    const out = base.map((p) => {
      const id = String(p.id);
      return extraById.has(id) ? extraById.get(id) : p;
    });
    clean.forEach((e) => {
      const id = String(e.id);
      if (!baseIdSet.has(id)) out.push(e);
    });
    return out;
  }

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return typeof o === "object" && o !== null ? o : null;
    } catch {
      return null;
    }
  }

  function basePublished(p) {
    if (p.published === false) return false;
    if (p.published === true) return true;
    if (typeof p.published === "string") {
      const s = p.published.trim().toLowerCase();
      if (s === "false" || s === "0" || s === "no" || s === "否" || s === "下架" || s === "off") return false;
      if (s === "true" || s === "1" || s === "yes" || s === "是" || s === "上架" || s === "on") return true;
    }
    return true;
  }

  function effectivePublished(p, overrides) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, p.id)) {
      return !!overrides[p.id];
    }
    return basePublished(p);
  }

  async function loadBaseProducts() {
    let list = Array.isArray(window.GACHA_PRODUCTS) ? [...window.GACHA_PRODUCTS] : [];
    const url = (window.GACHA_DATA_URL || "").trim();
    if (url) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.products)) list = data.products;
        }
      } catch (e) {
        console.warn("[admin] 無法載入遠端商品，僅顯示 data.js。", e);
      }
    }
    return list.filter((p) => p && String(p.id || "").trim());
  }

  const MAX_IMAGE_SIDE = 1600;

  /**
   * 將圖片檔壓縮為 JPEG Data URL（供本機商品欄位儲存）
   * @param {File} file
   * @returns {Promise<string>}
   */
  function compressImageFileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || file.type.indexOf("image/") !== 0) {
        reject(new Error("請選擇圖片檔（JPG／PNG 等）"));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var url = reader.result;
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth;
          var h = img.naturalHeight;
          if (!w || !h) {
            reject(new Error("無法讀取圖片尺寸"));
            return;
          }
          var max = MAX_IMAGE_SIDE;
          if (w > max || h > max) {
            var r = Math.min(max / w, max / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("無法處理圖片"));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          var q = 0.85;
          var dataUrl = canvas.toDataURL("image/jpeg", q);
          while (dataUrl.length > 2000000 && q > 0.42) {
            q -= 0.07;
            dataUrl = canvas.toDataURL("image/jpeg", q);
          }
          resolve(dataUrl);
        };
        img.onerror = function () {
          reject(new Error("圖片無法顯示（若為 iPhone HEIC，請在相簿改選 JPG 或截圖）"));
        };
        img.src = url;
      };
      reader.onerror = function () {
        reject(new Error("讀取檔案失敗"));
      };
      reader.readAsDataURL(file);
    });
  }

  function setMainImagePreview(src) {
    var wrap = document.getElementById("admin-image-preview");
    var im = document.getElementById("admin-image-preview-img");
    if (!wrap || !im) return;
    var s = src && String(src).trim();
    if (s && (s.indexOf("http") === 0 || s.indexOf("data:image") === 0)) {
      im.src = s;
      wrap.hidden = false;
    } else {
      im.removeAttribute("src");
      wrap.hidden = true;
    }
  }

  function refreshGalleryPreview() {
    var ta = document.getElementById("admin-field-gallery");
    var host = document.getElementById("admin-gallery-preview");
    if (!ta || !host) return;
    var parts = String(ta.value || "")
      .split(/[|\n\r]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    host.innerHTML = "";
    if (!parts.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    parts.slice(0, 12).forEach(function (src) {
      var img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.width = 56;
      img.height = 56;
      img.loading = "lazy";
      img.className = "admin-gallery-thumb";
      host.appendChild(img);
    });
  }

  function clearUploadUI() {
    var mainFile = document.getElementById("admin-file-main");
    var galFile = document.getElementById("admin-file-gallery");
    if (mainFile instanceof HTMLInputElement) mainFile.value = "";
    if (galFile instanceof HTMLInputElement) galFile.value = "";
    setMainImagePreview("");
    var gh = document.getElementById("admin-gallery-preview");
    if (gh) {
      gh.innerHTML = "";
      gh.hidden = true;
    }
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderSeriesOptions(products) {
    const list = document.getElementById("admin-series-options");
    if (!(list instanceof HTMLDataListElement)) return;
    const names = Array.from(
      new Set(
        (Array.isArray(products) ? products : [])
          .map((p) => (p && p.series != null ? String(p.series).trim() : ""))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, "zh-Hant"));
    list.innerHTML = names.map((name) => `<option value="${escapeAttr(name)}"></option>`).join("");
  }

  function setFeedback(msg, kind) {
    const el = document.getElementById("admin-feedback");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "admin-toast" + (kind === "ok" ? " admin-toast--ok" : kind === "err" ? " admin-toast--err" : "");
  }

  function updateRowPill(tr, checked) {
    const pill = tr.querySelector(".js-status-pill");
    if (!pill) return;
    pill.textContent = checked ? "上架" : "下架";
    pill.className =
      "admin-status-pill js-status-pill " + (checked ? "admin-status-pill--on" : "admin-status-pill--off");
  }

  /** @param {boolean} published  true＝顧客看得到（上架） */
  function setRowPublished(tr, published) {
    tr.dataset.published = published ? "true" : "false";
    const cb = tr.querySelector("input.js-published");
    if (cb) {
      cb.checked = published;
      cb.setAttribute("aria-checked", published ? "true" : "false");
    }
    updateRowPill(tr, published);
  }

  function updateStats() {
    const rows = document.querySelectorAll("#admin-tbody tr[data-published]");
    let on = 0;
    rows.forEach((tr) => {
      if (tr.dataset.published === "true") on += 1;
    });
    const total = rows.length;
    const off = total - on;
    const elOn = document.getElementById("stat-on");
    const elOff = document.getElementById("stat-off");
    const elTotal = document.getElementById("stat-total");
    if (elOn) elOn.textContent = String(on);
    if (elOff) elOff.textContent = String(off);
    if (elTotal) elTotal.textContent = String(total);
  }

  function applySearch(q) {
    const needle = q.trim().toLowerCase();
    document.querySelectorAll("#admin-tbody tr[data-search]").forEach((tr) => {
      const hay = tr.getAttribute("data-search") || "";
      const show = !needle || hay.includes(needle);
      tr.setAttribute("data-hidden", show ? "false" : "true");
    });
  }

  /**
   * @param {Record<string, unknown>[]} products
   * @param {Record<string, boolean> | null} overrides
   * @param {Set<string>} extraIdSet 出現在本機 extra 清單中的 id（含覆寫雲端同編號）
   */
  function renderTable(products, overrides, extraIdSet) {
    const host = document.getElementById("admin-table-host");
    if (!host) return;

    const extraSet = extraIdSet instanceof Set ? extraIdSet : new Set();

    if (products.length === 0) {
      host.innerHTML =
        '<p class="admin-empty">目前沒有商品資料。請確認 <code>data.js</code> 或遠端 JSON 是否正確，或使用上方「新增商品」。</p>';
      updateStats();
      return;
    }

    const rows = products
      .map((p) => {
        const on = effectivePublished(p, overrides);
        const id = String(p.id);
        const name = p.name != null ? String(p.name) : "";
        const series = p.series != null ? String(p.series) : "";
        const search = `${id} ${name} ${series}`.toLowerCase();
        const soon = !!p.comingSoon;
        const flagSoon = soon
          ? '<span class="admin-flag">待上市</span>'
          : '<span class="admin-flag admin-flag--empty">—</span>';
        const pillClass = on ? "admin-status-pill--on" : "admin-status-pill--off";
        const pillText = on ? "上架" : "下架";
        const pubAttr = on ? "true" : "false";
        const labelName = escapeAttr((name || id).slice(0, 40));
        const isExtra = extraSet.has(id);
        const localCell = isExtra
          ? `<span class="admin-local-badge">本機</span><button type="button" class="btn ghost admin-btn-tiny js-remove-extra" data-id="${escapeAttr(
              id
            )}">移除</button>`
          : '<span class="admin-local-dash">—</span>';
        return `<tr data-search="${escapeAttr(search)}" data-id="${escapeAttr(id)}" data-published="${pubAttr}">
          <td class="col-actions">
            <label class="admin-toggle">
              <input type="checkbox" role="switch" class="js-published" data-id="${escapeAttr(id)}" ${
                on ? "checked" : ""
              } aria-checked="${on ? "true" : "false"}" aria-label="上架開關：${labelName}。綠色為上架，灰色為下架" />
              <span class="admin-toggle__track" aria-hidden="true"><span class="admin-toggle__knob"></span></span>
            </label>
          </td>
          <td class="col-status"><span class="admin-status-pill js-status-pill ${pillClass}">${pillText}</span></td>
          <td class="col-id"><code>${escapeHtml(id)}</code></td>
          <td>${escapeHtml(name || "—")}</td>
          <td>${escapeHtml(series || "—")}</td>
          <td class="col-flag">${flagSoon}</td>
          <td class="col-local">${localCell}</td>
        </tr>`;
      })
      .join("");

    host.innerHTML = `
      <div class="admin-table-wrap">
        <table class="admin-table" id="admin-table">
          <thead>
            <tr>
              <th class="col-actions" scope="col">上下架</th>
              <th class="col-status" scope="col">狀態</th>
              <th class="col-id" scope="col">編號</th>
              <th scope="col">名稱</th>
              <th scope="col">系列</th>
              <th class="col-flag" scope="col">備註</th>
              <th class="col-local" scope="col">本機</th>
            </tr>
          </thead>
          <tbody id="admin-tbody">${rows}</tbody>
        </table>
      </div>`;

    const tbody = document.getElementById("admin-tbody");
    if (tbody) {
      tbody.addEventListener("change", (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement) || !t.classList.contains("js-published")) return;
        const tr = t.closest("tr");
        if (!tr) return;
        const checked = t.checked;
        tr.dataset.published = checked ? "true" : "false";
        t.setAttribute("aria-checked", checked ? "true" : "false");
        updateRowPill(tr, checked);
        updateStats();
      });
      tbody.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest && e.target.closest(".js-remove-extra");
        if (!(btn instanceof HTMLElement)) return;
        const rid = btn.getAttribute("data-id");
        if (!rid) return;
        const next = loadExtraProducts().filter((x) => String(x.id) !== rid);
        saveExtraProducts(next);
        setFeedback("已移除本機條目「" + rid + "」。", "ok");
        void bootstrap();
      });
    }

    const searchEl = document.getElementById("admin-search");
    if (searchEl) applySearch(searchEl.value);
    updateStats();
  }

  function setDataSourceBadge() {
    const el = document.getElementById("admin-data-source");
    if (!el) return;
    const url = (window.GACHA_DATA_URL || "").trim();
    if (url) {
      if (url.indexOf("script.google.com") !== -1) {
        el.textContent = "資料：Google 試算表";
      } else {
        el.textContent = "資料：遠端 JSON";
      }
      el.classList.add("admin-badge--live");
      el.title = url;
    } else {
      el.textContent = "資料：本機 data.js";
      el.classList.remove("admin-badge--live");
      el.title = "GACHA_DATA_URL 未設定";
    }
  }

  function setKeyHints() {
    const el = document.getElementById("admin-key-hint");
    if (el) el.textContent = KEY;
    const ex = document.getElementById("admin-extra-key-hint");
    if (ex) ex.textContent = EXTRA_KEY;
  }

  /**
   * @returns {{ id: string; name: string; series: string; error?: string } | Record<string, unknown> | null}
   */
  function buildProductFromForm() {
    const name = (document.getElementById("admin-field-name")?.value || "").trim();
    const series = (document.getElementById("admin-field-series")?.value || "").trim();
    if (!name || !series) return null;

    const idRaw = (document.getElementById("admin-field-id")?.value || "").trim();
    const id = idRaw || "new-" + Date.now();

    const jpy = Number(document.getElementById("admin-field-jpy")?.value || 300);
    const capsule = (document.getElementById("admin-field-capsule")?.value || "").trim();
    const image = (document.getElementById("admin-field-image")?.value || "").trim();
    const accent = (document.getElementById("admin-field-accent")?.value || "").trim();
    const gallery = (document.getElementById("admin-field-gallery")?.value || "").trim();
    const description = (document.getElementById("admin-field-description")?.value || "").trim();
    const specsRaw = (document.getElementById("admin-field-specs")?.value || "").trim();
    let specs = [];
    if (specsRaw) {
      try {
        const parsed = JSON.parse(specsRaw);
        specs = Array.isArray(parsed) ? parsed : [];
      } catch {
        return { id, name, series, error: "規格須為有效的 JSON 陣列。" };
      }
    }

    const pcEl = document.getElementById("admin-field-purchaseCount");
    const pcRaw = pcEl && "value" in pcEl ? String(pcEl.value || "").trim() : "";
    let purchaseCount = undefined;
    if (pcRaw !== "") {
      const n = Number(pcRaw);
      purchaseCount = Number.isNaN(n) ? undefined : Math.max(0, Math.floor(n));
    }

    const launchNote = (document.getElementById("admin-field-launchNote")?.value || "").trim();
    const labels = [];
    if (document.getElementById("admin-label-new")?.checked) labels.push("new");
    if (document.getElementById("admin-label-hot")?.checked) labels.push("hot");
    if (document.getElementById("admin-label-recommend")?.checked) labels.push("recommend");

    return {
      id,
      name,
      series,
      jpy: Number.isNaN(jpy) ? 300 : jpy,
      capsule,
      image,
      accent,
      gallery: gallery || "",
      description,
      specs,
      purchaseCount,
      launchNote,
      labels,
      comingSoon: !!document.getElementById("admin-field-comingSoon")?.checked,
      published: !!document.getElementById("admin-field-published")?.checked,
    };
  }

  async function bootstrap() {
    setKeyHints();
    setDataSourceBadge();
    setSheetSyncHint();
    const host = document.getElementById("admin-table-host");
    if (host) host.innerHTML = '<p class="admin-loading" id="admin-loading">正在載入商品…</p>';

    const baseOnly = await loadBaseProducts();
    const extras = loadExtraProducts();
    productsCache = mergeWithExtras(baseOnly, extras);
    renderSeriesOptions(productsCache);
    const extraIdSet = new Set(
      extras.map((e) => (e && e.id != null ? String(e.id) : "")).filter(Boolean)
    );
    renderTable(productsCache, loadOverrides(), extraIdSet);
  }

  document.addEventListener("DOMContentLoaded", () => {
    void bootstrap();

    try {
      const tok = getStoredSheetToken();
      const el = document.getElementById("admin-sheet-token");
      if (tok && el instanceof HTMLInputElement) el.value = tok;
    } catch {
      /* ignore */
    }
    try {
      if (window.GACHA_AUTO_SYNC_SHEET && (window.GACHA_DATA_URL || "").trim()) {
        const syncEl = document.getElementById("admin-sync-sheet");
        if (syncEl instanceof HTMLInputElement) syncEl.checked = true;
      }
    } catch {
      /* ignore */
    }
    document.getElementById("admin-sheet-token")?.addEventListener("change", () => {
      const el = document.getElementById("admin-sheet-token");
      if (el instanceof HTMLInputElement) {
        setStoredSheetToken(el.value);
      }
    });

    document.getElementById("admin-btn-pick-main")?.addEventListener("click", () => {
      document.getElementById("admin-file-main")?.click();
    });
    document.getElementById("admin-file-main")?.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !t.files || !t.files[0]) return;
      const file = t.files[0];
      t.value = "";
      processImageFileForUpload(file)
        .then((url) => {
          const ta = document.getElementById("admin-field-image");
          if (ta instanceof HTMLTextAreaElement) ta.value = url;
          setMainImagePreview(url);
          setFeedback(isCloudinaryConfigured() ? "已上傳 Cloudinary 並設為主圖。" : "已設為主圖（已壓縮）。", "ok");
        })
        .catch((err) => setFeedback(String(err.message || err), "err"));
    });

    document.getElementById("admin-btn-pick-gallery")?.addEventListener("click", () => {
      document.getElementById("admin-file-gallery")?.click();
    });
    document.getElementById("admin-file-gallery")?.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !t.files || !t.files.length) return;
      const files = Array.from(t.files);
      t.value = "";
      const ta = document.getElementById("admin-field-gallery");
      if (!(ta instanceof HTMLTextAreaElement)) return;
      let chain = Promise.resolve();
      files.forEach((file) => {
        chain = chain.then(() =>
          processImageFileForUpload(file).then((url) => {
            const cur = ta.value.trim();
            ta.value = cur ? cur + " | " + url : url;
            refreshGalleryPreview();
          })
        );
      });
      chain
        .then(() =>
          setFeedback(
            (isCloudinaryConfigured() ? "已上傳 Cloudinary 並加入 " : "已加入 ") + files.length + " 張圖片。",
            "ok"
          )
        )
        .catch((err) => setFeedback(String(err.message || err), "err"));
    });

    const dropMain = document.getElementById("admin-drop-main");
    if (dropMain) {
      ["dragenter", "dragover"].forEach((ev) => {
        dropMain.addEventListener(ev, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropMain.classList.add("admin-drop--active");
        });
      });
      dropMain.addEventListener("dragleave", () => {
        dropMain.classList.remove("admin-drop--active");
      });
      dropMain.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropMain.classList.remove("admin-drop--active");
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f || f.type.indexOf("image/") !== 0) {
          setFeedback("請拖入圖片檔。", "err");
          return;
        }
        processImageFileForUpload(f)
          .then((url) => {
            const ta = document.getElementById("admin-field-image");
            if (ta instanceof HTMLTextAreaElement) ta.value = url;
            setMainImagePreview(url);
            setFeedback(
              isCloudinaryConfigured() ? "已上傳 Cloudinary 並設為主圖（拖曳）。" : "已設為主圖（拖曳上傳）。",
              "ok"
            );
          })
          .catch((err) => setFeedback(String(err.message || err), "err"));
      });
    }

    document.getElementById("admin-field-image")?.addEventListener("input", () => {
      const ta = document.getElementById("admin-field-image");
      if (ta instanceof HTMLTextAreaElement) setMainImagePreview(ta.value);
    });
    document.getElementById("admin-field-gallery")?.addEventListener("input", () => {
      refreshGalleryPreview();
    });

    document.getElementById("admin-add-reset")?.addEventListener("click", () => {
      clearUploadUI();
    });
    document.getElementById("admin-add-form")?.addEventListener("reset", () => {
      setTimeout(clearUploadUI, 0);
    });

    document.getElementById("admin-reload")?.addEventListener("click", async () => {
      setFeedback("正在重新載入…", "");
      await bootstrap();
      setFeedback("已重新載入商品列表。", "ok");
    });

    document.getElementById("admin-search")?.addEventListener("input", (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement) applySearch(t.value);
    });

    document.getElementById("admin-bulk-on")?.addEventListener("click", () => {
      document.querySelectorAll("#admin-tbody tr[data-id]").forEach((tr) => {
        if (!(tr instanceof HTMLElement)) return;
        setRowPublished(tr, true);
      });
      updateStats();
      setFeedback("已將列表中所有品項設為上架（尚未儲存）。", "");
    });

    document.getElementById("admin-bulk-off")?.addEventListener("click", () => {
      document.querySelectorAll("#admin-tbody tr[data-id]").forEach((tr) => {
        if (!(tr instanceof HTMLElement)) return;
        setRowPublished(tr, false);
      });
      updateStats();
      setFeedback("已將列表中所有品項設為下架（尚未儲存）。", "");
    });

    document.getElementById("admin-save")?.addEventListener("click", () => {
      const map = {};
      document.querySelectorAll("#admin-tbody tr[data-id]").forEach((tr) => {
        const id = tr.getAttribute("data-id");
        if (id) map[id] = tr.dataset.published === "true";
      });
      try {
        localStorage.setItem(KEY, JSON.stringify(map));
        setFeedback("已儲存 " + Object.keys(map).length + " 筆上架狀態。請重新整理首頁查看效果。", "ok");
      } catch (e) {
        setFeedback("儲存失敗：" + String(e), "err");
      }
    });

    document.getElementById("admin-clear")?.addEventListener("click", () => {
      try {
        localStorage.removeItem(KEY);
        const extras = loadExtraProducts();
        const extraIdSet = new Set(
          extras.map((e) => (e && e.id != null ? String(e.id) : "")).filter(Boolean)
        );
        renderTable(productsCache, null, extraIdSet);
        setFeedback("已清除本機覆寫，前台將依試算表／data.js 的 published。", "ok");
      } catch (e) {
        setFeedback("清除失敗：" + String(e), "err");
      }
    });

    document.getElementById("admin-clear-extras")?.addEventListener("click", () => {
      try {
        localStorage.removeItem(EXTRA_KEY);
        setFeedback("已清除本機新增／覆寫商品。", "ok");
      } catch (e) {
        setFeedback("清除失敗：" + String(e), "err");
        return;
      }
      void bootstrap();
    });

    document.getElementById("admin-add-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const out = buildProductFromForm();
      if (!out) {
        setFeedback("請填寫名稱與系列。", "err");
        return;
      }
      if ("error" in out && out.error) {
        setFeedback(String(out.error), "err");
        return;
      }
      const row = /** @type {Record<string, unknown>} */ (out);
      const sync = !!document.getElementById("admin-sync-sheet")?.checked;
      const tokenEl = document.getElementById("admin-sheet-token");
      const token = tokenEl instanceof HTMLInputElement ? tokenEl.value : "";
      if (sync && !String(token).trim()) {
        setFeedback("已勾選同步試算表，請填寫 ADMIN_TOKEN（與 Apps Script 指令碼屬性相同）。", "err");
        return;
      }

      const pid = String(row.id);
      const localListWithoutCurrent = loadExtraProducts().filter((x) => String(x.id) !== pid);
      const localListWithCurrent = localListWithoutCurrent.concat([row]);
      const baseOk = "已處理商品「" + String(row.name) + "」。";
      if (sync) {
        void postProductToSheet(row, token)
          .then(() => {
            // 勾選同步且成功時，移除同 id 的本機覆寫，避免列表持續顯示「本機」。
            try {
              saveExtraProducts(localListWithoutCurrent);
            } catch {
              /* ignore */
            }
            try {
              setStoredSheetToken(token);
            } catch {
              /* ignore */
            }
            setFeedback(baseOk + " 試算表已新增一列，且未保留本機副本。", "ok");
          })
          .catch((err) => {
            // 同步失敗時保留本機，避免賣家資料遺失。
            try {
              saveExtraProducts(localListWithCurrent);
            } catch (saveErr) {
              const saveErrName = saveErr && /** @type {Error} */ (saveErr).name;
              if (
                saveErrName === "QuotaExceededError" ||
                String(saveErr).indexOf("QuotaExceeded") !== -1
              ) {
                setFeedback(
                  "試算表寫入失敗，且本機空間不足無法暫存。請刪減圖片、改用圖床網址後重試。原錯誤：" +
                    String(err.message || err),
                  "err"
                );
                return;
              }
              setFeedback(
                "試算表寫入失敗，且本機暫存失敗：" +
                  String(saveErr) +
                  "。原錯誤：" +
                  String(err.message || err),
                "err"
              );
              return;
            }
            setFeedback(baseOk + " 試算表寫入失敗，已暫存本機：" + String(err.message || err), "err");
          })
          .finally(() => {
            const form = document.getElementById("admin-add-form");
            if (form instanceof HTMLFormElement) form.reset();
            clearUploadUI();
            const jpyEl = document.getElementById("admin-field-jpy");
            if (jpyEl instanceof HTMLSelectElement) jpyEl.value = "300";
            const pubEl = document.getElementById("admin-field-published");
            if (pubEl instanceof HTMLInputElement) pubEl.checked = true;
            const syncEl = document.getElementById("admin-sync-sheet");
            if (syncEl instanceof HTMLInputElement) syncEl.checked = false;
            try {
              const tok = getStoredSheetToken();
              const tel = document.getElementById("admin-sheet-token");
              if (tok && tel instanceof HTMLInputElement) tel.value = tok;
            } catch {
              /* ignore */
            }
            void bootstrap();
          });
      } else {
        try {
          saveExtraProducts(localListWithCurrent);
        } catch (err) {
          const name = err && /** @type {Error} */ (err).name;
          if (name === "QuotaExceededError" || String(err).indexOf("QuotaExceeded") !== -1) {
            setFeedback("儲存失敗：本機空間不足（圖太大或太多）。請刪減圖片、改用圖床網址，或清除部分本機商品。", "err");
          } else {
            setFeedback("儲存失敗：" + String(err), "err");
          }
          return;
        }
        setFeedback(
          "已加入本機商品「" +
            String(row.name) +
            "」。" +
            " 請重新整理首頁查看。（未勾選「同步寫入試算表」時，Google 試算表不會新增列。）",
          "ok"
        );
        const form = document.getElementById("admin-add-form");
        if (form instanceof HTMLFormElement) form.reset();
        clearUploadUI();
        const jpyEl = document.getElementById("admin-field-jpy");
        if (jpyEl instanceof HTMLSelectElement) jpyEl.value = "300";
        const pubEl = document.getElementById("admin-field-published");
        if (pubEl instanceof HTMLInputElement) pubEl.checked = true;
        void bootstrap();
      }
    });
  });
})();
