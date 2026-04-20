(async function () {
  "use strict";

  const STORAGE_KEY = "gacha-cart-v1";
  const PURCHASE_STATS_KEY = "gacha-purchase-stats-v1";

  const DEFAULT_JPY_TO_TWD = {
    100: 60,
    200: 90,
    300: 130,
    400: 150,
    500: 180,
    600: 200,
  };

  /** @type {Record<number, number>} */
  let JPY_TO_TWD = { ...DEFAULT_JPY_TO_TWD, ...(window.GACHA_JPY_TO_TWD || {}) };

  /** 遠端 JSON 的 jpyToTwdRate（每 1 日幣合幾元台幣）；未載入或無此欄為 null */
  let REMOTE_JPY_TO_TWD_RATE = null;

  const JPY_RATE_LS_KEY = window.GACHA_JPY_TO_TWD_RATE_STORAGE_KEY || "gacha-jpy-twd-rate-v1";

  function loadStoredJpyToTwdRate() {
    try {
      const raw = localStorage.getItem(JPY_RATE_LS_KEY);
      if (raw == null || String(raw).trim() === "") return null;
      const n = Number(String(raw).trim());
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      /* ignore */
    }
    return null;
  }

  /**
   * 有效匯率（每 1 日幣 → 台幣係數）。優先：本機 localStorage → 遠端 JSON → data.js。
   * 皆無則回傳 null，改走檔位表 GACHA_JPY_TO_TWD。
   */
  function effectiveJpyToTwdRate() {
    const ls = loadStoredJpyToTwdRate();
    if (ls != null) return ls;
    if (REMOTE_JPY_TO_TWD_RATE != null && REMOTE_JPY_TO_TWD_RATE > 0) return REMOTE_JPY_TO_TWD_RATE;
    const w = window.GACHA_JPY_TO_TWD_RATE;
    if (typeof w === "number" && Number.isFinite(w) && w > 0) return w;
    return null;
  }

  /** @type {Record<string, unknown>[]} */
  let products = Array.isArray(window.GACHA_PRODUCTS) ? [...window.GACHA_PRODUCTS] : [];

  function normalizeJpyToTwd(raw) {
    if (!raw || typeof raw !== "object") return;
    const next = { ...DEFAULT_JPY_TO_TWD, ...(window.GACHA_JPY_TO_TWD || {}) };
    Object.keys(raw).forEach((k) => {
      const nk = Number(k);
      const v = Number(raw[k]);
      if (!Number.isNaN(nk) && !Number.isNaN(v)) next[nk] = v;
    });
    JPY_TO_TWD = next;
  }

  /**
   * 將試算表／API 列資料轉成與 GACHA_PRODUCTS 相同形狀。
   * @param {Record<string, unknown>} raw
   */
  function normalizeProduct(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = String(raw.id != null ? raw.id : "").trim();
    if (!id) return null;

    const p = { ...raw, id };
    let jpy = p.jpy;
    if (typeof jpy === "string") jpy = parseInt(jpy, 10);
    jpy = Number(jpy);
    if (Number.isNaN(jpy)) jpy = 300;
    p.jpy = jpy;

    let gallery = p.gallery;
    if (typeof gallery === "string") {
      gallery = gallery
        .split(/[|\n\r]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (!Array.isArray(gallery)) gallery = [];
    p.gallery = gallery;

    let specs = p.specs;
    if (typeof specs === "string" && specs.trim()) {
      try {
        const parsed = JSON.parse(specs);
        specs = Array.isArray(parsed) ? parsed : [];
      } catch {
        specs = [];
      }
    } else if (!Array.isArray(specs)) specs = [];
    p.specs = specs;

    let labels = p.labels;
    if (typeof labels === "string") {
      labels = labels
        .split(/[,，]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (!Array.isArray(labels)) labels = [];
    p.labels = labels;

    let comingSoon = p.comingSoon;
    if (typeof comingSoon === "string") {
      const s = comingSoon.trim().toLowerCase();
      comingSoon = s === "true" || s === "1" || s === "yes" || s === "y" || s === "是";
    } else {
      comingSoon = !!comingSoon;
    }
    p.comingSoon = comingSoon;

    if (p.purchaseCount != null && typeof p.purchaseCount !== "number") {
      const n = Number(p.purchaseCount);
      p.purchaseCount = Number.isNaN(n) ? undefined : Math.max(0, Math.floor(n));
    }
    if (p.purchase_count != null && p.purchaseCount === undefined) {
      const n = Number(p.purchase_count);
      p.purchaseCount = Number.isNaN(n) ? undefined : Math.max(0, Math.floor(n));
    }
    delete p.purchase_count;

    if (p.launchNote == null && p.launch_note != null) p.launchNote = String(p.launch_note);
    delete p.launch_note;

    p.image = p.image != null ? String(p.image) : "";
    p.accent = p.accent != null ? String(p.accent) : "";
    p.name = p.name != null ? String(p.name) : "";
    p.series = p.series != null ? String(p.series) : "";
    p.capsule = p.capsule != null ? String(p.capsule) : "";
    p.description = p.description != null ? String(p.description) : "";
    if (p.launchNote != null) p.launchNote = String(p.launchNote);

    let published = p.published;
    if (published === undefined || published === null || published === "") {
      published = true;
    } else if (typeof published === "string") {
      const s = published.trim().toLowerCase();
      if (s === "false" || s === "0" || s === "no" || s === "否" || s === "下架" || s === "off") published = false;
      else if (s === "true" || s === "1" || s === "yes" || s === "是" || s === "上架" || s === "on") published = true;
      else published = true;
    } else {
      published = !!published;
    }
    p.published = published;

    return p;
  }

  const EXTRA_PRODUCTS_KEY = window.GACHA_EXTRA_PRODUCTS_KEY || "gacha-products-extra-v1";

  /**
   * 合併本機 extra 商品：同 id 覆寫 base，僅出現在 extra 的 id 則附加在清單末端。
   * @param {Record<string, unknown>[]} base
   */
  function mergeExtraProducts(base) {
    let rawExtras = [];
    try {
      const raw = localStorage.getItem(EXTRA_PRODUCTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        rawExtras = Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      return base;
    }
    const extras = rawExtras.map(normalizeProduct).filter(Boolean);
    if (extras.length === 0) return base;
    const extraById = new Map(extras.map((e) => [e.id, e]));
    const baseIds = new Set(base.map((p) => p.id));
    const out = base.map((p) => (extraById.has(p.id) ? extraById.get(p.id) : p));
    extras.forEach((e) => {
      if (!baseIds.has(e.id)) out.push(e);
    });
    return out;
  }

  const PUBLISHED_OVERRIDE_KEY = window.GACHA_PUBLISHED_STORAGE_KEY || "gacha-published-overrides-v1";

  function loadPublishedOverrides() {
    try {
      const raw = localStorage.getItem(PUBLISHED_OVERRIDE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return typeof o === "object" && o !== null ? o : null;
    } catch {
      return null;
    }
  }

  /** 前台是否顯示：資料 published 與本機覆寫（admin.html） */
  function isProductPublished(p) {
    if (!p) return false;
    const o = loadPublishedOverrides();
    if (o && Object.prototype.hasOwnProperty.call(o, p.id)) {
      return !!o[p.id];
    }
    return p.published !== false;
  }

  async function loadGachaData() {
    const url = (window.GACHA_DATA_URL || "").trim();
    if (!url) return;
    REMOTE_JPY_TO_TWD_RATE = null;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      REMOTE_JPY_TO_TWD_RATE =
        typeof data.jpyToTwdRate === "number" && Number.isFinite(data.jpyToTwdRate) && data.jpyToTwdRate > 0
          ? data.jpyToTwdRate
          : null;
      if (data.jpyToTwd && typeof data.jpyToTwd === "object") normalizeJpyToTwd(data.jpyToTwd);
      if (Array.isArray(data.products)) {
        products = data.products.map(normalizeProduct).filter(Boolean);
      }
      if (Array.isArray(data.heroBanners) && data.heroBanners.length) {
        window.HERO_BANNERS = data.heroBanners;
      }
    } catch (err) {
      console.warn("[GACHA] 遠端資料載入失敗，使用 data.js 預設。", err);
    }
  }

  /** @param {{ jpy?: number, price?: number } | null | undefined} p */
  function getProductTwd(p) {
    if (!p) return 0;
    let jpy = p.jpy;
    if (typeof jpy === "string") jpy = parseInt(jpy, 10);
    jpy = Number(jpy);
    const rate = effectiveJpyToTwdRate();
    if (rate != null && Number.isFinite(jpy) && !Number.isNaN(jpy)) {
      return Math.max(0, Math.round(jpy * rate));
    }
    if (!Number.isNaN(jpy) && JPY_TO_TWD[jpy] !== undefined) {
      const mult =
        typeof window.GACHA_TWD_TIER_MULTIPLIER === "number" &&
        Number.isFinite(window.GACHA_TWD_TIER_MULTIPLIER) &&
        window.GACHA_TWD_TIER_MULTIPLIER > 0
          ? window.GACHA_TWD_TIER_MULTIPLIER
          : 1;
      return Math.max(0, Math.round(JPY_TO_TWD[jpy] * mult));
    }
    if (typeof p.price === "number") return p.price;
    return 0;
  }

  const LABEL_DEF = {
    hot: { text: "熱銷", cls: "product-label--hot" },
    new: { text: "新品", cls: "product-label--new" },
    recommend: { text: "推薦", cls: "product-label--recommend" },
  };
  const LABEL_ORDER = ["hot", "new", "recommend"];

  /** @param {string[]|undefined} arr */
  function normalizeLabels(arr) {
    if (!Array.isArray(arr)) return [];
    const set = new Set(arr.filter((k) => LABEL_DEF[k]));
    return LABEL_ORDER.filter((k) => set.has(k)).map((k) => ({ key: k, text: LABEL_DEF[k].text, cls: LABEL_DEF[k].cls }));
  }

  function cardLabelsRowHtml(p) {
    const labels = normalizeLabels(p.labels);
    if (!labels.length) {
      return `<div class="product-label-row"><span class="product-badge product-badge--type" aria-hidden="true">扭蛋</span></div>`;
    }
    const pills = labels
      .map(
        (l) =>
          `<span class="product-label ${l.cls}">${escapeHtml(l.text)}</span>`
      )
      .join("");
    return `<div class="product-label-row">${pills}<span class="product-badge product-badge--type product-badge--ghost" aria-hidden="true">扭蛋</span></div>`;
  }

  function modalLabelsHtml(p) {
    const labels = normalizeLabels(p.labels);
    if (!labels.length) return "";
    return labels
      .map(
        (l) =>
          `<span class="product-label product-label--lg ${l.cls}">${escapeHtml(l.text)}</span>`
      )
      .join("");
  }

  /** @type {Record<string, number>} */
  let cart = loadCart();

  const els = {
    grid: document.getElementById("products-grid"),
    pagination: document.getElementById("products-pagination"),
    productsSection: document.getElementById("products-section"),
    search: document.getElementById("search"),
    priceFilters: document.getElementById("price-filters"),
    seriesFilters: document.getElementById("series-filters"),
    spotlightFilters: document.getElementById("spotlight-filters"),
    btnHowto: document.getElementById("btn-howto"),
    howtoPanel: document.getElementById("howto-panel"),
    btnCart: document.getElementById("btn-cart"),
    cartPanel: document.getElementById("cart-panel"),
    cartBackdrop: document.getElementById("cart-backdrop"),
    btnCloseCart: document.getElementById("btn-close-cart"),
    cartList: document.getElementById("cart-list"),
    cartEmpty: document.getElementById("cart-empty"),
    cartCount: document.getElementById("cart-count"),
    cartSubtotal: document.getElementById("cart-subtotal"),
    note: document.getElementById("note"),
    btnCopy: document.getElementById("btn-copy"),
    copyFeedback: document.getElementById("copy-feedback"),
    heroTrack: document.getElementById("hero-track"),
    heroViewport: document.getElementById("hero-viewport"),
    heroDots: document.getElementById("hero-dots"),
    heroPrev: document.getElementById("hero-prev"),
    heroNext: document.getElementById("hero-next"),
    heroInner: document.querySelector(".hero-inner"),
    productModal: document.getElementById("product-modal"),
    productModalBackdrop: document.getElementById("product-modal-backdrop"),
    productModalClose: document.getElementById("product-modal-close"),
    productModalFigure: document.getElementById("product-modal-figure"),
    productModalThumbs: document.getElementById("product-modal-thumbs"),
    productModalThumbsWrap: document.getElementById("product-modal-thumbs-wrap"),
    productModalSeries: document.getElementById("product-modal-series"),
    productModalLabels: document.getElementById("product-modal-labels"),
    productModalSoon: document.getElementById("product-modal-soon"),
    productModalTitle: document.getElementById("product-modal-title"),
    productModalPrice: document.getElementById("product-modal-price"),
    productModalCapsule: document.getElementById("product-modal-capsule"),
    productModalDesc: document.getElementById("product-modal-desc"),
    productModalSpecs: document.getElementById("product-modal-specs"),
    productModalAdd: document.getElementById("product-modal-add"),
    productModalPurchase: document.getElementById("product-modal-purchase"),
  };

  let modalSlides = [];
  let modalSlideIndex = 0;
  let modalProductId = null;

  let activeSeries = "all";
  /** 篩選：機台日幣檔位，'all' 或 100～600 */
  let activePriceRange = "all";
  /** 首屏標籤：未選＝全部；new／hot／recommend／coming_soon(待上市) */
  /** @type {'all'|'new'|'hot'|'recommend'|'coming_soon'} */
  let activeSpotlight = "all";
  let searchQuery = "";
  let currentPage = 1;
  const PRODUCTS_PER_PAGE = 14;

  function loadCart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }

  function loadPurchaseStats() {
    try {
      const raw = localStorage.getItem(PURCHASE_STATS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  function savePurchaseStats(stats) {
    try {
      localStorage.setItem(PURCHASE_STATS_KEY, JSON.stringify(stats));
    } catch {
      /* ignore */
    }
  }

  /** 賣家填寫基數 + 本機累計（每次加入購物車數量） */
  function getTotalPurchaseCount(p) {
    if (!p) return 0;
    const base =
      typeof p.purchaseCount === "number" && !Number.isNaN(p.purchaseCount)
        ? Math.max(0, Math.floor(p.purchaseCount))
        : 0;
    const stats = loadPurchaseStats();
    const local = typeof stats[p.id] === "number" && !Number.isNaN(stats[p.id]) ? Math.max(0, Math.floor(stats[p.id])) : 0;
    return base + local;
  }

  function recordPurchaseRegistration(id, qty) {
    if (!id || qty <= 0) return;
    const stats = loadPurchaseStats();
    stats[id] = (stats[id] || 0) + qty;
    savePurchaseStats(stats);
  }

  function formatPurchaseStatLine(n) {
    if (n <= 0) return "";
    const formatted = n.toLocaleString("zh-Hant");
    return `購買登記 <strong>${formatted}</strong> 次`;
  }

  function purchaseStatRowHtml(p) {
    if (p.comingSoon) return "";
    const n = getTotalPurchaseCount(p);
    if (n <= 0) return "";
    return `<p class="product-purchase-stat" aria-label="購買登記 ${n} 次">${formatPurchaseStatLine(n)}</p>`;
  }

  function updateProductModalPurchaseStat() {
    if (!els.productModalPurchase) return;
    if (!modalProductId) {
      els.productModalPurchase.hidden = true;
      els.productModalPurchase.innerHTML = "";
      return;
    }
    const p = getProduct(modalProductId);
    if (p && p.comingSoon) {
      els.productModalPurchase.hidden = true;
      els.productModalPurchase.innerHTML = "";
      return;
    }
    const n = getTotalPurchaseCount(p);
    if (n <= 0) {
      els.productModalPurchase.hidden = true;
      els.productModalPurchase.innerHTML = "";
      return;
    }
    els.productModalPurchase.hidden = false;
    els.productModalPurchase.innerHTML = formatPurchaseStatLine(n);
  }

  function getProduct(id) {
    return products.find((p) => p.id === id);
  }

  function getSeriesList() {
    const set = new Set(
      products.filter((p) => isProductPublished(p)).map((p) => p.series)
    );
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hant"))];
  }

  function matchesActivePriceTier(p) {
    if (activePriceRange === "all") return true;
    return Number(p.jpy) === Number(activePriceRange);
  }

  /** @param {'new'|'hot'|'recommend'} key */
  function productHasSpotlightLabel(p, key) {
    const arr = Array.isArray(p.labels) ? p.labels : [];
    return arr.includes(key);
  }

  function matchesSpotlight(p) {
    if (activeSpotlight === "all") return true;
    if (activeSpotlight === "coming_soon") return !!p.comingSoon;
    return productHasSpotlightLabel(p, activeSpotlight);
  }

  function filterProducts() {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (!isProductPublished(p)) return false;
      if (!matchesSpotlight(p)) return false;
      if (activeSeries !== "all" && p.series !== activeSeries) return false;
      if (!matchesActivePriceTier(p)) return false;
      if (!q) return true;
      const hay = `${p.name} ${p.series} ${p.capsule || ""} ${p.description || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function pruneCartDisallowed() {
    let changed = false;
    Object.keys(cart).forEach((id) => {
      const p = getProduct(id);
      if (p && (p.comingSoon || !isProductPublished(p))) {
        delete cart[id];
        changed = true;
      }
    });
    if (changed) saveCart();
  }

  function buildGallerySlides(p) {
    const accent = p.accent || "linear-gradient(145deg, #fce7f3, #fbcfe8)";
    const slides = [];
    if (p.image) {
      slides.push({ kind: "image", src: p.image, alt: p.name });
    } else {
      slides.push({ kind: "gradient", gradient: accent, caption: "商品示意" });
    }
    const gal = Array.isArray(p.gallery) ? p.gallery : [];
    gal.forEach((src) => {
      if (src) slides.push({ kind: "image", src, alt: p.name });
    });
    if (slides.length < 2) {
      slides.push({ kind: "gradient", gradient: accent, caption: "更多角度參考" });
    }
    return slides.slice(0, 8);
  }

  function getDescription(p) {
    if (p.description && String(p.description).trim()) return String(p.description).trim();
    return `${p.name}（${p.series}）。${p.capsule || ""}。現場扭蛋隨機出貨，實際款式以連線當下為準；可於下單備註許願，由小幫手協助留意。`;
  }

  function getSpecs(p) {
    if (Array.isArray(p.specs) && p.specs.length) return p.specs;
    return [
      {
        label: "參考尺寸",
        value: "內容物尺寸因款式不同略有差異，實際規格請以原廠為準。",
      },
      { label: "材質", value: "PVC／ABS 等（依原廠標示）" },
      { label: "產地", value: "日本" },
    ];
  }

  function showModalSlide(i) {
    const n = modalSlides.length;
    if (n === 0 || !els.productModalFigure) return;
    modalSlideIndex = Math.max(0, Math.min(i, n - 1));
    const s = modalSlides[modalSlideIndex];
    if (s.kind === "image") {
      els.productModalFigure.innerHTML = `<img src="${escapeAttr(s.src)}" alt="${escapeAttr(
        s.alt || ""
      )}" />`;
    } else {
      const cap = escapeHtml(s.caption || "示意");
      els.productModalFigure.innerHTML = `<div class="product-modal-grad" style="background:${escapeAttr(
        s.gradient || ""
      )}"><span class="product-modal-grad-emoji" aria-hidden="true">🎲</span><span class="product-modal-grad-cap">${cap}</span></div>`;
    }
    if (els.productModalThumbs) {
      els.productModalThumbs.querySelectorAll(".product-modal-thumb").forEach((btn, idx) => {
        btn.setAttribute("aria-selected", idx === modalSlideIndex ? "true" : "false");
      });
    }
  }

  function renderModalThumbs() {
    if (!els.productModalThumbs) return;
    els.productModalThumbs.innerHTML = modalSlides
      .map((s, i) => {
        const selected = i === modalSlideIndex;
        if (s.kind === "image") {
          return `<button type="button" class="product-modal-thumb" data-slide="${i}" aria-selected="${selected}" aria-label="第 ${
            i + 1
          } 張圖"><img src="${escapeAttr(s.src)}" alt="" loading="lazy" /></button>`;
        }
        return `<button type="button" class="product-modal-thumb" data-slide="${i}" aria-selected="${selected}" aria-label="第 ${
          i + 1
        } 張示意"><div class="product-modal-thumb-grad" style="background:${escapeAttr(
          s.gradient || ""
        )}"></div></button>`;
      })
      .join("");

    els.productModalThumbs.querySelectorAll(".product-modal-thumb").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-slide") || "0", 10);
        showModalSlide(idx);
      });
    });
  }

  function openProductModal(id) {
    const p = getProduct(id);
    if (!p || !els.productModal) return;
    modalProductId = id;
    modalSlides = buildGallerySlides(p);
    modalSlideIndex = 0;

    if (els.productModalSeries) els.productModalSeries.textContent = p.series;
    if (els.productModalLabels) {
      const lab = modalLabelsHtml(p);
      if (lab) {
        els.productModalLabels.innerHTML = lab;
        els.productModalLabels.hidden = false;
      } else {
        els.productModalLabels.innerHTML = "";
        els.productModalLabels.hidden = true;
      }
    }
    if (els.productModalTitle) els.productModalTitle.textContent = p.name;
    if (els.productModalPrice) {
      const twd = getProductTwd(p);
      const jpy = p.jpy != null ? p.jpy : "—";
      els.productModalPrice.textContent = p.comingSoon
        ? `機台 ¥${jpy} → 參考 NT$ ${twd}／顆（待上市，實際以開賣為準）`
        : `機台 ¥${jpy} → NT$ ${twd}／顆（連線代購參考價）`;
    }
    if (els.productModalSoon) {
      if (p.comingSoon) {
        els.productModalSoon.hidden = false;
        const note = p.launchNote ? escapeHtml(p.launchNote) : "開賣後將開放加入購物車與連線代購。";
        els.productModalSoon.innerHTML = `<span class="soon-badge">待上市</span><span class="soon-note">${note}</span>`;
      } else {
        els.productModalSoon.hidden = true;
        els.productModalSoon.innerHTML = "";
      }
    }
    if (els.productModalCapsule) els.productModalCapsule.textContent = p.capsule || "";
    updateProductModalPurchaseStat();
    if (els.productModalDesc) els.productModalDesc.textContent = getDescription(p);

    const tbody = els.productModalSpecs && els.productModalSpecs.querySelector("tbody");
    if (tbody) {
      tbody.innerHTML = getSpecs(p)
        .map(
          (row) =>
            `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`
        )
        .join("");
    }

    renderModalThumbs();
    showModalSlide(0);

    if (els.productModalThumbsWrap) {
      els.productModalThumbsWrap.hidden = modalSlides.length <= 1;
    }

    if (els.productModalAdd) {
      els.productModalAdd.disabled = !!p.comingSoon;
      els.productModalAdd.textContent = p.comingSoon ? "待上市，尚無法加入" : "加入購物車";
    }

    els.productModal.hidden = false;
    document.body.classList.add("modal-open");
    if (els.productModalClose) els.productModalClose.focus();
  }

  function closeProductModal() {
    if (!els.productModal) return;
    els.productModal.hidden = true;
    document.body.classList.remove("modal-open");
    modalProductId = null;
  }

  function renderFilters() {
    const series = getSeriesList();
    els.seriesFilters.innerHTML = series
      .map((s) => {
        const label = s === "all" ? "全部" : s;
        const pressed = activeSeries === s;
        return `<button type="button" class="filter-chip" data-series="${escapeAttr(s)}" aria-pressed="${pressed}">${escapeHtml(
          label
        )}</button>`;
      })
      .join("");

    els.seriesFilters.querySelectorAll(".filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeSeries = btn.getAttribute("data-series") || "all";
        els.seriesFilters.querySelectorAll(".filter-chip").forEach((b) => {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        currentPage = 1;
        renderProducts();
      });
    });
  }

  function renderSpotlightFilters() {
    if (!els.spotlightFilters) return;
    const opts = [
      { id: "new", label: "⭐NEW新品" },
      { id: "hot", label: "🔥HOT熱賣" },
      { id: "recommend", label: "👑限定商品" },
      { id: "coming_soon", label: "✨待上市" },
    ];
    els.spotlightFilters.innerHTML = opts
      .map((o) => {
        const pressed = activeSpotlight === o.id;
        return `<button type="button" class="filter-chip filter-chip--spotlight" data-spotlight="${escapeAttr(
          o.id
        )}" aria-pressed="${pressed}" aria-label="${escapeAttr(o.label)}"><span class="spotlight-chip__label">${escapeHtml(
          o.label
        )}</span></button>`;
      })
      .join("");

    els.spotlightFilters.querySelectorAll("[data-spotlight]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-spotlight") || "";
        const valid = ["new", "hot", "recommend", "coming_soon"];
        const next = /** @type {'new'|'hot'|'recommend'|'coming_soon'} */ (
          valid.includes(id) ? id : "new"
        );
        if (activeSpotlight === next) {
          activeSpotlight = "all";
          els.spotlightFilters.querySelectorAll("[data-spotlight]").forEach((b) => {
            b.setAttribute("aria-pressed", "false");
          });
        } else {
          activeSpotlight = next;
          els.spotlightFilters.querySelectorAll("[data-spotlight]").forEach((b) => {
            b.setAttribute("aria-pressed", b === btn ? "true" : "false");
          });
        }
        currentPage = 1;
        renderProducts();
      });
    });
  }

  function renderPriceFilters() {
    if (!els.priceFilters) return;
    const opts = [
      { id: "all", label: "全部" },
      { id: "100", label: "¥100" },
      { id: "200", label: "¥200" },
      { id: "300", label: "¥300" },
      { id: "400", label: "¥400" },
      { id: "500", label: "¥500" },
      { id: "600", label: "¥600" },
    ];
    els.priceFilters.innerHTML = opts
      .map(
        (o) =>
          `<button type="button" class="filter-chip filter-chip--price" data-price-range="${escapeAttr(
            o.id
          )}" aria-pressed="${activePriceRange === o.id}">${escapeHtml(o.label)}</button>`
      )
      .join("");

    els.priceFilters.querySelectorAll("[data-price-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activePriceRange = btn.getAttribute("data-price-range") || "all";
        els.priceFilters.querySelectorAll("[data-price-range]").forEach((b) => {
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        currentPage = 1;
        renderProducts();
      });
    });
  }

  function renderPagination(totalPages) {
    if (!els.pagination) return;
    if (totalPages <= 1) {
      els.pagination.hidden = true;
      els.pagination.innerHTML = "";
      return;
    }
    els.pagination.hidden = false;
    const prevDisabled = currentPage <= 1;
    const nextDisabled = currentPage >= totalPages;
    els.pagination.innerHTML = `
      <button type="button" class="page-btn page-btn--prev" aria-label="上一頁" ${prevDisabled ? "disabled" : ""}>‹</button>
      <p class="page-indicator" aria-live="polite">
        第 <strong>${currentPage}</strong> ／ <span class="page-total-num">${totalPages}</span> 頁
      </p>
      <button type="button" class="page-btn page-btn--next" aria-label="下一頁" ${nextDisabled ? "disabled" : ""}>›</button>
    `;

    const prev = els.pagination.querySelector(".page-btn--prev");
    const next = els.pagination.querySelector(".page-btn--next");
    if (prev && !prevDisabled) {
      prev.addEventListener("click", () => {
        if (currentPage > 1) {
          currentPage -= 1;
          renderProducts();
          scrollProductsIntoView();
        }
      });
    }
    if (next && !nextDisabled) {
      next.addEventListener("click", () => {
        if (currentPage < totalPages) {
          currentPage += 1;
          renderProducts();
          scrollProductsIntoView();
        }
      });
    }
  }

  function scrollProductsIntoView() {
    const el = els.productsSection || els.grid;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function renderProductCard(p) {
    const qty = cart[p.id] || 0;
    const soon = !!p.comingSoon;
    const img = p.image ? `<img src="${escapeAttr(p.image)}" alt="" loading="lazy" />` : "";
    const placeholderClass = p.image ? "" : " placeholder";
    const bg = p.accent || "linear-gradient(145deg, #333 0%, #111 100%)";
    const visualSoon = soon ? " product-visual--soon" : "";
    const cardSoon = soon ? " product-card--soon" : "";
    const twd = getProductTwd(p);
    const jpy = p.jpy != null ? p.jpy : "—";
    const priceLine = soon
      ? `<div class="product-price product-price--soon"><span class="product-price-jpy">¥${jpy}</span><span class="product-price-sep" aria-hidden="true">→</span><span class="product-price-twd">NT$ ${twd}</span><small>／顆 · 待上市</small></div>`
      : `<div class="product-price"><span class="product-price-jpy">¥${jpy}</span><span class="product-price-sep" aria-hidden="true">→</span><span class="product-price-twd">NT$ ${twd}</span><small>／顆</small></div>`;
    const btnLine = soon
      ? `<button type="button" class="btn btn-add" data-add="${escapeAttr(
          p.id
        )}" disabled title="待上市，開賣後開放">待上市</button>`
      : `<button type="button" class="btn btn-add" data-add="${escapeAttr(p.id)}">${
          qty > 0 ? `再來一顆 (+${qty})` : "加入購物車"
        }</button>`;

    return `
        <article class="product-card${cardSoon}" data-id="${escapeAttr(
          p.id
        )}" tabindex="0" role="button" data-soon="${soon ? "1" : "0"}" aria-label="查看 ${escapeAttr(
          p.name
        )} 詳情">
          <div class="product-visual${visualSoon}${placeholderClass}" style="background:${bg}">
            ${cardLabelsRowHtml(p)}
            ${soon ? '<span class="product-soon-ribbon" aria-hidden="true">待上市</span>' : ""}
            ${img}
          </div>
          <div class="product-body">
            <p class="product-series">${escapeHtml(p.series)}</p>
            <h3 class="product-name">${escapeHtml(p.name)}</h3>
            <p class="product-meta">${escapeHtml(p.capsule || "")}</p>
            ${purchaseStatRowHtml(p)}
            <div class="product-row">
              ${priceLine}
              ${btnLine}
            </div>
          </div>
        </article>`;
  }

  function productsSectionHead(title, hint, soonVariant) {
    const extra = soonVariant ? " products-section-head--soon" : "";
    const h = escapeHtml(title);
    const sub = hint ? `<p class="products-section-hint">${escapeHtml(hint)}</p>` : "";
    return `<div class="products-section-head${extra}" role="presentation">
      <h3 class="products-section-title">${h}</h3>
      ${sub}
    </div>`;
  }

  function renderProducts() {
    pruneCartDisallowed();
    const list = filterProducts();
    if (list.length === 0) {
      els.grid.innerHTML =
        '<p class="products-empty-msg">找不到符合的商品，試試其他關鍵字、系列或價格區間。</p>';
      if (els.pagination) {
        els.pagination.hidden = true;
        els.pagination.innerHTML = "";
      }
      return;
    }

    const onSale = list.filter((p) => !p.comingSoon);
    const coming = list.filter((p) => p.comingSoon);
    const useSplit = onSale.length > 0 && coming.length > 0;
    const ordered = useSplit ? [...onSale, ...coming] : list;

    const totalPages = Math.max(1, Math.ceil(ordered.length / PRODUCTS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * PRODUCTS_PER_PAGE;
    const end = Math.min(start + PRODUCTS_PER_PAGE, ordered.length);

    let html = "";
    for (let g = start; g < end; g++) {
      const p = ordered[g];
      if (useSplit) {
        if (g === 0 && onSale.length && !ordered[0].comingSoon) {
          html += productsSectionHead(
            "可連線選購",
            "以下可加入購物車並複製訂單至 LINE。"
          );
        }
        if (p.comingSoon && (g === 0 || !ordered[g - 1].comingSoon)) {
          html += productsSectionHead(
            "即將開賣 · 待上市",
            "僅供預覽參考，開賣後會再開放代購；可先記下款式向官方 LINE 詢問。",
            true
          );
        }
      }
      html += renderProductCard(p);
    }

    els.grid.innerHTML = html;

    els.grid.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        const id = btn.getAttribute("data-add");
        if (!id) return;
        addToCart(id);
      });
    });

    renderPagination(totalPages);
  }

  function addToCart(id) {
    const p = getProduct(id);
    if (!p || p.comingSoon || !isProductPublished(p)) return;
    cart[id] = (cart[id] || 0) + 1;
    recordPurchaseRegistration(id, 1);
    saveCart();
    renderProducts();
    updateCartUI();
    setCopyFeedback("", false);
    if (modalProductId === id) updateProductModalPurchaseStat();
  }

  function setQty(id, delta) {
    const p = getProduct(id);
    if (!p || p.comingSoon || !isProductPublished(p)) return;
    const next = (cart[id] || 0) + delta;
    if (next <= 0) {
      delete cart[id];
    } else {
      cart[id] = next;
    }
    if (delta > 0) recordPurchaseRegistration(id, delta);
    saveCart();
    renderProducts();
    renderCartList();
    updateCartUI();
    setCopyFeedback("", false);
    if (modalProductId === id) updateProductModalPurchaseStat();
  }

  function cartLineItems() {
    return Object.entries(cart)
      .filter(([, n]) => n > 0)
      .map(([id, qty]) => {
        const p = getProduct(id);
        return p && !p.comingSoon && isProductPublished(p) ? { ...p, qty } : null;
      })
      .filter(Boolean);
  }

  function subtotal(items) {
    return items.reduce((sum, i) => sum + getProductTwd(i) * i.qty, 0);
  }

  function updateCartUI() {
    const items = cartLineItems();
    const count = items.reduce((s, i) => s + i.qty, 0);
    els.cartCount.hidden = count === 0;
    els.cartCount.textContent = String(count);
    els.cartSubtotal.textContent = `NT$ ${subtotal(items).toLocaleString("zh-Hant")}`;
    els.btnCopy.disabled = items.length === 0;
    els.cartEmpty.style.display = items.length === 0 ? "block" : "none";
  }

  function renderCartList() {
    const items = cartLineItems();
    els.cartList.innerHTML = items
      .map((i) => {
        const unit = getProductTwd(i);
        const line = unit * i.qty;
        const jpy = i.jpy != null ? i.jpy : "—";
        return `
        <li class="cart-item">
          <div>
            <div class="cart-item-title">${escapeHtml(i.name)}</div>
            <div class="cart-item-meta">${escapeHtml(i.series)} · ¥${jpy} → NT$ ${unit} / 顆</div>
          </div>
          <div class="cart-item-controls">
            <button type="button" class="qty-btn" data-qty="${escapeAttr(i.id)}" data-delta="-1" aria-label="減少">−</button>
            <span class="qty-val">${i.qty}</span>
            <button type="button" class="qty-btn" data-qty="${escapeAttr(i.id)}" data-delta="1" aria-label="增加">+</button>
          </div>
          <div class="cart-item-price">小計 NT$ ${line.toLocaleString("zh-Hant")}</div>
        </li>`;
      })
      .join("");

    els.cartList.querySelectorAll("[data-qty]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-qty");
        const d = parseInt(btn.getAttribute("data-delta") || "0", 10);
        if (id && d) setQty(id, d);
      });
    });

    updateCartUI();
  }

  function buildOrderText() {
    const items = cartLineItems();
    if (items.length === 0) return "";
    const total = subtotal(items);
    const note = (els.note.value || "").trim();
    const lines = items.map((i, idx) => {
      const unit = getProductTwd(i);
      const jpy = i.jpy != null ? i.jpy : "—";
      const lineTwd = unit * i.qty;
      return `${idx + 1}. ${i.name} × ${i.qty}（${i.series}）— 機台 ¥${jpy}／NT$ ${unit} × ${i.qty} = NT$ ${lineTwd.toLocaleString("zh-Hant")}`;
    });
    const header = "【東京扭蛋代購｜連線訂單】";
    const body = lines.join("\n");
    const footer = `—\n參考小計：NT$ ${total.toLocaleString("zh-Hant")}（實際金額以官方回覆為準）`;
    const noteBlock = note ? `\n備註：\n${note}` : "";
    return `${header}\n${body}\n${footer}${noteBlock}`;
  }

  async function copyOrder() {
    const text = buildOrderText();
    if (!text) {
      setCopyFeedback("購物車是空的。", true);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback("已複製！請到官方 LINE 對話框貼上送出。", false);
    } catch {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      setCopyFeedback("已複製！請到官方 LINE 對話框貼上送出。", false);
    } catch {
      setCopyFeedback("複製失敗，請手動選取訂單文字。", true);
    }
    document.body.removeChild(ta);
  }

  function setCopyFeedback(msg, isError) {
    els.copyFeedback.textContent = msg;
    els.copyFeedback.classList.toggle("error", !!isError);
  }

  function openCart(open) {
    els.cartPanel.hidden = !open;
    els.btnCart.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      renderCartList();
      els.btnCloseCart.focus();
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

  /* Hero carousel */
  const HERO_DECOS = ["🎀", "⭐", "🌸", "🍡", "✨"];
  let heroIndex = 0;
  let heroTimer = null;
  const heroReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function renderHero() {
    if (!els.heroTrack) return;
    const raw = window.HERO_BANNERS;
    const banners = Array.isArray(raw) && raw.length > 0 ? raw : [{ title: "東京扭蛋連線", sub: "明亮展示 · 一鍵複製下單", gradient: "linear-gradient(118deg, #fff5f7 0%, #fce7f3 100%)", tag: "TOP" }];

    els.heroTrack.innerHTML = banners
      .map((b, i) => {
        const g = b.gradient || "#fce7f3";
        return `
        <div class="hero-slide" role="listitem" style="background:${escapeAttr(g)}">
          <span class="hero-tag">${escapeHtml(b.tag || "PICK UP")}</span>
          <h2 class="hero-title">${escapeHtml(b.title)}</h2>
          <p class="hero-sub">${escapeHtml(b.sub || "")}</p>
          <span class="hero-deco" aria-hidden="true">${HERO_DECOS[i % HERO_DECOS.length]}</span>
        </div>`;
      })
      .join("");

    if (els.heroDots) {
      els.heroDots.innerHTML = banners
        .map(
          (_, i) =>
            `<button type="button" class="hero-dot" role="tab" aria-selected="${i === 0}" aria-label="第 ${i + 1} 張"></button>`
        )
        .join("");
    }

    if (els.heroViewport) {
      els.heroViewport.style.setProperty("--hero-slides", String(banners.length));
    }

    const single = banners.length <= 1;
    if (els.heroPrev) els.heroPrev.hidden = single;
    if (els.heroNext) els.heroNext.hidden = single;
    if (els.heroDots) els.heroDots.hidden = single;

    if (heroReducedMotion && els.heroTrack) {
      els.heroTrack.style.transition = "none";
    }
  }

  function getHeroSlideCount() {
    if (els.heroTrack && els.heroTrack.children.length > 0) return els.heroTrack.children.length;
    const len = window.HERO_BANNERS && window.HERO_BANNERS.length;
    return len > 0 ? len : 1;
  }

  function heroGoTo(i, bannersLen) {
    const n = bannersLen != null ? bannersLen : getHeroSlideCount();
    heroIndex = ((i % n) + n) % n;

    if (els.heroTrack && n > 0) {
      const pct = (heroIndex * 100) / n;
      els.heroTrack.style.transform = `translateX(-${pct}%)`;
    }
    if (els.heroDots) {
      els.heroDots.querySelectorAll(".hero-dot").forEach((dot, idx) => {
        dot.setAttribute("aria-selected", idx === heroIndex ? "true" : "false");
      });
    }
  }

  function heroStartAutoplay() {
    heroStopAutoplay();
    if (heroReducedMotion) return;
    const n = getHeroSlideCount();
    if (n <= 1) return;
    heroTimer = window.setInterval(() => {
      heroGoTo(heroIndex + 1, n);
    }, 5200);
  }

  function heroStopAutoplay() {
    if (heroTimer) {
      clearInterval(heroTimer);
      heroTimer = null;
    }
  }

  function initHeroCarousel() {
    renderHero();
    const n = getHeroSlideCount();
    heroIndex = 0;
    heroGoTo(0, n);

    els.heroPrev &&
      els.heroPrev.addEventListener("click", () => {
        heroGoTo(heroIndex - 1, n);
        heroStartAutoplay();
      });
    els.heroNext &&
      els.heroNext.addEventListener("click", () => {
        heroGoTo(heroIndex + 1, n);
        heroStartAutoplay();
      });

    if (els.heroDots) {
      els.heroDots.addEventListener("click", (e) => {
        const btn = e.target.closest(".hero-dot");
        if (!btn) return;
        const idx = Array.prototype.indexOf.call(els.heroDots.querySelectorAll(".hero-dot"), btn);
        if (idx >= 0) {
          heroGoTo(idx, n);
          heroStartAutoplay();
        }
      });
    }

    if (els.heroInner) {
      els.heroInner.addEventListener("mouseenter", heroStopAutoplay);
      els.heroInner.addEventListener("mouseleave", heroStartAutoplay);
      els.heroInner.addEventListener("focusin", heroStopAutoplay);
      els.heroInner.addEventListener("focusout", heroStartAutoplay);
    }

    heroStartAutoplay();
  }

  /* Events */
  els.search.addEventListener("input", () => {
    searchQuery = els.search.value;
    currentPage = 1;
    renderProducts();
  });

  els.btnHowto.addEventListener("click", () => {
    const open = els.howtoPanel.hidden;
    els.howtoPanel.hidden = !open;
    els.btnHowto.setAttribute("aria-expanded", open ? "true" : "false");
  });

  els.btnCart.addEventListener("click", () => openCart(true));
  els.cartBackdrop.addEventListener("click", () => openCart(false));
  els.btnCloseCart.addEventListener("click", () => openCart(false));

  els.grid.addEventListener("click", (e) => {
    if (e.target.closest(".btn-add")) return;
    const card = e.target.closest(".product-card");
    if (!card || !els.grid.contains(card)) return;
    const id = card.getAttribute("data-id");
    if (id) openProductModal(id);
  });

  els.grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest(".btn-add")) return;
    const card = e.target.closest(".product-card");
    if (!card || !els.grid.contains(card)) return;
    e.preventDefault();
    const id = card.getAttribute("data-id");
    if (id) openProductModal(id);
  });

  if (els.productModalBackdrop) {
    els.productModalBackdrop.addEventListener("click", () => closeProductModal());
  }
  if (els.productModalClose) {
    els.productModalClose.addEventListener("click", () => closeProductModal());
  }
  if (els.productModalAdd) {
    els.productModalAdd.addEventListener("click", () => {
      if (!modalProductId) return;
      addToCart(modalProductId);
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (els.productModal && !els.productModal.hidden) {
      closeProductModal();
      return;
    }
    if (!els.cartPanel.hidden) openCart(false);
  });

  els.btnCopy.addEventListener("click", () => copyOrder());

  /* Init */
  await loadGachaData();
  products = products.map(normalizeProduct).filter(Boolean);
  products = mergeExtraProducts(products);
  initHeroCarousel();
  pruneCartDisallowed();
  renderSpotlightFilters();
  renderPriceFilters();
  renderFilters();
  renderProducts();
  updateCartUI();
})();
