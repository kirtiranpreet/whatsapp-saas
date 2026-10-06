"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, ChevronRight, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FollowUpsView } from "./followups-view";
import { formatDay } from "./labels";
import { Empty } from "./ui-bits";

interface ReportRow {
  id: string;
  kind: "weekly" | "manual";
  period_start: string;
  period_end: string;
  time_zone: string;
  status: "processing" | "finalizing" | "ready" | "failed";
  conversation_count: number;
  analyzed_count: number;
  failed_count: number;
  summary: string | null;
  error: string | null;
  created_at: string;
}

interface ListResponse {
  data: ReportRow[];
  progress: Record<string, number>;
  settings: { weekly: boolean; timeZone: string };
  role: string;
}

const STATUS: Record<ReportRow["status"], string> = {
  processing: "Analizando",
  finalizing: "Preparando informe",
  ready: "Listo",
  failed: "Error",
};

export function periodLabel(r: { period_start: string; period_end: string; time_zone: string }): string {
  const end = new Date(Date.parse(r.period_end) - 1).toISOString();
  return `${formatDay(r.period_start, r.time_zone)} – ${formatDay(end, r.time_zone)}`;
}

export function InsightsHome({ workspaceId, role }: { workspaceId: string; role: string }) {
  const canManage = role === "admin" || role === "manager";
  const canReply = role !== "viewer";
  const [list, setList] = useState<ListResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/insights`, { cache: "no-store" });
      const json = (await res.json()) as ListResponse & { error?: string };
      if (!res.ok) throw new Error(json.error);
      setList(json);
    } catch {
      toast.error("No se pudieron cargar los informes");
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mientras haya un informe en curso, refresca el progreso.
  const running = list?.data.some((r) => r.status === "processing" || r.status === "finalizing");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [running, load]);

  async function analyzeNow(days: 7 | 30 | 90) {
    setBusy(`new-${days}`);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      if (!res.ok) throw new Error();
      toast.success("Análisis en marcha. Puedes cerrar esta página: seguirá solo.");
      await load();
    } catch {
      toast.error("No se pudo iniciar el análisis");
    } finally {
      setBusy(null);
    }
  }

  async function setWeekly(weekly: boolean) {
    setBusy("weekly");
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/insights`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekly }),
      });
      if (!res.ok) throw new Error();
      setList((l) => (l ? { ...l, settings: { ...l.settings, weekly } } : l));
    } catch {
      toast.error("No se pudo guardar");
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: ReportRow) {
    if (!confirm("¿Eliminar este informe y todo su análisis? No se puede deshacer.")) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/insights/${r.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setList((l) => (l ? { ...l, data: l.data.filter((x) => x.id !== r.id) } : l));
    } catch {
      toast.error("No se pudo eliminar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Inteligencia de conversaciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Qué preguntan, qué les frena y por qué compran, a partir de las conversaciones que atendió tu agente. Cada
          dato enlaza al mensaje original.
        </p>
      </div>

      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports">Informes</TabsTrigger>
          <TabsTrigger value="opportunities">Oportunidades</TabsTrigger>
          <TabsTrigger value="followups">Seguimientos</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Informe semanal automático</span>
                </div>
                <Switch
                  checked={list?.settings.weekly ?? false}
                  disabled={!canManage || !list || busy === "weekly"}
                  onCheckedChange={(v) => void setWeekly(v)}
                  aria-label="Informe semanal automático"
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Cada lunes desde las 08:00 ({list?.settings.timeZone ?? "…"}) se analiza la semana anterior (lunes a
                domingo).
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Analizar ahora</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {([7, 30, 90] as const).map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant="outline"
                    disabled={!canManage || busy !== null}
                    onClick={() => void analyzeNow(d)}
                  >
                    {busy === `new-${d}` && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Últimos {d} días
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {!list ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : list.data.length === 0 ? (
            <Empty>Todavía no hay informes. Activa el informe semanal o pulsa «Analizar ahora».</Empty>
          ) : (
            <ul className="space-y-2">
              {list.data.map((r) => {
                const done = list.progress[r.id] ?? r.analyzed_count + r.failed_count;
                const inProgress = r.status === "processing" || r.status === "finalizing";
                return (
                  <li key={r.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
                    <Link href={`/insights/${r.id}`} className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{periodLabel(r)}</span>
                        <Badge variant="outline">{r.kind === "weekly" ? "Semanal" : "Manual"}</Badge>
                        <Badge variant={r.status === "ready" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>
                          {STATUS[r.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {inProgress
                          ? `${done} de ${r.conversation_count} conversaciones analizadas`
                          : r.status === "failed"
                            ? r.error ?? "No se pudo completar"
                            : `${r.analyzed_count} conversaciones analizadas${r.failed_count ? ` · ${r.failed_count} sin poder analizar` : ""}`}
                      </p>
                    </Link>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Eliminar informe"
                        disabled={busy === r.id}
                        onClick={() => void remove(r)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="opportunities" className="mt-4">
          <FollowUpsView workspaceId={workspaceId} mode="opportunities" canReply={canReply} />
        </TabsContent>
        <TabsContent value="followups" className="mt-4">
          <FollowUpsView workspaceId={workspaceId} mode="followups" canReply={canReply} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
