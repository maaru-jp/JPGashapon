/**
 * 首頁大型 Banner：連線前可改文案與配色（gradient）。
 * 亦可將 image 設為圖片網址，會以背景圖顯示（需搭配 object 區域）。
 */
window.HERO_BANNERS = [
  {
    title: "東京連線｜扭蛋新鮮貨",
    sub: "本週連線限定 · 即時更新庫存",
    gradient: "linear-gradient(118deg, #fff5f7 0%, #fce7f3 35%, #fbcfe8 70%, #fda4af 100%)",
    tag: "NEW",
  },
  {
    title: "人氣 IP 一次收齊",
    sub: "吉伊卡哇 · 寶可夢 · 三麗鷗 熱賣中",
    gradient: "linear-gradient(118deg, #ecfeff 0%, #cffafe 40%, #a5f3fc 85%, #67e8f9 100%)",
    tag: "HOT",
  },
  {
    title: "選好商品 · 一鍵複製下單",
    sub: "貼到官方 LINE，小幫手與您確認金額與取貨",
    gradient: "linear-gradient(118deg, #fffbeb 0%, #fef3c7 38%, #fde68a 78%, #fcd34d 100%)",
    tag: "HOW",
  },
];

/**
 * 公開資料 JSON 網址（Google Apps Script Web App 部署後的網址等）。
 * 留空則完全使用本檔 GACHA_PRODUCTS／GACHA_JPY_TO_TWD／HERO_BANNERS。
 * 若 JSON 含 jpyToTwdRate（正數），前台以「日幣 × 匯率」計台幣；否則仍可用 jpyToTwd 檔位表。
 * @example "https://script.google.com/macros/s/XXXX/exec"
 * 後台勾選「同步寫入試算表」時，亦用此網址以 POST 新增列（需指令碼屬性 ADMIN_TOKEN）。
 */
window.GACHA_DATA_URL = "";

/**
 * Cloudinary：後台選圖時改為上傳雲端並寫入圖片網址（需 Unsigned upload preset）。
 * 主控台 → Settings → Upload → Upload presets → Add upload preset → Signing mode: Unsigned，
 * 並在 preset 內設定 Asset folder 或允許 API 傳入 folder（依你的 Cloudinary 設定）。
 * @example cloudName: "abcd1234"（Dashboard 網址 / 帳戶名稱）
 * @example uploadPreset: "gacha_unsigned"
 * @example folder: "扭蛋連線/2025" 或 "gacha/products"（選填；與 preset 權限需一致）
 */
window.GACHA_CLOUDINARY_CLOUD_NAME = "491e7edae6dd1f07efb907fed72a9d";
window.GACHA_CLOUDINARY_UPLOAD_PRESET = "icn59m22";
window.GACHA_CLOUDINARY_FOLDER = "icn59m22";

/**
 * 為 true 時，後台「加入商品」會預設勾選「同步寫入試算表」（仍須填 ADMIN_TOKEN）。
 */
window.GACHA_AUTO_SYNC_SHEET = false;

/**
 * 本機「上架／下架」覆寫的 localStorage 鍵（由 admin.html 寫入）。
 * 正式環境請以試算表或 data.js 的 published 為準；若不需本機覆寫，勿開啟後台頁或按後台「清除覆寫」。
 */
window.GACHA_PUBLISHED_STORAGE_KEY = "gacha-published-overrides-v1";

/**
 * 本機「新增／覆寫商品」的 localStorage 鍵（JSON 陣列，欄位與 GACHA_PRODUCTS 相同）。
 * 後台「新增商品」會寫入此鍵；首頁載入時會與試算表／data.js 合併（同 id 以本機為準）。
 */
window.GACHA_EXTRA_PRODUCTS_KEY = "gacha-products-extra-v1";

/**
 * 連線扭蛋：日本機台價（日幣／顆）→ 台幣代購參考價（每顆）
 * 修改對照時僅需改此表，商品上的 jpy 須為下列鍵之一：100、200、300、400、500、600
 */
window.GACHA_JPY_TO_TWD = {
  100: 60,
  200: 90,
  300: 130,
  400: 150,
  500: 180,
  600: 200,
};

