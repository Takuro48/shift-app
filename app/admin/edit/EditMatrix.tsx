"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { shiftMonth } from "@/lib/calendar";
import type { DayCategory } from "@/types/database";
import { confirmMonth, setAssignment } from "./actions";

type Staff = { id: string; name: string };
type Frame = {
  id: string;
  name: string;
  color: string;
  start_time: string;
  end_time: string;
};
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

// 希望帯(セルの左右に細く差し込む)
const COLOR_BAR: Record<string, string> = {
  green: "bg-emerald-500",
  indigo: "bg-indigo-500",
  amber: "bg-amber-500",
  gray: "bg-gray-500",
  red: "bg-red-500",
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

  // 各 frame を時間帯から左/右に振り分ける。
  //  - start_hour < 12 → 左(早番系)
  //  - end_hour   >= 17 → 右(遅番系)
  // 通し(両方該当)は左右両方に色がつく。
  // どちらにも該当しない枠(休など)は中央に小さい「希」マーク。
  const framePosition = useMemo(() => {
    const m = new Map<string, { left: boolean; right: boolean }>();
    for (const f of props.frames) {
      const sh = parseInt(f.start_time.slice(0, 2), 10) || 0;
      const eh = parseInt(f.end_time.slice(0, 2), 10) || 0;
      m.set(f.id, { left: sh < 12, right: eh >= 17 });
    }
    return m;
  }, [props.frames]);

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

  // 希望集計(各 frame × 日付 で希望者数をカウント)
  const requestCount = useMemo(() => {
    const rows = new Map<string, Map<string, number>>(); // frame_id -> (date -> requested)
    for (const f of props.frames) rows.set(f.id, new Map());
    for (const r of props.requests) {
      const m = rows.get(r.shift_frame_id);
      if (!m) continue;
      m.set(r.date, (m.get(r.date) ?? 0) + 1);
    }
    return rows;
  }, [props.frames, props.requests]);

  const warnings = useMemo(() => {
    const list: string[] = [];
    for (const day of props.days) {
      for (const f of props.frames) {
        const required = requiredMap.get(`${f.id}|${day.category}`) ?? 0;
        if (required === 0) continue;
        const requested = requestCount.get(f.id)?.get(day.iso) ?? 0;
        if (requested < required) {
          list.push(
            `${props.month}/${day.day}(${WEEKDAY_LABELS[day.weekday]}) ${f.name} 希望不足: ${requested}/${required}`,
          );
        }
      }
    }
    return list;
  }, [props.days, props.frames, props.month, requiredMap, requestCount]);

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
                    // 希望の表示: 休枠は色バー無しで「休」テキスト、それ以外は左/右に色帯
                    let leftColor: string | null = null;
                    let rightColor: string | null = null;
                    let restRequested = false;
                    let otherRequested = false;
                    for (const f of props.frames) {
                      if (!requestSet.has(requestKey(s.id, d.iso, f.id))) continue;
                      if (f.name.includes("休")) {
                        restRequested = true;
                        continue;
                      }
                      const pos = framePosition.get(f.id);
                      if (!pos) continue;
                      if (pos.left && !leftColor) leftColor = f.color;
                      if (pos.right && !rightColor) rightColor = f.color;
                      if (!pos.left && !pos.right) otherRequested = true;
                    }
                    const bg = frame
                      ? (COLOR_BG[frame.color] ?? "bg-gray-200")
                      : isRest
                        ? "bg-gray-200"
                        : "bg-white";
                    const label = frame
                      ? frame.name.charAt(0)
                      : isRest
                        ? "休"
                        : !a && restRequested
                          ? "休"
                          : "";
                    // 希望のみで割当無しの「休」は薄いグレー文字で区別
                    const labelClass =
                      !a && restRequested && !frame && !isRest
                        ? "text-gray-400"
                        : "";
                    return (
                      <td
                        key={d.iso}
                        className={`border-l border-gray-200 p-0 text-center align-middle relative cursor-pointer hover:opacity-80 ${bg}`}
                        onClick={() => setEditing({ staff: s, day: d })}
                      >
                        <div className={`h-7 leading-7 text-xs ${labelClass}`}>
                          {label}
                        </div>
                        {!a && leftColor && (
                          <span
                            className={`absolute top-0 bottom-0 left-0 w-1.5 ${
                              COLOR_BAR[leftColor] ?? "bg-gray-500"
                            }`}
                          />
                        )}
                        {!a && rightColor && (
                          <span
                            className={`absolute top-0 bottom-0 right-0 w-1.5 ${
                              COLOR_BAR[rightColor] ?? "bg-gray-500"
                            }`}
                          />
                        )}
                        {!a && otherRequested && !leftColor && !rightColor && (
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
              {/* 希望フッター(枠ごと、日付別) */}
              {props.frames.map((f) => (
                <tr
                  key={`req-${f.id}`}
                  className="border-t border-gray-200 bg-gray-50"
                >
                  <td className="px-2 py-1 text-[10px] text-gray-600 border-r border-gray-200 sticky left-0 bg-gray-50 z-10 whitespace-nowrap">
                    {f.name} 希望
                  </td>
                  {props.days.map((d) => {
                    const required =
                      requiredMap.get(`${f.id}|${d.category}`) ?? 0;
                    const requested =
                      requestCount.get(f.id)?.get(d.iso) ?? 0;
                    const cellClass =
                      required === 0
                        ? "text-gray-400"
                        : requested < required
                          ? "text-red-700 font-bold"
                          : requested > required
                            ? "text-blue-700 font-bold"
                            : "text-gray-600";
                    return (
                      <td
                        key={d.iso}
                        className={`border-l border-gray-200 text-[10px] text-center px-0.5 py-1 ${cellClass}`}
                      >
                        {requested}/{required}
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
