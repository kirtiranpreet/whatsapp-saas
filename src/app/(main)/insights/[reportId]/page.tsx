import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/features/workspace/services/active-workspace";
import { ReportView } from "@/features/insights/components/report-view";

export const dynamic = "force-dynamic";

export default async function InsightReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getActiveWorkspace(supabase, user.id);
  if (!membership) {
    return <div className="p-8 text-sm text-muted-foreground">No tienes un workspace activo.</div>;
  }
  return <ReportView workspaceId={membership.workspace_id} reportId={reportId} role={membership.role} />;
}
