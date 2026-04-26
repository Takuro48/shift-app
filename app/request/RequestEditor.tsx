"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CalendarCell } from "@/lib/calendar";
import { shiftMonth } from "@/lib/calendar";
import { saveRequests } from "./actions";

type Frame = {
  id: string;
  name: string;
  color: string;
};

type Props = {
  staffId: string;
  staffName: string;
  year: number;
  month: number;
  weeks: CalendarCell[][];
  frames: Frame[];
  initialSelections: { date: string; shift_frame_id: string }[];
};

const COLOR_CHIP_SELECTED: Record<string, string> = {
  green: "bg-emerald-200 text-emerald-900 border-emerald-400",
  indigo: "bg-indigo-200 text-indigo-900 border-indigo-400",
  amber: "bg-amber-200 text-amber-900 border-amber-400",
  gray: "bg-gray-300 text-gray-900 border-gray-500",
  red: "bg-red-200 text-red-900 border-red-400",
};

const CHIP_UNSELECTED = "bg-white text-gray-400 border-gray-300";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function selectionKey(date: string, frameId: string): string {
  return `${date}|${frameId}`;
}

export function RequestEditor({
  staffId,
  staffName,
  year,
  month,
  weeks,
  frames,
  initialSelections,
}: Props) {
  const router = useRouter();
  const [selections, setSelections] = useState<Set<string>>(
    () =>
      new Set(
        initialSelections.map((s) => selectionKey(s.date, s.shift_frame_id)),
      ),
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const initialKey = useMemo(
    () =>
      JSON.stringify(
        initialSelections
          .map((s) => selectionKey(s.date, s.shift_frame_id))
          .sort(),
      ),
    [initialSelections],
  );
  const currentKey = useMemo(
    () => JSON.stringify(Array.from(selections).sort()),
    [selections],
  );
  const dirty = initialKey !== currentKey;

  const toggle = (date: string, frameId: string) => {
    setError(null);
    setSavedAt(null);
    setSelections((prev) => {
      const next = new Set(prev);
      const key = selectionKey(date, frameId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = () => {
    setError(null);
    setSavedAt(null);
    const items = Array.from(selections)
      .map((k) => {
        const [date, shift_frame_id] = k.split("|");
        return { date, shift_frame_id };
      })
      .filter((i) => {
        // 当月のみ送信(他月のセルは表示用なので無視)
        const m = Number(i.date.slice(5, 7));
        const y = Number(i.date.slice(0, 4));
        return y === year && m === month;
      });

    startTransition(async () => {
      const result = await saveRequests({
        staff_id: staffId,
        year,
        month,
        items,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    });
  };

  const goMonth = (delta: number) => {
    if (dirty) {
      if (
        !window.confirm(
          "未保存の変更があります。月を切り替えると失われます。続けますか?",
        )
      ) {
        return;
      }
    }
    const next = shiftMonth(year, month, delta);
    router.push(
      `/request?staff=${staffId}&year=${next.year}&month=${next.month}`,
    );
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs text-gray-500">スタッフ</p>
          <p className="text-base font-semibold">{staffName}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => goMonth(-1)}
            className="text-sm border border-gray-300 px-3 py-1 rounded hover:bg-gray-50"
          >
            ← 前月
          </button>
          <p className="text-base font-semibold w-24 text-center">
            {year}年{month}月
          </p>
          <button
            onClick={() => goMonth(1)}
            className="text-sm border border-gray-300 px-3 py-1 rounded hover:bg-gray-50"
          >
            次月 →
          </button>
        </div>
      </header>

      <p className="text-xs text-gray-500">
        各日の枠チップをタップで選択 ⇔ 解除。何も選ばない日は休み希望と同じ扱いです。
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[640px]">
          <thead>
            <tr>
              {WEEKDAY_LABELS.map((w, i) => (
                <th
                  key={w}
                  className={`border border-gray-200 bg-gray-50 px-2 py-1 font-medium text-xs ${
                    i === 0
                      ? "text-red-600"
                      : i === 6
                        ? "text-blue-600"
                        : "text-gray-700"
                  }`}
                >
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell) => (
                  <CellView
                    key={cell.iso}
                    cell={cell}
                    frames={frames}
                    selections={selections}
                    onToggle={toggle}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={save}
          disabled={isPending || !dirty}
          className="bg-blue-900 text-white text-sm px-5 py-2 rounded hover:bg-blue-800 disabled:opacity-50"
        >
          {isPending ? "保存中…" : "保存"}
        </button>
        {dirty && !savedAt && (
          <span className="text-xs text-amber-700">未保存の変更があります</span>
        )}
        {savedAt && (
          <span className="text-xs text-green-700">{savedAt} に保存しました</span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
        <Link
          href="/"
          className="text-xs text-gray-500 hover:underline ml-auto"
        >
          ← ホームに戻る
        </Link>
      </div>
    </div>
  );
}

function CellView({
  cell,
  frames,
  selections,
  onToggle,
}: {
  cell: CalendarCell;
  frames: Frame[];
  selections: Set<string>;
  onToggle: (date: string, frameId: string) => void;
}) {
  const dayColor =
    cell.weekday === 0
      ? "text-red-600"
      : cell.weekday === 6
        ? "text-blue-600"
        : "text-gray-700";

  return (
    <td
      className={`border border-gray-200 align-top p-1 h-24 w-[14.28%] ${
        cell.inCurrentMonth ? "bg-white" : "bg-gray-50"
      }`}
    >
      <div
        className={`text-xs mb-1 ${dayColor} ${
          cell.inCurrentMonth ? "" : "opacity-50"
        }`}
      >
        {cell.day}
      </div>
      {cell.inCurrentMonth && (
        <div className="flex flex-wrap gap-1">
          {frames.map((f) => {
            const key = selectionKey(cell.iso, f.id);
            const selected = selections.has(key);
            const cls = selected
              ? (COLOR_CHIP_SELECTED[f.color] ?? COLOR_CHIP_SELECTED.gray)
              : CHIP_UNSELECTED;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onToggle(cell.iso, f.id)}
                className={`text-[10px] leading-none px-1.5 py-0.5 rounded border ${cls}`}
                title={f.name}
              >
                {f.name}
              </button>
            );
          })}
        </div>
      )}
    </td>
  );
}
