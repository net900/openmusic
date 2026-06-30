import type { RoomState } from '../types';

function stableRoomSnapshot(room: RoomState) {
  const { currentTime, ...rest } = room;
  return rest;
}

/** room_update 已是核心快照（不含 messages/songHistory），忽略纯播放时间漂移避免无效重渲染。 */
export function mergeRoomState(incoming: RoomState, current: RoomState | null): RoomState {
  if (!current || current.id !== incoming.id) {
    return incoming;
  }
  if (
    JSON.stringify(stableRoomSnapshot(incoming))
    === JSON.stringify(stableRoomSnapshot(current))
  ) {
    return current;
  }
  return incoming;
}
