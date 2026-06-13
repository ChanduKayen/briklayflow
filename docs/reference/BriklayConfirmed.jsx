// BriklayConfirmed.jsx — reference design (account confirmed / signup complete)
// The moment: the user just clicked the email link, carrying a flicker of "did it
// work?". The page's job is RELIEF, then MOMENTUM. One signature, then a clear
// first step — not a dead-end "success" screen.
//
// Signature: THE BRICK LANDS. The landing page's brick falls to *correct* a
// sentence; here it falls to *found* something — it drops into place as the first
// brick of the user's account, settling onto a baseline that becomes the line of
// type "You're in." One gesture, the whole brand: building, begun.

import React, { useEffect, useState } from "react";
import { ArrowRight, MessageCircle } from "lucide-react";

const V = {
  ink: "#1E1A15", inkSoft: "#3D3830", sys: "#6B6258", faint: "#9A9186",
  terra: "#BC4B27", terraDeep: "#8F3318", terraWash: "#FBEFE9",
  sage: "#2F5D34", sageWash: "#E9F2E7",
  page: "#FBF9F6", surface: "#FFFFFF", field: "#F4F2EE", line: "#EAE6E0",
};
const font = { fontFamily: "'DM Sans', system-ui, sans-serif" };
const serif = { fontFamily: "Georgia, 'Times New Roman', serif" };
const terraGrad = "linear-gradient(135deg, #C75530 0%, #A93E1F 100%)";

const CSS = `
@keyframes cfBrickFall {
  0%   { opacity: 0; transform: translate(-50%, -120px) rotate(-8deg); animation-timing-function: cubic-bezier(.5,0,.9,.4); }
  8%   { opacity: 1; }
  46%  { transform: translate(-50%, 0) rotate(3deg); animation-timing-function: ease-out; }
  52%  { transform: translate(-50%, 0) rotate(3deg) scale(1.12,.82); }
  60%  { transform: translate(-50%, 0) scale(.97); }
  68%  { transform: translate(-50%, 0) scale(1); }
  100% { transform: translate(-50%, 0) scale(1); opacity: 1; }
}
@keyframes cfDust {
  0%, 44% { opacity: 0; transform: scaleX(.3); }
  54%     { opacity: .5; transform: scaleX(1); }
  100%    { opacity: 0; transform: scaleX(1.4); }
}
@keyframes cfRise { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: none; } }
@keyframes cfShudder { 0%,46%{transform:none;} 50%{transform:translateY(2px);} 54%{transform:translateY(-1px);} 58%,100%{transform:none;} }

.cf-brick   { animation: cfBrickFall 1.5s forwards; }
.cf-dust    { animation: cfDust 1.5s ease forwards; }
.cf-line    { animation: cfShudder 1.5s ease forwards; }
.cf-r1 { animation: cfRise .6s cubic-bezier(.25,.7,.2,1) 1.35s both; }
.cf-r2 { animation: cfRise .6s cubic-bezier(.25,.7,.2,1) 1.55s both; }
.cf-r3 { animation: cfRise .6s cubic-bezier(.25,.7,.2,1) 1.8s both; }

@media (prefers-reduced-motion: reduce) {
  .cf-brick { animation: none; opacity: 1; transform: translate(-50%, 0); }
  .cf-dust { display: none; }
  .cf-line, .cf-r1, .cf-r2, .cf-r3 { animation: none; opacity: 1; transform: none; }
}
`;

export default function BriklayConfirmed() {
  // a real app reads ?email= or the session; placeholder for the reference
  const name = "Chandu";

  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: V.page, ...font }}>
      <style>{CSS}</style>

      <div className="w-full text-center" style={{ maxWidth: 440 }}>

        {/* the brand, quiet at the top — exactly as on the website */}
        <p className="text-lg font-semibold" style={{ color: V.ink }}>
          Briklay<span style={{ color: V.terra }}>.</span>
        </p>

        {/* the signature: the brick lands, founding the line */}
        <div className="relative mt-16 mb-2" style={{ height: 64 }}>
          {/* the brick */}
          <span
            className="cf-brick absolute"
            aria-hidden="true"
            style={{
              left: "50%", bottom: 14, width: 30, height: 19, borderRadius: 3,
              background: terraGrad, boxShadow: "0 6px 16px rgba(143,51,24,0.28)",
            }}
          />
          {/* the dust line it kicks up on impact = the baseline it founds */}
          <span
            className="cf-dust absolute"
            aria-hidden="true"
            style={{
              left: "50%", transform: "translateX(-50%)", bottom: 12,
              width: 140, height: 1, background: V.terra, transformOrigin: "center",
            }}
          />
        </div>

        {/* the relief line */}
        <h1 className="cf-line" style={{ color: V.ink, ...serif, fontSize: "clamp(2rem, 1.4rem + 3vw, 2.8rem)", lineHeight: 1.1 }}>
          You're in, {name}.
        </h1>

        <p className="cf-r1 mt-4 leading-relaxed" style={{ color: V.sys, fontSize: "clamp(0.9rem, 0.84rem + 0.4vw, 1rem)" }}>
          Your account is set. Your books start the moment your site does.
        </p>

        {/* the momentum: the real first step, not a dead end */}
        <a
          href="/onboarding"
          className="cf-r2 inline-flex items-center justify-center gap-2 mt-8 w-full py-3 rounded-xl font-medium"
          style={{ background: terraGrad, color: "#fff", textDecoration: "none", fontSize: "clamp(0.9rem, 0.85rem + 0.3vw, 1rem)" }}
        >
          Set up your first project <ArrowRight size={16} />
        </a>

        {/* the secondary path: bring the site onto WhatsApp */}
        <a
          href="/day-book"
          className="cf-r3 inline-flex items-center justify-center gap-2 mt-3 text-sm"
          style={{ color: V.inkSoft, textDecoration: "none" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#1FA855" aria-hidden="true"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-1.115z"/></svg>
          or bring your site onto WhatsApp first
        </a>

      </div>
    </div>
  );
}
