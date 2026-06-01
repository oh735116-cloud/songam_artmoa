function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('공연모아')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getPerformances() {
  var apiKey = PropertiesService.getScriptProperties().getProperty('KOPIS_API_KEY');

  if (!apiKey) {
    throw new Error('KOPIS_API_KEY script property is missing.');
  }

  var today = new Date();
  var end = new Date(today);
  end.setDate(today.getDate() + 30);

  var params = {
    service: apiKey,
    stdate: formatDate(today),
    eddate: formatDate(end),
    cpage: '1',
    rows: '30',
  };

  var query = Object.keys(params)
    .map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    })
    .join('&');

  var url = 'https://www.kopis.or.kr/openApi/restful/pblprfr?' + query;
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
  });
  var statusCode = response.getResponseCode();
  var body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('KOPIS API request failed: ' + statusCode + ' ' + body);
  }

  var root = XmlService.parse(body).getRootElement();
  var items = root.getChildren('db');

  return items.map(function (item) {
    return {
      id: getXmlText(item, 'mt20id'),
      title: getXmlText(item, 'prfnm'),
      place: getXmlText(item, 'fcltynm'),
      date: getXmlText(item, 'prfpdfrom') + ' ~ ' + getXmlText(item, 'prfpdto'),
      genre: getXmlText(item, 'genrenm'),
      area: getXmlText(item, 'area'),
      poster: normalizePosterUrl(getXmlText(item, 'poster')),
      price: '정보 확인',
      isFree: false,
    };
  });
}

function getXmlText(item, name) {
  var child = item.getChild(name);
  return child ? child.getText() : '';
}

function normalizePosterUrl(url) {
  if (!url) {
    return '';
  }

  return url.replace(/^http:\/\//, 'https://');
}

function formatDate(date) {
  return Utilities.formatDate(date, 'Asia/Seoul', 'yyyyMMdd');
}

function testGetPerformances() {
  var items = getPerformances();
  Logger.log(JSON.stringify(items.slice(0, 3), null, 2));
  return items.length;
}
