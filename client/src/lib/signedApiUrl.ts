import { useEffect, useState } from 'react';
import { buildApiSignHeaders, canonicalApiQuery, needsApiSign } from './apiSign';
import { ensureSessionBootstrap } from './sessionBootstrap';

const SIGN_QUERY_KEYS = ['om_ts', 'om_nonce', 'om_sign'] as const;
/** 普通 API 签名缓存：略短于服务端 5 分钟窗口 */
const SIGNED_URL_CACHE_TTL_MS = 4 * 60 * 1000;
/** 媒体签名缓存：留足余量，配合服务端 20 分钟媒体窗口 */
const MEDIA_SIGNED_URL_CACHE_TTL_MS = 10 * 60 * 1000;
const MEDIA_API_PATHS = new Set(['/api/meting', '/api/media-proxy']);

const signedUrlCache = new Map<string, { url: string; expires: number }>();

function isMediaApiPath(pathname: string): boolean {
  return MEDIA_API_PATHS.has(pathname);
}

/** 去掉已有签名参数，得到可缓存/可重签的裸 URL */
export function stripApiSignParams(relativeUrl: string): string {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(relativeUrl, origin);
    for (const key of SIGN_QUERY_KEYS) parsed.searchParams.delete(key);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return relativeUrl;
  }
}

export async function signApiUrl(relativeUrl: string, options?: { force?: boolean }): Promise<string> {
  if (!needsApiSign(relativeUrl)) return relativeUrl;

  const cacheKey = stripApiSignParams(relativeUrl);
  if (!options?.force) {
    const cached = signedUrlCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.url;
  }

  await ensureSessionBootstrap();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const parsed = new URL(cacheKey, origin);
  const query = canonicalApiQuery(parsed.searchParams);
  const headers = await buildApiSignHeaders('GET', parsed.pathname, query, '');
  if (!headers['X-OM-Sign']) return cacheKey;

  parsed.searchParams.set('om_ts', headers['X-OM-Ts']);
  parsed.searchParams.set('om_nonce', headers['X-OM-Nonce']);
  parsed.searchParams.set('om_sign', headers['X-OM-Sign']);
  const signed = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const ttl = isMediaApiPath(parsed.pathname) ? MEDIA_SIGNED_URL_CACHE_TTL_MS : SIGNED_URL_CACHE_TTL_MS;
  signedUrlCache.set(cacheKey, { url: signed, expires: Date.now() + ttl });
  return signed;
}

/** 强制换发新签名（播放重试 / 中途续播时使用） */
export async function refreshSignedApiUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!needsApiSign(url)) return url;
  return signApiUrl(url, { force: true });
}

export async function resolveSignedApiUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!needsApiSign(url)) return url;
  return signApiUrl(url);
}

/** 为 `<img>` / `<audio>` 等同源媒体地址异步附加 query 签名 */
export function useSignedApiUrl(url: string | null | undefined): string | null {
  const [signed, setSigned] = useState<string | null>(() => {
    if (!url) return null;
    return needsApiSign(url) ? null : url;
  });

  useEffect(() => {
    if (!url) {
      setSigned(null);
      return;
    }
    if (!needsApiSign(url)) {
      setSigned(url);
      return;
    }

    let cancelled = false;
    void signApiUrl(url).then((next) => {
      if (!cancelled) setSigned(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return signed;
}
