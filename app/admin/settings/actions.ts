"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import type { DayCategory } from "@/types/database";

export type ActionResult = { ok: true } | { ok: false; error: string };

type ShiftFrameInput = {
  name: string;
  start_time: string;
  end_time: string;
  color: string;
  display_order: number;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateFrame(input: ShiftFrameInput): string | null {
  if (!input.name.trim()) return "名前を入力してください";
  if (!TIME_RE.test(input.start_time)) return "開始時刻が不正です(HH:mm)";
  if (!TIME_RE.test(input.end_time)) return "終了時刻が不正です(HH:mm)";
  if (input.start_time === input.end_time) {
    return "開始時刻と終了時刻が同じです";
  }
  if (!input.color.trim()) return "色を選択してください";
  if (!Number.isFinite(input.display_order) || input.display_order < 0) {
    return "表示順は0以上の数値で入力してください";
  }
  return null;
}

export async function createShiftFrame(
  input: ShiftFrameInput,
): Promise<ActionResult> {
  const err = validateFrame(input);
  if (err) return { ok: false, error: err };

  const { error } = await supabase.from("shift_frames").insert({
    name: input.name.trim(),
    start_time: input.start_time,
    end_time: input.end_time,
    color: input.color,
    display_order: input.display_order,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function updateShiftFrame(
  id: string,
  input: ShiftFrameInput,
): Promise<ActionResult> {
  const err = validateFrame(input);
  if (err) return { ok: false, error: err };

  const { error } = await supabase
    .from("shift_frames")
    .update({
      name: input.name.trim(),
      start_time: input.start_time,
      end_time: input.end_time,
      color: input.color,
      display_order: input.display_order,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function deleteShiftFrame(id: string): Promise<ActionResult> {
  const { error } = await supabase.from("shift_frames").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings");
  return { ok: true };
}

type CountEntry = {
  shift_frame_id: string;
  day_category: DayCategory;
  count: number;
};

export async function saveRequiredCounts(
  entries: CountEntry[],
): Promise<ActionResult> {
  for (const e of entries) {
    if (!Number.isFinite(e.count) || e.count < 0) {
      return { ok: false, error: "必要人数は0以上の数値で入力してください" };
    }
  }

  const { error } = await supabase
    .from("required_counts")
    .upsert(entries, { onConflict: "shift_frame_id,day_category" });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings");
  return { ok: true };
}
