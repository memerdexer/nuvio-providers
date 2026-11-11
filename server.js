/**
 * Stremio / Nuvio addon wrapper for the Nuvio providers in ./providers
 *
 *   /manifest.json                 -> ONE addon with ALL providers
 *   /<provider-id>/manifest.json   -> a separate addon for ONE provider
 *   /stream/<type>/<id>.json       -> streams from all providers
 *   /<provider-id>/stream/...      -> streams from that provider only
 *
 * Env vars (all optional):
 *   PORT              default 7000
 *   TMDB_API_KEY      used to convert IMDb ids (tt123) to TMDB ids
 *   PROVIDER_TIMEOUT  per-provider timeout in ms, default 25000
 *   PUBLIC_URL        e.g. https://my-addon.onrender.com (only used in logs)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 7000;
const TMDB_API_KEY = process.env.TMDB_API_KEY || '439c478a771f35c05022f9feabcca01c';
const TIMEOUT = parseInt(process.env.PROVIDER_TIMEOUT || '25000', 10);
const CACHE_MS = 10 * 60 * 1000;

// ---------- load providers (metadata comes from manifest.json) ----------
const repoManifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const providers = {};
for (const s of repoManifest.scrapers || []) {
  if (s.enabled === false) continue;
  try {
    const mod = require(path.join(__dirname, s.filename));
    const fn = mod && (mod.getStreams || (mod.default && mod.default.getStreams));
    if (typeof fn !== 'function') throw new Error('no getStreams export');
    providers[s.id] = { id: s.id, name: s.name, description: s.description, types: s.supportedTypes || ['movie', 'tv'], getStreams: fn };
  } catch (e) {
    console.error(`[addon] could not load ${s.id}: ${e.message}`);
  }
}
console.log(`[addon] loaded providers: ${Object.keys(providers).join(', ') || 'NONE'}`);

// ---------- helpers ----------
const cache = new Map();
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms)),
  ]);
}

async function imdbToTmdb(imdbId, type) {
  const key = `tmdb:${type}:${imdbId}`;
  if (cache.has(key)) return cache.get(key);
  const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
  const res = await fetch(url);
  const data = await res.json();
  const list = type === 'movie' ? data.movie_results : data.tv_results;
  const id = list && list[0] ? String(list[0].id) : null;
  if (id) cache.set(key, id);
  return id;
}

function toStremioStream(p, s) {
  const quality = s.quality ? ` ${s.quality}` : '';
  const lines = [s.title, s.size].filter(Boolean).join('\n');
  const out = {
    name: `${p.name}${quality}`,
    title: lines || p.name,
    url: s.url,
  };
  const hints = { notWebReady: true };
  if (s.headers && Object.keys(s.headers).length) {
    hints.proxyHeaders = { request: s.headers };
  }
  out.behaviorHints = hints;
  return out;
}

async function collectStreams(providerIds, type, stremioId) {
  const [imdbId, seasonStr, episodeStr] = stremioId.split(':');
  const nuvioType = type === 'movie' ? 'movie' : 'tv';
  const season = seasonStr ? parseInt(seasonStr, 10) : null;
  const episode = episodeStr ? parseInt(episodeStr, 10) : null;

  const cacheKey = `streams:${providerIds.join(',')}:${type}:${stremioId}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.value;

  const tmdbId = /^tt\d+$/.test(imdbId) ? await imdbToTmdb(imdbId, nuvioType) : imdbId.replace(/^tmdb:/, '');
  if (!tmdbId) return [];

  const jobs = providerIds
    .map((id) => providers[id])
    .filter((p) => p && p.types.includes(nuvioType))
    .map(async (p) => {
      try {
        const list = await withTimeout(Promise.resolve(p.getStreams(tmdbId, nuvioType, season, episode)), TIMEOUT, p.id);
        return (Array.isArray(list) ? list : []).filter((s) => s && s.url).map((s) => toStremioStream(p, s));
      } catch (e) {
        console.error(`[${p.id}] ${e.message}`);
        return [];
      }
    });

  const value = (await Promise.all(jobs)).flat();
  if (value.length) cache.set(cacheKey, { ts: Date.now(), value });
  return value;
}

function buildManifest(providerId) {
  const p = providerId ? providers[providerId] : null;
  return {
    id: p ? `community.memerdexer.${p.id}` : 'community.memerdexer.providers',
    version: repoManifest.version || '1.0.0',
    name: p ? p.name : repoManifest.name || 'Memerdexer Providers',
    description: p ? p.description : 'Streams from all providers in Memerdexer\'s repo',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: { configurable: false },
  };
}

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
  });
  res.end(JSON.stringify(body));
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const pathname = decodeURIComponent(req.url.split('?')[0]).replace(/\/+$/, '');
  const parts = pathname.split('/').filter(Boolean);

  try {
    if (parts.length === 0) {
      const base = process.env.PUBLIC_URL || `http://${req.headers.host}`;
      return send(res, 200, {
        status: 'ok',
        all_providers_addon: `${base}/manifest.json`,
        single_provider_addons: Object.fromEntries(Object.keys(providers).map((id) => [id, `${base}/${id}/manifest.json`])),
      });
    }

    // optional provider prefix
    let providerId = null;
    if (providers[parts[0]]) providerId = parts.shift();
    const ids = providerId ? [providerId] : Object.keys(providers);

    if (parts.length === 1 && parts[0] === 'manifest.json') return send(res, 200, buildManifest(providerId));

    if (parts[0] === 'stream' && parts.length === 3) {
      const type = parts[1];
      const id = parts[2].replace(/\.json$/, '');
      if (type !== 'movie' && type !== 'series') return send(res, 200, { streams: [] });
      const streams = await collectStreams(ids, type, id);
      return send(res, 200, { streams });
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 200, { streams: [] });
  }
});

server.listen(PORT, () => console.log(`[addon] listening on :${PORT}  ->  /manifest.json`));
