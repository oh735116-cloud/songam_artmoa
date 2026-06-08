function doGet() {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("GongMoA")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getPerformances() {
  let registeredPerformances = [];
  let apiKey;

  try {
    registeredPerformances = getRegisteredPerformances();
  } catch (error) {
    console.error("등록 공연 조회 실패: " + error.message);
  }

  try {
    apiKey = getKopisApiKey_();
  } catch (error) {
    if (registeredPerformances.length) {
      return sortPerformancesByRecentDate_(registeredPerformances);
    }

    throw error;
  }

  const today = new Date();
  let start = new Date(today);
  let end = new Date(today);
  start.setDate(today.getDate() - 30);
  end.setDate(today.getDate() + 60);

  let listResult;
  let items = [];

  try {
    listResult = fetchKopisPerformanceList_(apiKey, start, end);
  } catch (error) {
    if (registeredPerformances.length) {
      return sortPerformancesByRecentDate_(registeredPerformances);
    }

    throw error;
  }

  items = listResult.items;

  if (!items.length) {
    start = new Date(today);
    end = new Date(today);
    start.setDate(today.getDate() - 180);
    end.setDate(today.getDate() + 365);

    try {
      listResult = fetchKopisPerformanceList_(apiKey, start, end);
    } catch (error) {
      if (registeredPerformances.length) {
        return sortPerformancesByRecentDate_(registeredPerformances);
      }

      throw error;
    }

    items = listResult.items;
  }

  if (!items.length) {
    if (registeredPerformances.length) {
      return sortPerformancesByRecentDate_(registeredPerformances);
    }

    throw new Error(
      "KOPIS API returned no performances: " + listResult.body.slice(0, 500),
    );
  }

  const detailsById = fetchPerformanceDetails_(items, apiKey);

  const apiPerformances = items.map(function (item) {
    const id = getXmlText(item, "mt20id");
    const title = getXmlText(item, "prfnm");
    const detail = detailsById[id] || {};
    const venue = getXmlText(item, "fcltynm") || detail.venue;
    const startDate = getXmlText(item, "prfpdfrom");
    const endDate = getXmlText(item, "prfpdto");
    const genre = getXmlText(item, "genrenm") || detail.genre;
    const region = getXmlText(item, "area") || detail.region;
    const poster = normalizePosterUrl(
      getXmlText(item, "poster") || detail.poster,
    );
    const price = detail.price || "가격 확인";
    const isFree = isFreePerformance_(price);
    const summary =
      detail.summary ||
      [detail.runtime, detail.age, detail.schedule]
        .filter(Boolean)
        .join(" · ") ||
      venue ||
      genre ||
      "공연 소개가 준비되는 중입니다.";

    return {
      id: id,
      title: title,
      place: venue,
      venue: venue,
      date: formatKopisDateRange_(startDate, endDate),
      startDate: startDate,
      endDate: endDate,
      genre: genre,
      area: region,
      region: region,
      poster: poster,
      price: isFree ? "무료" : price,
      priceType: isFree ? "무료" : "유료",
      isFree: isFree,
      summary: summary,
      tag: getPerformanceTag_(genre),
    };
  });

  return sortPerformancesByRecentDate_(
    registeredPerformances.concat(apiPerformances),
  );
}

function fetchKopisPerformanceList_(apiKey, startDate, endDate) {
  const params = {
    service: apiKey,
    stdate: formatDate(startDate),
    eddate: formatDate(endDate),
    cpage: "1",
    rows: "30",
  };

  const query = Object.keys(params)
    .map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
    })
    .join("&");

  const url = "http://kopis.or.kr/openApi/restful/pblprfr?" + query;
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  const body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("KOPIS API request failed: " + statusCode + " " + body);
  }

  return {
    body: body,
    items: getDbItems_(XmlService.parse(body).getRootElement()),
  };
}

function getKopisApiKey_() {
  const apiKey = String(
    PropertiesService.getScriptProperties().getProperty("KOPIS_API_KEY") || "",
  ).trim();

  if (!apiKey) {
    throw new Error(
      "KOPIS_API_KEY script property is missing. Apps Script 프로젝트 설정의 스크립트 속성에 KOPIS_API_KEY를 추가하세요.",
    );
  }

  return apiKey;
}

function getDbItems_(root) {
  if (!root) {
    return [];
  }

  const directItems = root.getChildren("db");

  if (directItems.length) {
    return directItems;
  }

  const dbs = root.getChild("dbs");
  return dbs ? dbs.getChildren("db") : [];
}

