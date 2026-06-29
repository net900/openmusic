import { getSongUrl, getTrackKey } from '../api/music';
import {
  buildQualityFallbackChain,
  getDowngradedQuality,
  getLowestQuality,
  getRoomPlaybackQuality,
} from '../api/music/quality';
import { useRoomStore } from '../stores/roomStore';
import type { MusicSource, QueueItem } from '../types';
import { isMobileDevice } from './audioUnlock';

const MAX_URL_CACHE = 24;
const DEFAULT_PREFETCH_COUNT = 2;
const URL_CACHE_STORAGE_KEY = 'openmusic:song-url-cache';

const urlCache = loadUrlCacheFromStorage();
const pendingFetches = new Map<string, Promise<string | null>>();
const sourceErrorKeys = new Set<string>();
const sourceErrorListeners = new Set<() => void>();
/** 本机临时降档（不影响房间音质设置） */
const localQualityOverrides = new Map<string, string>();

function notifySourceErrors() {
  sourceErrorListeners.forEach((listener) => listener());
}

export function subscribeSourceErrors(listener: () => void) {
  sourceErrorListeners.add(listener);
  return () => {
    sourceErrorListeners.delete(listener);
  };
}

export function isTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>): boolean {
  return sourceErrorKeys.has(trackKeyOf(song));
}

function markTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  const key = trackKeyOf(song);
  if (sourceErrorKeys.has(key)) return;
  sourceErrorKeys.add(key);
  notifySourceErrors();
}

function clearTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  const key = trackKeyOf(song);
  if (!sourceErrorKeys.delete(key)) return;
  notifySourceErrors();
}

function clearLocalQualityOverride(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  localQualityOverrides.delete(trackKeyOf(song));
}

function setLocalQualityOverride(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>, quality: string) {
  localQualityOverrides.set(trackKeyOf(song), quality);
}

/** 移除已不在播放列表中的源错误标记，避免 Set 无限增长 */
export function pruneSourceErrors(activeSongs: Array<Pick<QueueItem, 'queueId' | 'id' | 'source'>>) {
  const activeKeys = new Set(activeSongs.map(trackKeyOf));
  let changed = false;
  for (const key of sourceErrorKeys) {
    if (!activeKeys.has(key)) {
      sourceErrorKeys.delete(key);
      changed = true;
    }
  }
  for (const key of localQualityOverrides.keys()) {
    if (!activeKeys.has(key)) {
      localQualityOverrides.delete(key);
    }
  }
  if (changed) notifySourceErrors();
}

