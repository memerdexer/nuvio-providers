"use strict";
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop)) __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b))
      if (__propIsEnum.call(b, prop)) __defNormalProp(a, prop, b[prop]);
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// ---------- Domain config ----------
// Primary domain is now .one — fallbacks are tried in order if it fails.
var KNOWN_DOMAINS = ["https://4khdhub.one", "https://4khdhub.click"];
var BASE_URL = KNOWN_DOMAINS[0];
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var domainCache = { url: BASE_URL, ts: 0 };

// Probe a domain by hitting its homepage; return true if it looks alive.
function probeDomain(domain) {
  return __async(this, null, function* () {
    try {
      const res = yield fetch(domain, {
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT }
      });
      if (!res.ok) return false;
      const txt = yield res.text();
      // Very loose check — 4khdhub pages include "4KHDHub" / "movie-card" / search form
      return /4khdhub|movie-card|hdhub/i.test(txt);
    } catch {
      return false;
    }
  });
}

function fetchLatestDomain() {
  return __async(this, null, function* () {
    const now = Date.now();
    // Cache success for 1 hour
    if (now - domainCache.ts < 36e5 && domainCache.url) return domainCache.url;

    // 1) Remote domains.json (authoritative if it has a 4khdhub entry)
    try {
      const response = yield fetch(DOMAINS_URL);
      const data = yield response.json();
      if (data && data["4khdhub"]) {
        const remote = String(data["4khdhub"]).trim();
        // Only trust it if it responds
        if (yield probeDomain(remote)) {
          domainCache.url = remote;
          domainCache.ts = now;
          return domainCache.url;
        }
        console.log(`[4KHDHub] Remote domain ${remote} unreachable, falling back`);
      }
    } catch (e) {
      console.log(`[4KHDHub] domains.json fetch failed: ${e.message}`);
    }

    // 2) Try known domains in order
    for (const d of KNOWN_DOMAINS) {
      if (yield probeDomain(d)) {
        domainCache.url = d;
        domainCache.ts = now;
        return d;
      }
    }

    // 3) Nothing reachable — return primary anyway so requests still go somewhere
    console.log("[4KHDHub] All domains unreachable, defaulting to primary");
    return KNOWN_DOMAINS[0];
  });
}

// ---------- HTTP ----------
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const retries = options.retries !== void 0 ? options.retries : 2;
    const delay = options.delay !== void 0 ? options.delay : 1e3;
    for (let i = 0; i <= retries; i++) {
      try {
        const response = yield fetch(url, {
          redirect: "follow",
          headers: __spreadValues({
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9"
          }, options.headers)
        });
        return yield response.text();
      } catch (err) {
        console.log(`[4KHDHub] Request failed for ${url}: ${err.message}${i < retries ? `, retrying (${i + 1}/${retries})...` : ""}`);
      }
      if (i < retries) yield new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
    }
    return null;
  });
}

// ---------- TMDB ----------
function getTmdbDetails(tmdbId, type) {
  return __async(this, null, function* () {
    const isSeries = type === "series" || type === "tv";
    const endpoint = isSeries ? "tv" : "movie";
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    try {
      const response = yield fetch(url);
      const data = yield response.json();
      if (isSeries) {
        return {
          title: data.name,
          year: data.first_air_date ? parseInt(data.first_air_date.split("-")[0]) : 0,
          originalTitle: data.original_name
        };
      }
      return {
        title: data.title,
        year: data.release_date ? parseInt(data.release_date.split("-")[0]) : 0,
        originalTitle: data.original_title
      };
    } catch (error) {
      console.log(`[4KHDHub] TMDB request failed: ${error.message}`);
      return null;
    }
  });
}

