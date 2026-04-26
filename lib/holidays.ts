import { getHolidaysOf } from "japanese-holidays";
import { isoDate } from "@/lib/calendar";

export type HolidayMap = Record<string, string>; // 'YYYY-MM-DD' -> 祝日名

const cache = new Map<number, HolidayMap>();

function holidayMapForYear(year: number): HolidayMap {
  const cached = cache.get(year);
  if (cached) return cached;
  const map: HolidayMap = {};
  for (const h of getHolidaysOf(year, true)) {
    map[isoDate(year, h.month, h.date)] = h.name;
  }
  cache.set(year, map);
  return map;
}

// 指定月のカレンダーが触れる範囲(前月末〜翌月頭)を含む祝日マップを返す。
export function getHolidayMapForMonth(
  year: number,
  month: number,
): HolidayMap {
  const years = new Set<number>([year]);
  if (month === 1) years.add(year - 1);
  if (month === 12) years.add(year + 1);
  const merged: HolidayMap = {};
  for (const y of years) {
    Object.assign(merged, holidayMapForYear(y));
  }
  return merged;
}
