import https from 'node:https';
import http from 'node:http';

const METING_API_URL = (process.env.METING_API_URL || '').replace(/\/$/, '');

let metingHost = '';
try {
  metingHost = METING_API_URL ? new URL(METING_API_URL).hostname : '';
} catch {
  metingHost = '';
}

const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function isMetingUrl(url) {
  if (!metingHost) return false;
  try {
    return new URL(url).hostname === metingHost;
  } catch {
    return false;
  }
}

function requestOnce(url, options = {}, timeoutMs = 10000) {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      agent: isHttps && isMetingUrl(url) ? insecureHttpsAgent : undefined,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          status: res.statusCode || 0,
          headers: {
            get: (name) => res.headers[String(name).toLowerCase()] ?? null,
          },
          text: async () => body.toString('utf8'),
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Meting 请求超时'));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

/** Meting 镜像站证书链在 Node 下常无法校验，浏览器可访问但 fetch 会失败 */
export async function fetchMeting(url, options = {}, timeoutMs = 10000) {
  return requestOnce(url, options, timeoutMs);
}

export function formatMetingFetchError(err) {
  const cause = err?.cause;
  if (cause?.code) return `${err?.message || 'fetch failed'} (${cause.code})`;
  if (cause?.message) return `${err?.message || 'fetch failed'} (${cause.message})`;
  return err?.message || 'fetch failed';
}
