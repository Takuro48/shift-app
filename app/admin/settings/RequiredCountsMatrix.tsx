"use client";

import { useState, useTransition } from "react";
import { saveRequiredCounts } from "./actions";
import type { DayCategory } from "@/types/database";
import type { FrameRow } from "./ShiftFramesManager";

const DAY_CATEGORIES: { key: DayCategory; label: string }[] = [
  { key: "weekday", label: "平日" },
  { key: "friday", label: "金" },
  { key: "saturday", label: "土" },
  { key: "sunday_holiday", label: "日・祝" },
];

export type CountRow = {
  shift_frame_id: string;
  day_category: DayCategory;
  count: number;
};

type Props = {
  frames: FrameRow[];
  initialCounts: CountRow[];
};

type CountMap = Record<string, Record<DayCategory, string>>;

function buildInitialMap(frames: FrameRow[], counts: CountRow[]): CountMap {
  const map: CountMap = {};
  for (const f of frames) {
    map[f.id] = {
      weekday: "0",
      friday: "0",
      saturday: "0",
      sunday_holiday: "0",
    };
  }
  for (const c of counts) {
    if (map[c.shift_frame_id]) {
      map[c.shift_frame_id][c.day_category] = String(c.count);
    }
  }
  return map;
}

export function RequiredCountsMatrix({ frames, initialCounts }: Props) {
  const [values, setValues] = useState<CountMap>(() =>
    buildInitialMap(frames, initialCounts),
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (frames.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-base font-semibold">必要人数</h2>
        <p className="text-sm text-gray-500">
          シフト枠を追加すると、ここに必要人数の入力欄が表示されます。
        </p>
      </section>
    );
  }

  const setCell = (frameId: string, day: DayCategory, raw: string) => {
    setValues((prev) => ({
      ...prev,
      [frameId]: { ...prev[frameId], [day]: raw },
    }));
    setSavedAt(null);
  };

  const handleSave = () => {
    setError(null);
    setSavedAt(null);
    const entries: CountRow[] = [];
    for (const f of frames) {
      for (const dc of DAY_CATEGORIES) {
        const raw = values[f.id]?.[dc.key] ?? "0";
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          setError(`「${f.name} / ${dc.label}」が0以上の整数ではありません`);
          return;
        }
        entries.push({
          shift_frame_id: f.id,
          day_category: dc.key,
          count: n,
        });
      }
    }

    startTransition(async () => {
      const result = await saveRequiredCounts(entries);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
    });
  };

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">必要人数</h2>
      <p className="text-xs text-gray-500">
        枠ごと・曜日カテゴリごとの必要人数を整数で入力してください(0以上)。
      </p>
      <table className="text-sm border border-gray-200 rounded">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-3 py-2 font-medium text-left">枠</th>
            <th className="px-3 py-2 font-medium text-left text-xs text-gray-500">
              時間
            </th>
            {DAY_CATEGORIES.map((d) => (
              <th
                key={d.key}
                className="px-3 py-2 font-medium text-center w-20"
              >
                {d.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {frames.map((f) => (
            <tr key={f.id} className="border-t border-gray-200">
              <td className="px-3 py-2 font-medium">{f.name}</td>
              <td className="px-3 py-2 text-xs text-gray-500">
                {f.start_time.slice(0, 5)}–{f.end_time.slice(0, 5)}
              </td>
              {DAY_CATEGORIES.map((d) => (
                <td key={d.key} className="px-3 py-2 text-center">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={values[f.id]?.[d.key] ?? "0"}
                    onChange={(e) => setCell(f.id, d.key, e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm w-16 text-right"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="bg-blue-900 text-white text-sm px-4 py-1 rounded hover:bg-blue-800 disabled:opacity-50"
        >
          {isPending ? "保存中…" : "保存"}
        </button>
        {savedAt && (
          <span className="text-xs text-green-700">{savedAt} に保存しました</span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </section>
  );
}
