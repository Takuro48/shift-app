import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  dayCategoryFromWeekday,
  isoDate,
  lastDay,
  parseYearMonth,
  weekdayOf,
} from "@/lib/calendar";
import { getHolidayMapForMonth } from "@/lib/holidays";
import { EditMatrix } from "./EditMatrix";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  year?: string;
  month?: string;
}>;

export default async function EditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { year, month } = parseYearMonth(params.year, params.month);
  const start = isoDate(year, month, 1);
  const end = isoDate(year, month, lastDay(year, month));

  const [
    staffResult,
    framesResult,
    assignmentsResult,
    requestsResult,
    requiredResult,
  ] = await Promise.all([
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
      .select("staff_id, date, shift_frame_id, status")
      .gte("date", start)
      .lte("date", end),
    supabase
      .from("shift_requests")
      .select("staff_id, date, shift_frame_id")
      .gte("date", start)
      .lte("date", end),
    supabase
      .from("required_counts")
      .select("shift_frame_id, day_category, count"),
  ]);

  const holidays = getHolidayMapForMonth(year, month);
  const days = Array.from({ length: lastDay(year, month) }, (_, i) => {
    const day = i + 1;
    const weekday = weekdayOf(year, month, day);
    const iso = isoDate(year, month, day);
    const holidayName = holidays[iso] ?? null;
    return {
      day,
      iso,
      weekday,
      category: dayCategoryFromWeekday(weekday, !!holidayName),
      holidayName,
    };
  });

  return (
    <main className="max-w-[100rem] mx-auto p-6 font-sans space-y-4">
      <nav className="text-xs text-gray-500">
        <Link href="/" className="hover:underline">
          ← ホーム
        </Link>
      </nav>
      <h1 className="text-xl font-bold">シフト編集</h1>

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
          割当取得エラー: {assignmentsResult.error.message}
        </p>
      )}

      <EditMatrix
        year={year}
        month={month}
        days={days}
        staff={staffResult.data ?? []}
        frames={framesResult.data ?? []}
        assignments={assignmentsResult.data ?? []}
        requests={requestsResult.data ?? []}
        required={requiredResult.data ?? []}
      />
    </main>
  );
}
