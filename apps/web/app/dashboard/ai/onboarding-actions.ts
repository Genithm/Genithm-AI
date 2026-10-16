"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 63);
}

/**
 * V32: start with chat, not a separate multi-page admin setup.
 * All mutations use the actual end-user session, not a service-role key.
 * The existing organization RPC and project RLS rules remain authoritative.
 */
export async function createAiResearchLab(formData: FormData) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  const slug = slugify(name);
  if (name.length < 2 || slug.length < 2) {
    redirect("/dashboard/ai?error=" + encodeURIComponent("Enter a lab or team name with at least two letters."));
  }
  const { error } = await supabase.rpc("create_organization", { org_name:name, org_slug:slug });
  if (error) {
    redirect("/dashboard/ai?error=" + encodeURIComponent("Could not create that lab. Try a more distinctive name."));
  }
  revalidatePath("/dashboard/ai");
  redirect("/dashboard/ai");
}

export async function createAiResearchProject(formData: FormData) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const orgId = String(formData.get("organization_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 160);
  if (!/^[a-f0-9-]{36}$/i.test(orgId) || name.length < 2) {
    redirect("/dashboard/ai?error=" + encodeURIComponent("Choose your lab and enter a project name."));
  }
  // Ownership and membership are enforced by existing projects RLS.
  const { error } = await supabase.from("projects").insert({
    organization_id: orgId,
    name,
    description: "Created from Genithm AI research chat",
    status: "active",
    created_by: userId,
  });
  if (error) {
    redirect("/dashboard/ai?error=" + encodeURIComponent("Could not create the research project in that lab."));
  }
  revalidatePath("/dashboard/ai");
  redirect("/dashboard/ai");
}
