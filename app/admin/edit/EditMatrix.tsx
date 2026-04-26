"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shiftMonth } from "@/lib/calendar";
import type { DayCategory } from "@/types/database";
import { confirmMonth, setAssignment } from "./actions";

type Staff = { id: string; name: string };
type Frame = { id: string; name: string; color: string };
type Assignment = {
  staff_id: string;
  date: string;
  shift_frame_id: string | null;
  status: "draft" | "confirmed";
};
type RequestRow = { staff_id: string; date: string; shift_frame_id: string };
type RequiredCount = {
  shift_frame_id: string;
  day_category: DayCategory;
  count: number;
};

type DayInfo = {
  day: number;
  iso: string;
  weekday: number;
  category: DayCategory;
  holidayName: string | null;
};

type Props = {
  year: number;
  month: number;
  days: DayInfo[];
  staff: Staff[];
  frames: Frame[];
  assignments: Assignment[];
  requests: RequestRow[];
  required: RequiredCount[];
};

const COLOR_BG: Record<string, string> = {
  green: "bg-emerald-200",
  indigo: "bg-indigo-200",
  amber: "bg-amber-200",
  gray: "bg-gray-200",
  red: "bg-red-200",
};

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function assignmentKey(staff_id: string, date: string): string {
  return `${staff_id}|${date}`;
}

function requestKey(staff_id: string, date: string, frame_id: string): string {
  return `${staff_id}|${date}|${frame_id}`;
}

