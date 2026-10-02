const ALLOWED_ORIGIN = "https://tsicb.github.io";
const JOB_BASE_URL = "https://ten.1049.cc/job/";
const SUCCESS_CACHE_SECONDS = 60 * 60 * 6; // 6時間
const CACHE_VERSION = "2";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (request.method !== "GET") {
      return jsonResponse(
        {
          ok: false,
          code: "METHOD_NOT_ALLOWED",
          message: "GETのみ対応しています。",
        },
        405
      );
    }

    if (!url.searchParams.has("jobId")) {
      return jsonResponse({
        ok: true,
        service: "tenichi-image-proxy",
        version: CACHE_VERSION,
        usage: "?jobId=25205292",
      });
    }

    const jobId = (url.searchParams.get("jobId") || "").trim();

    if (!/^\d{1,20}$/.test(jobId)) {
      return jsonResponse(
        {
          ok: false,
          code: "INVALID_JOB_ID",
          message: "jobIdは数字のみ指定してください。",
        },
        400
      );
    }

    const cache = caches.default;
    // 旧Workerが相対URLをキャッシュしている可能性があるため、
    // 内部キャッシュキーだけversionを上げて旧キャッシュをバイパスする。
    const cacheKey = new Request(
      `${url.origin}${url.pathname}?v=${CACHE_VERSION}&jobId=${encodeURIComponent(jobId)}`,
      { method: "GET" }
    );

    const cached = await cache.match(cacheKey);

    if (cached) {
      const response = new Response(cached.body, cached);
      response.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
      response.headers.set("X-Worker-Cache", "HIT");
      return response;
    }

    const result = await resolveTopImage(jobId);

    const response = jsonResponse(
      result.body,
      result.status,
      result.body.ok
        ? {
            "Cache-Control": `public, max-age=${SUCCESS_CACHE_SECONDS}`,
            "X-Worker-Cache": "MISS",
          }
        : {
            "Cache-Control": "no-store",
            "X-Worker-Cache": "MISS",
          }
    );

    if (result.body.ok) {
      await cache.put(cacheKey, response.clone());
    }

    return response;
  },
};

async function resolveTopImage(jobId) {
  const jobUrl = `${JOB_BASE_URL}${jobId}`;

  let upstream;
  try {
    upstream = await fetch(jobUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
  } catch (error) {
    return {
      status: 502,
      body: {
        ok: false,
        code: "FETCH_ERROR",
        jobId,
        message: safeErrorMessage(error),
      },
    };
  }

  if (!upstream.ok) {
    return {
      status: 502,
      body: {
        ok: false,
        code: "UPSTREAM_HTTP_ERROR",
        jobId,
        upstreamStatus: upstream.status,
        message: `求人ページの取得に失敗しました。HTTP ${upstream.status}`,
      },
    };
  }

  const html = await upstream.text();
  const baseUrl = upstream.url || jobUrl;

  const jsonLdImage = extractImageFromJsonLd(html);
  if (jsonLdImage) {
    return success(jobId, jsonLdImage, "json-ld:image", baseUrl);
  }

  const srcsetMatch = html.match(
    /<figure\b[^>]*class=["'][^"']*bl_contents_imgWrap[^"']*["'][\s\S]*?<source\b[^>]*srcset=["']([^"']+)["']/i
  );

  if (srcsetMatch?.[1]) {
    const srcsetUrl = firstSrcsetUrl(srcsetMatch[1]);
    if (srcsetUrl) {
      return success(jobId, srcsetUrl, "picture:source-srcset", baseUrl);
    }
  }

  const dataSrcMatch = html.match(
    /<figure\b[^>]*class=["'][^"']*bl_contents_imgWrap[^"']*["'][\s\S]*?<img\b[^>]*data-src=["']([^"']+)["']/i
  );

  if (dataSrcMatch?.[1]) {
    return success(jobId, dataSrcMatch[1], "img:data-src", baseUrl);
  }

  return {
    status: 404,
    body: {
      ok: false,
      code: "IMAGE_NOT_FOUND",
      jobId,
      message: "求人ページは取得できましたが、TOP画像URLを特定できませんでした。",
    },
  };
}

function success(jobId, imageUrl, method, baseUrl) {
  const normalizedImageUrl = normalizeImageUrl(imageUrl, baseUrl);

  if (!normalizedImageUrl) {
    return {
      status: 404,
      body: {
        ok: false,
        code: "IMAGE_URL_INVALID",
        jobId,
        method,
        message: "TOP画像候補は見つかりましたが、有効な画像URLへ変換できませんでした。",
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      jobId,
      imageUrl: normalizedImageUrl,
      method,
      fetchedAt: new Date().toISOString(),
    },
  };
}

function normalizeImageUrl(value, baseUrl) {
  const raw = decodeHtml(value).trim();
  if (!raw) return "";

  try {
    const resolved = new URL(raw, baseUrl || JOB_BASE_URL);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.href
      : "";
  } catch {
    return "";
  }
}

function firstSrcsetUrl(value) {
  const decoded = decodeHtml(value).trim();
  if (!decoded) return "";

  const firstCandidate = decoded.split(",", 1)[0].trim();
  if (!firstCandidate) return "";

  return firstCandidate.split(/\s+/, 1)[0] || "";
}

function extractImageFromJsonLd(html) {
  const regex =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const image = findJobPostingImage(parsed);
      if (image) return image;
    } catch {}
  }

  return "";
}

function findJobPostingImage(value) {
  if (!value) return "";

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findJobPostingImage(item);
      if (result) return result;
    }
    return "";
  }

  if (typeof value !== "object") return "";

  const types = Array.isArray(value["@type"])
    ? value["@type"]
    : [value["@type"]];

  if (types.includes("JobPosting") && value.image) {
    const image = value.image;

    if (typeof image === "string") return image;

    if (Array.isArray(image) && image.length) {
      const first = image[0];
      if (typeof first === "string") return first;
      if (first && typeof first.url === "string") return first.url;
    }

    if (typeof image === "object" && typeof image.url === "string") {
      return image.url;
    }
  }

  if (Array.isArray(value["@graph"])) {
    const result = findJobPostingImage(value["@graph"]);
    if (result) return result;
  }

  return "";
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
    ...extra,
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({
      "Content-Type": "application/json; charset=UTF-8",
      ...extraHeaders,
    }),
  });
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
