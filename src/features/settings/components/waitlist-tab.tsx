"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell, Check, Download, Loader2, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { WaitlistEntry } from "@/features/waitlist/service";

interface Props {
  workspaceId: string;
  canManage: boolean;
}

export function WaitlistTab({ workspaceId, canManage }: Props) {
  const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);
  const [city, setCity] = useState<string>("todas");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/waitlist`, { cache: "no-store" });
      const json = (await res.json()) as { data?: WaitlistEntry[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error");
      setEntries(json.data ?? []);
    } catch {
      toast.error("No se pudo cargar la lista de espera");
      setEntries([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries ?? []) {
      if (e.status === "waiting") counts.set(e.city, (counts.get(e.city) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const shown = (entries ?? []).filter((e) => city === "todas" || e.city === city);

  async function setStatus(entry: WaitlistEntry, status: WaitlistEntry["status"]) {
    setBusy(entry.id);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/waitlist/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      setEntries((prev) => (prev ?? []).map((e) => (e.id === entry.id ? { ...e, status } : e)));
    } catch {
      toast.error("No se pudo actualizar");
    } finally {
      setBusy(null);
    }
  }

  async function remove(entry: WaitlistEntry) {
    setBusy(entry.id);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/waitlist/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setEntries((prev) => (prev ?? []).filter((e) => e.id !== entry.id));
    } catch {
      toast.error("No se pudo quitar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Lista de espera</h2>
          <p className="text-sm text-muted-foreground">
            Personas a las que no les encajó ninguna edición. El agente las apunta
            (tool «Lista de espera») para avisarles cuando haya una nueva en su ciudad.
            Con HighLevel conectado, además reciben la etiqueta{" "}
            <code className="text-xs">lista-espera-&lt;ciudad&gt;</code>.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/workspace/${workspaceId}/waitlist?format=csv`}>
            <Download className="mr-2 h-4 w-4" />
            Descargar CSV
          </a>
        </Button>
      </div>

      {entries === null ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-6 w-6" />
          Todavía no hay nadie en la lista de espera.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={city === "todas" ? "default" : "outline"}
              onClick={() => setCity("todas")}
            >
              Todas ({entries.length})
            </Button>
            {cities.map(([c, n]) => (
              <Button
                key={c}
                size="sm"
                variant={city === c ? "default" : "outline"}
                onClick={() => setCity(c)}
              >
                {c} ({n})
              </Button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Ciudad</th>
                  <th className="px-3 py-2 font-medium">Nombre</th>
                  <th className="px-3 py-2 font-medium">Teléfono</th>
                  <th className="px-3 py-2 font-medium">Notas</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  {canManage && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{e.city}</td>
                    <td className="px-3 py-2">
                      {e.name ?? "—"}
                      {e.email && <div className="text-xs text-muted-foreground">{e.email}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{e.phone ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.notes || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {e.status === "notified" ? (
                        <Badge variant="secondary">Avisado</Badge>
                      ) : (
                        <Badge>En espera</Badge>
                      )}
                      {e.hl_tagged && (
                        <span className="ml-1 text-xs text-muted-foreground">· GHL</span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {busy === e.id ? (
                          <Loader2 className="ml-auto h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              title={e.status === "notified" ? "Volver a en espera" : "Marcar como avisado"}
                              onClick={() => setStatus(e, e.status === "notified" ? "waiting" : "notified")}
                            >
                              {e.status === "notified" ? <Bell className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                            </Button>
                            <Button size="sm" variant="ghost" title="Quitar" onClick={() => remove(e)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
