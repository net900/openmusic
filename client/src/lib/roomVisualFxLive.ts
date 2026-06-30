import {
  readRoomVisualFx,
  writeRoomVisualFx,
  type RoomVisualFxSettings,
} from './roomVisualPreset';

/** 供 R3F useFrame 同步读取，绕过 Canvas 外 React 更新延迟 */
export const roomVisualFxLive: { current: RoomVisualFxSettings } = {
  current: readRoomVisualFx(),
};

export function commitRoomVisualFx(next: RoomVisualFxSettings): RoomVisualFxSettings {
  roomVisualFxLive.current = next;
  writeRoomVisualFx(next);
  return next;
}

export function patchRoomVisualFx(patch: Partial<RoomVisualFxSettings>): RoomVisualFxSettings {
  return commitRoomVisualFx({ ...roomVisualFxLive.current, ...patch });
}
