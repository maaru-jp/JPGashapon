/**
 * 扭蛋連線 · Google 試算表 → 公開 JSON
 *
 * 設定（專案設定 → 指令碼屬性）：
 *   SPREADSHEET_ID  試算表 ID（網址 /d/ 與 /edit 之間）
 *   ADMIN_TOKEN     （選用）doPost 新增列時驗證用密語
 *
 * 分頁順序（由左至右）：
 *   第 1 張：商品（第一列為標題列，欄位名稱見試算表欄位說明.txt）
 *   第 2 張：匯率設定（見下方）
 *   第 3 張（選填）：名稱須為 HeroBanners，首頁輪播；無此分頁則用前端 data.js
 *
 * 【第 2 張分頁】
 *   B1：可填「每 1 日幣合幾元台幣」正數小數（例 0.22），JSON 會帶 jpyToTwdRate；留白則不依單一匯率計價。
 *   其餘列：日幣檔位與台幣參考（第一欄日幣、第二欄台幣）；可有標題列（非數字會自動略過）。
 *
 * 部署：部署 → 新增部署作業 → 類型「網路應用程式」→ 存取「任何人」→ 取得網址填入 data.js 的 GACHA_DATA_URL
 */

var INDEX_SHEET_PRODUCTS = 0;
var INDEX_SHEET_RATES = 1;
var SHEET_HERO = "HeroBanners";

function doGet() {
  var ss = getSpreadsheet_();
  var payload = {
    jpyToTwd: readJpyToTwd_(ss),
    jpyToTwdRate: readJpyToTwdRate_(ss),
    heroBanners: readHeroBanners_(ss),
    products: readProducts_(ss),
  };
  return jsonResponse_(payload);
}

/** 依索引取得分頁；超出範圍回傳 null */
function getSheetByIndex_(ss, index) {
  var sheets = ss.getSheets();
  if (index < 0 || index >= sheets.length) return null;
  return sheets[index];
}

/** 第二張分頁 B1：單一匯率（每 1 日幣 → 台幣） */
function readJpyToTwdRate_(ss) {
  var sh = getSheetByIndex_(ss, INDEX_SHEET_RATES);
  if (!sh) return null;
  var v = sh.getRange("B1").getValue();
  if (typeof v === "number" && v > 0 && v <= 3) return v;
  return null;
}

/**
 * 後台新增一筆商品（建議僅自用；圖片請先上傳 Cloudinary 取得 URL 再放入 JSON）。
 * POST JSON：{ "token": "與 ADMIN_TOKEN 相同", "product": { ...欄位與試算表相同 } }
 */
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var expect = props.getProperty("acha_2026!Seller#A9");
  if (!expect) {
    return jsonResponse_({ ok: false, error: "未設定 ADMIN_TOKEN" });
  }
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, error: "empty_post_body" });
    }
    var body = JSON.parse(e.postData.contents);
    if (body.token !== expect) {
      return jsonResponse_({ ok: false, error: "unauthorized" });
    }
    if (!body.product || typeof body.product !== "object") {
      return jsonResponse_({ ok: false, error: "missing product" });
    }
    appendProductRow_(body.product);
    return jsonResponse_({ ok: true });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty("1NDa6vyEIxIHUlD9fPZPzgL7o5JBcmngfLiu5RlcyK9c");
  if (!id) throw new Error("請在指令碼屬性設定 SPREADSHEET_ID");
  return SpreadsheetApp.openById(id);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 第二張分頁：各列第一欄日幣、第二欄台幣（略過無法辨識為檔位對照的列）
 */
function readJpyToTwd_(ss) {
  var sh = getSheetByIndex_(ss, INDEX_SHEET_RATES);
  if (!sh) return null;
  var v = sh.getDataRange().getValues();
  var o = {};
  for (var r = 0; r < v.length; r++) {
    var jpy = v[r][0];
    var twd = v[r][1];
    var jn = typeof jpy === "number" ? jpy : parseInt(String(jpy).replace(/,/g, ""), 10);
    var tn = typeof twd === "number" ? twd : parseFloat(String(twd).replace(/,/g, ""));
    if (isNaN(jn) || isNaN(tn)) continue;
    if (jn < 50 || jn > 5000) continue;
    if (tn < 5) continue;
    o[String(Math.round(jn))] = Math.round(tn);
  }
  return Object.keys(o).length ? o : null;
}

function readHeroBanners_(ss) {
  var sh = ss.getSheetByName(SHEET_HERO);
  if (!sh) return null;
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return null;
  var headers = v[0].map(function (h) {
    return String(h).trim();
  });
  var out = [];
  for (var r = 1; r < v.length; r++) {
    var row = v[r];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = row[c];
    }
    var title = obj.title;
    if (title === "" || title == null) continue;
    out.push({
      title: String(obj.title != null ? obj.title : ""),
      sub: String(obj.sub != null ? obj.sub : ""),
      gradient: String(obj.gradient != null ? obj.gradient : ""),
      tag: String(obj.tag != null ? obj.tag : ""),
    });
  }
  return out.length ? out : null;
}

function readProducts_(ss) {
  var sh = getSheetByIndex_(ss, INDEX_SHEET_PRODUCTS);
  if (!sh) return [];
  var v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  var headers = v[0].map(function (h) {
    return String(h).trim();
  });
  var products = [];
  for (var r = 1; r < v.length; r++) {
    var row = v[r];
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = row[c];
    }
    if (!obj.id || String(obj.id).trim() === "") continue;
    products.push(obj);
  }
  return products;
}

function appendProductRow_(product) {
  var ss = getSpreadsheet_();
  var sh = getSheetByIndex_(ss, INDEX_SHEET_PRODUCTS);
  if (!sh) throw new Error("找不到第 1 張分頁（商品）");
  var v = sh.getDataRange().getValues();
  var headers = v[0].map(function (h) {
    return String(h).trim();
  });
  var row = headers.map(function (h) {
    if (!h) return "";
    var val = product[h];
    if (val === undefined || val === null) return "";
    if (typeof val === "object") {
      try {
        return JSON.stringify(val);
      } catch (e) {
        return String(val);
      }
    }
    return val;
  });
  sh.appendRow(row);
}