// ---------- Crypto / helpers ----------
function atob(input) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let str = String(input).replace(/=+$/, "");
  if (str.length % 4 === 1) throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
  let output = "";
  for (let bc = 0, bs, buffer, i = 0; buffer = str.charAt(i++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    buffer = chars.indexOf(buffer);
  }
  return output;
}
function rot13Cipher(str) {
  return str.replace(/[a-zA-Z]/g, function (c) {
    return String.fromCharCode((c <= "Z" ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
  });
}
function levenshteinDistance(s, t) {
  if (s === t) return 0;
  const n = s.length, m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const d = [];
  for (let i = 0; i <= n; i++) { d[i] = []; d[i][0] = i; }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = s.charAt(i - 1) === t.charAt(j - 1) ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[n][m];
}
function parseBytes(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const match = String(val).match(/([0-9.]+)\s*([a-zA-Z]+)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  let multiplier = 1;
  if (unit.indexOf("k") === 0) multiplier = 1024;
  else if (unit.indexOf("m") === 0) multiplier = 1024 * 1024;
  else if (unit.indexOf("g") === 0) multiplier = 1024 * 1024 * 1024;
  else if (unit.indexOf("t") === 0) multiplier = 1024 * 1024 * 1024 * 1024;
  return num * multiplier;
}
function formatBytes(val) {
  if (!val || val === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  let i = Math.floor(Math.log(val) / Math.log(k));
  if (i < 0) i = 0;
  return parseFloat((val / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
function normalizeUrl(base, href) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  try { return new URL(href, base).toString(); } catch { return null; }
}
function tryAtob(s) {
  try { return atob(s); } catch { return null; }
}

// ---------- Search page ----------
var cheerio = require("cheerio-without-node-native");

function fetchPageUrls(name, year, isSeries) {
  return __async(this, null, function* () {
    const domain = yield fetchLatestDomain();
    const searchUrl = `${domain}/?s=${encodeURIComponent(name + " " + year)}`;
    console.log(`[4KHDHub] Search Request URL: ${searchUrl}`);
    const html = yield fetchText(searchUrl);
    if (!html) { console.log("[4KHDHub] Search failed: No HTML response"); return []; }
    const $ = cheerio.load(html);
    const targetType = isSeries ? "Series" : "Movies";

    let matched = $(".movie-card").filter((_, el) => {
      if (!$(el).find(`.movie-card-format:contains("${targetType}")`).length) return false;
      const movieCardYear = parseInt($(el).find(".movie-card-meta").text());
      if (isNaN(movieCardYear) || Math.abs(movieCardYear - year) > 1) return false;
      const movieCardTitle = $(el).find(".movie-card-title").text().replace(/\[.*?]/g, "").trim();
      return levenshteinDistance(movieCardTitle.toLowerCase(), name.toLowerCase()) < 8;
    });

    if (matched.length === 0) {
      console.log("[4KHDHub] Strict search returned 0, falling back to title-only match");
      matched = $(".movie-card").filter((_, el) => {
        if (!$(el).find(`.movie-card-format:contains("${targetType}")`).length) return false;
        const movieCardTitle = $(el).find(".movie-card-title").text().replace(/\[.*?]/g, "").trim();
        return levenshteinDistance(movieCardTitle.toLowerCase(), name.toLowerCase()) < 10;
      });
    }

    const urls = matched.map((_, el) => normalizeUrl(domain, $(el).attr("href"))).get().filter(Boolean);
    console.log(`[4KHDHub] Found ${urls.length} matching page(s)`);
    return urls;
  });
}

// ---------- Provider classification ----------
function classifyProvider(url, text) {
  const t = (text || "").toLowerCase();
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch {}
  const u = url.toLowerCase();

  if (/r2\.cloudflarestorage\.com/.test(host)) return "R2 (S3)";
  if (/\.r2\.dev$/.test(host)) return "R2";
  if (/\.workers\.dev$/.test(host)) return "ZipDisk";
  if (/pixel\.hubcloud\.pw/.test(host)) return "PixelServer";
  if (/video-downloads\.googleusercontent\.com/.test(host)) return "GDrive";
  if (/drive\.google\.com/.test(host)) return "GDrive";
  if (/hbplay\.pages\.dev/.test(host)) return "HBPlay";
  if (/pixeldrain\.com/.test(host)) return "Pixeldrain";
  if (/gdflix\./.test(host)) return "GDFlix";
  if (/hubcdn\./.test(host)) return "HubCDN";
  if (/hubstream\./.test(host)) return "HubStream";
  if (/hubdrive\./.test(host)) return "HubDrive";
  if (/hubcloud\./.test(host)) return "HubCloud";
  if (/10gbps/.test(t) || /pixelserver/.test(t)) return "10Gbps";
  if (/\bfsl\b/.test(t) || /fsl\./.test(host)) return "FSL";
  if (/zipdisk/.test(t)) return "ZipDisk";
  if (/\.(mkv|mp4|m4v|avi|webm|mov)(\?|$)/i.test(u)) return "Direct Video";
  if (/\.(zip|rar|7z)(\?|$)/i.test(u)) return "Archive";
  return null;
}

function looksLikeFileUrl(url, text) {
  const u = url.toLowerCase();
  if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|map|html?)(\?|$)/i.test(u)) return false;
  if (/google-analytics|googletagmanager|doubleclick|facebook|twitter|disqus|cdnjs|jsdelivr/i.test(u)) return false;
  if (classifyProvider(url, text)) return true;
  if (/download|stream|server|play|file/i.test(text || "")) return true;
  return false;
}

// ---------- Collect ALL links from an HTML blob ----------
function collectLinks(html, baseUrl) {
  const found = [];
  const seen = new Set();
  const push = (href, text) => {
    if (!href) return;
    const abs = normalizeUrl(baseUrl, href);
    if (!abs) return;
    if (seen.has(abs)) return;
    if (!looksLikeFileUrl(abs, text)) return;
    seen.add(abs);
    found.push({ url: abs, text: (text || "").trim() });
  };

  const $ = cheerio.load(html);

  $("a").each((_, el) => push($(el).attr("href"), $(el).text()));

  ["source", "video", "iframe"].forEach((tag) => {
    $(tag).each((_, el) => push($(el).attr("src"), tag));
  });

  const varUrlRe = /var\s+url\s*=\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = varUrlRe.exec(html))) push(m[1], "var-url");

  const locRe = /(?:window\.|document\.|top\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/g;
  while ((m = locRe.exec(html))) push(m[1], "js-location");

  const metaRe = /http-equiv=["']refresh["'][^>]*url=([^"'>\s]+)/gi;
  while ((m = metaRe.exec(html))) push(m[1], "meta-refresh");

  const jsonRe = /"(?:url|link|file|src|href)"\s*:\s*"([^"]+)"/g;
  while ((m = jsonRe.exec(html))) push(m[1].replace(/\\\//g, "/"), "json");

  const rawRe = /https?:\/\/[^\s'"<>]+/g;
  while ((m = rawRe.exec(html))) {
    const raw = m[0].replace(/\\\//g, "/");
    if (/r2\.cloudflarestorage\.com|video-downloads\.googleusercontent\.com|r2\.dev|workers\.dev|pixeldrain|\.mkv|\.mp4/i.test(raw)) {
      push(raw, "script");
    }
  }

  return found;
}

// ---------- Decode base64-wrapped player URLs (hbplay.pages.dev?u=...) ----------
function decodeWrappedUrl(url) {
  try {
    const u = new URL(url);
    const encoded = u.searchParams.get("u");
    if (!encoded) return null;
    const decoded = tryAtob(encoded);
    if (decoded && /^https?:\/\//.test(decoded)) return decoded;
  } catch {}
  return null;
}

// ---------- Recursive resolver ----------
async function resolveDeep(startUrl, meta, depth, visited, results) {
  if (!startUrl || depth > 3 || visited.has(startUrl)) return;
  visited.add(startUrl);

  const provider = classifyProvider(startUrl, "");
  const isFinal =
    provider === "R2 (S3)" ||
    provider === "R2" ||
    provider === "ZipDisk" ||
    provider === "GDrive" ||
    provider === "Pixeldrain" ||
    provider === "Direct Video" ||
    provider === "Archive";

  if (isFinal) {
    results.push({ source: provider, url: startUrl, meta });
    return;
  }

  if (provider === "HBPlay") {
    const decoded = decodeWrappedUrl(startUrl);
    if (decoded) {
      await resolveDeep(decoded, meta, depth + 1, visited, results);
      return;
    }
  }

  const html = await fetchText(startUrl, { headers: { Referer: startUrl } });
  if (!html) return;

  const links = collectLinks(html, startUrl);
  for (const l of links) {
    if (visited.has(l.url)) continue;
    const p = classifyProvider(l.url, l.text);
    const isChildFinal =
      p === "R2 (S3)" || p === "R2" || p === "ZipDisk" || p === "GDrive" ||
      p === "Pixeldrain" || p === "Direct Video" || p === "Archive";

    if (isChildFinal) {
      results.push({ source: p, url: l.url, meta });
      visited.add(l.url);
    } else {
      await resolveDeep(l.url, meta, depth + 1, visited, results);
    }
  }
}

// ---------- Extract from a download-item card ----------
function extractSourceResults($, el) {
  return __async(this, null, function* () {
    const localHtml = $(el).html() || "";
    const sizeMatch = localHtml.match(/([\d.]+ ?[GMK]B)/i);
    const heightMatch = localHtml.match(/\d{3,}p/);
    const title = $(el).find(".file-title, .episode-file-title").text().trim() || $(el).text().trim();

    let height = heightMatch ? parseInt(heightMatch[0]) : 0;
    if (height === 0 && /(4k|2160p)/i.test(localHtml)) height = 2160;
    if (height === 0 && /(1080p)/i.test(localHtml)) height = 1080;
    if (height === 0 && /(720p)/i.test(localHtml)) height = 720;

    const meta = {
      bytes: sizeMatch ? parseBytes(sizeMatch[1]) : 0,
      height,
      title
    };

    const anchors = [];
    $(el).find("a").each((_, a) => {
      const text = $(a).text().trim();
      const href = $(a).attr("href");
      if (!href) return;
      const abs = normalizeUrl(BASE_URL, href);
      if (!abs) return;
      if (looksLikeFileUrl(abs, text)) anchors.push({ url: abs, text });
    });

    if (anchors.length === 0) return null;
    return { anchors, meta };
  });
}

// ---------- Main ----------
var cheerio3 = require("cheerio-without-node-native");

function episodeMatches(text, season, episode) {
  if (!season || !episode) return false;
  const seasonOk = new RegExp(`S0?${season}(?!\\d)`, "i").test(text);
  const epOk = new RegExp(
    `(Episode[- _]?0?${episode}(?!\\d)|E0?${episode}(?!\\d)|(?<![\\d])0?${episode}(?![\\d]))`,
    "i"
  ).test(text);
  return seasonOk && epOk;
}

function getStreams(tmdbId, type, season, episode) {
  return __async(this, null, function* () {
    const tmdbDetails = yield getTmdbDetails(tmdbId, type);
    if (!tmdbDetails) return [];
    const { title, year } = tmdbDetails;
    const isSeries = type === "series" || type === "tv";
    console.log(`[4KHDHub] Search: ${title} (${year})`);

    const pageUrls = yield fetchPageUrls(title, year, isSeries);
    if (!pageUrls.length) { console.log("[4KHDHub] No pages found"); return []; }

    const allStreams = [];
    const urlDedupe = new Set();

    for (const pageUrl of pageUrls) {
      console.log(`[4KHDHub] Scraping page: ${pageUrl}`);
      const html = yield fetchText(pageUrl);
      if (!html) continue;
      const $ = cheerio3.load(html);

      const itemsToProcess = [];

      if (isSeries && season && episode) {
        $(".episode-item").each((_, el) => {
          if (!new RegExp(`S0?${season}(?!\\d)`, "i").test($(el).text())) return;
          $(el).find(".episode-download-item").each((_2, item) => {
            if (episodeMatches($(item).text() + " " + ($(item).html() || ""), season, episode)) itemsToProcess.push(item);
          });
        });
        if (itemsToProcess.length === 0) {
          $(".episode-download-item, .download-item").each((_, item) => {
            if (episodeMatches($(item).text() + " " + ($(item).html() || ""), season, episode)) itemsToProcess.push(item);
          });
        }
      } else {
        $(".download-item").each((_, el) => itemsToProcess.push(el));
      }

      console.log(`[4KHDHub] Processing ${itemsToProcess.length} item(s) on ${pageUrl}`);

      const streamPromises = itemsToProcess.map((item) =>
        __async(this, null, function* () {
          try {
            const sourceResult = yield extractSourceResults($, item);
            if (!sourceResult) return [];

            const collected = [];
            const visited = new Set();
            for (const anchor of sourceResult.anchors) {
              yield resolveDeep(anchor.url, sourceResult.meta, 0, visited, collected);
            }

            return collected.map((link) => ({
              name: `4KHDHub - ${link.source}${sourceResult.meta.height ? ` ${sourceResult.meta.height}p` : ""}`,
              title: `${link.meta.title || sourceResult.meta.title}\n${formatBytes(link.meta.bytes || 0)}`,
              url: link.url,
              quality: sourceResult.meta.height ? `${sourceResult.meta.height}p` : void 0,
              behaviorHints: { bingeGroup: `4khdhub-${link.source}` }
            }));
          } catch (err) {
            console.log(`[4KHDHub] Item processing error: ${err.message}`);
            return [];
          }
        })
      );

      const results = yield Promise.all(streamPromises);
      for (const list of results) {
        for (const s of list) {
          if (urlDedupe.has(s.url)) continue;
          urlDedupe.add(s.url);
          allStreams.push(s);
        }
      }
    }

    console.log(`[4KHDHub] Total streams: ${allStreams.length}`);
    return allStreams;
  });
}

module.exports = { getStreams };