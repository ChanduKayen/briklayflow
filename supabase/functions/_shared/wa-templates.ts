// Config-driven WhatsApp template registry.
//
// Adding a new approved template = ONE entry here (its exact Meta name, language,
// and component shape). Sending it is then a one-liner via sendTemplate() in
// ./whatsapp.ts. No logic changes per template.
//
// We can't be purely name-only: Meta needs each template's component shape (header
// type, how many body variables, dynamic URL buttons) to build the send body. But
// a template with no variables and a static header needs only { name, language }.

// Header shapes Meta supports. "dynamic: false" = a fixed/static asset uploaded at
// template creation → we omit the header component at send time.
export type HeaderSpec =
  | { kind: "none" }
  | { kind: "text" }
  | { kind: "image"; dynamic: boolean }
  | { kind: "video"; dynamic: boolean }
  | { kind: "document"; dynamic: boolean };

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
    header: { kind: "image", dynamic: true }, // set dynamic:false if you uploaded a fixed image
    bodyParams: ["name"],                     // {{1}} = "Welcome, {{1}}!"
  },
} satisfies Record<string, TemplateDef>;

export type TemplateKey = keyof typeof TEMPLATES;
