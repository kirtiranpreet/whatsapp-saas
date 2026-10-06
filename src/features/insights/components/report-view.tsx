"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CountRow, GroupProfile, ReportStats } from "@/features/insights/aggregate";
import type { ContentPack, VerifiedExtraction } from "@/features/insights/schema";
import type { Evolution, EvolutionRow } from "@/features/insights/evolution";
import type { Recommendation } from "@/features/insights/recommend";
import { ReplySheet } from "./followups-view";
import { periodLabel } from "./insights-home";
import {
  FUNNEL_LABEL,
  INTENT_LABEL,
  KIND_LABEL,
  MOMENT_LABEL,
  NON_BUYING_LABEL,
  OBJECTION_LABEL,
  OUTCOME_LABEL,
  RECOMMENDATION_LABEL,
  SENTIMENT_LABEL,
  formatDate,
  label,
} from "./labels";
import { Empty, EvidenceQuote, Kpi, SampleNote, StatRow } from "./ui-bits";

interface Report {
  id: string;
  kind: string;
  period_start: string;
  period_end: string;
  time_zone: string;
  status: string;
  conversation_count: number;
  analyzed_count: number;
  failed_count: number;
  stats: ReportStats & { evolution?: Evolution };
  summary: string | null;
  recommendations: Recommendation[];
  model: string | null;
  error: string | null;
  completed_at: string | null;
}

type ContentKind = "faq" | "objection" | "non_buying" | "motivation" | "language";

interface ContentRow {
  id: string;
  source: { kind: ContentKind; key: string; name: string; conversations: number };
  content: ContentPack;
  created_at: string;
}