function fetchPerformanceDetails_(items, apiKey) {
  const requests = items
    .slice(0, 12)
    .map(function (item) {
      const id = getXmlText(item, "mt20id");

      if (!id) {
        return null;
      }

      return {
        url:
          "http://kopis.or.kr/openApi/restful/pblprfr/" +
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

  let responses;

  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch (error) {
    console.error("KOPIS detail API request failed: " + error.message);
    return {};
  }
  const detailsById = {};

  responses.forEach(function (response) {
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      return;
    }

    const root = XmlService.parse(response.getContentText()).getRootElement();
    const detail = root.getChild("db") || getDbItems_(root)[0];

    if (!detail) {
      return;
    }

    const id = getXmlText(detail, "mt20id");

    if (!id) {
      return;
    }

    detailsById[id] = {
      venue: getXmlText(detail, "fcltynm"),
      genre: getXmlText(detail, "genrenm"),
      region: getXmlText(detail, "area"),
      poster: normalizePosterUrl(getXmlText(detail, "poster")),
      price: normalizePriceText_(getXmlText(detail, "pcseguidance")),
      runtime: getXmlText(detail, "prfruntime"),
      age: getXmlText(detail, "prfage"),
      schedule: getXmlText(detail, "dtguidance"),
      summary: normalizeSummaryText_(getXmlText(detail, "sty")),
    };
  });

  return detailsById;
}

function saveUserPreference(preference) {
  return appendToSheet_("사용자추천설정", [
    new Date(),
    preference && preference.area,
    preference && preference.genre,
    preference && preference.price,
  ]);
}

const PERFORMANCE_REGISTER_SHEET_NAME = "공연정보";
const PERFORMANCE_REGISTER_HEADERS = [
  "등록일",
  "제목",
  "포스터(이미지)",
  "날자",
  "가격",
  "장소",
  "장르",
  "곡명",
  "솔리스트",
  "출연진",
  "지휘자",
  "공연설명",
  "후원",
  "주최",
  "기타사항",
];

function saveRegisteredPerformance(formData) {
  const safeData = formData || {};
  const title = normalizeSheetText_(safeData.title);
  const date = normalizeSheetText_(safeData.date);

  if (!title) {
    throw new Error("공연 제목을 입력하세요.");
  }

  if (!date) {
    throw new Error("공연 날짜를 입력하세요.");
  }

  const sheet = getPerformanceRegisterSheet_();
  sheet.appendRow([
    new Date(),
    title,
    normalizePosterUrl(normalizeSheetText_(safeData.poster)),
    date,
    normalizeSheetText_(safeData.price),
    normalizeSheetText_(safeData.venue),
    normalizeSheetText_(safeData.genre),
    normalizeSheetText_(safeData.musicTitle),
    normalizeSheetText_(safeData.soloist),
    normalizeSheetText_(safeData.cast),
    normalizeSheetText_(safeData.conductor),
    normalizeSheetText_(safeData.description),
    normalizeSheetText_(safeData.sponsor),
    normalizeSheetText_(safeData.organizer),
    normalizeSheetText_(safeData.notes),
  ]);

  return {
    ok: true,
    performances: getRegisteredPerformances(),
  };
}

function getRegisteredPerformances() {
  const sheet = getPerformanceRegisterSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return [];
  }

  return sheet
    .getRange(2, 1, lastRow - 1, PERFORMANCE_REGISTER_HEADERS.length)
    .getValues()
    .map(function (row, index) {
      const item = rowToRegisteredPerformance_(row, index);
      return item.title ? item : null;
    })
    .filter(function (item) {
      return !!item;
    })
    .sort(function (a, b) {
      return getPerformanceDateValue_(b) - getPerformanceDateValue_(a);
    });
}

function getPerformanceRegisterSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("No active spreadsheet is bound.");
  }

  const sheet =
    spreadsheet.getSheetByName(PERFORMANCE_REGISTER_SHEET_NAME) ||
    spreadsheet.insertSheet(PERFORMANCE_REGISTER_SHEET_NAME);
  const headerRange = sheet.getRange(
    1,
    1,
    1,
    PERFORMANCE_REGISTER_HEADERS.length,
  );
  const currentHeaders = headerRange.getValues()[0];
  const shouldWriteHeaders = PERFORMANCE_REGISTER_HEADERS.some(
    function (header, index) {
      return currentHeaders[index] !== header;
    },
  );

  if (shouldWriteHeaders) {
    headerRange.setValues([PERFORMANCE_REGISTER_HEADERS]);
  }

  return sheet;
}

