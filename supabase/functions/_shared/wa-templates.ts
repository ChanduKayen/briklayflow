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

  // Sends a placed PO to its VENDOR, with the signed PO PDF as the document header. Proactive
  // (out-of-24h-window) → must be a template. Approved copy:
  //   "Hello {{1}},\n\n*{{2}}* has placed Purchase Order {{3}} with you.\n\nThe signed PO PDF is
  //    attached. Kindly proceed with the order and dispatch as per the delivery schedule in the PO."
  //   {{1}} = vendor name · {{2}} = builder (sender) name · {{3}} = PO number.
  // Header is a DYNAMIC document — the PO PDF link is a per-send param (headerDocument). ⚠ Register
  // in Meta (exact name/language/components) before enabling; `language` assumed "en" — correct it
  // if Meta registered another code.
  purchase_order: {
    name: "purchase_order",
    // Meta registered this in English (US) → "en_US" (a plain "en" gives #132001 "Template name
    // does not exist in the translation"). If the template's language chip in WhatsApp Manager
    // reads just "English", change this back to "en".
    language: "en_US",
    header: { kind: "document", dynamic: true },
    bodyParams: ["vendor_name", "builder_name", "po_number"],
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

  // Login / signup OTP — delivered over WhatsApp by the Supabase Send-SMS hook (auth-sms-hook),
  // which passes the code Supabase generated. Matches the APPROVED Meta template `signup_otp`
  // (English US → "en_US"). The approved body has TWO variables:
  //   "OTP Code: {{1}}. This is your OTP code for {{2}}. For your security, do not share this code."
  //   {{1}} = the OTP · {{2}} = the purpose label ("Login" in the approved sample).
  // Sending only {{1}} → Meta #132000 ("localizable_params (1) does not match expected (2)").
  //
  // This template carries a URL button at index 0 (the "Copy code" / autofill button that
  // WhatsApp OTP templates get). Meta REQUIRES that button's parameter on every send, else
  // #131008 ("buttons: Button at index 0 of type Url requires a parameter"). The button's
  // value is the OTP itself — the same `code` var — so the button copies/autofills the code.
  auth_otp: {
    name: "signup_otp",
    language: "en_US",
    header: { kind: "none" },
    bodyParams: ["code", "purpose"],           // {{1}} = the OTP, {{2}} = purpose label
    buttonUrlParams: [{ index: 0, name: "code" }],  // copy-code button → the OTP
  },

  // RFQ — request a quotation from a vendor (proactive → template). Approved Meta template
  // `request_for_quotation` (English US). Body has 4 vars + a DYNAMIC URL button opening a
  // no-login page where the vendor enters their rates. The Meta button URL is
  // `https://www.briklay.app/{{1}}`, and we send {{1}} = "quote/<token>" → the final link is
  // https://www.briklay.app/quote/<token> (matches the /quote/:token route).
  //   {{1}} vendor name · {{2}} builder (user org) name · {{3}} items summary + count · {{4}} delivery address
  request_for_quotation: {
    name: "rfq_vendor_v1",   // the approved Meta template name (dynamic URL button)
    language: "en_US",
    header: { kind: "none" },
    bodyParams: ["vendor_name", "builder_name", "items_summary", "delivery_location"],
    buttonUrlParams: [{ index: 0, name: "token_path" }],
  },

  // Team invite — sent to a cold number, so it's a template. Approved Meta template
  // `account_creation_confirmation_3` (English US). Body:
  //   "Hi {{1}}, {{2}} invited you to Briklay App. Tap below to accept the invite and get set up…"
  //   {{1}} = invited person's name, {{2}} = the inviter's name.
  // The button is a STATIC URL to the signup page (no per-send param) — the invitee enters their
  // mobile number there and our OTP takes over; org linking is by phone, so no token in the URL.
  team_invite: {
    name: "account_creation_confirmation_3",
    language: "en_US",
    header: { kind: "none" },
    bodyParams: ["invitee", "inviter"],   // {{1}} = invited name, {{2}} = inviter name
    // static button → no buttonUrlParams
  },
} satisfies Record<string, TemplateDef>;

export type TemplateKey = keyof typeof TEMPLATES;
