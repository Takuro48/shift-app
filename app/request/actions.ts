"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { isoDate, lastDay } from "@/lib/calendar";

export type ActionResult = { ok: true } | { ok: false; error: string };

type SaveInput = {
  staff_id: string;
  year: number;
  month: number;
  items: { date: string; shift_frame_id: string }[];
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveRequests(input: SaveInput): Promise<ActionResult> {
  const { staff_id, year, month, items } = input;

  if (!staff_id) return { ok: false, error: "スタッフIDが必要です" };
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return { ok: false, error: "年月が不正です" };
  }

  const start = isoDate(year, month, 1);
  const end = isoDate(year, month, lastDay(year, month));

  for (const it of items) {
    if (!ISO_RE.test(it.date)) {
      return { ok: false, error: `日付が不正です: ${it.date}` };
    }
    if (it.date < start || it.date > end) {
      return {
        ok: false,
        error: `${year}年${month}月の範囲外の日付があります: ${it.date}`,
      };
    }
    if (!it.shift_frame_id) {
      return { ok: false, error: "シフト枠IDが空です" };
    }
  }

  const { error: delErr } = await supabase
    .from("shift_requests")
    .delete()
    .eq("staff_id", staff_id)
    .gte("date", start)
    .lte("date", end);
  if (delErr) return { ok: false, error: delErr.message };

  if (items.length > 0) {
    const rows = items.map((i) => ({
      staff_id,
      date: i.date,
      shift_frame_id: i.shift_frame_id,
    }));
    const { error: insErr } = await supabase.from("shift_requests").insert(rows);
    if (insErr) return { ok: false, error: insErr.message };
  }

  revalidatePath("/request");
  return { ok: true };
}