function rowToRegisteredPerformance_(row, index) {
  const title = normalizeSheetText_(row[1]);
  const poster = normalizePosterUrl(normalizeSheetText_(row[2]));
  const date = normalizeSheetText_(row[3]);
  const price = normalizeSheetText_(row[4]) || "가격 확인";
  const venue = normalizeSheetText_(row[5]) || "장소 확인";
  const genre = normalizeSheetText_(row[6]) || "등록공연";
  const musicTitle = normalizeSheetText_(row[7]);
  const soloist = normalizeSheetText_(row[8]);
  const cast = normalizeSheetText_(row[9]);
  const conductor = normalizeSheetText_(row[10]);
  const description = normalizeSheetText_(row[11]);
  const sponsor = normalizeSheetText_(row[12]);
  const organizer = normalizeSheetText_(row[13]);
  const notes = normalizeSheetText_(row[14]);
  const detailLines = [
    description,
    musicTitle ? "곡명: " + musicTitle : "",
    soloist ? "솔리스트: " + soloist : "",
    cast ? "출연진: " + cast : "",
    conductor ? "지휘자: " + conductor : "",
    sponsor ? "후원: " + sponsor : "",
    organizer ? "주최: " + organizer : "",
    notes ? "기타사항: " + notes : "",
  ].filter(Boolean);
  const isFree = isFreePerformance_(price);

  return {
    id: "registered-" + (index + 1),
    title: title,
    poster: poster,
    date: formatRegisteredDate_(date),
    startDate: date,
    price: price,
    priceType: isFree ? "무료" : "유료",
    isFree: isFree,
    venue: venue,
    place: venue,
    genre: genre,
    region: "등록공연",
    area: "등록공연",
    summary: detailLines.join(" · ") || "공연 소개가 준비되는 중입니다.",
    tag: getPerformanceTag_(genre),
    tone: "linear-gradient(135deg, #6a2815, #171b27 62%, #08080d)",
    source: "registered",
  };
}

function normalizeSheetText_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, "Asia/Seoul", "yyyy-MM-dd");
  }

  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatRegisteredDate_(dateText) {
  const value = normalizeSheetText_(dateText);

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.replace(/-/g, ".");
  }

  return value || "일정 확인";
}

function sortPerformancesByRecentDate_(performances) {
  return performances.slice().sort(function (a, b) {
    return getPerformanceDateValue_(b) - getPerformanceDateValue_(a);
  });
}

function getPerformanceDateValue_(performance) {
  const value = String(
    (performance && (performance.startDate || performance.date)) || "",
  ).trim();
  const normalized = value.replace(/\./g, "-").replace(/\//g, "-");
  const compact = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  const date = compact
    ? new Date(compact[1] + "-" + compact[2] + "-" + compact[3])
    : new Date(normalized.split("~")[0].trim());
  const time = date.getTime();

  return Number.isFinite(time) ? time : 0;
}

function appendToSheet_(sheetName, row) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    return { ok: false, message: "No active spreadsheet is bound." };
  }

  const sheet =
    spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  sheet.appendRow(row);
  return { ok: true };
}

function getXmlText(item, name) {
  const child = item.getChild(name);
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

function normalizeSummaryText_(summary) {
  if (!summary) {
    return "";
  }

  return summary
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatKopisDateRange_(startDate, endDate) {
  const formattedStartDate = formatKopisDate_(startDate);
  const formattedEndDate = formatKopisDate_(endDate);

  if (!formattedStartDate && !formattedEndDate) {
    return "일정 확인";
  }

  if (!formattedEndDate || formattedStartDate === formattedEndDate) {
    return formattedStartDate;
  }

  return formattedStartDate + " ~ " + formattedEndDate;
}

function formatKopisDate_(dateText) {
  const value = String(dateText || "").trim();

  if (/^\d{4}\.\d{2}\.\d{2}$/.test(value)) {
    return value;
  }

  if (/^\d{8}$/.test(value)) {
    return value.slice(0, 4) + "." + value.slice(4, 6) + "." + value.slice(6);
  }

  return value;
}

function getPerformanceTag_(genre) {
  const value = String(genre || "").trim();

  if (!value) {
    return "Stage";
  }

  if (value.length <= 8) {
    return value;
  }

  return value.slice(0, 8);
}

function formatDate(date) {
  return Utilities.formatDate(date, "Asia/Seoul", "yyyyMMdd");
}

function testGetPerformances() {
  const items = getPerformances();
  Logger.log(JSON.stringify(items.slice(0, 3), null, 2));
  return items.length;
}

function testKopisApi() {
  const apiKey = getKopisApiKey_();
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);
  start.setDate(today.getDate() - 30);
  end.setDate(today.getDate() + 60);

  const params = {
    service: apiKey,
    stdate: formatDate(start),
    eddate: formatDate(end),
    cpage: "1",
    rows: "5",
  };
  const query = Object.keys(params)
    .map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
    })
    .join("&");
  const url = "http://kopis.or.kr/openApi/restful/pblprfr?" + query;
  const safeUrl = url.replace(encodeURIComponent(apiKey), "KOPIS_API_KEY");
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  const body = response.getContentText();

  Logger.log("KOPIS_API_KEY exists: " + !!apiKey);
  Logger.log("KOPIS API URL: " + safeUrl);
  Logger.log("KOPIS HTTP status: " + statusCode);
  Logger.log("KOPIS response preview: " + body.slice(0, 1000));

  return {
    hasApiKey: !!apiKey,
    statusCode: statusCode,
    bodyPreview: body.slice(0, 1000),
  };
}

