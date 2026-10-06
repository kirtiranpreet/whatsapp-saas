import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";
import { InsightsHome } from "@/features/insights/components/insights-home";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getActiveWorkspace(supabase, user.id);
  if (!membership) {
    return <div className="p-8 text-sm text-muted-foreground">No tienes un workspace activo.</div>;
  }
  return <InsightsHome workspaceId={membership.workspace_id} role={membership.role} />;
}
