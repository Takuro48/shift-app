"use client";

import { useState, useTransition } from "react";
import { createStaff, deleteStaff, updateStaff } from "./actions";
import type { StaffRole } from "@/types/database";

type StaffRow = {
  id: string;
  name: string;
  role: StaffRole;
  display_order: number;
};

type Props = {
  initialStaff: StaffRow[];
};

export function StaffManager({ initialStaff }: Props) {
  return (
    <div className="space-y-6">
      <AddForm />
      <StaffTable staff={initialStaff} />
    </div>
  );
}

function AddForm() {
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [displayOrder, setDisplayOrder] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createStaff({
        name,
        role,
        display_order: Number(displayOrder),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setRole("staff");
      setDisplayOrder("0");
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-gray-200 rounded-md p-4 space-y-3 bg-gray-50"
    >
      <h2 className="text-sm font-semibold">+ スタッフ追加</h2>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col text-xs">
          <span className="text-gray-600 mb-1">名前</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            placeholder="山田太郎"
            required
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-gray-600 mb-1">役割</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="staff">staff</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-gray-600 mb-1">表示順</span>
          <input
            type="number"
            min="0"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-20"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="bg-blue-900 text-white text-sm px-4 py-1 rounded hover:bg-blue-800 disabled:opacity-50"
        >
          {isPending ? "追加中…" : "追加"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

function StaffTable({ staff }: { staff: StaffRow[] }) {
  if (staff.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        まだスタッフが登録されていません。上のフォームから追加してください。
      </p>
    );
  }
  return (
    <table className="w-full text-sm border border-gray-200 rounded">
      <thead className="bg-gray-100 text-left">
        <tr>
          <th className="px-3 py-2 font-medium">名前</th>
          <th className="px-3 py-2 font-medium">役割</th>
          <th className="px-3 py-2 font-medium w-24">表示順</th>
          <th className="px-3 py-2 font-medium w-40">操作</th>
        </tr>
      </thead>
      <tbody>
        {staff.map((s) => (
          <StaffTableRow key={s.id} staff={s} />
        ))}
      </tbody>
    </table>
  );
}

function StaffTableRow({ staff }: { staff: StaffRow }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(staff.name);
  const [role, setRole] = useState<StaffRole>(staff.role);
  const [displayOrder, setDisplayOrder] = useState(String(staff.display_order));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startEdit = () => {
    setName(staff.name);
    setRole(staff.role);
    setDisplayOrder(String(staff.display_order));
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateStaff(staff.id, {
        name,
        role,
        display_order: Number(displayOrder),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  };

  const remove = () => {
    if (!window.confirm(`「${staff.name}」を削除しますか?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteStaff(staff.id);
      if (!result.ok) setError(result.error);
    });
  };

  if (editing) {
    return (
      <tr className="border-t border-gray-200 bg-yellow-50">
        <td className="px-3 py-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-full"
          />
        </td>
        <td className="px-3 py-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="staff">staff</option>
            <option value="admin">admin</option>
          </select>
        </td>
        <td className="px-3 py-2">
          <input
            type="number"
            min="0"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-20"
          />
        </td>
        <td className="px-3 py-2 space-x-2">
          <button
            onClick={save}
            disabled={isPending}
            className="text-xs bg-blue-900 text-white px-2 py-1 rounded hover:bg-blue-800 disabled:opacity-50"
          >
            {isPending ? "…" : "保存"}
          </button>
          <button
            onClick={cancelEdit}
            disabled={isPending}
            className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-100"
          >
            キャンセル
          </button>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-gray-200">
      <td className="px-3 py-2">{staff.name}</td>
      <td className="px-3 py-2 text-gray-600">{staff.role}</td>
      <td className="px-3 py-2 text-gray-600">{staff.display_order}</td>
      <td className="px-3 py-2 space-x-2">
        <button
          onClick={startEdit}
          className="text-xs border border-gray-300 px-2 py-1 rounded hover:bg-gray-100"
        >
          編集
        </button>
        <button
          onClick={remove}
          disabled={isPending}
          className="text-xs border border-red-300 text-red-700 px-2 py-1 rounded hover:bg-red-50 disabled:opacity-50"
        >
          {isPending ? "…" : "削除"}
        </button>
        {error && <span className="text-xs text-red-600 ml-2">{error}</span>}
      </td>
    </tr>
  );
}
