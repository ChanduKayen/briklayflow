/**
 * General-expense classification. A general expense carries no payee — it is filed
 * under a GEN-xx expense head. The head is chosen by the LLM from the description,
 * reusing the existing `sku-matcher` edge function (action: suggestCostCode), which
 * returns the single best code from whatever candidate list it is handed. We hand it
 * ONLY the GEN heads, so the result is always a GEN code (or the GEN-99 fallback).
 */
import { supabase } from './supabase';
import { GEN_HEADS, GEN_FALLBACK, getCostCode } from './costCodes';

/**
 * Read a description and return the best-matching general-expense head code.
 * Never throws and never returns empty — falls back to GEN-99 on any miss/error so
 * a general expense always has a head.
 */
export async function classifyExpenseHead(description: string): Promise<string> {
  const remark = (description || '').trim();
  if (remark.length < 3) return GEN_FALLBACK;
  try {
    const { data, error } = await supabase.functions.invoke('sku-matcher', {
      body: {
        action: 'suggestCostCode',
        remark,
        cost_codes: GEN_HEADS.map((c) => ({ code: c.code, name: c.name })),
      },
    });
    if (error) return GEN_FALLBACK;
    const code = String((data as { code?: string })?.code || '').trim().toUpperCase();
    // only accept a real GEN head; anything else (NONE / hallucinated) → fallback
    if (code && code.startsWith('GEN-') && getCostCode(code)) return code;
    return GEN_FALLBACK;
  } catch {
    return GEN_FALLBACK;
  }
}
