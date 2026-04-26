import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { error } = await supabase
    .from("_supabase_health_check")
    .select("*")
    .limit(1);

  const reachable = error?.code !== undefined && error.code !== "ENOTFOUND";

  return (
    <main className="min-h-screen flex items-center justify-center p-8 font-sans">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-bold">シフト表アプリ</h1>
        <p className="text-sm text-gray-600">
          Supabase 接続: {reachable ? "OK(到達できています)" : "NG"}
        </p>
        {error && (
          <p className="text-xs text-gray-400">
            code: {error.code} / {error.message}
          </p>
        )}
        <p className="text-xs text-gray-400">
          Step 1 動作確認用ページ(Step 5 でログイン画面に置き換え予定)
        </p>
      </div>
    </main>
  );
}
