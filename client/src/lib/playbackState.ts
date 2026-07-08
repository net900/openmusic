import type { PlaybackState } from '../types';

/** 客户端缓存：服务端快照 + 本地收/提交时间 */
export type ClientPlaybackState = PlaybackState & {
  /** 收到 playback_state（或入 pending 队列）时刻，Date.now() */
  receivedAt: number;
  /** apply 到客户端缓存时刻，Date.now() */
  committedAt: number;
  basePositionSec: number;
};

const clientState = {
  server: null as ClientPlaybackState | null,
  localVersion: 0,
};

function statePositionSeconds(state: PlaybackState): number {
  const position = Number(state.positionSec ?? state.currentTime ?? 0);
  return Number.isFinite(position) && position > 0 ? position : 0;
}

/**
 * 播放进度：优先用服务端 startedAt 锚点（或 serverNowMs + positionSec），
 * 避免 pending snapshot 延迟刷入时把过期的 positionSec 当成「当前时刻」。
 */
export function getPlaybackTime(state: PlaybackState | null | undefined): number {
  if (!state) return 0;
  if (state.status !== 'playing') {
    return statePositionSeconds(state);
  }
  const startedAt = Number(state.startedAt);
  if (Number.isFinite(startedAt) && startedAt > 0) {
    return Math.max(0, (Date.now() - startedAt) / 1000);
  }
  const serverNowMs = Number(state.serverNowMs);
  if (Number.isFinite(serverNowMs) && serverNowMs > 0) {
    const base = statePositionSeconds(state);
    return Math.max(0, base + (Date.now() - serverNowMs) / 1000);
  }
  const cached = state as Partial<ClientPlaybackState>;
  const base = cached.basePositionSec ?? statePositionSeconds(state);
  const receivedAt = cached.receivedAt ?? cached.committedAt ?? Date.now();
  return Math.max(0, base + (Date.now() - receivedAt) / 1000);
}

export function getClientPlaybackState(): ClientPlaybackState | null {
  return clientState.server;
}

export function getClientPlaybackVersion(): number {
  return clientState.localVersion;
}

export function getPlaybackSnapshotTiming(): {
  receivedAt: number;
  committedAt: number;
  snapshotAgeMs: number;
} | null {
  const s = clientState.server;
  if (!s) return null;
  return {
    receivedAt: s.receivedAt,
    committedAt: s.committedAt,
    snapshotAgeMs: Math.max(0, s.committedAt - s.receivedAt),
  };
}

export type ApplyPlaybackTiming = {
  receivedAt: number;
  committedAt?: number;
};

export function applyPlaybackState(
  state: PlaybackState,
  timing?: ApplyPlaybackTiming,
): boolean {
  if (state.version < clientState.localVersion) return false;
  const committedAt = timing?.committedAt ?? Date.now();
  const receivedAt = timing?.receivedAt ?? committedAt;
  clientState.server = {
    ...state,
    positionSec: statePositionSeconds(state),
    basePositionSec: statePositionSeconds(state),
    receivedAt,
    committedAt,
  };
  clientState.localVersion = state.version;
  return true;
}

export function resetPlaybackStateCache(): void {
  clientState.server = null;
  clientState.localVersion = 0;
}

export function optimisticSeekPosition(
  roomId: string,
  trackId: string,
  positionSec: number,
  isPlaying: boolean,
): PlaybackState {
  const version = clientState.localVersion;
  const now = Date.now();
  const state = playbackStateFromRoom(roomId, trackId, isPlaying, positionSec, version);
  applyPlaybackState(state, { receivedAt: now, committedAt: now });
  return state;
}

export function playbackStateFromRoom(
  roomId: string,
  trackId: string,
  isPlaying: boolean,
  currentTime: number,
  version = 0,
  durationMs = 0,
): PlaybackState {
  const now = Date.now();
  const positionSec = Math.max(0, Number(currentTime) || 0);
  const durationSec = Number(durationMs) > 0 ? Number(durationMs) / 1000 : 0;
  return {
    roomId,
    version,
    trackId,
    status: isPlaying ? 'playing' : 'paused',
    positionSec,
    durationSec: durationSec > 0 ? durationSec : undefined,
    serverNowMs: now,
    startedAt: isPlaying ? now - positionSec * 1000 : 0,
    currentTime: positionSec,
    updatedAt: now,
  };
}
