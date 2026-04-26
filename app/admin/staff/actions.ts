"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";
import type { StaffRole } from "@/types/database";

export type ActionResult = { ok: true } | { ok: false; error: string };

type StaffInput = {
  name: string;
  role: StaffRole;
  display_order: number;
};

function validate(input: StaffInput): string | null {
  if (!input.name.trim()) return "名前を入力してください";
  if (input.role !== "admin" && input.role !== "staff") return "役割が不正です";
  if (!Number.isFinite(input.display_order) || input.display_order < 0) {
    return "表示順は0以上の数値で入力してください";
  }
  return null;
}

export async function createStaff(input: StaffInput): Promise<ActionResult> {
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const { error } = await supabase.from("staff").insert({
    name: input.name.trim(),
    role: input.role,
    display_order: input.display_order,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/staff");
  return { ok: true };
}

export async function updateStaff(
  id: string,
  input: StaffInput,
): Promise<ActionResult> {
  const err = validate(input);
  if (err) return { ok: false, error: err };

  const { error } = await supabase
    .from("staff")
    .update({
      name: input.name.trim(),
      role: input.role,
      display_order: input.display_order,
    })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/staff");
  return { ok: true };
}

export async function deleteStaff(id: string): Promise<ActionResult> {
  const { error } = await supabase.from("staff").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/staff");
  return { ok: true };
}
