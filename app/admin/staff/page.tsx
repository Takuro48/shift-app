import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { StaffManager } from "./StaffManager";

export const dynamic = "force-dynamic";

export default async function StaffAdminPage() {
  const { data, error } = await supabase
    .from("staff")
    .select("id, name, role, display_order")
    .order("display_order")
    .order("name");

  return (
    <main className="max-w-3xl mx-auto p-6 font-sans space-y-4">
      <nav className="text-xs text-gray-500">
        <Link href="/" className="hover:underline">
          ← ホーム
        </Link>
      </nav>
      <h1 className="text-xl font-bold">スタッフ名簿管理</h1>
      {error ? (
        <p className="text-sm text-red-600">
          スタッフ取得エラー: {error.message}
        </p>
      ) : (
        <StaffManager initialStaff={data ?? []} />
      )}
    </main>
  );
}
