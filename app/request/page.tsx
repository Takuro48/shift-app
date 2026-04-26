import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  buildMonthGrid,
  isoDate,
  lastDay,
  parseYearMonth,
} from "@/lib/calendar";
import { RequestEditor } from "./RequestEditor";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  staff?: string;
  year?: string;
  month?: string;
}>;

export default async function RequestPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const staffId = params.staff;
  const { year, month } = parseYearMonth(params.year, params.month);

  if (!staffId) {
    return (
      <main className="max-w-2xl mx-auto p-6 font-sans space-y-3">
        <p className="text-sm text-red-600">
          スタッフが指定されていません。ホーム画面から名前を選んでください。
        </p>
        <Link href="/" className="text-sm text-blue-900 hover:underline">
          ← ホームへ
        </Link>
      </main>
    );
  }

  const [staffResult, framesResult, requestsResult] = await Promise.all([
    supabase.from("staff").select("id, name").eq("id", staffId).maybeSingle(),
    supabase
      .from("shift_frames")
      .select("id, name, color")
      .order("display_order")
      .order("name"),
    supabase
      .from("shift_requests")
      .select("date, shift_frame_id")
      .eq("staff_id", staffId)
      .gte("date", isoDate(year, month, 1))
      .lte("date", isoDate(year, month, lastDay(year, month))),
  ]);

  if (staffResult.error || !staffResult.data) {
    return (
      <main className="max-w-2xl mx-auto p-6 font-sans space-y-3">
        <p className="text-sm text-red-600">
          スタッフが見つかりません: {staffResult.error?.message ?? staffId}
        </p>
        <Link href="/" className="text-sm text-blue-900 hover:underline">
          ← ホームへ
        </Link>
      </main>
    );
  }

  const weeks = buildMonthGrid(year, month);
  const frames = framesResult.data ?? [];
  const initialSelections = requestsResult.data ?? [];

  return (
    <main className="max-w-4xl mx-auto p-6 font-sans space-y-4">
      <nav className="text-xs text-gray-500">
        <Link href="/" className="hover:underline">
          ← ホーム
        </Link>
      </nav>
      <h1 className="text-xl font-bold">希望シフトの入力</h1>
      {framesResult.error && (
        <p className="text-sm text-red-600">
          シフト枠取得エラー: {framesResult.error.message}
        </p>
      )}
      {requestsResult.error && (
        <p className="text-sm text-red-600">
          希望取得エラー: {requestsResult.error.message}
        </p>
      )}
      {frames.length === 0 ? (
        <p className="text-sm text-gray-500">
          シフト枠が未登録です。管理者に
          <Link
            href="/admin/settings"
            className="text-blue-900 underline mx-1"
          >
            シフト枠 + 必要人数の設定
          </Link>
          で枠を登録してもらってください。
        </p>
      ) : (
        <RequestEditor
          staffId={staffResult.data.id}
          staffName={staffResult.data.name}
          year={year}
          month={month}
          weeks={weeks}
          frames={frames}
          initialSelections={initialSelections}
        />
      )}
    </main>
  );
}
