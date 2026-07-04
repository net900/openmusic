import { resetGalaxyAudioWire } from '../components/galaxy/lib/galaxyAudio';
import { configureInlineAudio } from './audioUnlock';
import { useAudioStore } from '../stores/audioStore';
import { getAudioController } from './audioController';
import { clearAudioQueueBinding } from './audioTrackBinding';

let sharedAudio: HTMLAudioElement | null = null;

/** 通知 useAudioPlayer：共享 audio 已替换，需重新绑定事件 */
export let sharedAudioGeneration = 0;

export function applyAudioVolume(volume: number): void {
  const audio = sharedAudio;
  if (!audio) return;
  audio.volume = Math.min(1, Math.max(0, volume));
}

export function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    configureInlineAudio(sharedAudio);
    applyAudioVolume(useAudioStore.getState().volume);
  }
  return sharedAudio;
}

/**
 * 释放 Web Audio 劫持并重建共享 audio 元素。
 * 在离开房间或从频谱/代理模式切回直链播放时必须调用，否则可能永久无声。
 */
export function resetSharedAudioElement(): HTMLAudioElement {
  getAudioController().clearQueue();
  if (sharedAudio) {
    sharedAudio.pause();
    clearAudioQueueBinding(sharedAudio);
  }
  resetGalaxyAudioWire();
  sharedAudio = new Audio();
  sharedAudioGeneration += 1;
  configureInlineAudio(sharedAudio);
  applyAudioVolume(useAudioStore.getState().volume);
  return sharedAudio;
}

export function stopSharedAudio(): void {
  getAudioController().clearQueue();
  if (sharedAudio) {
    sharedAudio.pause();
    clearAudioQueueBinding(sharedAudio);
  }
  resetGalaxyAudioWire();
  sharedAudio = null;
  sharedAudioGeneration += 1;
}
