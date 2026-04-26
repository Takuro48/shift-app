import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  buildMonthGrid,
  isoDate,
  lastDay,
  shiftMonth,
  weekdayOf,
} from "@/lib/calendar";
import { getHolidayMapForMonth } from "@/lib/holidays";
import { ViewSwitcher } from "./ViewSwitcher";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  year?: string;
  month?: string;
  staff?: string;
}>;

function parseViewMonth(
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
  // 確認画面のデフォルトは「今月」
  const now = new Date();
  return shiftMonth(now.getFullYear(), now.getMonth() + 1, 0);
}

export default async function ViewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { year, month } = parseViewMonth(params.year, params.month);
  const highlightStaffId = params.staff ?? null;

  const start = isoDate(year, month, 1);
  const end = isoDate(year, month, lastDay(year, month));

  const [staffResult, framesResult, assignmentsResult] = await Promise.all([
    supabase
      .from("staff")
      .select("id, name")
      .order("display_order")
      .order("name"),
    supabase
      .from("shift_frames")
      .select("id, name, color")
      .order("display_order")
      .order("name"),
    supabase
      .from("shift_assignments")
      .select("staff_id, date, shift_frame_id")
      .eq("status", "confirmed")
      .gte("date", start)
      .lte("date", end),
  ]);

  const weeks = buildMonthGrid(year, month);
  const holidays = getHolidayMapForMonth(year, month);
  const daysInMonth = Array.from(
    { length: lastDay(year, month) },
    (_, i) => {
      const day = i + 1;
      return {
        day,
        iso: isoDate(year, month, day),
        weekday: weekdayOf(year, month, day),
      };
    },
  );

  return (
    <main className="max-w-[100rem] mx-auto p-6 font-sans space-y-4">
      <nav className="text-xs text-gray-500">
        <Link href="/" className="hover:underline">
          ← ホーム
        </Link>
      </nav>
      <h1 className="text-xl font-bold">確定シフトの確認</h1>
      <p className="text-xs text-gray-500">
        確定済み(管理者が「✓ 確定して通知」を押したもの)のみ表示しています。
      </p>

      {staffResult.error && (
        <p className="text-sm text-red-600">
          スタッフ取得エラー: {staffResult.error.message}
        </p>
      )}
      {framesResult.error && (
        <p className="text-sm text-red-600">
          シフト枠取得エラー: {framesResult.error.message}
        </p>
      )}
      {assignmentsResult.error && (
        <p className="text-sm text-red-600">
          シフト取得エラー: {assignmentsResult.error.message}
        </p>
      )}

      <ViewSwitcher
        year={year}
        month={month}
        highlightStaffId={highlightStaffId}
        staff={staffResult.data ?? []}
        frames={framesResult.data ?? []}
        assignments={assignmentsResult.data ?? []}
        weeks={weeks}
        daysInMonth={daysInMonth}
        holidays={holidays}
      />
    </main>
  );
}
