import { resolveEffectiveAudioQuality } from '../stores/userQualityStore';
import { useRoomStore } from '../stores/roomStore';
import { getQualityLabel } from '../api/music/quality';
import type { RoomAudioQuality } from '../types';
import Tooltip from './Tooltip';

interface Props {
  audioQuality?: RoomAudioQuality | null;
  className?: string;
  onClick?: () => void;
}

export default function RoomQualityBadge({ audioQuality, className = '', onClick }: Props) {
  const roomQuality = useRoomStore((s) => s.room?.audioQuality);
  const quality = resolveEffectiveAudioQuality(audioQuality ?? roomQuality);

  const content = (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-none text-netease-muted">
      <Tooltip content={`我的网易音质：${getQualityLabel(quality.netease)}`}>
        <span className="whitespace-nowrap">
          <span className="text-netease-red">网易</span>
          {' '}
          {getQualityLabel(quality.netease)}
        </span>
      </Tooltip>
      <span className="text-white/20" aria-hidden>·</span>
      <Tooltip content={`我的 QQ 音质：${getQualityLabel(quality.tencent)}`}>
        <span className="whitespace-nowrap">
          <span className="text-[#31c27c]">QQ</span>
          {' '}
          {getQualityLabel(quality.tencent)}
        </span>
      </Tooltip>
    </span>
  );

  if (!onClick) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left transition-opacity hover:opacity-80 ${className}`}
      aria-label="设置我的音质"
    >
      {content}
    </button>
  );
}
