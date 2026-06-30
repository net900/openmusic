import { Readable } from 'stream';

export const DEFAULT_MEDIA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function shouldBufferResponse(contentType, options) {
  if (options.forceBuffer) return true;
  if (options.thumbPx > 0) return true;
  if (contentType && /^image\//i.test(contentType)) return true;
  return false;
}

function isAudioStream(contentType, range) {
  if (range) return true;
  return Boolean(contentType && /^audio\//i.test(contentType));
}

/**
 * 从上游拉取媒体并返回给客户端。
 * 图片/缩略图整包缓冲，避免 HTTP/2 pipe 截断；音频 Range 仍流式转发。
 */
export async function serveUpstreamMedia(rawUrl, res, fetchWithTimeout, options = {}) {
  const headers = {
    'User-Agent': DEFAULT_MEDIA_UA,
    Accept: '*/*',
    Referer: 'https://music.163.com/',
    ...(options.headers || {}),
  };

  const range = String(options.range || '').trim();
  if (range) headers.Range = range;

  let response;
  try {
    response = await fetchWithTimeout(
      rawUrl,
      { headers, redirect: 'follow' },
      options.timeoutMs || 20000,
    );
  } catch {
    if (!res.headersSent) res.status(502).json({ error: '媒体代理失败' });
    return false;
  }

  if (!response.ok) {
    if (!res.headersSent) res.status(response.status).json({ error: '上游媒体请求失败' });
    return false;
  }

  const contentType = response.headers.get('content-type') || '';
  const useBuffer = shouldBufferResponse(contentType, options) && !isAudioStream(contentType, range);

  res.set('Cache-Control', 'public, max-age=3600');
  res.set('X-OpenMusic-Proxy', '1');

  if (useBuffer) {
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (res.writableEnded || res.destroyed) return false;
      if (contentType) res.set('Content-Type', contentType);
      res.status(200).send(buffer);
      return true;
    } catch {
      if (!res.headersSent) res.status(502).json({ error: '媒体代理失败' });
      return false;
    }
  }

  if (contentType) res.set('Content-Type', contentType);
  for (const header of ['accept-ranges', 'content-length', 'content-range']) {
    const value = response.headers.get(header);
    if (value) res.set(header, value);
  }

  if (!response.body) {
    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.status(response.status).send(buffer);
      return true;
    } catch {
      if (!res.headersSent) res.status(502).json({ error: '媒体代理失败' });
      return false;
    }
  }

  const stream = Readable.fromWeb(response.body);
  let clientGone = false;
  res.on('close', () => {
    clientGone = true;
    stream.destroy();
  });
  stream.on('error', () => {
    if (clientGone) return;
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  });

  res.status(response.status);
  stream.pipe(res);
  return true;
}

/** @deprecated 使用 serveUpstreamMedia */
export const pipeUpstreamMedia = serveUpstreamMedia;
