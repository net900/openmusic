import type { PlaybackState } from '../types';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { getSharedAudio } from './audioElement';
import { getAudioBoundQueueId } from './audioTrackBinding';
import { debugLine, debugLog } from './debugTools';
import {
  applyPlaybackState,
  getPlaybackTime,
  playbackStateFromRoom,
  resetPlaybackStateCache,
} from './playbackState';
import type { RoomState } from '../types';

type PendingSnapshot = {
  state: PlaybackState;
  receivedAt: number;
};

let pendingSnapshot: PendingSnapshot | null = null;

/** @deprecated 绑定改在 assign src 时写入 audio.dataset，此处保留空实现兼容旧调用 */
export function markAudioReadyTrackQueueId(_queueId: string | null): void {}

function syncRoomPlaybackFromState(state: PlaybackState) {
  const { room } = useRoomStore.getState();
  if (!room || room.id !== state.roomId) return;
  if (!room.current || room.current.queueId !== state.trackId) return;
  useRoomStore.getState().setRoom({
    ...room,
    currentTime: getPlaybackTime(state),
    isPlaying: state.status === 'playing',
  });
}

function isAudioReadyForSnapshot(trackId: string): boolean {
  const audio = getSharedAudio();
  if (!audio.src) return false;
  if (audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
  const duration = audio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const { room } = useRoomStore.getState();
  if (!room?.current || room.current.queueId !== trackId) return false;
  if (getAudioBoundQueueId(audio) !== trackId) return false;
  return true;
}

function queueSnapshot(state: PlaybackState, receivedAt: number): void {
  if (!pendingSnapshot || state.version >= pendingSnapshot.state.version) {
    pendingSnapshot = { state, receivedAt };
  }
}

function logPlaybackCommit(
  state: PlaybackState,
  receivedAt: number,
  committedAt: number,
  via: 'live' | 'flush_pending',
): void {
  const snapshotAgeMs = committedAt - receivedAt;
  const serverAgeMs = committedAt - (state.serverNowMs || state.updatedAt || committedAt);
  debugLog('playback_state_commit', debugLine({
    via,
    version: state.version,
    trackId: state.trackId,
    positionSec: Number(state.positionSec.toFixed(3)),
    snapshotAgeMs,
    serverAgeMs,
    receivedAt,
    committedAt,
    startedAt: state.startedAt || 0,
  }));
}

/** 立即应用（加入房间等初始同步） */
export function commitPlaybackState(
  state: PlaybackState,
  receivedAt = Date.now(),
): boolean {
  const committedAt = Date.now();
  if (!applyPlaybackState(state, { receivedAt, committedAt })) return false;
  useAudioStore.getState().setPlaybackVersion(state.version);
  syncRoomPlaybackFromState(state);
  return true;
}

/** 应用服务端播放状态；audio 未 ready 时先入队，避免 currentTime=0 跳秒 */
export function schedulePlaybackState(state: PlaybackState): void {
  const receivedAt = Date.now();
  if (!isAudioReadyForSnapshot(state.trackId)) {
    queueSnapshot(state, receivedAt);
    debugLog('playback_state_queued', debugLine({
      version: state.version,
      trackId: state.trackId,
      positionSec: Number(state.positionSec.toFixed(3)),
      receivedAt,
    }));
    return;
  }
  pendingSnapshot = null;
  const committedAt = Date.now();
  logPlaybackCommit(state, receivedAt, committedAt, 'live');
  commitPlaybackState(state, receivedAt);
}

/** audio ready 后刷入待处理的 snapshot */
export function flushPendingPlaybackSnapshot(): boolean {
  if (!pendingSnapshot) return false;
  const { state, receivedAt } = pendingSnapshot;
  if (!isAudioReadyForSnapshot(state.trackId)) return false;
  pendingSnapshot = null;
  const committedAt = Date.now();
  logPlaybackCommit(state, receivedAt, committedAt, 'flush_pending');
  return commitPlaybackState(state, receivedAt);
}

export function hasPendingPlaybackSnapshot(): boolean {
  return pendingSnapshot !== null;
}

export function resetPlaybackScheduling(): void {
  pendingSnapshot = null;
}

export function seedPlaybackFromRoom(room: RoomState): void {
  if (!room.current) {
    resetPlaybackStateCache();
    resetPlaybackScheduling();
    useAudioStore.getState().setPlaybackVersion(0);
    return;
  }
  const state = playbackStateFromRoom(
    room.id,
    room.current.queueId,
    room.isPlaying,
    room.currentTime,
    0,
    room.current.duration ?? 0,
  );
  schedulePlaybackState(state);
}
