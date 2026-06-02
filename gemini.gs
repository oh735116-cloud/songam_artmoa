function recommendPerformances(preference, performances) {
  var scriptProperty = PropertiesService.getScriptProperties();
  var apiKey = scriptProperty.getProperty("GEMINI_API_KEY");

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY script property is missing.");
  }

  var safePreference = preference || {};
  var safePerformances = (performances || []).slice(0, 30).map(function (item) {
    return {
      id: item && item.id,
      title: item && item.title,
      region: item && item.region,
      genre: item && item.genre,
      priceType: item && item.priceType,
      price: item && item.price,
      date: item && item.date,
      venue: item && item.venue,
      summary: item && item.summary,
    };
  });

  var prompt = [
    "당신은 공연 추천 도우미입니다.",
    "사용자의 상태와 취향을 바탕으로 아래 공연 목록 중 가장 어울리는 공연 4개 이하를 추천하세요.",
    "반드시 제공된 공연 목록 안에서만 고르세요.",
    "응답은 JSON만 반환하세요. 마크다운, 설명 문장, 코드블록은 쓰지 마세요.",
    '형식: {"message":"짧은 추천 요약","recommendations":[{"id":"공연 id","title":"공연명","reason":"추천 이유 1문장"}]}',
    "",
    "[사용자 데이터]",
    "현재기분: " + (safePreference.mood || "미입력"),
    "좋아하는 색: " + (safePreference.color || "미입력"),
    "평소듣는 음악장르: " + (safePreference.music || "미입력"),
    "같이 공연보고싶은 사람: " + (safePreference.person || "미입력"),
    "하고싶은말: " + (safePreference.context || "미입력"),
    "",
    "[공연 목록 JSON]",
    JSON.stringify(safePerformances),
  ].join("\n");

  var modelId = "gemini-3.1-flash-lite";
  var url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(modelId) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
    },
  };
  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var statusCode = response.getResponseCode();
  var body = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("Gemini API request failed: " + statusCode + " " + body);
  }

  var jsonData = JSON.parse(body);
  var text =
    jsonData &&
    jsonData.candidates &&
    jsonData.candidates[0] &&
    jsonData.candidates[0].content &&
    jsonData.candidates[0].content.parts &&
    jsonData.candidates[0].content.parts[0] &&
    jsonData.candidates[0].content.parts[0].text;

  if (!text) {
    throw new Error("Gemini API response is empty.");
  }

  return normalizeRecommendationResult_(JSON.parse(extractJsonText_(text)));
}

function extractJsonText_(text) {
  var trimmed = String(text || "").trim();
  var fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced) {
    return fenced[1].trim();
  }

  var start = trimmed.indexOf("{");
  var end = trimmed.lastIndexOf("}");

  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function normalizeRecommendationResult_(result) {
  var recommendations = Array.isArray(result && result.recommendations)
    ? result.recommendations
    : [];

  return {
    message:
      (result && result.message) ||
      "AI가 현재 입력한 취향에 맞는 공연을 추천했습니다.",
    recommendations: recommendations.slice(0, 4).map(function (item) {
      return {
        id: item && item.id,
        title: item && item.title,
        reason: item && item.reason,
      };
    }),
  };
}
