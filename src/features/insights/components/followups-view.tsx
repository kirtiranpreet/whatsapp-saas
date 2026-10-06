"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, MessageSquareReply, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { FollowUpItem } from "@/features/insights/followups";
import type { SuggestedReply } from "@/features/insights/reply";
import { FOLLOWUP_LABEL, INTENT_LABEL, OBJECTION_LABEL, formatDate, hoursAgo, label } from "./labels";
import { Empty } from "./ui-bits";

type Mode = "opportunities" | "followups";

const PRIORITY_VARIANT = { alta: "default", media: "secondary", baja: "outline" } as const;

export function FollowUpsView({ workspaceId, mode, canReply }: { workspaceId: string; mode: Mode; canReply: boolean }) {
  const [items, setItems] = useState<FollowUpItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [replyFor, setReplyFor] = useState<FollowUpItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/insights/followups`, { cache: "no-store" });
      const json = (await res.json()) as { data?: FollowUpItem[]; error?: string };
      if (!res.ok) throw new Error(json.error);
      setItems(json.data ?? []);
    } catch {
      toast.error("No se pudieron cargar las conversaciones");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = (items ?? []).filter((i) =>
    mode === "opportunities"
      ? i.status !== "cerrada" && i.intent === "alta"
      : ["sin_responder", "seguimiento_pendiente", "enfriandose", "alto_riesgo"].includes(i.status),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {mode === "opportunities"
            ? "Conversaciones de los últimos 30 días con intención alta de compra. Cada una muestra las señales concretas y el mensaje que las justifica."
            : "Conversaciones que necesitan atención según el tiempo sin respuesta y las señales observadas. Que alguien no conteste no significa que esté perdido: el estado solo describe el tiempo y las señales."}
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {items === null ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : shown.length === 0 ? (
        <Empty>
          {mode === "opportunities"
            ? "Ahora mismo no hay conversaciones con intención alta."
            : "No hay seguimientos pendientes."}
        </Empty>
      ) : (
        <div className="space-y-3">
          {shown.map((i) => (
            <div key={i.conversation_id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{i.contact}</span>
                <Badge variant="outline">{label(FOLLOWUP_LABEL, i.status)}</Badge>
                <Badge variant={PRIORITY_VARIANT[i.priority]}>Prioridad {i.priority}</Badge>
                <span className="text-xs text-muted-foreground">
                  Intención {label(INTENT_LABEL, i.intent)}
                  {i.intent_source === "senales" ? " (por señales)" : i.intent_source === "analisis" ? " (por análisis)" : ""}
                </span>
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline text-muted-foreground">Último mensaje del cliente: </dt>
                  <dd className="inline">
                    {i.last_customer_at ? `hace ${hoursAgo(i.hours_since_customer)}` : "—"}
                  </dd>
                </div>
                {i.friction && (
                  <div>
                    <dt className="inline text-muted-foreground">Posible fricción: </dt>
                    <dd className="inline">{label(OBJECTION_LABEL, i.friction)}</dd>
                  </div>
                )}
                {i.last_question && (
                  <div className="sm:col-span-2">
                    <dt className="inline text-muted-foreground">Última pregunta: </dt>
                    <dd className="inline">“{i.last_question.text}”</dd>
                  </div>
                )}
                {i.last_business_text && (
                  <div className="sm:col-span-2">
                    <dt className="inline text-muted-foreground">Última respuesta: </dt>
                    <dd className="inline line-clamp-2">{i.last_business_text}</dd>
                  </div>
                )}
              </dl>

              {i.signals.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {i.signals.slice(0, 3).map((s) => (
                    <li key={s.signal} className="text-muted-foreground">
                      <span className="text-foreground">{s.signal}</span> · “{s.quote}” · {formatDate(s.at)}
                    </li>
                  ))}
                </ul>
              )}

              {i.reasons.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">Por qué aparece: {i.reasons.join(" · ")}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <p className="text-sm">
                  <span className="text-muted-foreground">Acción recomendada: </span>
                  {i.next_action}
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/inbox/${i.conversation_id}`}>
                      Ver chat <ExternalLink className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                  {canReply && (
                    <Button size="sm" onClick={() => setReplyFor(i)}>
                      <MessageSquareReply className="mr-2 h-4 w-4" />
                      ¿Qué debería responder?
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ReplySheet workspaceId={workspaceId} item={replyFor} onClose={() => setReplyFor(null)} />
    </div>
  );
}

export function ReplySheet({
  workspaceId,
  item,
  onClose,
}: {
  workspaceId: string;
  item: { conversation_id: string; contact: string } | null;
  onClose: () => void;
}) {
  const [reply, setReply] = useState<SuggestedReply | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async () => {
    if (!item) return;
    setLoading(true);
    setReply(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/insights/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: item.conversation_id }),
      });
      const json = (await res.json()) as { data?: SuggestedReply; error?: string };
      if (!res.ok || !json.data) throw new Error(json.error);
      setReply(json.data);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "No se pudo generar la respuesta");
    } finally {
      setLoading(false);
    }
  }, [item, workspaceId]);

  useEffect(() => {
    if (item) void generate();
    else setReply(null);
  }, [item, generate]);

  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>¿Qué debería responder?</SheetTitle>
          <SheetDescription>
            Propuesta para {item?.contact}. No se envía nada: revísala y cópiala si te sirve.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm">
          {loading && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Leyendo la conversación…
            </p>
          )}
          {reply && (
            <>
              {reply.window_note && (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  {reply.window_note}
                </p>
              )}
              <section>
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Contexto detectado</h3>
                <p className="mt-1">{reply.context}</p>
              </section>
              <section>
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Objetivo de la respuesta</h3>
                <p className="mt-1">{reply.goal}</p>
              </section>
              <section>
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Respuesta sugerida</h3>
                <p className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{reply.reply}</p>
              </section>
              <section>
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Por qué se recomienda</h3>
                <p className="mt-1">{reply.why}</p>
              </section>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(reply.reply);
                    toast.success("Respuesta copiada");
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" /> Copiar respuesta
                </Button>
                <Button size="sm" variant="outline" onClick={() => void generate()} disabled={loading}>
                  Otra propuesta
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
