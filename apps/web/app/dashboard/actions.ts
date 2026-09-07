"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 63);
}

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  return { supabase, userId };
}

export async function createOrganization(formData: FormData) {
  const { supabase } = await requireUser();
  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  const slug = slugify(String(formData.get("slug") ?? name));
  if (name.length < 2 || slug.length < 2) redirect("/dashboard?error=Organization%20name%20or%20slug%20is%20invalid.");

  const { error } = await supabase.rpc("create_organization", { org_name: name, org_slug: slug });
  if (error) redirect(`/dashboard?error=${encodeURIComponent("Could not create organization. The slug may already be in use.")}`);
  revalidatePath("/dashboard");
}

export async function createProject(formData: FormData) {
  const { supabase, userId } = await requireUser();
  const organizationId = String(formData.get("organization_id") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 160);
  const description = String(formData.get("description") ?? "").trim().slice(0, 5000) || null;
  if (!organizationId || !name) redirect("/dashboard?error=Project%20name%20and%20organization%20are%20required.");

  const { error } = await supabase.from("projects").insert({
    organization_id: organizationId,
    name,
    description,
    status: "active",
    created_by: userId,
  });
  if (error) redirect(`/dashboard?error=${encodeURIComponent("Could not create project in that organization.")}`);
  revalidatePath("/dashboard");
}