/**
 * 台幣計價（擇一；前台 getProductTwd 會套用）
 *
 * 【匯率模式】設為正數時：台幣價 = Math.round(商品 jpy × 匯率)。例：0.22 表示每 1 日幣約 0.22 台幣（可依實際代購／手續費調整）。
 * 取消註解下一行即啟用；未設定則走下方【檔位表】。
 */
// window.GACHA_JPY_TO_TWD_RATE = 0.22;

/**
 * 【檔位模式】僅在未啟用匯率時使用。可將對照表整體加減價（例 1.05 = 漲 5%）。
 */
window.GACHA_TWD_TIER_MULTIPLIER = 1;

/**
 * 本機 localStorage 鍵：若存一個正數字串，會優先當作匯率（方便不部署就試算；不需要時刪除此鍵）。
 */
window.GACHA_JPY_TO_TWD_RATE_STORAGE_KEY = "gacha-jpy-twd-rate-v1";

/**
 * 商品資料
 * - jpy：機台價（日幣），須為 GACHA_JPY_TO_TWD 已定義之檔位
 * - image：主圖網址（可留空，以 accent 漸層示意）
 * - gallery：詳情彈窗額外圖片（多張網址陣列，可留空）
 * - description：詳細說明
 * - specs：尺寸與規格列 { label, value }
 * - purchaseCount：（選填）購買／登記人次基數，由賣家更新；會與本頁累計加總後顯示
 * - comingSoon：true 表示待上市（無法加入購物車，僅展示）
 * - launchNote：（選填）例：預計上架月份、開賣提醒
 * - labels：（選填）陣列，可填 'new' 新品、'hot' 熱銷、'recommend' 推薦，可並列多個
 * - published：（選填）false 或「下架」表示前台不顯示、無法加購；預設 true（上架）
 */
