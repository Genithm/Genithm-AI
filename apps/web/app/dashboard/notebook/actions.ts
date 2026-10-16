"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const kinds = ["observation", "hypothesis", "interpretation", "limitation"] as const;
type NoteKind = typeof kinds[number];

function notebookError(message: string): never {
  redirect("/dashboard/notebook?error=" + encodeURIComponent(message));
}

function parseTags(value: FormDataEntryValue | null): string[] | null {
  const input = String(value ?? "").trim();
  if (!input) return [];
  const tags = [...new Set(input.toLowerCase().split(",").map(item => item.trim()))];
  if (tags.length > 8 || tags.some(item =>
    item.length < 2 || item.length > 24 || !/^[a-z0-9][a-z0-9-]*$/.test(item))) return null;
  return tags;
}

function parseFields(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const rawKind = String(formData.get("note_kind") ?? "");
  const tags = parseTags(formData.get("tags"));
  if (title.length < 3 || title.length > 160 ||
      body.length < 1 || body.length > 8000 ||
      !kinds.includes(rawKind as NoteKind) || tags === null) {
    notebookError("Use a 3–160 character title, up to 8000 characters of notes, and at most eight simple tags.");
  }
  return { title, body, note_kind: rawKind as NoteKind, tags };
}

export async function createScientificNotebookEntry(formData: FormData) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId || authError) redirect("/login");

  const projectId = String(formData.get("project_id") ?? "");
  const requestedJob = String(formData.get("scientific_job_id") ?? "").trim();
  if (!UUID.test(projectId) || (requestedJob && !UUID.test(requestedJob))) {
    notebookError("Choose an accessible research project and a valid analysis.");
  }
  const fields = parseFields(formData);
  // The database owns the project-to-org lookup, source-job scope check, and
  // immutable SHA-256 capture. No caller-supplied digest is accepted.
  const { error } = await supabase.from("scientific_notebook_entries").insert({
    project_id: projectId,
    created_by: userId,
    scientific_job_id: requestedJob || null,
    ...fields,
  });
  if (error) notebookError("The note could not be saved. Check project access and analysis completion.");
  revalidatePath("/dashboard/notebook");
  redirect("/dashboard/notebook?saved=1");
}

export async function updateScientificNotebookEntry(formData: FormData) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId || authError) redirect("/login");
  const id = String(formData.get("entry_id") ?? "");
  if (!UUID.test(id)) notebookError("This note is not available.");
  const fields = parseFields(formData);
  const { data, error } = await supabase.from("scientific_notebook_entries")
    .update(fields).eq("id", id).eq("created_by", userId).select("id").maybeSingle();
  if (error || !data) notebookError("This note could not be updated.");
  revalidatePath("/dashboard/notebook");
  redirect("/dashboard/notebook?updated=1");
}

export async function deleteScientificNotebookEntry(formData: FormData) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId || authError) redirect("/login");
  const id = String(formData.get("entry_id") ?? "");
  if (!UUID.test(id)) notebookError("This note is not available.");
  const { data, error } = await supabase.from("scientific_notebook_entries")
    .delete().eq("id", id).eq("created_by", userId).select("id").maybeSingle();
  if (error || !data) notebookError("This note could not be deleted.");
  revalidatePath("/dashboard/notebook");
  redirect("/dashboard/notebook?deleted=1");
}
