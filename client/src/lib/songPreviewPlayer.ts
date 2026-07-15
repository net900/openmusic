import type { SearchResult } from '../types';
import { getSongUrl, songKey } from '../api/music';
import { getSharedAudio } from './audioElement';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';

export type SongPreviewStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type SongPreviewState = {
  key: string | null;
  status: SongPreviewStatus;
  error: string | null;
};

let previewAudio: HTMLAudioElement | null = null;
let activeKey: string | null = null;
let status: SongPreviewStatus = 'idle';
let lastError: string | null = null;
let loadToken = 0;
let pausedRoomForPreview = false;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((cb) => cb());
}

function getOrCreatePreviewAudio(): HTMLAudioElement {
  if (!previewAudio) {
    previewAudio = new Audio();
    previewAudio.preload = 'metadata';
    previewAudio.addEventListener('ended', () => {
      finishPreview({ resumeRoom: true });
    });
    previewAudio.addEventListener('error', () => {
      if (status === 'loading' || status === 'playing') {
        lastError = '试听加载失败';
        status = 'error';
        notify();
      }
    });
  }
  return previewAudio;
}

function pauseRoomAudioLocally() {
  const audio = getSharedAudio();
  if (!audio.paused) {
    audio.pause();
    pausedRoomForPreview = true;
  }
}

function resumeRoomAudioIfNeeded() {
  if (!pausedRoomForPreview) return;
  pausedRoomForPreview = false;
  const room = useRoomStore.getState().room;
  if (room?.isPlaying) {
    useAudioStore.getState().retryPlayback?.(true);
  }
}

function finishPreview(options: { resumeRoom: boolean }) {
  loadToken += 1;
  const audio = previewAudio;
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  activeKey = null;
  status = 'idle';
  lastError = null;
  notify();
  if (options.resumeRoom) resumeRoomAudioIfNeeded();
}

export function getSongPreviewState(): SongPreviewState {
  return { key: activeKey, status, error: lastError };
}

export function subscribeSongPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function stopSongPreview(options: { resumeRoom?: boolean } = {}) {
  if (status === 'idle' && !activeKey) return;
  finishPreview({ resumeRoom: options.resumeRoom !== false });
}

export async function toggleSongPreview(song: SearchResult): Promise<void> {
  const key = songKey(song);
  const audio = getOrCreatePreviewAudio();

  if (activeKey === key) {
    if (status === 'loading') return;
    if (status === 'playing') {
      audio.pause();
      status = 'paused';
      notify();
      return;
    }
    if (status === 'paused' || status === 'error') {
      pauseRoomAudioLocally();
      try {
        await audio.play();
        status = 'playing';
        lastError = null;
        notify();
      } catch {
        lastError = '无法播放试听';
        status = 'error';
        notify();
      }
      return;
    }
  }

  const token = ++loadToken;
  activeKey = key;
  status = 'loading';
  lastError = null;
  notify();

  pauseRoomAudioLocally();

  try {
    const url = await getSongUrl(song);
    if (token !== loadToken || activeKey !== key) return;
    if (!url) throw new Error('empty url');

    audio.src = url;
    await audio.play();
    if (token !== loadToken || activeKey !== key) return;
    status = 'playing';
    lastError = null;
    notify();
  } catch (err) {
    if (token !== loadToken) return;
    lastError = err instanceof Error && err.message ? '试听失败，换一首试试' : '试听失败';
    status = 'error';
    notify();
    resumeRoomAudioIfNeeded();
  }
}