function loadUrlCacheFromStorage(): Map<string, string> {
  try {
    const raw = sessionStorage.getItem(URL_CACHE_STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function persistUrlCacheToStorage() {
  try {
    const entries = [...urlCache.entries()].slice(-MAX_URL_CACHE);
    sessionStorage.setItem(URL_CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // sessionStorage may be unavailable.
  }
}

function trackKeyOf(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  return getTrackKey(song);
}

function songSourceOf(song: Pick<QueueItem, 'source'>): MusicSource {
  return song.source || 'netease';
}

function getEffectivePlaybackQuality(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>): string | undefined {
  const source = songSourceOf(song);
  return localQualityOverrides.get(trackKeyOf(song)) ?? getRoomPlaybackQuality(source);
}

function urlCacheKey(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source'>,
  quality?: string,
) {
  const effective = quality ?? getEffectivePlaybackQuality(song);
  return `${trackKeyOf(song)}:${effective || 'default'}`;
}

/**
 * 房主（播放主控）已在播当前曲时，视为歌曲源可用，听众侧失败更可能是本机网络/高码率问题。
 */
export function isPlaybackLeaderAheadOnTrack(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>): boolean {
  const { room, isPlaybackLeader } = useRoomStore.getState();
  if (isPlaybackLeader || !room?.current) return false;
  return room.isPlaying && room.current.queueId === song.queueId;
}

/** 房主在播当前曲时逐级降档；房主也失败时仅尝试房间音质后直跳最低档 */
function useGradualQualityFallback(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>): boolean {
  return isPlaybackLeaderAheadOnTrack(song);
}

function buildJumpQualityChain(
  source: MusicSource,
  startQuality: string,
): string[] {
  const lowest = getLowestQuality(source);
  if (!lowest || lowest === startQuality) return [startQuality];
  return [startQuality, lowest];
}

function buildFetchQualityChain(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>): Array<string | undefined> {
  const source = songSourceOf(song);
  const roomQuality = getRoomPlaybackQuality(source);
  if (!roomQuality) return [undefined];

  const override = localQualityOverrides.get(trackKeyOf(song));
  const startQuality = override ?? roomQuality;

  if (useGradualQualityFallback(song)) {
    return buildQualityFallbackChain(source, startQuality);
  }

  return buildJumpQualityChain(source, startQuality);
}

export function clearSongUrlCache() {
  urlCache.clear();
  pendingFetches.clear();
  localQualityOverrides.clear();
  try {
    sessionStorage.removeItem(URL_CACHE_STORAGE_KEY);
  } catch {
    // sessionStorage may be unavailable.
  }
}

function trimUrlCache() {
  while (urlCache.size > MAX_URL_CACHE) {
    const oldest = urlCache.keys().next().value;
    if (!oldest) break;
    urlCache.delete(oldest);
  }
  persistUrlCacheToStorage();
}

async function fetchSongUrlOnce(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
  quality: string | undefined,
  options: { refresh?: boolean } = {},
): Promise<string | null> {
  const key = urlCacheKey(song, quality);
  if (options.refresh) {
    urlCache.delete(key);
  } else {
    const cached = urlCache.get(key);
    if (cached) return cached;
  }

  const pendingKey = options.refresh ? `${key}:refresh` : key;
  const pending = pendingFetches.get(pendingKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      let url: string | null = null;
      try {
        url = await getSongUrl({
          id: song.id,
          source: songSourceOf(song),
          url: options.refresh ? undefined : song.url,
        }, quality);
      } catch {
        return null;
      }
      if (!url) return null;
      urlCache.set(key, url);
      trimUrlCache();
      return url;
    } finally {
      pendingFetches.delete(pendingKey);
    }
  })();

  pendingFetches.set(pendingKey, promise);
  return promise;
}

async function fetchSongUrl(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
  options: { refresh?: boolean } = {},
): Promise<string | null> {
  const qualities = buildFetchQualityChain(song);
  const startIndex = Math.max(
    0,
    qualities.findIndex((quality) => quality === getEffectivePlaybackQuality(song)),
  );
  const tryQualities = qualities.slice(startIndex >= 0 ? startIndex : 0);

  for (let index = 0; index < tryQualities.length; index += 1) {
    const quality = tryQualities[index];
    if (quality) {
      setLocalQualityOverride(song, quality);
    } else {
      clearLocalQualityOverride(song);
    }

    const url = await fetchSongUrlOnce(
      song,
      quality,
      { refresh: options.refresh || index > 0 },
    );
    if (url) {
      clearTrackSourceError(song);
      return url;
    }
  }

  const { isPlaybackLeader } = useRoomStore.getState();
  if (isPlaybackLeader || !isPlaybackLeaderAheadOnTrack(song)) {
    markTrackSourceError(song);
  }
  return null;
}

/** 播放中音频加载失败时降档重试：房主在播则降一级，否则直跳最低档 */
export async function tryDowngradeSongUrl(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
): Promise<string | null> {
  const source = songSourceOf(song);
  const current = getEffectivePlaybackQuality(song) ?? getRoomPlaybackQuality(source);
  if (!current) return null;

  let target: string | null;
  if (useGradualQualityFallback(song)) {
    target = getDowngradedQuality(source, current);
  } else {
    const lowest = getLowestQuality(source);
    if (!lowest || lowest === current) return null;
    target = lowest;
  }

  if (!target) return null;

  setLocalQualityOverride(song, target);
  return fetchSongUrl(song, { refresh: true });
}

export function rememberSongUrl(trackKey: string, url: string) {
  urlCache.set(trackKey, url);
  trimUrlCache();
}

export async function resolveSongUrl(
  song: QueueItem,
  options: { refresh?: boolean } = {},
): Promise<string> {
  const url = await fetchSongUrl(song, options);
  if (!url) throw new Error('empty url');
  return url;
}

/** 加入房间后立即预取当前歌曲 URL，缩短刷新后的加载等待 */
export function prefetchCurrentSong(song: QueueItem | null | undefined) {
  if (!song) return;
  void fetchSongUrl(song);
}

export function prefetchQueueSongs(
  queue: QueueItem[],
  options: { count?: number; current?: QueueItem | null } = {},
) {
  const count = options.count ?? DEFAULT_PREFETCH_COUNT;
  const targets = queue.slice(0, isMobileDevice() ? 1 : count);

  if (options.current) {
    pruneSourceErrors([options.current, ...queue]);
  } else {
    pruneSourceErrors(queue);
  }

  for (const song of targets) {
    void fetchSongUrl(song);
  }
}