export function ReportView({ workspaceId, reportId, role }: { workspaceId: string; reportId: string; role: string }) {
  const canManage = role === "admin" || role === "manager";
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [content, setContent] = useState<ContentRow[]>([]);
  const [generating, setGenerating] = useState<string | null>(null);
  const [tab, setTab] = useState("summary");
  const [openConv, setOpenConv] = useState<{ id: string; contact: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/workspace/${workspaceId}/insights/${reportId}`, { cache: "no-store" });
    if (res.status === 404) return setNotFound(true);
    const json = (await res.json()) as { data?: Report };
    if (json.data) setReport(json.data);
  }, [workspaceId, reportId]);

  const loadContent = useCallback(async () => {
    const res = await fetch(`/api/workspace/${workspaceId}/insights/${reportId}/content`, { cache: "no-store" });
    const json = (await res.json()) as { data?: ContentRow[] };
    setContent(json.data ?? []);
  }, [workspaceId, reportId]);

  useEffect(() => {
    void load();
    void loadContent();
  }, [load, loadContent]);

  useEffect(() => {
    if (!report || report.status === "ready" || report.status === "failed") return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [report, load]);

  async function generate(kind: ContentKind, key: string) {
    setGenerating(`${kind}:${key}`);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/insights/${reportId}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, key }),
      });
      const json = (await res.json()) as { data?: ContentRow; error?: string };
      if (!res.ok || !json.data) throw new Error(json.error);
      setContent((c) => [json.data!, ...c]);
      setTab("content");
      toast.success("Contenido generado");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "No se pudo generar el contenido");
    } finally {
      setGenerating(null);
    }
  }

  async function remove() {
    if (!confirm("¿Eliminar este informe y todo su análisis? No se puede deshacer.")) return;
    const res = await fetch(`/api/workspace/${workspaceId}/insights/${reportId}`, { method: "DELETE" });
    if (res.ok) router.push("/insights");
    else toast.error("No se pudo eliminar");
  }

  if (notFound) return <div className="p-8 text-sm text-muted-foreground">Informe no encontrado.</div>;
  if (!report) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const tz = report.time_zone;
  const s = report.stats;
  const genButton = (kind: ContentKind, key: string) =>
    canManage ? (
      <Button
        size="sm"
        variant="outline"
        disabled={generating !== null}
        onClick={() => void generate(kind, key)}
      >
        {generating === `${kind}:${key}` ? (
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="mr-2 h-3.5 w-3.5" />
        )}
        Crear contenido con esto
      </Button>
    ) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/insights" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Informes
          </Link>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
            {report.kind === "weekly" ? "Informe semanal" : "Análisis"} · {periodLabel(report)}
          </h1>
          <p className="text-xs text-muted-foreground">
            Solo conversaciones atendidas por el agente · modelo {report.model ?? "—"}
            {report.completed_at ? ` · generado ${formatDate(report.completed_at, tz)}` : ""}
          </p>
        </div>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => void remove()}>
            <Trash2 className="mr-2 h-4 w-4" /> Eliminar
          </Button>
        )}
      </div>

      {report.status !== "ready" ? (
        <Empty>
          {report.status === "failed"
            ? `No se pudo completar: ${report.error ?? "error desconocido"}`
            : `Analizando ${report.conversation_count} conversaciones… Puedes cerrar esta página.`}
        </Empty>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <TabsList className="w-max">
              <TabsTrigger value="summary">Resumen</TabsTrigger>
              <TabsTrigger value="faq">Preguntas</TabsTrigger>
              <TabsTrigger value="objections">Objeciones</TabsTrigger>
              <TabsTrigger value="buying">Compra y no compra</TabsTrigger>
              <TabsTrigger value="language">Hablan tus clientes</TabsTrigger>
              <TabsTrigger value="topics">Temas</TabsTrigger>
              <TabsTrigger value="sells">Qué vende</TabsTrigger>
              <TabsTrigger value="recs">Recomendaciones</TabsTrigger>
              <TabsTrigger value="content">Contenido</TabsTrigger>
              <TabsTrigger value="conversations">Conversaciones</TabsTrigger>
            </TabsList>
          </div>

          {/* ── Resumen ── */}
          <TabsContent value="summary" className="mt-4 space-y-4">
            <SampleNote n={s.totals.analyzed} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Conversaciones analizadas" value={s.totals.analyzed} hint={s.totals.failed ? `${s.totals.failed} sin poder analizar` : undefined} />
              <Kpi
                label="Agendaron llamada"
                value={s.outcomes.find((o) => o.status === "agendo_llamada")?.count ?? 0}
                hint={`${s.outcomes.find((o) => o.status === "agendo_llamada")?.percent ?? 0} %`}
              />
              <Kpi
                label="Compraron"
                value={s.outcomes.find((o) => o.status === "compro")?.count ?? 0}
                hint={`${s.outcomes.find((o) => o.status === "compro")?.percent ?? 0} %`}
              />
              <Kpi
                label="Intención alta"
                value={s.intent.find((i) => i.level === "alta")?.count ?? 0}
                hint={`${s.intent.find((i) => i.level === "alta")?.percent ?? 0} %`}
              />
            </div>
            {report.summary && (
              <div className="rounded-lg border bg-card p-4">
                <h2 className="text-sm font-medium">Resumen</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{report.summary}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Interpretación de la IA sobre los datos de abajo. Las cifras se calculan sin IA.
                </p>
              </div>
            )}
            {report.error && <p className="text-xs text-muted-foreground">{report.error}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Distribution
                title="Resultado"
                rows={s.outcomes.map((o) => ({ name: label(OUTCOME_LABEL, o.status), count: o.count, percent: o.percent }))}
              />
              <Distribution
                title="Intención de compra"
                rows={s.intent.map((i) => ({ name: label(INTENT_LABEL, i.level), count: i.count, percent: i.percent }))}
              />
              <Distribution
                title="Sentimiento"
                rows={s.sentiment.map((x) => ({ name: label(SENTIMENT_LABEL, x.sentiment), count: x.count, percent: x.percent }))}
              />
              <Distribution
                title="Embudo (llegaron al menos a…)"
                rows={s.funnel.map((f) => ({ name: label(FUNNEL_LABEL, f.stage), count: f.reached, percent: f.percent }))}
              />
            </div>
          </TabsContent>

          {/* ── Preguntas ── */}
          <TabsContent value="faq" className="mt-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              Preguntas agrupadas por intención. Porcentaje = conversaciones en las que aparece sobre {s.totals.analyzed}.
            </p>
            {s.faq.length === 0 ? <Empty>No se detectaron preguntas.</Empty> : s.faq.map((r) => (
              <RowWithEvidence key={r.key} row={r} tz={tz} action={genButton("faq", r.key)} />
            ))}
          </TabsContent>

          {/* ── Objeciones ── */}
          <TabsContent value="objections" className="mt-4 space-y-4">
            {s.evolution && <EvolutionBlock title="Evolución respecto al informe anterior" rows={s.evolution.objections} map={OBJECTION_LABEL} previousN={s.evolution.previous_analyzed} />}
            <div className="space-y-2">
              {s.objections.length === 0 ? <Empty>No se detectaron objeciones.</Empty> : s.objections.map((r) => (
                <StatRow
                  key={r.key}
                  title={label(OBJECTION_LABEL, r.name)}
                  percent={r.percent}
                  subtitle={`${r.conversations} conversaciones · ${r.occurrences} veces · ${Object.entries(r.by_kind)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => `${label(KIND_LABEL, k)}: ${n}`)
                    .join(" · ")}`}
                >
                  {r.examples.map((e) => (
                    <EvidenceQuote key={e.message_id} ev={e} tz={tz} />
                  ))}
                  <div className="pt-1">{genButton("objection", r.key)}</div>
                </StatRow>
              ))}
            </div>
          </TabsContent>

          {/* ── Compra y no compra ── */}
          <TabsContent value="buying" className="mt-4 space-y-6">
            <section className="space-y-2">
              <h2 className="font-medium">Motivos de compra</h2>
              {s.motivations.length === 0 ? <Empty>No se detectaron motivos de compra con cita literal.</Empty> : s.motivations.map((r) => (
                <RowWithEvidence key={r.key} row={r} tz={tz} action={genButton("motivation", r.key)} />
              ))}
            </section>
            <section className="space-y-2">
              <h2 className="font-medium">Motivos de no compra</h2>
              <p className="text-sm text-muted-foreground">
                Sobre {s.totals.not_purchased} conversaciones que no terminaron en compra. Que un motivo aparezca no
                significa que sea la causa: es un dato, no una conclusión.
              </p>
              {s.evolution && <EvolutionBlock title="Evolución" rows={s.evolution.non_buying} map={NON_BUYING_LABEL} previousN={s.evolution.previous_analyzed} />}
              {s.non_buying.length === 0 ? <Empty>No se detectaron motivos de no compra.</Empty> : s.non_buying.map((r) => (
                <StatRow
                  key={r.key}
                  title={label(NON_BUYING_LABEL, r.name)}
                  percent={r.percent}
                  subtitle={`${r.conversations} conversaciones · ${r.occurrences} veces${r.inferred ? ` · ${r.inferred} inferidas por la IA` : ""}`}
                  badge={r.inferred === r.occurrences ? <Badge variant="outline">Solo inferencias</Badge> : undefined}
                >
                  {r.examples.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Inferencias sin mensaje concreto de respaldo.</p>
                  ) : r.examples.map((e) => <EvidenceQuote key={e.message_id} ev={e} tz={tz} />)}
                  <div className="pt-1">{genButton("non_buying", r.key)}</div>
                </StatRow>
              ))}
            </section>
          </TabsContent>

          {/* ── Hablan tus clientes ── */}
          <TabsContent value="language" className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Frases literales de tus clientes, agrupadas por tema. Copiadas tal cual del chat (sin teléfonos ni emails).
            </p>
            {s.language.length === 0 ? <Empty>No hay frases destacadas.</Empty> : s.language.map((g) => (
              <section key={g.theme} className="space-y-2 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium capitalize">
                    {g.theme} <span className="text-sm font-normal text-muted-foreground">· {g.count} frases</span>
                  </h3>
                  {genButton("language", g.theme)}
                </div>
                {g.quotes.map((q) => (
                  <EvidenceQuote key={`${q.message_id}-${q.quote}`} ev={q} tz={tz} />
                ))}
              </section>
            ))}
          </TabsContent>

          {/* ── Temas ── */}
          <TabsContent value="topics" className="mt-4 space-y-2">
            {s.topics.length === 0 ? <Empty>No se detectaron temas.</Empty> : s.topics.map((r) => (
              <StatRow key={r.key} title={r.name} percent={r.percent} subtitle={`${r.conversations} conversaciones`} />
            ))}
          </TabsContent>

          {/* ── Qué vende ── */}
          <TabsContent value="sells" className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Compara las conversaciones que convirtieron (compra o llamada agendada) con las que no (rechazo o no
              compra). Son patrones estadísticos, no causas. Se excluyen {s.conversion?.excluded ?? 0} pendientes o
              indeterminadas.
            </p>
            {s.conversion ? <ConversionTable converted={s.conversion.converted} notConverted={s.conversion.not_converted} /> : <Empty>Sin datos.</Empty>}
          </TabsContent>

          {/* ── Recomendaciones ── */}
          <TabsContent value="recs" className="mt-4 space-y-3">
            {report.recommendations.length === 0 ? <Empty>Sin recomendaciones para este periodo.</Empty> : report.recommendations.map((r, i) => (
              <RecommendationCard key={i} rec={r} stats={s} />
            ))}
          </TabsContent>

          {/* ── Contenido ── */}
          <TabsContent value="content" className="mt-4 space-y-4">
            {content.length === 0 ? (
              <Empty>
                Pulsa «Crear contenido con esto» en una pregunta, objeción, motivo o tema de «Hablan tus clientes».
              </Empty>
            ) : content.map((c) => <ContentCard key={c.id} row={c} />)}
          </TabsContent>

          {/* ── Conversaciones ── */}
          <TabsContent value="conversations" className="mt-4 space-y-2">
            {s.conversations.map((c) => (
              <button
                key={c.conversation_id}
                type="button"
                onClick={() => setOpenConv({ id: c.conversation_id, contact: c.contact })}
                className="block w-full rounded-lg border bg-card px-4 py-3 text-left hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.contact}</span>
                  <Badge variant="outline">{label(OUTCOME_LABEL, c.outcome)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    Intención {label(INTENT_LABEL, c.intent)} · {label(SENTIMENT_LABEL, c.sentiment)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{c.summary}</p>
              </button>
            ))}
          </TabsContent>
        </Tabs>
      )}

      <ConversationSheet
        workspaceId={workspaceId}
        reportId={reportId}
        conv={openConv}
        tz={tz}
        canReply={role !== "viewer"}
        onClose={() => setOpenConv(null)}
      />
    </div>
  );
}

function RowWithEvidence({ row, tz, action }: { row: CountRow; tz: string; action: React.ReactNode }) {
  return (
    <StatRow title={row.name} percent={row.percent} subtitle={`${row.conversations} conversaciones · ${row.occurrences} veces`}>
      {row.examples.map((e) => (
        <EvidenceQuote key={e.message_id} ev={e} tz={tz} />
      ))}
      {action && <div className="pt-1">{action}</div>}
    </StatRow>
  );
}

function Distribution({ title, rows }: { title: string; rows: { name: string; count: number; percent: number }[] }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.name} className="text-sm">
            <div className="flex justify-between gap-2">
              <span>{r.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {r.count} · {r.percent} %
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${r.percent}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvolutionBlock({
  title,
  rows,
  map,
  previousN,
}: {
  title: string;
  rows: EvolutionRow[];
  map: Record<string, string>;
  previousN: number;
}) {
  if (rows.length === 0) return null;
  const icon = (t: EvolutionRow["trend"]) =>
    t === "sube" ? <ArrowUp className="h-3.5 w-3.5" /> : t === "baja" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />;
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground">
        Cambio en puntos porcentuales frente al informe anterior ({previousN} conversaciones).
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {rows.map((r) => (
          <li key={r.key} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
            {icon(r.trend)}
            {label(map, r.name)} {r.trend === "nuevo" ? "(nuevo)" : `${r.delta_pp > 0 ? "+" : ""}${r.delta_pp} pp`}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConversionTable({ converted, notConverted }: { converted: GroupProfile; notConverted: GroupProfile }) {
  const rows: Array<[string, (g: GroupProfile) => string]> = [
    ["Conversaciones (muestra)", (g) => String(g.n)],
    ["Mensajes (mediana)", (g) => fmt(g.median_messages)],
    ["Mensajes del cliente (mediana)", (g) => fmt(g.median_customer_messages)],
    ["Preguntas del cliente (mediana)", (g) => fmt(g.median_questions)],
    ["Objeciones (mediana)", (g) => fmt(g.median_objections)],
    ["Duración en horas (mediana)", (g) => fmt(g.median_duration_hours)],
    ["Con al menos una objeción", (g) => `${g.pct_with_objection} %`],
    ["Con seguimiento automático", (g) => `${g.pct_with_follow_up} %`],
  ];
  return (
    <div className="space-y-2">
      {(!converted.sufficient || !notConverted.sufficient) && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Hacen falta al menos 10 conversaciones en cada grupo para que la comparación sea fiable. Por ahora, tómalo como
          orientación.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 font-medium">Convierten</th>
              <th className="px-3 py-2 font-medium">No convierten</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, f]) => (
              <tr key={name} className="border-t">
                <td className="px-3 py-2 text-muted-foreground">{name}</td>
                <td className="px-3 py-2 tabular-nums">{f(converted)}</td>
                <td className="px-3 py-2 tabular-nums">{f(notConverted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const fmt = (v: number | null) => (v === null ? "—" : String(v));

function evidenceFor(key: string, s: ReportStats): string | null {
  const [kind, ...rest] = key.split(":");
  const k = rest.join(":");
  const pick = (rows: CountRow[], map?: Record<string, string>) => {
    const r = rows.find((x) => x.key === key);
    return r ? `${map ? label(map, r.name) : r.name}: ${r.conversations} conversaciones (${r.percent} %)` : null;
  };
  if (kind === "faq") return pick(s.faq);
  if (kind === "objection") return pick(s.objections, OBJECTION_LABEL);
  if (kind === "non_buying") return pick(s.non_buying, NON_BUYING_LABEL);
  if (kind === "motivation") return pick(s.motivations);
  if (kind === "topic") return pick(s.topics);
  if (kind === "intent") {
    const r = s.intent.find((x) => x.level === k);
    return r ? `Intención ${r.level}: ${r.count} (${r.percent} %)` : null;
  }
  if (kind === "outcome") {
    const r = s.outcomes.find((x) => x.status === k);
    return r ? `${label(OUTCOME_LABEL, r.status)}: ${r.count} (${r.percent} %)` : null;
  }
  return null;
}

function RecommendationCard({ rec, stats }: { rec: Recommendation; stats: ReportStats }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{label(RECOMMENDATION_LABEL, rec.type)}</Badge>
        <h3 className="font-medium">{rec.title}</h3>
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase text-muted-foreground">Problema detectado</dt>
          <dd>{rec.problem}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-muted-foreground">Evidencia (datos reales)</dt>
          <dd>
            <ul className="list-disc pl-5">
              {rec.based_on.map((k) => {
                const ev = evidenceFor(k, stats);
                return ev ? <li key={k}>{ev}</li> : null;
              })}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-muted-foreground">Impacto potencial</dt>
          <dd>{rec.impact}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-muted-foreground">Acción sugerida</dt>
          <dd>{rec.action}</dd>
        </div>
      </dl>
    </div>
  );
}

function CopyBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium uppercase text-muted-foreground">{title}</h4>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            toast.success("Copiado");
          }}
        >
          Copiar
        </button>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{text}</p>
    </div>
  );
}

function ContentCard({ row }: { row: ContentRow }) {
  const c = row.content;
  const name = row.source.kind === "objection" ? label(OBJECTION_LABEL, row.source.name) : row.source.kind === "non_buying" ? label(NON_BUYING_LABEL, row.source.name) : row.source.name;
  return (
    <details className="rounded-lg border bg-card p-4" open>
      <summary className="cursor-pointer font-medium">
        {name} <span className="text-sm font-normal text-muted-foreground">· {row.source.conversations} conversaciones · {formatDate(row.created_at)}</span>
      </summary>
      <div className="mt-3 space-y-3">
        <CopyBlock title="5 hooks" text={c.hooks.map((h, i) => `${i + 1}. ${h}`).join("\n")} />
        {c.reels.map((r, i) => (
          <CopyBlock key={i} title={`Reel ${i + 1}: ${r.title}`} text={`Gancho: ${r.hook}\n\n${r.script}\n\nCTA: ${r.cta}`} />
        ))}
        <CopyBlock title={`Carrusel: ${c.carousel.title}`} text={c.carousel.slides.map((sl, i) => `${i + 1}. ${sl}`).join("\n")} />
        <CopyBlock title="Email" text={`Asunto: ${c.email.subject}\n\n${c.email.body}`} />
        <CopyBlock title="Respuesta de WhatsApp" text={c.whatsapp_reply} />
        <CopyBlock title={`Masterclass: ${c.masterclass.title}`} text={`${c.masterclass.promise}\n\n${c.masterclass.outline.map((o, i) => `${i + 1}. ${o}`).join("\n")}`} />
        <CopyBlock title="FAQ" text={`${c.faq.question}\n\n${c.faq.answer}`} />
      </div>
    </details>
  );
}

type ConvInsight = {
  status: string;
  error: string | null;
  dropped: Record<string, number>;
  extraction: (VerifiedExtraction & { contact?: string }) | null;
};

function ConversationSheet({
  workspaceId,
  reportId,
  conv,
  tz,
  canReply,
  onClose,
}: {
  workspaceId: string;
  reportId: string;
  conv: { id: string; contact: string } | null;
  tz: string;
  canReply: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<ConvInsight | null>(null);
  const [replyFor, setReplyFor] = useState<{ conversation_id: string; contact: string } | null>(null);

  useEffect(() => {
    setData(null);
    if (!conv) return;
    void (async () => {
      const res = await fetch(`/api/workspace/${workspaceId}/insights/${reportId}/conversations/${conv.id}`, { cache: "no-store" });
      const json = (await res.json()) as { data?: ConvInsight };
      setData(json.data ?? null);
    })();
  }, [conv, workspaceId, reportId]);

  const x = data?.extraction ?? null;
  const droppedTotal = useMemo(() => Object.values(data?.dropped ?? {}).reduce((a, b) => a + b, 0), [data]);

  return (
    <>
      <Sheet open={!!conv} onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{conv?.contact}</SheetTitle>
            <SheetDescription>
              Análisis de la conversación. Lo observado lleva su cita; lo inferido está marcado.
            </SheetDescription>
          </SheetHeader>
          {!x ? (
            <Skeleton className="mt-4 h-40 w-full" />
          ) : (
            <div className="mt-4 space-y-5 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge>{label(INTENT_LABEL, x.intent.level)}</Badge>
                <Badge variant="outline">{label(OUTCOME_LABEL, x.outcome.status)}</Badge>
                <Badge variant="outline">Etapa: {label(FUNNEL_LABEL, x.funnel_stage)}</Badge>
              </div>
              <p>{x.summary}</p>

              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Datos observados</h3>
                <p>
                  <span className="text-muted-foreground">Intención: </span>
                  {x.intent.reason}
                </p>
                {x.intent.signals.map((sig, i) => (
                  <div key={i}>
                    <p className="text-xs text-muted-foreground">Señal: {sig.signal}</p>
                    <EvidenceQuote ev={sig.evidence} conversationId={conv?.id} tz={tz} />
                  </div>
                ))}
                {x.questions.map((q, i) => (
                  <div key={`q${i}`}>
                    <p className="text-xs text-muted-foreground">Pregunta · {q.normalized}</p>
                    <EvidenceQuote ev={q.evidence} conversationId={conv?.id} tz={tz} />
                  </div>
                ))}
                {x.objections.map((o, i) => (
                  <div key={`o${i}`}>
                    <p className="text-xs text-muted-foreground">
                      {label(KIND_LABEL, o.kind)} · {label(OBJECTION_LABEL, o.category)}
                      {o.note ? ` — ${o.note}` : ""}
                    </p>
                    <EvidenceQuote ev={o.evidence} conversationId={conv?.id} tz={tz} inferred={o.kind === "inferencia"} />
                  </div>
                ))}
              </section>

              <section className="space-y-1">
                <h3 className="text-xs font-medium uppercase text-muted-foreground">Resultado</h3>
                <p>{x.outcome.explanation}</p>
                {x.outcome.facts.map((f) => (
                  <p key={f} className="text-xs text-muted-foreground">Dato del sistema: {f}</p>
                ))}
                {x.non_buying_reasons.map((r, i) => (
                  <p key={i} className="text-xs">
                    Motivo de no compra: {label(NON_BUYING_LABEL, r.category)}
                    {r.inferred ? " (inferencia de la IA)" : ""}
                  </p>
                ))}
              </section>

              {x.key_moments.length > 0 && (
                <section>
                  <h3 className="text-xs font-medium uppercase text-muted-foreground">Momentos importantes</h3>
                  <ol className="mt-2 space-y-2 border-l pl-4">
                    {x.key_moments.map((m, i) => (
                      <li key={i}>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(m.at, tz)} · {label(MOMENT_LABEL, m.type)}
                        </p>
                        <p>{m.note}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {droppedTotal > 0 && (
                <p className="text-xs text-muted-foreground">
                  Se descartaron {droppedTotal} elementos que la IA propuso pero no se pudieron comprobar con un mensaje
                  literal.
                </p>
              )}

              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/inbox/${conv?.id}`}>Ver chat completo</Link>
                </Button>
                {canReply && conv && (
                  <Button size="sm" onClick={() => setReplyFor({ conversation_id: conv.id, contact: conv.contact })}>
                    ¿Qué debería responder?
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <ReplySheet workspaceId={workspaceId} item={replyFor} onClose={() => setReplyFor(null)} />
    </>
  );
}
