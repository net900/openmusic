import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  NETEASE_QUALITY_OPTIONS,
  TENCENT_QUALITY_OPTIONS,
  normalizeRoomAudioQuality,
} from '../api/music/quality';
import type { RoomAudioQuality } from '../types';

interface Props {
  open: boolean;
  value: RoomAudioQuality;
  saving?: boolean;
  onClose: () => void;
  onSave: (quality: RoomAudioQuality) => void;
}

export default function RoomQualityModal({ open, value, saving = false, onClose, onSave }: Props) {
  if (!open) return null;

  const current = normalizeRoomAudioQuality(value);

  const handleNeteaseChange = (netease: string) => {
    onSave({ ...current, netease });
  };

  const handleTencentChange = (tencent: string) => {
    onSave({ ...current, tencent });
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="relative w-full max-w-md animate-fade-in rounded-2xl border border-white/10 bg-netease-dark p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">我的音质</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-xs leading-5 text-netease-muted">
          仅影响你本机的播放与预加载，不影响房间内其他人。网络较慢时可选择较低音质以减少卡顿。
        </p>

        <div className="space-y-4">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-netease-red">网易</span>
              <span className="text-sm text-netease-muted">网易云音乐</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {NETEASE_QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  onClick={() => handleNeteaseChange(opt.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    current.netease === opt.value
                      ? 'border-netease-red/40 bg-netease-red/15 text-white'
                      : 'border-white/10 bg-netease-card text-netease-muted hover:border-white/20 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-[#31c27c]">QQ</span>
              <span className="text-sm text-netease-muted">QQ音乐</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {TENCENT_QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={saving}
                  onClick={() => handleTencentChange(opt.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    current.tencent === opt.value
                      ? 'border-[#31c27c]/40 bg-[#31c27c]/15 text-white'
                      : 'border-white/10 bg-netease-card text-netease-muted hover:border-white/20 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
