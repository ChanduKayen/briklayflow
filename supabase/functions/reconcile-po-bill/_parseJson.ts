/**
 * Pull the object out of whatever the model returned.
 *
 * With response_format json_object this is close to a formality, but the reader must never die on a
 * stray fence or a leading sentence: the person on the other end is holding a phone in front of a
 * bill, and an engineer's error where a form should be is the difference between recording the bill
 * and giving up. So: strip a fence, take the OUTERMOST BALANCED object — walking to its matching
 * brace, never greedily to the last "}" in the response, which a trailing sentence could supply —
 * and if there is genuinely nothing to parse, fail in words that person can act on.
 *
 * Kept apart from the edge function so it can be tested without an API key.
 */
export function parseModelJson(raw: string): Record<string, unknown> {
  const body = String(raw ?? '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const first = body.indexOf('{');
  if (first < 0) throw new Error("The reader couldn't make figures out of that page");

  let depth = 0, inStr = false, esc = false;
  for (let i = first; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(body.slice(first, i + 1)) as Record<string, unknown>; }
      catch { break; }                      // balanced but not valid — nothing better to try
    }
  }
  throw new Error("The reader couldn't make figures out of that page");
}
