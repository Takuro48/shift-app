"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import { isoDate, lastDay } from "@/lib/calendar";

export type ActionResult = { ok: true } | { ok: false; error: string };

type AssignmentValue =
  | { kind: "frame"; frame_id: string }
  | { kind: "rest" }
  | { kind: "clear" };

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function setAssignment(input: {
  staff_id: string;
  date: string;
  value: AssignmentValue;
}): Promise<ActionResult> {
  if (!input.staff_id) return { ok: false, error: "スタッフIDが必要です" };
  if (!ISO_RE.test(input.date)) {
    return { ok: false, error: "日付が不正です" };
  }

  if (input.value.kind === "clear") {
    const { error } = await supabase
      .from("shift_assignments")
      .delete()
      .eq("staff_id", input.staff_id)
      .eq("date", input.date);
    if (error) return { ok: false, error: error.message };
  } else {
    const frame_id =
      input.value.kind === "frame" ? input.value.frame_id : null;
    const { error } = await supabase.from("shift_assignments").upsert(
      {
        staff_id: input.staff_id,
        date: input.date,
        shift_frame_id: frame_id,
        status: "draft",
      },
      { onConflict: "staff_id,date" },
    );
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/admin/edit");
  revalidatePath("/view");
  return { ok: true };
}

export async function confirmMonth(input: {
  year: number;
  month: number;
}): Promise<ActionResult> {
  const { year, month } = input;
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
  const { error } = await supabase
    .from("shift_assignments")
    .update({ status: "confirmed" })
    .gte("date", start)
    .lte("date", end);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/edit");
  revalidatePath("/view");
  return { ok: true };
}
