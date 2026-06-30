import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Settings2, X } from 'lucide-react';
import type { RoomVisualFxSettings } from '../lib/roomVisualPreset';
import { DEFAULT_ROOM_VISUAL_FX } from '../lib/roomVisualPreset';

interface Props {
  open: boolean;
  value: RoomVisualFxSettings;
  onPatch: (patch: Partial<RoomVisualFxSettings>) => void;
  onReset: () => void;
  onClose: () => void;
  onDraggingChange?: (dragging: boolean) => void;
}

type SliderKey =
  | 'cameraDistance'
  | 'intensity'
  | 'depth'
  | 'coverResolution'
  | 'point'
  | 'speed'
  | 'twist'
  | 'colorBoost'
  | 'scatter'
  | 'bgFade'
  | 'bloomStrength';

interface SliderDef {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  formatValue?: (v: number) => string;
  patch?: (v: number, current: RoomVisualFxSettings) => Partial<RoomVisualFxSettings>;
}

const SLIDERS: SliderDef[] = [
  {
    key: 'cameraDistance',
    label: '镜头远近',
    min: 0.55,
    max: 1.65,
    step: 0.01,
    formatValue: (v) => (v < 0.9 ? '较近' : v > 1.1 ? '较远' : '默认'),
  },
  { key: 'intensity', label: '强度', min: 0.2, max: 1.6, step: 0.01 },
  { key: 'depth', label: '深度', min: 0.2, max: 1.8, step: 0.01 },
  { key: 'coverResolution', label: '封面精度', min: 0.75, max: 1.55, step: 0.01 },
  { key: 'point', label: '粒子大小', min: 0.5, max: 2.2, step: 0.01 },
  { key: 'speed', label: '速度', min: 0.2, max: 2.5, step: 0.01 },
  { key: 'twist', label: '扭曲', min: 0, max: 0.6, step: 0.01 },
  { key: 'colorBoost', label: '色彩', min: 0.5, max: 2, step: 0.01 },
  { key: 'scatter', label: '散射', min: 0, max: 0.5, step: 0.01 },
  { key: 'bgFade', label: '背景淡化', min: 0, max: 1.2, step: 0.01 },
  {
    key: 'bloomStrength',
    label: '光晕强度',
    min: 0,
    max: 1.6,
    step: 0.01,
    patch: (bloomStrength) => ({
      bloomStrength,
      bloom: bloomStrength > 0.01,
    }),
  },
];

function rangePct(v: number, min: number, max: number): string {
  const pct = ((v - min) / (max - min)) * 100;
  return `${Math.min(100, Math.max(0, pct))}%`;
}

function FxSlider({
  def,
  value,
  onLiveChange,
  onDragStart,
}: {
  def: SliderDef;
  value: number;
  onLiveChange: (v: number) => void;
  onDragStart: () => void;
}) {
  const pct = rangePct(value, def.min, def.max);
  const display = def.formatValue ? def.formatValue(value) : value.toFixed(2);

  return (
    <div className="pointer-events-auto select-none">
      <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
        <span className="text-xs font-medium text-white/75">{def.label}</span>
        <span className="text-[11px] tabular-nums text-white/50">{display}</span>
      </div>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onPointerDown={(e) => {
          e.stopPropagation();
          onDragStart();
        }}
        onInput={(e) => onLiveChange(Number(e.currentTarget.value))}
        onChange={(e) => onLiveChange(Number(e.currentTarget.value))}
        style={{ ['--range-pct' as string]: pct }}
        className="visual-fx-range w-full"
        aria-label={def.label}
      />
    </div>
  );
}

function FxToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="pointer-events-auto flex items-center justify-between gap-2 px-0.5">
      <span className="text-xs font-medium text-white/75">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-netease-red/90' : 'bg-white/15'}`}
      >
        <span
          aria-hidden
          className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function preserveSlot(hidden: boolean, children: ReactNode) {
  return (
    <div className={hidden ? 'pointer-events-none invisible' : undefined}>{children}</div>
  );
}

export default function RoomVisualFxPanel({
  open,
  value,
  onPatch,
  onReset,
  onClose,
  onDraggingChange,
}: Props) {
  const [draggingKey, setDraggingKey] = useState<SliderKey | null>(null);
  const dragging = draggingKey !== null;

  useEffect(() => {
    onDraggingChange?.(dragging);
  }, [dragging, onDraggingChange]);

  useEffect(() => {
    if (!draggingKey) return;
    const end = () => setDraggingKey(null);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [draggingKey]);

  useEffect(() => {
    if (!open) setDraggingKey(null);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      {!dragging ? (
        <button
          type="button"
          className="absolute inset-0 cursor-default bg-transparent"
          onClick={onClose}
          aria-label="关闭参数面板"
        />
      ) : null}

      <div
        className={`absolute right-2 top-[3.75rem] bottom-20 z-10 flex max-h-[min(78vh,calc(100%-5.5rem))] w-[13rem] flex-col overflow-hidden sm:right-3 sm:w-[13.5rem] ${
          dragging
            ? 'rounded-2xl border border-transparent bg-transparent shadow-none'
            : 'rounded-2xl border border-white/15 bg-[#14161c]/92 shadow-2xl backdrop-blur-xl [-webkit-backdrop-filter:blur(20px)]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex shrink-0 items-center justify-between px-3.5 py-2.5 ${
            dragging ? 'pointer-events-none invisible border-b border-transparent' : 'border-b border-white/10'
          }`}
        >
          <h2 className="flex items-center gap-1.5 text-xs font-semibold text-white/90">
            <Settings2 className="h-3.5 w-3.5 text-netease-red" />
            视觉参数
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
            tabIndex={dragging ? -1 : 0}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex max-h-[min(68vh,calc(100vh-8rem))] flex-col gap-3 overflow-y-auto px-3.5 py-3">
          {preserveSlot(
            dragging,
            <button
              type="button"
              onClick={onReset}
              className="pointer-events-auto self-end text-[10px] text-white/45 transition-colors hover:text-white/80"
              tabIndex={dragging ? -1 : 0}
            >
              恢复默认
            </button>,
          )}

          {SLIDERS.map((def) => {
            const hidden = draggingKey !== null && draggingKey !== def.key;
            return (
              <div key={def.key} className={hidden ? 'pointer-events-none invisible' : undefined}>
                <FxSlider
                  def={def}
                  value={value[def.key]}
                  onDragStart={() => setDraggingKey(def.key)}
                  onLiveChange={(v) => {
                    onPatch(def.patch ? def.patch(v, value) : { [def.key]: v });
                  }}
                />
              </div>
            );
          })}

          {preserveSlot(
            dragging,
            <div className="flex flex-col gap-3 border-t border-white/10 pt-3">
              <FxToggle
                label="光晕"
                checked={value.bloom && value.bloomStrength > 0.01}
                onChange={(bloom) =>
                  onPatch(
                    bloom
                      ? {
                          bloom: true,
                          ...(value.bloomStrength <= 0.01
                            ? { bloomStrength: DEFAULT_ROOM_VISUAL_FX.bloomStrength }
                            : {}),
                        }
                      : { bloom: false },
                  )
                }
              />
              <FxToggle label="边缘增强" checked={value.edge} onChange={(edge) => onPatch({ edge })} />
            </div>,
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