window.GACHA_PRODUCTS = [
  {
    id: "g1",
    name: "吉伊卡哇 睡衣派對",
    series: "吉伊卡哇",
    jpy: 300,
    capsule: "全 5 款",
    image: "",
    accent: "linear-gradient(145deg, #ffe4ec 0%, #ffc2d4 50%, #ff8fab 100%)",
    gallery: [
      "https://picsum.photos/seed/gacha-g1a/800/600",
      "https://picsum.photos/seed/gacha-g1b/800/600",
    ],
    description:
      "軟萌睡衣造型立體小公仔，適合收藏與拍照。\n連線時可請小幫手確認當日機台與剩餘款式；隨機出貨，下單備註許願會盡力協助。",
    specs: [
      { label: "參考尺寸", value: "扭蛋球約 φ50mm；公仔本體約 H45～52mm（依角色略有差異）" },
      { label: "材質", value: "PVC／ABS（依原廠標示）" },
      { label: "產地", value: "日本" },
    ],
    purchaseCount: 18,
    labels: ["new", "hot"],
  },
  {
    id: "g2",
    name: "寶可夢 睡眠系列",
    series: "寶可夢",
    jpy: 300,
    capsule: "全 6 款",
    image: "",
    accent: "linear-gradient(145deg, #e0f2fe 0%, #bae6fd 50%, #38bdf8 100%)",
    gallery: ["https://picsum.photos/seed/gacha-g2a/800/600"],
    description: "打瞌睡姿勢的寶可夢迷你模型，色彩柔和。隨機款式，連線可現場確認盒況與重複款。",
    specs: [
      { label: "參考尺寸", value: "扭蛋球約 φ50mm；內容物約 H40～55mm" },
      { label: "材質", value: "PVC／軟膠（依款式）" },
      { label: "產地", value: "日本" },
    ],
    purchaseCount: 6,
    labels: ["hot"],
  },
  {
    id: "g3",
    name: "咒術迴戰 懷玉·玉折",
    series: "咒術迴戰",
    jpy: 400,
    capsule: "全 5 款",
    image: "",
    accent: "linear-gradient(145deg, #ede9fe 0%, #c4b5fd 50%, #7c3aed 100%)",
    gallery: [],
    description: "動畫篇章主題扭蛋，適合搭配小場景展示。實際塗裝與細節以現場實物為準。",
    specs: [
      { label: "參考尺寸", value: "約 H50～58mm（角色不同略有差異）" },
      { label: "材質", value: "PVC" },
      { label: "產地", value: "日本" },
    ],
    labels: ["recommend"],
  },
  {
    id: "g4",
    name: "SPY×FAMILY 日常篇",
    series: "SPY×FAMILY",
    jpy: 300,
    capsule: "全 5 款",
    image: "",
    accent: "linear-gradient(145deg, #fef3c7 0%, #fcd34d 50%, #f59e0b 100%)",
    gallery: [],
    description: "佛傑一家的日常小物造型扭蛋，輕巧好收納。隨機出貨，可備註偏好由小幫手留意。",
    specs: [
      { label: "參考尺寸", value: "扭蛋球 φ50mm；內容物約 H42～50mm" },
      { label: "材質", value: "PVC／ABS" },
      { label: "產地", value: "日本" },
    ],
    labels: ["new"],
  },
  {
    id: "g5",
    name: "鏈鋸人 小小紅與波奇塔",
    series: "鏈鋸人",
    jpy: 300,
    capsule: "全 4 款",
    image: "",
    accent: "linear-gradient(145deg, #fee2e2 0%, #fca5a5 50%, #dc2626 100%)",
    gallery: [],
    description: "人氣角色迷你收藏系列。每款設計不同，連線時可請小幫手翻攝紙台與實體比例。",
    specs: [
      { label: "參考尺寸", value: "約 H48～55mm" },
      { label: "材質", value: "PVC" },
      { label: "產地", value: "日本" },
    ],
  },
  {
    id: "g6",
    name: "三麗鷗 星空夜燈",
    series: "三麗鷗",
    jpy: 500,
    capsule: "全 6 款",
    image: "",
    accent: "linear-gradient(145deg, #fce7f3 0%, #f9a8d4 50%, #db2777 100%)",
    gallery: [],
    description: "可愛角色搭配星空元素的小型夜燈／燈飾系扭蛋（依實際款式為準）。需電池者以包裝說明為主。",
    specs: [
      { label: "參考尺寸", value: "約 H55～65mm（依角色）" },
      { label: "材質", value: "ABS／PVC（依款式）" },
      { label: "產地", value: "日本" },
    ],
  },
  {
    id: "g7",
    name: "排球少年 隊服小立牌",
    series: "排球少年",
    jpy: 300,
    capsule: "全 8 款",
    image: "",
    accent: "linear-gradient(145deg, #ffedd5 0%, #fdba74 50%, #ea580c 100%)",
    gallery: [],
    description: "迷你立牌尺寸適合書桌展示。多款角色隨機，連線可協助確認是否為新盒或殘盒。",
    specs: [
      { label: "參考尺寸", value: "立牌本體約 H50～60mm（含底座）" },
      { label: "材質", value: "壓克力／紙台（依款式）" },
      { label: "產地", value: "日本" },
    ],
  },
  {
    id: "g8",
    name: "鬼滅之刃 刀鍔收藏",
    series: "鬼滅之刃",
    jpy: 400,
    capsule: "全 5 款",
    image: "",
    accent: "linear-gradient(145deg, #ccfbf1 0%, #5eead4 50%, #0d9488 100%)",
    gallery: [],
    description: "刀鍔造型迷你收藏，細節豐富。適合與同系列模型一起展示。",
    specs: [
      { label: "參考尺寸", value: "約 φ45～50mm（依款式）" },
      { label: "材質", value: "PVC／金屬色塗裝（依原廠）" },
      { label: "產地", value: "日本" },
    ],
  },
  {
    id: "g9",
    name: "角落生物 溫泉旅館",
    series: "角落生物",
    jpy: 200,
    capsule: "全 6 款",
    image: "",
    accent: "linear-gradient(145deg, #f3e8ff 0%, #d8b4fe 50%, #9333ea 100%)",
    gallery: [],
    description: "溫泉主題場景小配件，療癒配色。隨機款式，適合疊放小場景。",
    specs: [
      { label: "參考尺寸", value: "約 H35～48mm" },
      { label: "材質", value: "PVC" },
      { label: "產地", value: "日本" },
    ],
  },
  {
    id: "g10",
    name: "吉卜力 龍貓 四季",
    series: "吉卜力",
    jpy: 500,
    capsule: "全 4 款",
    image: "",
    accent: "linear-gradient(145deg, #ecfccb 0%, #a3e635 50%, #65a30d 100%)",
    gallery: [],
    description: "四季氛圍的龍貓小模型，塗裝柔和。正版授權款式以包裝標示為準。",
    specs: [
      { label: "參考尺寸", value: "約 H50～62mm" },
      { label: "材質", value: "PVC" },
      { label: "產地", value: "日本" },
    ],
  },
  {
    id: "g11",
    name: "假面騎士 迷你腰帶",
    series: "假面騎士",
    jpy: 600,
    capsule: "全 5 款",
    image: "",
    accent: "linear-gradient(145deg, #e5e7eb 0%, #9ca3af 50%, #374151 100%)",
    gallery: [],
    description: "可收藏的迷你腰帶造型扭蛋，細節較多。高單價建議連線時確認盒況與重複款。",
    specs: [
      { label: "參考尺寸", value: "約 H45～55mm" },
      { label: "材質", value: "ABS／PVC" },
      { label: "產地", value: "日本" },
    ],
    comingSoon: true,
    launchNote: "預計 2026/06 日本開賣，開賣後開放連線代購。",
    labels: ["recommend"],
  },
  {
    id: "g12",
    name: "蠟筆小新 睡衣小新",
    series: "蠟筆小新",
    jpy: 200,
    capsule: "全 5 款",
    image: "",
    accent: "linear-gradient(145deg, #fef08a 0%, #facc15 50%, #ca8a04 100%)",
    gallery: [],
    description: "睡衣造型搞笑pose小公仔，輕鬆可愛。隨機出貨，可備註許願。",
    specs: [
      { label: "參考尺寸", value: "約 H45～52mm" },
      { label: "材質", value: "PVC" },
      { label: "產地", value: "日本" },
    ],
    comingSoon: true,
    launchNote: "官方尚未公佈發售日，上架後會於此頁與 LINE 公告。",
    labels: ["new"],
  },
  {
    id: "g13",
    name: "嚕嚕米 北歐小物",
    series: "嚕嚕米",
    jpy: 300,
    capsule: "全 5 款",
    image: "",
    accent: "linear-gradient(145deg, #e0f2fe 0%, #bae6fd 55%, #7dd3fc 100%)",
    gallery: [],
    description: "北歐風小物扭蛋，清新配色。隨機款式。",
    specs: [
      { label: "參考尺寸", value: "約 H40～50mm" },
      { label: "材質", value: "PVC" },
      { label: "產地", value: "日本" },
    ],
  },
  {
    id: "g14",
    name: "機動戰士 鋼彈 頭像",
    series: "鋼彈",
    jpy: 500,
    capsule: "全 6 款",
    image: "",
    accent: "linear-gradient(145deg, #e8e8e8 0%, #94a3b8 50%, #475569 100%)",
    gallery: [],
    description: "經典機體頭像收藏，塗裝細緻。",
    specs: [
      { label: "參考尺寸", value: "約 H50～58mm" },
      { label: "材質", value: "PVC" },
      { label: "產地", value: "日本" },
    ],
  },
  {
    id: "g15",
    name: "貓福珊迪 軟綿公仔",
    series: "貓福珊迪",
    jpy: 300,
    capsule: "全 4 款",
    image: "",
    accent: "linear-gradient(145deg, #fef9c3 0%, #fde047 55%, #eab308 100%)",
    gallery: [],
    description: "軟萌貓咪造型，適合收藏展示。",
    specs: [
      { label: "參考尺寸", value: "約 H42～48mm" },
      { label: "材質", value: "PVC／植絨（依款式）" },
      { label: "產地", value: "日本" },
    ],
  },
];
