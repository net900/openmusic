/**
 * 区分「息屏/切后台被系统挂起」与「用户从锁屏控件主动暂停」。
 * 刚进入 hidden 后短时间内的 pause/ended 视为系统行为，不可据此改房间播放态。
 */
const SYSTEM_SUSPEND_GRACE_MS = 2000;

let hiddenAtMs = 0;
let listenersInstalled = false;

export function installBackgroundPlaybackGuards(): void {
  if (listenersInstalled || typeof document === 'undefined') return;
  listenersInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAtMs = Date.now();
    }
  });
}

/** 页面刚进入后台时的系统挂起窗口内 */
export function isLikelySystemMediaSuspend(): boolean {
  if (typeof document === 'undefined' || !document.hidden) return false;
  if (!hiddenAtMs) return true;
  return Date.now() - hiddenAtMs < SYSTEM_SUSPEND_GRACE_MS;
}

/** 后台期间（含锁屏）：系统可能误触 pause，不应改房间状态 */
export function shouldIgnoreBackgroundRoomPause(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}
