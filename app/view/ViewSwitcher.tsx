"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CalendarCell } from "@/lib/calendar";
import { shiftMonth } from "@/lib/calendar";

type Staff = { id: string; name: string };
type Frame = { id: string; name: string; color: string };
type Assignment = {
  staff_id: string;
  date: string;
  shift_frame_id: string | null;
};

type Props = {
  year: number;
  month: number;
  highlightStaffId: string | null;
  staff: Staff[];
  frames: Frame[];
  assignments: Assignment[];
  weeks: CalendarCell[][];
  daysInMonth: {
    day: number;
    iso: string;
    weekday: number;
  }[];
  holidays: Record<string, string>;
};

const COLOR_BG: Record<string, string> = {
  green: "bg-emerald-200",
  indigo: "bg-indigo-200",
  amber: "bg-amber-200",
  gray: "bg-gray-200",
  red: "bg-red-200",
};

const COLOR_TEXT: Record<string, string> = {
  green: "text-emerald-900",
  indigo: "text-indigo-900",
  amber: "text-amber-900",
  gray: "text-gray-700",
  red: "text-red-900",
};

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

type Mode = "calendar" | "matrix";

export function ViewSwitcher(props: Props) {
  const [mode, setMode] = useState<Mode>("calendar");
  const router = useRouter();

  const goMonth = (delta: number) => {
    const next = shiftMonth(props.year, props.month, delta);
    const params = new URLSearchParams();
    params.set("year", String(next.year));
    params.set("month", String(next.month));
    if (props.highlightStaffId) params.set("staff", props.highlightStaffId);
    router.push(`/view?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => goMonth(-1)}
            className="text-sm border border-gray-300 px-3 py-1 rounded hover:bg-gray-50"
          >
            ← 前月
          </button>
          <p className="text-base font-semibold w-24 text-center">
            {props.year}年{props.month}月
          </p>
          <button
            onClick={() => goMonth(1)}
            className="text-sm border border-gray-300 px-3 py-1 rounded hover:bg-gray-50"
          >
            次月 →
          </button>
        </div>
        <div className="inline-flex rounded border border-gray-300 overflow-hidden text-sm">
          <button
            onClick={() => setMode("calendar")}
            className={`px-3 py-1 ${
              mode === "calendar"
                ? "bg-blue-900 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            カレンダー
          </button>
          <button
            onClick={() => setMode("matrix")}
            className={`px-3 py-1 border-l border-gray-300 ${
              mode === "matrix"
                ? "bg-blue-900 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            マトリクス
          </button>
        </div>
      </header>

      {props.assignments.length === 0 ? (
        <p className="text-sm text-gray-500">
          {props.year}年{props.month}月の確定シフトはまだありません。
        </p>
      ) : mode === "calendar" ? (
        <CalendarView {...props} />
      ) : (
        <MatrixView {...props} />
      )}
    </div>
  );
}

function CalendarView({
  highlightStaffId,
  weeks,
  staff,
  frames,
  assignments,
  year,
  month,
  holidays,
}: Props) {
  const staffById = useMemo(() => {
    const m = new Map<string, Staff>();
    for (const s of staff) m.set(s.id, s);
    return m;
  }, [staff]);

  const byDateFrame = useMemo(() => {
    const m = new Map<string, Map<string, string[]>>(); // date -> (frame_id|'rest' -> staff_ids)
    for (const a of assignments) {
      if (!m.has(a.date)) m.set(a.date, new Map());
      const inner = m.get(a.date)!;
      const key = a.shift_frame_id ?? "rest";
      if (!inner.has(key)) inner.set(key, []);
      inner.get(key)!.push(a.staff_id);
    }
    return m;
  }, [assignments]);

  return (
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
              {row.map((cell) => {
                const inMonth =
                  cell.year === year && cell.month === month;
                const holidayName = holidays[cell.iso] ?? null;
                const isHoliday = !!holidayName;
                const dayColor = isHoliday
                  ? "text-red-600"
                  : cell.weekday === 0
                    ? "text-red-600"
                    : cell.weekday === 6
                      ? "text-blue-600"
                      : "text-gray-700";
                const cellBg = !inMonth
                  ? "bg-gray-50"
                  : isHoliday
                    ? "bg-red-50"
                    : "bg-white";
                const dateAssigns = byDateFrame.get(cell.iso);
                return (
                  <td
                    key={cell.iso}
                    title={holidayName ?? undefined}
                    className={`border border-gray-200 align-top p-1 h-28 w-[14.28%] ${cellBg}`}
                  >
                    <div
                      className={`text-xs mb-1 ${dayColor} ${
                        inMonth ? "" : "opacity-50"
                      }`}
                    >
                      {isHoliday && <span className="mr-0.5">㊗</span>}
                      {cell.day}
                      {isHoliday && inMonth && (
                        <span className="block text-[9px] truncate">
                          {holidayName}
                        </span>
                      )}
                    </div>
                    {inMonth && dateAssigns && (
                      <div className="space-y-0.5">
                        {frames.map((f) => {
                          const ids = dateAssigns.get(f.id);
                          if (!ids || ids.length === 0) return null;
                          return (
                            <div
                              key={f.id}
                              className={`text-[10px] rounded px-1 py-0.5 ${
                                COLOR_BG[f.color] ?? "bg-gray-200"
                              } ${COLOR_TEXT[f.color] ?? "text-gray-800"}`}
                            >
                              <span className="font-semibold">{f.name}: </span>
                              {ids.map((id, idx) => {
                                const s = staffById.get(id);
                                if (!s) return null;
                                const me = id === highlightStaffId;
                                return (
                                  <span
                                    key={id}
                                    className={
                                      me ? "font-bold underline" : ""
                                    }
                                  >
                                    {s.name}
                                    {idx < ids.length - 1 ? ", " : ""}
                                  </span>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixView({
  highlightStaffId,
  staff,
  frames,
  assignments,
  daysInMonth,
  holidays,
}: Props) {
  const map = useMemo(() => {
    const m = new Map<string, Assignment>();
    for (const a of assignments) m.set(`${a.staff_id}|${a.date}`, a);
    return m;
  }, [assignments]);
  const frameById = useMemo(() => {
    const m = new Map<string, Frame>();
    for (const f of frames) m.set(f.id, f);
    return m;
  }, [frames]);

  return (
    <div className="overflow-x-auto border border-gray-200 rounded">
      <table className="text-sm border-collapse">
        <thead>
          <tr>
            <th className="bg-gray-100 px-2 py-1 text-xs font-medium border-r border-gray-200 sticky left-0 z-10">
              スタッフ
            </th>
            {daysInMonth.map((d) => {
              const holidayName = holidays[d.iso] ?? null;
              const isHoliday = !!holidayName;
              const headerColor = isHoliday
                ? "text-red-600 bg-red-50"
                : d.weekday === 0
                  ? "text-red-600 bg-gray-100"
                  : d.weekday === 6
                    ? "text-blue-600 bg-gray-100"
                    : "text-gray-700 bg-gray-100";
              return (
                <th
                  key={d.iso}
                  title={holidayName ?? undefined}
                  className={`px-1 py-1 text-xs font-medium border-l border-gray-200 min-w-[2.5rem] ${headerColor}`}
                >
                  <div>
                    {isHoliday && <span className="mr-0.5">㊗</span>}
                    {d.day}
                  </div>
                  <div className="text-[10px]">
                    {WEEKDAY_LABELS[d.weekday]}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => {
            const me = s.id === highlightStaffId;
            return (
              <tr
                key={s.id}
                className={`border-t border-gray-200 ${
                  me ? "bg-yellow-50" : ""
                }`}
              >
                <td
                  className={`px-2 py-1 text-xs font-medium border-r border-gray-200 sticky left-0 z-10 whitespace-nowrap ${
                    me ? "bg-yellow-50 font-bold" : "bg-white"
                  }`}
                >
                  {s.name}
                </td>
                {daysInMonth.map((d) => {
                  const a = map.get(`${s.id}|${d.iso}`);
                  const frame = a?.shift_frame_id
                    ? frameById.get(a.shift_frame_id)
                    : null;
                  const isRest =
                    a !== undefined && a.shift_frame_id === null;
                  const bg = frame
                    ? (COLOR_BG[frame.color] ?? "bg-gray-200")
                    : isRest
                      ? "bg-gray-200"
                      : "";
                  const label = frame
                    ? frame.name.charAt(0)
                    : isRest
                      ? "休"
                      : "";
                  return (
                    <td
                      key={d.iso}
                      className={`border-l border-gray-200 text-center align-middle ${bg}`}
                    >
                      <div className="h-7 leading-7 text-xs">{label}</div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
