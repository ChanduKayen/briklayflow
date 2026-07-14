// THE TRADE VOCABULARY — the words that decide WHICH TRADE a sentence is about.
//
// PURE. No I/O, no model, no DB. It lives on its own because BOTH the I/O layer (_siteops_route's candidate
// narrowing) and the PURE enforcement planner (_siteops_resolution's trade guard) need it, and the planner
// must never import the layer that touches a database.
//
// ── THE LIVE FAILURE (2026-07-13) ───────────────────────────────────────────────────────────────────────
// He said: "Unit B ki electrical గాడులు తీసాము" — we cut the ELECTRICAL chases for Unit B.
//
// A chase (గాడు) is the groove cut into a wall to bury something. EVERY trade cuts them. But the word
// "chases" appears in exactly ONE label in the whole task library — "Plumbing — in-wall lines (chases &
// sleeves)" — and the electrical task is called "Electrical — conduiting (1st fix)" and never says "chase"
// at all. So the model matched the only label carrying his word, and said so itself: "…though it is labeled
// as plumbing". We then asked him to confirm a PLUMBING task, with no electrical option on the list.
//
// ── WHAT BELONGS HERE, AND WHAT DOES NOT ────────────────────────────────────────────────────────────────
// A word earns a place in a TRADE GROUP only if, on its own, it DECIDES the trade.
//
// "chase" does NOT. That is the whole lesson. Putting it under electrical would just move the bug; putting it
// under BOTH would make every chase-bearing label match both trades and quietly disable the guard. It is
// trade-NEUTRAL, and it must stay out — the word beside it ("electrical", "plumbing") is what decides, which
// is exactly what the supervisor was relying on.
//
// What DOES belong: the words that name a trade in the language he speaks it in. ఎలక్ట్రికల్ is electrical.
// కరెంట్ is electrical. ప్లంబింగ్ is plumbing. A guard that only reads English cannot guard a Telugu site.
//
// (The site's word for the WORK — chase/గాడు/1st fix — is surfaced to the MODEL instead, on the candidate
// line, via the engine library's `saidAs`. That is where a synonym helps: in the list the model reads.)

// Trade SYNONYM GROUPS. A supervisor's word ("brick work") and the engine's label ("Wall — blockwork") must
// resolve to the SAME group. Both sides are canonicalised to group indices and matched group-vs-group, so
// vocabulary differences never cause a false "parked". Matched by SUBSTRING, so entries are stems:
// 'electric' catches electrical/electrician.
//
// EVERY ENTRY MUST BE TRADE-DECISIVE ON ITS OWN. If a word could honestly belong to two trades, it does not
// go in a group — it goes nowhere, and the guard stays silent (silence is not evidence).
const TRADE_GROUPS: string[][] = [
  ['block', 'brick', 'masonry', 'మేస్త్రి', 'mestri'],
  ['plaster', 'rendering', 'ప్లాస్టరింగ్', 'ప్లాస్టర్'],
  // ELECTRICAL — in every language it is actually said in. కరెంట్ ("current") is what a site calls electrical.
  ['conduit', 'wiring', 'cable', 'electric', 'switchboard', 'switchplate',
    'ఎలక్ట్రికల్', 'ఎలక్ట్రీషియన్', 'కరెంట్', 'కరంట్', 'వైరింగ్', 'కండ్యూట్'],
  ['plumb', 'sanitary', 'pipe', 'cpvc', 'upvc', 'ప్లంబింగ్', 'ప్లంబర్', 'పైపు', 'పైపులు'],
  ['tile', 'tiling', 'flooring', 'floor finish', 'dado', 'టైల్స్', 'టైల్'],
  ['paint', 'putty', 'పెయింట్', 'పుట్టీ'],
  ['slab', 'pour', 'cast', 'casting', 'concreting', 'స్లాబ్'],
  ['column'], ['beam'], ['footing'], ['plinth'], ['excavat', 'digging'], ['pcc'], ['backfill'],
  ['waterproof', 'వాటర్‌ప్రూఫింగ్'], ['ceiling', 'సీలింగ్'], ['door', 'డోర్'], ['window'],
  ['grill', 'railing'], ['curing', 'క్యూరింగ్'],
  ['shutter', 'de-prop', 'deprop', 'deshutter', 'షట్టరింగ్'], ['reinforc', 'steel', 'rebar'],
  ['pile'], ['raft'], ['screed'], ['skirting'], ['frame'], ['lift', 'elevator', 'లిఫ్ట్'], ['riser'],
]

/**
 * Which trade groups a free-text string names (by index). Reads a MESSAGE and a TASK LABEL identically, so
 * the two can be compared as sets — which is what the trade guard does.
 *
 * An EMPTY result means "this string names no trade", NOT "this string names every trade". The guard treats
 * an empty side as no verdict, because a message that never says which trade it is about has not disagreed
 * with anything.
 */
export function tradeGroups(s: string | null): number[] {
  if (!s) return []
  const h = s.toLowerCase()
  const out: number[] = []
  TRADE_GROUPS.forEach((g, i) => { if (g.some((w) => h.includes(w))) out.push(i) })
  return out
}

/**
 * Do a message and a task label name DIFFERENT trades?
 *
 * True only when BOTH name a trade and the sets are disjoint. That is a fact, not a hunch, and it is the one
 * thing about a site report that is never uncertain: a supervisor who says "electrical" is not being vague
 * about the trade, however vague he may be about the floor.
 */
export function tradeMismatch(message: string | null, taskLabel: string | null): boolean {
  if (!message || !taskLabel) return false
  const said = tradeGroups(message)
  const task = tradeGroups(taskLabel)
  if (!said.length || !task.length) return false     // one side is silent → no verdict
  return !said.some((g) => task.includes(g))         // both spoke, and they disagreed
}
