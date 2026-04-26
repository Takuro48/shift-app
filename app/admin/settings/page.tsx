import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ShiftFramesManager } from "./ShiftFramesManager";
import { RequiredCountsMatrix } from "./RequiredCountsMatrix";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [framesResult, countsResult] = await Promise.all([
    supabase
      .from("shift_frames")
      .select("id, name, start_time, end_time, color, display_order")
      .order("display_order")
      .order("name"),
    supabase
      .from("required_counts")
      .select("shift_frame_id, day_category, count"),
  ]);

  const frames = framesResult.data ?? [];
  const counts = countsResult.data ?? [];

  return (
    <main className="max-w-4xl mx-auto p-6 font-sans space-y-6">
      <nav className="text-xs text-gray-500">
        <Link href="/" className="hover:underline">
          ← ホーム
        </Link>
      </nav>
      <h1 className="text-xl font-bold">シフト枠 + 必要人数の設定</h1>
      {framesResult.error && (
        <p className="text-sm text-red-600">
          シフト枠取得エラー: {framesResult.error.message}
        </p>
      )}
      {countsResult.error && (
        <p className="text-sm text-red-600">
          必要人数取得エラー: {countsResult.error.message}
        </p>
      )}
      <ShiftFramesManager frames={frames} />
      <hr className="border-gray-200" />
      <RequiredCountsMatrix frames={frames} initialCounts={counts} />
    </main>
  );
}
