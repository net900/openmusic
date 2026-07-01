const API_BASE = 'https://cn.apihz.cn/api/img/apihzbqbbaidu.php';
const APIHZ_IMG_ID = (process.env.APIHZ_IMG_ID || process.env.APIHZ_ID || '').trim();
const APIHZ_IMG_KEY = (process.env.APIHZ_IMG_KEY || process.env.APIHZ_KEY || '').trim();
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 20;
const SEARCH_TIMEOUT_MS = 10000;

export function isApihzStickerConfigured() {
  return Boolean(APIHZ_IMG_ID && APIHZ_IMG_KEY);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function searchApihzStickers(words, page = 1, limit = DEFAULT_LIMIT) {
  if (!isApihzStickerConfigured()) {
    throw new Error('未配置表情包搜索');
  }

  const normalizedWords = String(words || '').trim();
  if (!normalizedWords) throw new Error('请输入搜索关键词');
  if (normalizedWords.length > 32) throw new Error('关键词过长');

  const safePage = Math.max(1, Math.min(200, Number(page) || 1));
  const safeLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));

  const params = new URLSearchParams({
    id: APIHZ_IMG_ID,
    key: APIHZ_IMG_KEY,
    limit: String(safeLimit),
    page: String(safePage),
    words: normalizedWords,
  });

  const res = await fetchWithTimeout(`${API_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error('搜索服务暂时不可用');

  const data = await res.json();
  if (Number(data?.code) !== 200) {
    throw new Error(data?.msg || data?.message || '搜索失败');
  }

  const images = Array.isArray(data.res)
    ? data.res.filter((item) => typeof item === 'string' && item.startsWith('https://'))
    : [];

  return {
    images,
    page: Number(data.page) || safePage,
    maxPage: Math.max(1, Number(data.maxpage) || 1),
    count: Number(data.count) || images.length,
  };
}
