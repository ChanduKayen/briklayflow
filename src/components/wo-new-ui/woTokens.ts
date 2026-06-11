/**
 * New Work Order redesign — WO-specific presentation constants.
 *
 * The four-voice palette (V) and `nums` are reused from po-new-ui/voiceTokens
 * (cross-page consistency — V.line is shared). Only the two things the WO
 * reference adds and po-new-ui lacks live here: the allocation-bar segment
 * greens and the serif face for the "living sentence".
 *
 * UI-only. Never read by any pipeline code path.
 */

// Sage segment greens for the allocation bar + sentence picture (sized by stage share).
export const SEG = ['#4F7A54', '#7FA383', '#AFC8B2'] as const;

// Serif face for the living sentence + ceremony sentence (plain-language voice).
export const serif = { fontFamily: "Georgia, 'Times New Roman', serif" } as const;

// Shared rupee formatter for the WO surfaces.
export const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN');
