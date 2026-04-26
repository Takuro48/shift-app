"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Staff = { id: string; name: string };

export function LoginForm({ staff }: { staff: Staff[] }) {
  const router = useRouter();
  const [staffId, setStaffId] = useState("");

  if (staff.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        スタッフが未登録です。先に管理メニューから名簿を登録してください。
      </p>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffId) return;
    router.push(`/request?staff=${staffId}`);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-xs">
        <span className="text-gray-600 mb-1">名前</span>
        <select
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm min-w-[12rem]"
          required
        >
          <option value="" disabled>
            選択してください
          </option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={!staffId}
        className="bg-blue-900 text-white text-sm px-5 py-2 rounded hover:bg-blue-800 disabled:opacity-50"
      >
        希望を入力する →
      </button>
    </form>
  );
}
