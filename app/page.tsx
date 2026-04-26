import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [staffResult, framesResult] = await Promise.all([
    supabase.from("staff").select("id, name").order("display_order"),
    supabase.from("shift_frames").select("id, name").order("display_order"),
  ]);

  return (
    <main className="min-h-screen flex items-center justify-center p-8 font-sans">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-bold">シフト表アプリ</h1>
        <p className="text-sm text-gray-600">
          DB 接続: {staffResult.error ? "NG" : "OK"}
        </p>
        <p className="text-sm text-gray-600">
          登録スタッフ: {staffResult.data?.length ?? 0} 名 / シフト枠:{" "}
          {framesResult.data?.length ?? 0} 件
        </p>
        {staffResult.error && (
          <p className="text-xs text-red-500">
            {staffResult.error.code}: {staffResult.error.message}
          </p>
        )}
        <p className="text-xs text-gray-400">
          Step 2 動作確認用ページ(Step 5 でログイン画面に置き換え予定)
        </p>
      </div>
    </main>
  );
}
