const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const OPENAI_API_URL = "https://api.openai.com/v1/responses";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value));
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("");
}

function normalizeProduct(item) {
  const quantityValue =
    Number.isFinite(item.quantityValue) && item.quantityValue > 0
      ? item.quantityValue
      : null;
  const count = Number.isInteger(item.count) && item.count > 0 ? item.count : null;

  return {
    source: "coupang",
    title: String(item.title || "").trim(),
    price: Math.max(0, Math.round(Number(item.price) || 0)),
    shipping: Math.max(0, Math.round(Number(item.shipping) || 0)),
    url: String(item.url || "").trim(),
    image: item.image ? String(item.image).trim() : "",
    productType: String(item.productType || "기타").trim(),
    packageLabel: String(item.packageLabel || "구성 미확인").trim(),
    measurement: ["volume", "weight", "count", "length", "other"].includes(
      item.measurement
    )
      ? item.measurement
      : "other",
    quantityValue,
    quantityUnit: ["ml", "l", "g", "kg", "ea", "m", "cm", "other"].includes(
      item.quantityUnit
    )
      ? item.quantityUnit
      : "other",
    count,
    confidence: ["high", "medium", "low"].includes(item.confidence)
      ? item.confidence
      : "low",
  };
}

function deduplicate(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.title || !item.price || !item.url) return false;
    const key = `${item.source}:${item.url}:${item.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchWithOpenAI(query) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error("OPENAI_API_KEY가 설정되지 않았습니다. .env 파일을 확인해주세요.");
    error.status = 503;
    throw error;
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source: { type: "string", enum: ["coupang"] },
            title: { type: "string" },
            price: { type: "number", minimum: 0 },
            shipping: { type: "number", minimum: 0 },
            url: { type: "string" },
            image: { type: ["string", "null"] },
            productType: { type: "string" },
            packageLabel: { type: "string" },
            measurement: {
              type: "string",
              enum: ["volume", "weight", "count", "length", "other"],
            },
            quantityValue: { type: ["number", "null"], minimum: 0 },
            quantityUnit: {
              type: "string",
              enum: ["ml", "l", "g", "kg", "ea", "m", "cm", "other"],
            },
            count: { type: ["integer", "null"], minimum: 1 },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: [
            "source",
            "title",
            "price",
            "shipping",
            "url",
            "image",
            "productType",
            "packageLabel",
            "measurement",
            "quantityValue",
            "quantityUnit",
            "count",
            "confidence",
          ],
        },
      },
    },
    required: ["items"],
  };

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
      tools: [
        {
          type: "web_search",
          filters: {
            allowed_domains: [
              "coupang.com",
              "www.coupang.com",
            ],
          },
        },
      ],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      reasoning: { effort: "high" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "shopping_search_results",
          strict: true,
          schema,
        },
      },
      input: [
        {
          role: "system",
          content:
            "당신은 한국 쇼핑 상품 검색기다. 웹 검색 결과에 명시된 사실만 추출하고 추측하지 않는다.",
        },
        {
          role: "user",
          content: [
            `검색 품목: ${query}`,
            "쿠팡의 현재 판매 상품을 웹에서 검색하라.",
            "가능하면 여러 묶음 수량과 용량을 포함해 최대 100개를 수집하라.",
            "가격은 선택 옵션의 표시 판매가, 배송비는 별도 배송비다. 무료 또는 불명이면 0으로 기록하라.",
            "productType은 브랜드보다 상품의 종류나 주요 변형을 짧게 적는다. 예: 생수, 제로 콜라, 백미, 세탁세제, 두루마리 휴지.",
            "packageLabel은 소비자가 비교할 수 있는 묶음 구성을 짧게 적는다. 예: 500ml × 24병, 10kg 1포, 30롤 × 2팩.",
            "quantityValue와 quantityUnit은 판매 구성 전체의 총수량이다. 예: 500ml × 24병은 12000과 ml, 10kg 1포는 10과 kg, 30롤 × 2팩은 60과 ea다.",
            "measurement는 volume, weight, count, length, other 중 하나다. count는 판매 구성의 낱개 총개수다.",
            "상품 페이지 또는 쇼핑 검색 결과의 실제 URL만 사용하라.",
            "가격·용량·수량이 검색 근거에 없으면 해당 필드는 null로 기록하고 confidence를 낮춰라.",
            "회원 전용가, 쿠폰 적용 예상가, 정기배송가는 일반 구매가와 명확히 구분되지 않으면 제외하라.",
          ].join("\n"),
        },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : `OpenAI API HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  const outputText = extractOutputText(data);
  if (!outputText) throw new Error("OpenAI 검색 응답에 상품 데이터가 없습니다.");

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("OpenAI 검색 결과를 JSON으로 해석하지 못했습니다.");
  }

  return {
    items: deduplicate((parsed.items || []).map(normalizeProduct)),
    engine: "openai_web_search",
    model: data.model || process.env.OPENAI_MODEL || "gpt-5.6-sol",
  };
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");

  fs.readFile(filePath, (error, buffer) => {
    if (error) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    send(res, 200, buffer, MIME[path.extname(filePath)] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/health") {
    return json(res, 200, {
      ready: Boolean(process.env.OPENAI_API_KEY),
      engine: "openai_web_search",
      model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
    });
  }

  if (url.pathname === "/api/search") {
    const query = (url.searchParams.get("q") || "").trim();
    if (!query) return json(res, 400, { error: "검색어가 필요합니다." });
    if (query.length > 100) return json(res, 400, { error: "검색어는 100자 이하여야 합니다." });

    try {
      return json(res, 200, await searchWithOpenAI(query));
    } catch (error) {
      const status = error.name === "TimeoutError" ? 504 : error.status || 500;
      return json(res, status, { error: error.message });
    }
  }

  serveStatic(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Price search app running at http://localhost:${PORT}`);
  console.log(
    process.env.OPENAI_API_KEY
      ? `OpenAI web search ready (${process.env.OPENAI_MODEL || "gpt-5.6-sol"})`
      : "OpenAI web search unavailable: OPENAI_API_KEY is missing"
  );
});
