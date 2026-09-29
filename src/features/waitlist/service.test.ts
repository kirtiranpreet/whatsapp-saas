import assert from "node:assert/strict";
import { test } from "node:test";
import { citySlug, normalizeCity, waitlistCsv, waitlistTags } from "./service.ts";

test("city slug and tags", () => {
  assert.equal(citySlug("La Coruña"), "la-coruna");
  assert.equal(citySlug(" Palma de Mallorca "), "palma-de-mallorca");
  assert.deepEqual(waitlistTags("Málaga"), ["lista-espera", "lista-espera-malaga"]);
});

test("city normalized for grouping", () => {
  assert.equal(normalizeCity("  zaragoza "), "Zaragoza");
  assert.equal(normalizeCity("palma DE mallorca"), "Palma de Mallorca");
  assert.equal(normalizeCity("la coruña"), "La Coruña");
});

test("csv escapes and keeps accents", () => {
  const csv = waitlistCsv([
    {
      id: "1",
      city: "Málaga",
      name: "Pérez, Ana",
      phone: "+34600000000",
      email: null,
      notes: 'quiere "fin de semana"',
      status: "waiting",
      hl_tagged: false,
      created_at: "2026-09-29T20:00:00Z",
    },
  ]);
  assert.ok(csv.startsWith("﻿Ciudad,"));
  assert.match(csv, /Málaga,"Pérez, Ana",\+34600000000,,"quiere ""fin de semana""",En espera,2026-09-29/);
});
