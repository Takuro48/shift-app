import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data, error } = await supabase
    .from("staff")
    .select("id, name")
    .order("display_order")
    .order("name");

  return (
    <main className="max-w-2xl mx-auto p-6 font-sans space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">シフト表アプリ</h1>
        <p className="text-xs text-gray-500">
          名簿から自分の名前を選んで希望を入力してください。
        </p>
      </header>

      {error ? (
        <p className="text-sm text-red-600">
          スタッフ取得エラー: {error.message}
        </p>
      ) : (
        <LoginForm staff={data ?? []} />
      )}

      <hr className="border-gray-200" />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">管理メニュー</h2>
        <ul className="text-sm text-blue-900 space-y-1">
          <li>
            <Link href="/admin/staff" className="underline hover:no-underline">
              スタッフ名簿管理 →
            </Link>
          </li>
          <li>
            <Link
              href="/admin/settings"
              className="underline hover:no-underline"
            >
              シフト枠 + 必要人数の設定 →
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
