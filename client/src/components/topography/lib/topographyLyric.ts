import { filterDisplayLyrics } from '../../../api/music';
import type { LyricLine } from '../../../types';

export interface ActiveLyricState {
  text: string;
  progress: number;
}

/** 当前行歌词 + 行内卡拉 OK 进度（0–1） */
export function getActiveLyricWithProgress(
  lines: LyricLine[],
  currentTime: number,
): ActiveLyricState | null {
  const displayLines = filterDisplayLyrics(lines);
  if (!displayLines.length) return null;

  const activeIndex = displayLines.findIndex((line, i) => {
    const next = displayLines[i + 1];
    return currentTime >= line.time && (!next || currentTime < next.time);
  });

  if (activeIndex < 0) {
    if (currentTime < displayLines[0].time) return null;
    const last = displayLines[displayLines.length - 1];
    return { text: last.text, progress: 1 };
  }

  const current = displayLines[activeIndex];
  const next = displayLines[activeIndex + 1];
  const duration = next ? Math.max(0.08, next.time - current.time) : 4;
  const progress = Math.max(0, Math.min(1, (currentTime - current.time) / duration));
  return { text: current.text, progress };
}
