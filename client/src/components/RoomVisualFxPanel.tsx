import { createPortal } from 'react-dom';
import { Settings2, X } from 'lucide-react';
import type { RoomVisualFxSettings } from '../lib/roomVisualPreset';
import { DEFAULT_ROOM_VISUAL_FX } from '../lib/roomVisualPreset';

interface Props {
  open: boolean;
  value: RoomVisualFxSettings;
  onChange: (next: RoomVisualFxSettings) => void;
  onClose: () => void;
}

function rangePct(value: number, min: number, max: number): string {
  const pct = ((value - min) / (max - min)) * 100;
  return `${Math.min(100, Math.max(0, pct))}%`;
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  const display = formatValue ? formatValue(value) : value.toFixed(2);
  const pct = rangePct(value, min, max);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-white">{label}</span>
        <span className="tabular-nums text-xs text-netease-muted">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--range-pct' as string]: pct }}
        className="setting-range w-full"
        aria-label={label}
      />
    </div>
  );
}

export default function RoomVisualFxPanel({ open, value, onChange, onClose }: Props) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="relative flex max-h-[min(78vh,560px)] w-full max-w-md animate-fade-in flex-col overflow-hidden rounded-2xl border border-white/10 bg-netease-dark shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-netease-border/50 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-white">
              <Settings2 className="h-4 w-4 text-netease-red" />
              视觉参数
            </h2>
            <p className="mt-0.5 text-xs text-netease-muted">调整背景动效强度与镜头表现</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          <SliderRow
            label="镜头远近"
            min={0.55}
            max={1.65}
            step={0.01}
            value={value.cameraDistance}
            onChange={(cameraDistance) => onChange({ ...value, cameraDistance })}
            formatValue={(v) => (v < 0.9 ? '较近' : v > 1.1 ? '较远' : '默认')}
          />
          <SliderRow
            label="强度"
            min={0.2}
            max={1.6}
            step={0.01}
            value={value.intensity}
            onChange={(intensity) => onChange({ ...value, intensity })}
          />
          <SliderRow
            label="深度"
            min={0.2}
            max={1.8}
            step={0.01}
            value={value.depth}
            onChange={(depth) => onChange({ ...value, depth })}
          />
          <SliderRow
            label="粒子大小"
            min={0.5}
            max={2.2}
            step={0.01}
            value={value.point}
            onChange={(point) => onChange({ ...value, point })}
          />
          <SliderRow
            label="速度"
            min={0.2}
            max={2.5}
            step={0.01}
            value={value.speed}
            onChange={(speed) => onChange({ ...value, speed })}
          />
          <SliderRow
            label="色彩"
            min={0.5}
            max={2}
            step={0.01}
            value={value.colorBoost}
            onChange={(colorBoost) => onChange({ ...value, colorBoost })}
          />
          <SliderRow
            label="光晕"
            min={0}
            max={1.6}
            step={0.01}
            value={value.bloomStrength}
            onChange={(bloomStrength) => onChange({ ...value, bloomStrength })}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-netease-border/50 px-5 py-4">
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_ROOM_VISUAL_FX })}
            className="rounded-xl border border-netease-border px-4 py-2 text-sm text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
          >
            恢复默认
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/90"
          >
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