function debugGetPerformances() {
  try {
    const items = getPerformances();
    return {
      ok: true,
      count: items.length,
      sample: items.slice(0, 3),
    };
  } catch (error) {
    return {
      ok: false,
      message: error && error.message ? error.message : String(error),
    };
  }
}

const YNA_PERFORMANCE_NEWS_URL =
  "https://www.yna.co.kr/culture/performance-exhibition";
const YNA_BASE_URL = "https://www.yna.co.kr";

function crawlNewsTest() {
  const newsItems = getPerformanceNews(3);
  Logger.log(JSON.stringify(newsItems, null, 2));
  return newsItems;
}

function getPerformanceNews(limit) {
  const maxItems = Math.max(1, Math.min(Number(limit) || 3, 6));
  const urls = getAllNews(YNA_PERFORMANCE_NEWS_URL).slice(0, maxItems);

  return urls
    .map(function (url) {
      try {
        return crawlHtml(url);
      } catch (error) {
        console.error(
          "연합뉴스 기사 크롤링 실패: " + url + " " + error.message,
        );
        return null;
      }
    })
    .filter(function (news) {
      return news && news.title;
    });
}

// 저장된 URL 호출하여 HTML 가져오기
function crawlHtml(url) {
  const articleUrl = normalizeYnaUrl_(url);
  const response = UrlFetchApp.fetch(articleUrl, {
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error("HTML 요청 실패 " + response.getResponseCode());
  }

  const htmlText = response.getContentText();
  const $ = Cheerio.load(htmlText);
  const newsTitle = normalizeNewsText_(
    $("#container > div.container591 > div.content90 > header > h1, h1.tit, h1")
      .first()
      .text(),
  );
  const newsArray = [];

  $("#articleWrap > div.story-news.article p, .story-news.article p").each(
    function (index, element) {
      const text = normalizeNewsText_($(element).text());

      if (text) {
        newsArray.push(text);
      }
    },
  );

  const content = newsArray.join("\n\n");

  return {
    title: newsTitle,
    content: content,
    summary: makeNewsSummary_(content),
    url: articleUrl,
  };
}

function getAllNews(pageUrl) {
  const response = UrlFetchApp.fetch(pageUrl || YNA_PERFORMANCE_NEWS_URL, {
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    console.warn("HTML 요청 실패 " + statusCode);
    return [];
  }

  const htmlText = response.getContentText();
  const $ = Cheerio.load(htmlText);
  const urlMap = {};

  $("#container a[href], a[href]").each(function (index, element) {
    const href = $(element).attr("href");

    if (!href || href.indexOf("/view/") === -1) {
      return;
    }

    const url = normalizeYnaUrl_(href);
    urlMap[url] = true;
  });

  return Object.keys(urlMap);
}

function normalizeYnaUrl_(url) {
  const value = String(url || "").trim();

  if (!value) {
    return "";
  }

  if (value.indexOf("//") === 0) {
    return "https:" + value;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return YNA_BASE_URL + (value.charAt(0) === "/" ? value : "/" + value);
}

function normalizeNewsText_(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeNewsSummary_(content) {
  const value = normalizeNewsText_(content);

  if (value.length <= 170) {
    return value;
  }

  return value.slice(0, 170).replace(/\s+\S*$/, "") + "...";
}

function setNewsData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("뉴스");
  const allNews = getPerformanceNews(10);

  allNews.forEach(function (news) {
    sheet.appendRow([news.title, news.content, news.url]);
  });
}
