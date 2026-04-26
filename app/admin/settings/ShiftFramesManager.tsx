"use client";

import { useState, useTransition } from "react";
import {
  createShiftFrame,
  deleteShiftFrame,
  updateShiftFrame,
} from "./actions";

export type FrameRow = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  color: string;
  display_order: number;
};

const COLOR_OPTIONS = [
  { value: "green", label: "緑(早番)" },
  { value: "indigo", label: "青紫(遅番)" },
  { value: "amber", label: "黄(通し)" },
  { value: "gray", label: "灰(休み等)" },
  { value: "red", label: "赤" },
];

const COLOR_DOT: Record<string, string> = {
  green: "bg-emerald-200",
  indigo: "bg-indigo-200",
  amber: "bg-amber-200",
  gray: "bg-gray-200",
  red: "bg-red-200",
};

function trimSeconds(time: string): string {
  return /^\d{2}:\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : time;
}

export function ShiftFramesManager({ frames }: { frames: FrameRow[] }) {
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold">シフト枠マスタ</h2>
      <AddFrameForm />
      <FrameTable frames={frames} />
    </section>
  );
}

function AddFrameForm() {
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("15:00");
  const [color, setColor] = useState("green");
  const [displayOrder, setDisplayOrder] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createShiftFrame({
        name,
        start_time: startTime,
        end_time: endTime,
        color,
        display_order: Number(displayOrder),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-gray-200 rounded-md p-4 space-y-3 bg-gray-50"
    >
      <h3 className="text-sm font-semibold">+ シフト枠を追加</h3>
      <div className="flex flex-wrap gap-3 items-end">
        <Field label="名前">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-28"
            placeholder="早番"
            required
          />
        </Field>
        <Field label="開始">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            required
          />
        </Field>
        <Field label="終了">
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            required
          />
        </Field>
        <Field label="色">
          <select
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {COLOR_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="表示順">
          <input
            type="number"
            min="0"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-20"
          />
        </Field>
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col text-xs">
      <span className="text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function FrameTable({ frames }: { frames: FrameRow[] }) {
  if (frames.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        シフト枠が未登録です。上のフォームから追加してください。
      </p>
    );
  }
  return (
    <table className="w-full text-sm border border-gray-200 rounded">
      <thead className="bg-gray-100 text-left">
        <tr>
          <th className="px-3 py-2 font-medium">名前</th>
          <th className="px-3 py-2 font-medium">開始</th>
          <th className="px-3 py-2 font-medium">終了</th>
          <th className="px-3 py-2 font-medium">色</th>
          <th className="px-3 py-2 font-medium w-20">表示順</th>
          <th className="px-3 py-2 font-medium w-40">操作</th>
        </tr>
      </thead>
      <tbody>
        {frames.map((f) => (
          <FrameRowItem key={f.id} frame={f} />
        ))}
      </tbody>
    </table>
  );
}

function FrameRowItem({ frame }: { frame: FrameRow }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(frame.name);
  const [startTime, setStartTime] = useState(trimSeconds(frame.start_time));
  const [endTime, setEndTime] = useState(trimSeconds(frame.end_time));
  const [color, setColor] = useState(frame.color);
  const [displayOrder, setDisplayOrder] = useState(String(frame.display_order));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startEdit = () => {
    setName(frame.name);
    setStartTime(trimSeconds(frame.start_time));
    setEndTime(trimSeconds(frame.end_time));
    setColor(frame.color);
    setDisplayOrder(String(frame.display_order));
    setError(null);
    setEditing(true);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateShiftFrame(frame.id, {
        name,
        start_time: startTime,
        end_time: endTime,
        color,
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
    if (
      !window.confirm(
        `「${frame.name}」を削除しますか?(関連する希望・必要人数も連動して消えます)`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteShiftFrame(frame.id);
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
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </td>
        <td className="px-3 py-2">
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </td>
        <td className="px-3 py-2">
          <select
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {COLOR_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
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
            onClick={() => setEditing(false)}
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
      <td className="px-3 py-2">{frame.name}</td>
      <td className="px-3 py-2 text-gray-600">
        {trimSeconds(frame.start_time)}
      </td>
      <td className="px-3 py-2 text-gray-600">{trimSeconds(frame.end_time)}</td>
      <td className="px-3 py-2 text-gray-600">
        <span
          className={`inline-block w-3 h-3 rounded-full mr-1 align-middle ${
            COLOR_DOT[frame.color] ?? "bg-gray-200"
          }`}
        />
        {frame.color}
      </td>
      <td className="px-3 py-2 text-gray-600">{frame.display_order}</td>
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
