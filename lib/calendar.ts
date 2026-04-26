// 月カレンダーの組み立て。タイムゾーンに依存しないよう全部 UTC ベースで計算する。

export type CalendarCell = {
  iso: string; // YYYY-MM-DD
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // 0=日 .. 6=土
  inCurrentMonth: boolean;
};

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function lastDay(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return DAYS_PER_MONTH[month - 1];
}

export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  let m = month + delta;
  let y = year;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function buildMonthGrid(
  year: number,
  month: number,
): CalendarCell[][] {
  const firstWeekday = weekdayOf(year, month, 1);
  const daysInMonth = lastDay(year, month);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const daysInPrev = lastDay(prev.year, prev.month);

  const cells: CalendarCell[] = [];

  for (let i = firstWeekday - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    cells.push({
      iso: isoDate(prev.year, prev.month, d),
      year: prev.year,
      month: prev.month,
      day: d,
      weekday: weekdayOf(prev.year, prev.month, d),
      inCurrentMonth: false,
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      iso: isoDate(year, month, d),
      year,
      month,
      day: d,
      weekday: weekdayOf(year, month, d),
      inCurrentMonth: true,
    });
  }

  let nd = 1;
  while (cells.length < 42) {
    cells.push({
      iso: isoDate(next.year, next.month, nd),
      year: next.year,
      month: next.month,
      day: nd,
      weekday: weekdayOf(next.year, next.month, nd),
      inCurrentMonth: false,
    });
    nd++;
  }

  const rows: CalendarCell[][] = [];
  for (let i = 0; i < 42; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

export function defaultRequestMonth(): { year: number; month: number } {
  // 希望提出のデフォルトは「翌月」
  const now = new Date();
  return shiftMonth(now.getFullYear(), now.getMonth() + 1, 1);
}

export function parseYearMonth(
  yearStr: string | undefined,
  monthStr: string | undefined,
): { year: number; month: number } {
  const y = Number(yearStr);
  const m = Number(monthStr);
  if (
    Number.isInteger(y) &&
    y >= 2000 &&
    y <= 2100 &&
    Number.isInteger(m) &&
    m >= 1 &&
    m <= 12
  ) {
    return { year: y, month: m };
  }
  return defaultRequestMonth();
}
