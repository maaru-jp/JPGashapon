(function () {
  "use strict";

  const KEY = window.GACHA_PUBLISHED_STORAGE_KEY || "gacha-published-overrides-v1";
  const EXTRA_KEY = window.GACHA_EXTRA_PRODUCTS_KEY || "gacha-products-extra-v1";

  /** @type {Record<string, unknown>[]} */
  let productsCache = [];

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
      el.textContent = "資料：遠端 JSON";
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
    const host = document.getElementById("admin-table-host");
    if (host) host.innerHTML = '<p class="admin-loading" id="admin-loading">正在載入商品…</p>';

    const baseOnly = await loadBaseProducts();
    const extras = loadExtraProducts();
    productsCache = mergeWithExtras(baseOnly, extras);
    const extraIdSet = new Set(
      extras.map((e) => (e && e.id != null ? String(e.id) : "")).filter(Boolean)
    );
    renderTable(productsCache, loadOverrides(), extraIdSet);
  }

  document.addEventListener("DOMContentLoaded", () => {
    void bootstrap();

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
      const pid = String(row.id);
      const list = loadExtraProducts().filter((x) => String(x.id) !== pid);
      list.push(row);
      try {
        saveExtraProducts(list);
      } catch (err) {
        setFeedback("儲存失敗：" + String(err), "err");
        return;
      }
      setFeedback("已加入本機商品「" + String(row.name) + "」。請重新整理首頁查看。", "ok");
      const form = document.getElementById("admin-add-form");
      if (form instanceof HTMLFormElement) form.reset();
      const jpyEl = document.getElementById("admin-field-jpy");
      if (jpyEl instanceof HTMLSelectElement) jpyEl.value = "300";
      const pubEl = document.getElementById("admin-field-published");
      if (pubEl instanceof HTMLInputElement) pubEl.checked = true;
      void bootstrap();
    });
  });
})();
