// Config-driven WhatsApp Cloud API template sender.
//
// sendTemplate(key, to, params) looks the template up in the registry
// (./wa-templates.ts), builds + VALIDATES the component array from `params`
// (throwing a clear error BEFORE the Meta call on any missing/wrong param), then
// POSTs it. Adding a template never touches this file.
//
// This is the proactive/out-of-24h-window path (templates bypass the customer-
// service window). In-conversation durable replies still go through the outbox
// via whatsapp-webhook/_format.ts `send()` — a separate concern, untouched.

import { TEMPLATES, type TemplateDef, type TemplateKey } from "./wa-templates.ts";

const GRAPH_VERSION = Deno.env.get("WA_GRAPH_VERSION") ?? "v22.0";
const PHONE_NUMBER_ID = Deno.env.get("WA_PHONE_NUMBER_ID")!;
// Prefer a System User PERMANENT token (required for reliable proactive sends);
// fall back to the existing WA_ACCESS_TOKEN secret so a deploy isn't broken before
// the permanent token is configured.
const WA_TOKEN = Deno.env.get("WA_PERMANENT_TOKEN") ?? Deno.env.get("WA_ACCESS_TOKEN")!;

export interface SendTemplateParams {
  // body var values keyed by the names in bodyParams, e.g. { name: "Chandu" }
  [k: string]: string | undefined;
  headerImage?: string;     // required if header.kind is image & dynamic
  headerVideo?: string;     // required if header.kind is video & dynamic
  headerDocument?: string;  // required if header.kind is document & dynamic
  headerText?: string;      // required if header.kind is text
}

function buildComponents(def: TemplateDef, params: SendTemplateParams) {
  const components: unknown[] = [];

  // ---- header
  const h = def.header;
  if (h.kind === "text") {
    if (!params.headerText) throw new Error(`Template "${def.name}" needs headerText`);
    components.push({ type: "header", parameters: [{ type: "text", text: params.headerText }] });
  } else if (h.kind !== "none") {
    // Media header — always required at send time. URL is the per-send param when
    // dynamic, otherwise the fixed URL declared on the template.
    const map = { image: "headerImage", video: "headerVideo", document: "headerDocument" } as const;
    const field = map[h.kind];
    const url = h.dynamic ? params[field] : h.url;
    if (!url) throw new Error(`Template "${def.name}" needs ${h.dynamic ? field : "a fixed header url"}`);
    components.push({
      type: "header",
      parameters: [{ type: h.kind, [h.kind]: { link: url } }],
    });
  }
  // h.kind === "none" → no header component

  // ---- body
  if (def.bodyParams.length) {
    const parameters = def.bodyParams.map((p) => {
      const v = params[p];
      if (v == null) throw new Error(`Template "${def.name}" missing body param "${p}"`);
      return { type: "text", text: v };
    });
    components.push({ type: "body", parameters });
  }

  // ---- dynamic URL buttons (optional)
  for (const b of def.buttonUrlParams ?? []) {
    const v = params[b.name];
    if (v == null) throw new Error(`Template "${def.name}" missing button param "${b.name}"`);
    components.push({
      type: "button",
      sub_type: "url",
      index: String(b.index),
      parameters: [{ type: "text", text: v }],
    });
  }

  return components;
}

/**
 * Build a DURABLE template OutMessage (for whatsapp-webhook/_format.ts `send()` →
 * outbox → drainer), instead of the direct-to-Meta `sendTemplate` below. Same
 * registry + same validation (throws on a missing/wrong param BEFORE enqueue), so
 * a proactive template inherits the outbox's durability/backoff/TTL like every
 * other message. The drainer POSTs the rendered body.
 */
export function buildTemplateMessage(
  key: TemplateKey,
  params: SendTemplateParams = {},
): { kind: 'template'; name: string; language: string; components: unknown[] } {
  const def = TEMPLATES[key];
  if (!def) throw new Error(`Unknown template key "${String(key)}"`);
  return { kind: "template", name: def.name, language: def.language, components: buildComponents(def, params) };
}

export async function sendTemplate(
  key: TemplateKey,
  to: string,                 // E.164 without "+", e.g. "9198XXXXXXXX"
  params: SendTemplateParams = {},
) {
  const def = TEMPLATES[key];
  if (!def) throw new Error(`Unknown template key "${String(key)}"`);

  const components = buildComponents(def, params);

  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: def.name,
      language: { code: def.language },
      ...(components.length ? { components } : {}),
    },
  };

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json();
  // Always log the result so a send is never invisible (matches the [wa-send] norm).
  console.log("[wa-template]", res.status, def.name, "->", to, JSON.stringify(data));
  if (!res.ok) {
    console.error("WA template send failed", { key, to, error: data?.error });
    throw new Error(data?.error?.message ?? "WA send failed");
  }

  return { wamid: data?.messages?.[0]?.id as string | undefined, raw: data };
}