export function EditMatrix(props: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<{
    staff: Staff;
    day: DayInfo;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const assignmentMap = useMemo(() => {
    const m = new Map<string, Assignment>();
    for (const a of props.assignments) m.set(assignmentKey(a.staff_id, a.date), a);
    return m;
  }, [props.assignments]);

  const requestSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of props.requests)
      s.add(requestKey(r.staff_id, r.date, r.shift_frame_id));
    return s;
  }, [props.requests]);

  const frameById = useMemo(() => {
    const m = new Map<string, Frame>();
    for (const f of props.frames) m.set(f.id, f);
    return m;
  }, [props.frames]);

  const requiredMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of props.required) {
      m.set(`${r.shift_frame_id}|${r.day_category}`, r.count);
    }
    return m;
  }, [props.required]);

  const goMonth = (delta: number) => {
    const next = shiftMonth(props.year, props.month, delta);
    router.push(`/admin/edit?year=${next.year}&month=${next.month}`);
  };

  const handleConfirmMonth = () => {
    if (
      !window.confirm(
        `${props.year}年${props.month}月のシフトを確定状態にしますか?`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await confirmMonth({
        year: props.year,
        month: props.month,
      });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  };

  const handlePick = (value: Parameters<typeof setAssignment>[0]["value"]) => {
    if (!editing) return;
    setError(null);
    const target = editing;
    startTransition(async () => {
      const result = await setAssignment({
        staff_id: target.staff.id,
        date: target.day.iso,
        value,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  };

  // 充足率と警告の計算
  const sufficiency = useMemo(() => {
    const rows = new Map<string, Map<string, number>>(); // frame_id -> (date -> assigned)
    for (const f of props.frames) rows.set(f.id, new Map());
    for (const a of props.assignments) {
      if (!a.shift_frame_id) continue;
      const m = rows.get(a.shift_frame_id);
      if (!m) continue;
      m.set(a.date, (m.get(a.date) ?? 0) + 1);
    }
    return rows;
  }, [props.frames, props.assignments]);

  const warnings = useMemo(() => {
    const list: string[] = [];
    for (const day of props.days) {
      for (const f of props.frames) {
        const required = requiredMap.get(`${f.id}|${day.category}`) ?? 0;
        const assigned = sufficiency.get(f.id)?.get(day.iso) ?? 0;
        if (assigned < required) {
          list.push(
            `${props.month}/${day.day}(${WEEKDAY_LABELS[day.weekday]}) ${f.name} 不足: ${assigned}/${required}`,
          );
        }
      }
    }
    return list;
  }, [props.days, props.frames, props.month, requiredMap, sufficiency]);

  const totalAssignments = props.assignments.length;
  const confirmedAssignments = props.assignments.filter(
    (a) => a.status === "confirmed",
  ).length;

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
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            割当 {totalAssignments} 件 / 確定済 {confirmedAssignments} 件
          </span>
          <button
            onClick={handleConfirmMonth}
            disabled={isPending}
            className="bg-blue-900 text-white text-sm px-4 py-1 rounded hover:bg-blue-800 disabled:opacity-50"
          >
            ✓ 確定して通知
          </button>
        </div>
      </header>

      {props.staff.length === 0 || props.frames.length === 0 ? (
        <p className="text-sm text-gray-500">
          先にスタッフ名簿とシフト枠を登録してください。
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="text-sm border-collapse">
            <thead>
              <tr>
                <th className="bg-gray-100 px-2 py-1 text-xs font-medium border-r border-gray-200 sticky left-0 z-10">
                  スタッフ
                </th>
                {props.days.map((d) => {
                  const isHoliday = !!d.holidayName;
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
                      title={d.holidayName ?? undefined}
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
              {props.staff.map((s) => (
                <tr key={s.id} className="border-t border-gray-200">
                  <td className="px-2 py-1 text-xs font-medium border-r border-gray-200 sticky left-0 bg-white z-10 whitespace-nowrap">
                    {s.name}
                  </td>
                  {props.days.map((d) => {
                    const a = assignmentMap.get(assignmentKey(s.id, d.iso));
                    const frame = a?.shift_frame_id
                      ? frameById.get(a.shift_frame_id)
                      : null;
                    const isRest =
                      a !== undefined && a.shift_frame_id === null;
                    const hasRequest = props.frames.some((f) =>
                      requestSet.has(requestKey(s.id, d.iso, f.id)),
                    );
                    const bg = frame
                      ? (COLOR_BG[frame.color] ?? "bg-gray-200")
                      : isRest
                        ? "bg-gray-200"
                        : "bg-white";
                    const label = frame
                      ? frame.name.charAt(0)
                      : isRest
                        ? "休"
                        : "";
                    return (
                      <td
                        key={d.iso}
                        className={`border-l border-gray-200 p-0 text-center align-middle relative cursor-pointer hover:opacity-80 ${bg}`}
                        onClick={() => setEditing({ staff: s, day: d })}
                      >
                        <div className="h-7 leading-7 text-xs">{label}</div>
                        {hasRequest && !a && (
                          <span className="absolute top-0 right-0 text-[8px] text-blue-700 px-0.5">
                            希
                          </span>
                        )}
                        {a?.status === "confirmed" && (
                          <span className="absolute bottom-0 right-0 text-[8px] text-emerald-700 px-0.5">
                            ✓
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* 充足率フッター */}
              {props.frames.map((f) => (
                <tr
                  key={`req-${f.id}`}
                  className="border-t border-gray-200 bg-gray-50"
                >
                  <td className="px-2 py-1 text-[10px] text-gray-600 border-r border-gray-200 sticky left-0 bg-gray-50 z-10 whitespace-nowrap">
                    {f.name} 充足
                  </td>
                  {props.days.map((d) => {
                    const required =
                      requiredMap.get(`${f.id}|${d.category}`) ?? 0;
                    const assigned =
                      sufficiency.get(f.id)?.get(d.iso) ?? 0;
                    const insufficient = assigned < required;
                    return (
                      <td
                        key={d.iso}
                        className={`border-l border-gray-200 text-[10px] text-center px-0.5 py-1 ${
                          insufficient ? "text-red-700 font-bold" : "text-gray-600"
                        }`}
                      >
                        {assigned}/{required}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {warnings.length > 0 && (
        <section className="border border-red-200 bg-red-50 rounded p-3 space-y-1">
          <h3 className="text-sm font-semibold text-red-700">
            ⚠ 必要人数に達していない日
          </h3>
          <ul className="text-xs text-red-700 space-y-0.5">
            {warnings.slice(0, 30).map((w) => (
              <li key={w}>・{w}</li>
            ))}
            {warnings.length > 30 && (
              <li>…他 {warnings.length - 30} 件</li>
            )}
          </ul>
        </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {editing && (
        <CellModal
          staff={editing.staff}
          day={editing.day}
          frames={props.frames}
          current={assignmentMap.get(
            assignmentKey(editing.staff.id, editing.day.iso),
          )}
          requestedFrameIds={
            new Set(
              props.frames
                .map((f) => f.id)
                .filter((fid) =>
                  requestSet.has(requestKey(editing.staff.id, editing.day.iso, fid)),
                ),
            )
          }
          onPick={handlePick}
          onClose={() => setEditing(null)}
          isPending={isPending}
        />
      )}
    </div>
  );
}

function CellModal({
  staff,
  day,
  frames,
  current,
  requestedFrameIds,
  onPick,
  onClose,
  isPending,
}: {
  staff: Staff;
  day: DayInfo;
  frames: Frame[];
  current: Assignment | undefined;
  requestedFrameIds: Set<string>;
  onPick: (value: Parameters<typeof setAssignment>[0]["value"]) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const currentFrameId = current?.shift_frame_id ?? null;
  const isRest = current !== undefined && current.shift_frame_id === null;
  const isEmpty = current === undefined;

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-lg max-w-sm w-full p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="space-y-0.5">
          <p className="text-xs text-gray-500">
            {day.iso}({WEEKDAY_LABELS[day.weekday]})
          </p>
          <p className="text-base font-semibold">{staff.name}</p>
        </header>

        <p className="text-xs text-gray-500">
          現在: {currentFrameId
            ? (frames.find((f) => f.id === currentFrameId)?.name ?? "?")
            : isRest
              ? "休"
              : "空欄"}
        </p>

        <div className="space-y-1.5">
          {frames.map((f) => {
            const selected = currentFrameId === f.id;
            const requested = requestedFrameIds.has(f.id);
            return (
              <button
                key={f.id}
                onClick={() => onPick({ kind: "frame", frame_id: f.id })}
                disabled={isPending}
                className={`block w-full text-left text-sm border rounded px-3 py-2 hover:bg-gray-50 disabled:opacity-50 ${
                  selected
                    ? "border-blue-500 bg-blue-50 font-semibold"
                    : "border-gray-300"
                }`}
              >
                <span
                  className={`inline-block w-3 h-3 rounded-full mr-2 align-middle ${
                    COLOR_BG[f.color] ?? "bg-gray-200"
                  }`}
                />
                {f.name}
                {requested && (
                  <span className="ml-2 text-[10px] text-blue-700 align-middle">
                    希望
                  </span>
                )}
              </button>
            );
          })}
          <button
            onClick={() => onPick({ kind: "rest" })}
            disabled={isPending}
            className={`block w-full text-left text-sm border rounded px-3 py-2 hover:bg-gray-50 disabled:opacity-50 ${
              isRest ? "border-blue-500 bg-blue-50 font-semibold" : "border-gray-300"
            }`}
          >
            <span className="inline-block w-3 h-3 rounded-full mr-2 align-middle bg-gray-300" />
            休
          </button>
          <button
            onClick={() => onPick({ kind: "clear" })}
            disabled={isPending}
            className={`block w-full text-left text-sm border rounded px-3 py-2 hover:bg-gray-50 disabled:opacity-50 ${
              isEmpty ? "border-blue-500 bg-blue-50 font-semibold" : "border-gray-300"
            }`}
          >
            空欄(取消)
          </button>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            disabled={isPending}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
