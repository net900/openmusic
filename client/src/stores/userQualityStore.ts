import { create } from 'zustand';
import {
  DEFAULT_ROOM_AUDIO_QUALITY,
  normalizeRoomAudioQuality,
} from '../api/music/quality';
import type { RoomAudioQuality } from '../types';

const STORAGE_KEY = 'openmusic:user-audio-quality';

function readStoredQuality(): RoomAudioQuality | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeRoomAudioQuality(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistQuality(quality: RoomAudioQuality) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quality));
  } catch {
    // localStorage may be unavailable.
  }
}

interface UserQualityStore {
  quality: RoomAudioQuality | null;
  revision: number;
  setQuality: (quality: RoomAudioQuality) => void;
  clearQuality: () => void;
}

export const useUserQualityStore = create<UserQualityStore>((set, get) => ({
  quality: readStoredQuality(),
  revision: 0,
  setQuality: (input) => {
    const quality = normalizeRoomAudioQuality(input);
    const current = get().quality;
    if (
      current
      && current.netease === quality.netease
      && current.tencent === quality.tencent
    ) {
      return;
    }
    persistQuality(quality);
    set({ quality, revision: get().revision + 1 });
  },
  clearQuality: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage may be unavailable.
    }
    set({ quality: null, revision: get().revision + 1 });
  },
}));

export function getStoredUserAudioQuality(): RoomAudioQuality | null {
  return useUserQualityStore.getState().quality ?? readStoredQuality();
}

export function resolveEffectiveAudioQuality(
  roomQuality?: RoomAudioQuality | null,
): RoomAudioQuality {
  return normalizeRoomAudioQuality(
    getStoredUserAudioQuality()
    ?? roomQuality
    ?? DEFAULT_ROOM_AUDIO_QUALITY,
  );
}
