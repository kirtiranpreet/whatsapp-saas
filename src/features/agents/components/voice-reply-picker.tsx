"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type VoiceMode = "off" | "special" | "on_audio" | "always";

export interface VoiceSetting {
  mode: VoiceMode;
  voiceId: string;
  voiceName?: string;
}

interface Voice {
  voiceId: string;
  name: string;
  description: string;
  previewUrl: string | null;
}

const MODE_OPTIONS: { value: VoiceMode; label: string; hint: string }[] = [
  { value: "off", label: "Nunca", hint: "Solo texto" },
  { value: "special", label: "En momentos especiales", hint: "Una por conversación, cuando más confianza genera" },
  { value: "on_audio", label: "Si el cliente manda audio", hint: "Responde igual" },
  { value: "always", label: "Siempre", hint: "Todas las respuestas" },
];

interface Props {
  workspaceId: string;
  value: VoiceSetting;
  onChange: (value: VoiceSetting) => void;
}

/** Cuándo responde el agente con nota de voz y con qué voz de ElevenLabs. */
export function VoiceReplyPicker({ workspaceId, value, onChange }: Props) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const needsVoices = value.mode !== "off";

  useEffect(() => {
    if (!needsVoices || voices !== null) return;
    let cancelled = false;
    fetch(`/api/workspace/${workspaceId}/voices`)
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          data?: Voice[];
          configured?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(json.error ?? "No se pudieron cargar las voces");
          setVoices([]);
          return;
        }
        setConfigured(json.configured !== false);
        setVoices(json.data ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("No se pudieron cargar las voces");
          setVoices([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsVoices, voices, workspaceId]);

  useEffect(() => () => audioRef.current?.pause(), []);

  function togglePreview(voice: Voice) {
    if (!voice.previewUrl) return;
    if (playing === voice.voiceId) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(voice.previewUrl);
    audio.onended = () => setPlaying(null);
    audioRef.current = audio;
    audio.play().then(() => setPlaying(voice.voiceId)).catch(() => setPlaying(null));
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Responder con nota de voz</Label>
        <div className="grid grid-cols-2 gap-2">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...value, mode: opt.value })}
              aria-pressed={value.mode === opt.value}
              className={cn(
                "rounded-md border p-2 text-left transition-colors",
                value.mode === opt.value
                  ? "border-primary bg-primary/10"
                  : "border-border/60 hover:bg-muted/40",
              )}
            >
              <span className="block text-xs font-medium text-foreground">{opt.label}</span>
              <span className="block text-[10px] text-muted-foreground">{opt.hint}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Los enlaces siempre van por escrito, justo después del audio.
        </p>
      </div>

      {needsVoices && (
        <div className="space-y-2">
          <Label>Voz (ElevenLabs)</Label>
          {voices === null ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando voces…
            </p>
          ) : !configured ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-foreground">
              Falta la clave de ElevenLabs. Añade la variable ELEVENLABS_API_KEY en Vercel y vuelve a
              publicar. Mientras tanto el agente responde por escrito.
            </p>
          ) : loadError ? (
            <p className="text-xs text-destructive">{loadError}</p>
          ) : voices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Tu cuenta de ElevenLabs no tiene voces. Añade una en ElevenLabs y vuelve aquí.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/60 p-1">
              {voices.map((voice) => {
                const selected = value.voiceId === voice.voiceId;
                return (
                  <li key={voice.voiceId} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ ...value, voiceId: voice.voiceId, voiceName: voice.name })
                      }
                      aria-pressed={selected}
                      className={cn(
                        "min-w-0 flex-1 rounded px-2 py-1.5 text-left transition-colors",
                        selected ? "bg-primary/10" : "hover:bg-muted/40",
                      )}
                    >
                      <span className="block truncate text-xs font-medium text-foreground">
                        {voice.name}
                        {selected && " ✓"}
                      </span>
                      {voice.description && (
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {voice.description}
                        </span>
                      )}
                    </button>
                    {voice.previewUrl && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        aria-label={`Escuchar ${voice.name}`}
                        onClick={() => togglePreview(voice)}
                      >
                        {playing === voice.voiceId ? (
                          <Pause className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <Play className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {value.mode !== "off" && !value.voiceId && voices && voices.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Elige una voz: sin voz, el agente sigue respondiendo por escrito.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
