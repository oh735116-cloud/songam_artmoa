function doGet() {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("GongMoA")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getPerformances() {
  var apiKey =
    PropertiesService.getScriptProperties().getProperty("KOPIS_API_KEY");

  if (!apiKey) {
    throw new Error("KOPIS_API_KEY script property is missing.");
  }

  var today = new Date();
  var end = new Date(today);
  end.setDate(today.getDate() + 30);

  var params = {
    service: apiKey,
    stdate: formatDate(today),
    eddate: formatDate(end),
    cpage: "1",
    rows: "30",
  };

  var query = Object.keys(params)
    .map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
    })
    .join("&");

  var url = "https://www.kopis.or.kr/openApi/restful/pblprfr?" + query;
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
  });
  var statusCode = response.getResponseCode();
  var body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("KOPIS API request failed: " + statusCode + " " + body);
  }

  var root = XmlService.parse(body).getRootElement();
  var items = root.getChildren("db");
  var detailsById = fetchPerformanceDetails_(items, apiKey);

  return items.map(function (item) {
    var id = getXmlText(item, "mt20id");
    var detail = detailsById[id] || {};
    var price = detail.price || "가격 확인";
    var isFree = isFreePerformance_(price);

    return {
      id: id,
      title: getXmlText(item, "prfnm"),
      place: getXmlText(item, "fcltynm"),
      date: getXmlText(item, "prfpdfrom") + " ~ " + getXmlText(item, "prfpdto"),
      genre: getXmlText(item, "genrenm"),
      area: getXmlText(item, "area"),
      poster: normalizePosterUrl(getXmlText(item, "poster")),
      price: isFree ? "무료" : price,
      isFree: isFree,
    };
  });
}

function fetchPerformanceDetails_(items, apiKey) {
  var requests = items
    .map(function (item) {
      var id = getXmlText(item, "mt20id");

      if (!id) {
        return null;
      }

      return {
        url:
          "https://www.kopis.or.kr/openApi/restful/pblprfr/" +
          encodeURIComponent(id) +
          "?service=" +
          encodeURIComponent(apiKey),
        muteHttpExceptions: true,
      };
    })
    .filter(function (request) {
      return !!request;
    });

  if (!requests.length) {
    return {};
  }

  var responses = UrlFetchApp.fetchAll(requests);
  var detailsById = {};

  responses.forEach(function (response) {
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      return;
    }

    var root = XmlService.parse(response.getContentText()).getRootElement();
    var detail = root.getChild("db") || root.getChildren("db")[0];

    if (!detail) {
      return;
    }

    var id = getXmlText(detail, "mt20id");

    if (!id) {
      return;
    }

    detailsById[id] = {
      price: normalizePriceText_(getXmlText(detail, "pcseguidance")),
    };
  });

  return detailsById;
}

function saveFavorite(performance) {
  return appendToSheet_("관심공연목록", [
    new Date(),
    performance && performance.id,
    performance && performance.title,
    performance && performance.genre,
    performance && performance.place,
    performance && performance.date,
    performance && performance.price,
  ]);
}

function saveUserPreference(preference) {
  return appendToSheet_("사용자추천설정", [
    new Date(),
    preference && preference.area,
    preference && preference.genre,
    preference && preference.price,
  ]);
}

function appendToSheet_(sheetName, row) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    return { ok: false, message: "No active spreadsheet is bound." };
  }

  var sheet =
    spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  sheet.appendRow(row);
  return { ok: true };
}

function getXmlText(item, name) {
  var child = item.getChild(name);
  return child ? child.getText() : "";
}

function normalizePosterUrl(url) {
  if (!url) {
    return "";
  }

  return url.replace(/^http:\/\//, "https://");
}

function normalizePriceText_(price) {
  if (!price) {
    return "가격 확인";
  }

  return price.replace(/\s+/g, " ").trim();
}

function isFreePerformance_(price) {
  return /무료/.test(price || "");
}

function formatDate(date) {
  return Utilities.formatDate(date, "Asia/Seoul", "yyyyMMdd");
}

function testGetPerformances() {
  var items = getPerformances();
  Logger.log(JSON.stringify(items.slice(0, 3), null, 2));
  return items.length;
}
