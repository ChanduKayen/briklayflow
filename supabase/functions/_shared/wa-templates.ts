// Config-driven WhatsApp template registry.
//
// Adding a new approved template = ONE entry here (its exact Meta name, language,
// and component shape). Sending it is then a one-liner via sendTemplate() in
// ./whatsapp.ts. No logic changes per template.
//
// We can't be purely name-only: Meta needs each template's component shape (header
// type, how many body variables, dynamic URL buttons) to build the send body. But
// a template with no variables and a static header needs only { name, language }.

// Header shapes Meta supports. For MEDIA headers (image/video/document) Meta
// always needs the asset at send time — the file uploaded when the template was
// created is only the approval sample, never reused on send. So:
//   dynamic: true  → caller passes the URL per send (headerImage/Video/Document)
//   dynamic: false → a FIXED asset that's the same every send; put its public
//                    URL in `url` here and we send that link on every message.
// Omitting the header component for a media-header template is rejected by Meta
// with error #132012 (parameter format does not match the created template).
export type HeaderSpec =
  | { kind: "none" }
  | { kind: "text" }
  | { kind: "image"; dynamic: true }
  | { kind: "image"; dynamic: false; url: string }
  | { kind: "video"; dynamic: true }
  | { kind: "video"; dynamic: false; url: string }
  | { kind: "document"; dynamic: true }
  | { kind: "document"; dynamic: false; url: string };

export interface TemplateDef {
  name: string;        // EXACT Meta template name
  language: string;    // EXACT language code, e.g. "en" (not "en_US" unless that's the template)
  header: HeaderSpec;
  bodyParams: string[];                                  // ordered → {{1}}, {{2}}, ...
  buttonUrlParams?: { index: number; name: string }[];   // dynamic URL-suffix buttons (optional)
}

// Add any new template here. The key is what callers reference.
export const TEMPLATES = {
  teammate_welcome: {
    name: "teammate_welcome_to_whatsapp_utility",
    language: "en",
    // Fixed image header — the "Welcome to Briklay!" graphic. Meta needs the media
    // link on every send (the creation-time upload is only the approval sample), so
    // we serve it from the public `wa-public` bucket. Same image each time.
    header: {
      kind: "image",
      dynamic: false,
      url: "https://momzyincivvpngazvfgq.supabase.co/storage/v1/object/public/wa-public/teammate_welcome.png",
    },
    bodyParams: ["name"],                     // {{1}} = "Welcome, {{1}}!"
  },

  // Proactive nudge to an approver that a purchase order awaits them (outside the 24h
  // session window → must be a template). Body e.g.:
  //   "{{1}} needs your approval — ₹{{2}} to {{3}} for {{4}}. Review or approve below."
  //   {{1}}=po_id, {{2}}=amount, {{3}}=vendor, {{4}}=site
  // A dynamic URL button ("Review details") whose suffix variable is the po_id, opening
  // <WA_APP_LINK>/purchase-orders/{{po_id}}.  ⚠ Register this template in Meta (exact
  // name/language/components) before enabling the send — it can't go out until approved.
  procurement_approval: {
    name: "procurement_approval_notification",
    language: "en",
    header: { kind: "none" },
    bodyParams: ["po_id", "amount", "vendor", "site"],
    buttonUrlParams: [{ index: 0, name: "po_id" }],
  },

  // Block B chase templates — APPROVED in Meta (user-supplied specs). ⚠ `language` is
  // assumed "en"; correct it if Meta registered another code (a mismatch → #132012).
  //
  // issue_followup — the batched status-check chase (out-of-window). Approved body:
  //   "Hi {{1}}, quick check :\n\n{{2}}\n\nHow's it looking? Reply back - and if anything's
  //    stuck, tell me and I'll help clear it."
  //   {{1}} = the owner's name · {{2}} = the status list.
  // NOTE: this is a TWO-slot template (name + one content slot), NOT a free-form {{1}}.
  // The batched digest rides {{2}} as the NEWLINE-FREE one-liner from renderDigestInline
  // (Meta rejects newlines in a variable value) — so out-of-window batches read as a single
  // line, not the pretty multi-line in-window digest. That's the approved shape's limit.
  issue_followup: {
    name: "issue_followup",
    language: "en",
    header: { kind: "none" },
    bodyParams: ["name", "summary"],   // {{1}} = owner name, {{2}} = status list
  },

  // issue_assignment — a hand-off to a new owner (out-of-window). Approved body:
  //   "Hi {{1}}, you have to follow-up on this :\n\n*{{2}}*\nAiming to close by {{3}}.\n\n
  //    Reply here anytime with how it's going — a voice note's fine. I'll check in as the
  //    date gets close."
  //   {{1}} = new owner name · {{2}} = the item · {{3}} = the close/target date.
  issue_assignment: {
    name: "issue_assignment",
    language: "en",
    header: { kind: "none" },
    bodyParams: ["name", "item", "due"],   // {{1}} owner, {{2}} item, {{3}} close date
  },
} satisfies Record<string, TemplateDef>;

export type TemplateKey = keyof typeof TEMPLATES;
