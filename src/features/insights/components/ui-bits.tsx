"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ExternalLink, Quote } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "./labels";

export interface EvidenceItem {
  quote: string;
  at: string;
  message_id: string;
  conversation_id?: string;
}

/** Cita literal con fecha y enlace al chat original. */
export function EvidenceQuote({
  ev,
  conversationId,
  tz,
  inferred,
}: {
  ev: EvidenceItem;
  conversationId?: string;
  tz?: string;
  inferred?: boolean;
}) {
  const cid = ev.conversation_id ?? conversationId;
  return (
    <div className="flex gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn("whitespace-pre-wrap break-words", inferred && "text-muted-foreground")}>
          {inferred ? ev.quote : `“${ev.quote}”`}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span>{formatDate(ev.at, tz)}</span>
          {inferred && <span>Mensaje en el que se apoya la inferencia</span>}
          {cid && (
            <Link href={`/inbox/${cid}`} className="inline-flex items-center gap-1 hover:text-foreground">
              Ver en el chat <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** Fila con barra de porcentaje y evidencias desplegables. */
export function StatRow({
  title,
  subtitle,
  percent,
  children,
  badge,
}: {
  title: string;
  subtitle: string;
  percent: number;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        disabled={!children}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{title}</span>
            {badge}
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">{percent} %</span>
        {children && (
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        )}
      </button>
      {open && children && <div className="space-y-2 border-t px-4 py-3">{children}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>
  );
}

export function SampleNote({ n, min = 10 }: { n: number; min?: number }) {
  if (n >= min) return null;
  return (
    <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
      Muestra pequeña ({n} {n === 1 ? "conversación" : "conversaciones"}): sirve para detectar señales, no para sacar
      conclusiones.
    </p>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
