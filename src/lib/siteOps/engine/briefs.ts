// THE BRIEF — what a task IS, before anyone starts it.
//
// A quality check is what you TICK when the work is done. A brief is what you READ before you begin.
// They are not the same thing, and the card shows them at different moments: the brief on a task that
// has not started, the checks from in-progress onwards. Neither replaces the other.
//
// Three points, always the same shape, so it can be skimmed in eight seconds:
//   1. WHAT it is            — one plain sentence. No jargon a first-week helper wouldn't know.
//   2. WHAT GOES WRONG       — the consequence, stated concretely. This is the point that earns its place.
//   3. WHEN IT'S REALLY DONE — the finish line, so "done" means one thing to everybody.
//
// ── ON THE TELUGU ────────────────────────────────────────────────────────────────────────────────
// This is SITE Telugu, not literary Telugu. On an Indian site the grammar is Telugu and the trade nouns
// are English — a mason says కండ్యూట్, ప్లాస్టరింగ్, స్లాబ్, క్యూరింగ్, లెవల్. Translating those into
// pure Telugu compounds produces sentences that are correct and that nobody on a site would use, which
// is worse than leaving them in English. So: TRANSLATE THE SENTENCE, TRANSLITERATE THE TRADE TERM.
// If you edit these, keep that rule — the test of a line is whether a supervisor would say it out loud.
//
// ── WHY THIS IS AUTHORED, NOT GENERATED ──────────────────────────────────────────────────────────
// The same reason the QC checks are (see types.ts, QcCheck). Generating text on a page visit means the
// text exists only if someone happened to open the right screen at the right moment, and it quietly
// differs every time it is read. A property of a task TYPE belongs with the task type.

import type { Brief, BriefLang, TaskTypeId } from './types'

export type { Brief }

/**
 * The 3 points for a task type in a language.
 *
 * Falls back to English when a language is missing rather than returning nothing — a blank panel is
 * the one outcome worse than the wrong language. Returns null only for a type with no brief at all
 * (a user-classified task, which has no authored type): an honest gap, and the card renders nothing
 * rather than inventing something.
 */
export function briefOf(taskTypeId: TaskTypeId | null | undefined, lang: BriefLang): string[] | null {
  if (!taskTypeId) return null
  const b = BRIEFS[taskTypeId]
  if (!b) return null
  const points = b[lang]
  return points?.length ? points : (b.en?.length ? b.en : null)
}

export const BRIEFS: Record<TaskTypeId, Brief> = {
  // ── substructure ───────────────────────────────────────────────────────────
  ground_clearance: {
    en: [
      'Clear the whole building footprint — bushes, rubble, old foundations, all of it out.',
      'Leave junk buried under the building and it settles later. You cannot fix that afterwards.',
      "Done when the plot is clean and a lorry can get in.",
    ],
    te: [
      'బిల్డింగ్ కట్టబోయే ఏరియా మొత్తం శుభ్రం చేయాలి — పొదలు, రబ్బిష్, పాత ఫౌండేషన్లు అన్నీ బయటికి తీసేయాలి.',
      'కింద చెత్త అలాగే వదిలేస్తే, కొన్నాళ్లకి అది కుంగిపోతుంది. బిల్డింగ్ కట్టేశాక దాన్ని సరిచేయడం ఎవరి వల్లా కాదు.',
      'ప్లాట్ శుభ్రంగా అయ్యి, లోపలికి లారీ వచ్చిపోయేలా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  site_marking: {
    en: [
      'Mark the grid lines and the building corners on the ground, straight off the drawing.',
      'A few inches out here shifts the whole building. Every wall after this is wrong.',
      'Done when the corners, the setbacks and the datum level are pegged and written down.',
    ],
    te: [
      'డ్రాయింగ్ చూసి గ్రిడ్ లైన్లు, బిల్డింగ్ మూలలు నేల మీద గుర్తు పెట్టాలి.',
      'ఇక్కడ రెండు మూడు అంగుళాలు తేడా వచ్చినా బిల్డింగ్ మొత్తం జరిగిపోతుంది. ఆ తర్వాత కట్టే ప్రతి గోడా తప్పుగానే వస్తుంది.',
      'మూలలు, సెట్‌బ్యాక్‌లు, డేటమ్ లెవల్ — అన్నీ గుర్తు పెట్టి, రాసి పెట్టుకున్నాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  excavation: {
    en: [
      'Dig the pits for the footings — down to the drawing depth, and down to firm soil.',
      'Stop at loose soil and the footing sinks. The crack shows up years later.',
      'Done when every pit is at level, clean at the bottom, and the sides hold.',
    ],
    te: [
      'ఫుటింగ్‌ల కోసం గుంతలు తవ్వాలి — డ్రాయింగ్‌లో ఉన్న లోతు వరకు, గట్టి నేల తగిలే వరకు.',
      'పైపైన మెత్తటి మట్టి దగ్గరే ఆపేస్తే ఫుటింగ్ కుంగిపోతుంది. ఆ పగులు కనిపించేసరికి చాలా ఏళ్లు గడిచిపోతాయి.',
      'ప్రతి గుంత సరైన లెవల్‌లో ఉండి, అడుగు భాగం శుభ్రంగా ఉండి, పక్క గోడలు కూలకుండా నిలబడితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  pcc_bed: {
    en: [
      'A thin concrete bed at the bottom of each pit, so the steel never sits on bare earth.',
      'Skip it and the earth eats the steel from below. Nobody sees it happen.',
      'Done when the bed covers the full footing area and it is level.',
    ],
    te: [
      'ప్రతి గుంత అడుగున పలుచటి కాంక్రీట్ బెడ్ వేయాలి — స్టీల్ నేరుగా మట్టి మీద కూర్చోకుండా.',
      'ఇది వదిలేస్తే మట్టిలో ఉన్న తేమ కింది నుంచి స్టీల్‌ని తినేస్తుంది. అది జరుగుతున్నప్పుడు ఎవరికీ కనిపించదు.',
      'ఫుటింగ్ ఏరియా మొత్తం కప్పేలా బెడ్ పడి, లెవల్‌గా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  footing: {
    en: [
      'The steel cage and the concrete the whole building stands on.',
      'If a bar touches the earth, water reaches it and it rusts. The building rots at the foot.',
      'Done when cover blocks sit under every bar and the pour went in one go, with no honeycomb.',
    ],
    te: [
      'బిల్డింగ్ మొత్తం దేని మీద నిలబడుతుందో ఆ ఫుటింగ్ — స్టీల్ కేజ్ కట్టి, కాంక్రీట్ పోయాలి.',
      'ఒక్క కడ్డీ మట్టికి తగిలినా, దాని దాకా నీళ్లు చేరి తుప్పు పడుతుంది. బిల్డింగ్ కాళ్ల దగ్గరే కుళ్లిపోతుంది.',
      'ప్రతి కడ్డీ కింద కవర్ బ్లాక్ ఉండి, పోత ఒకేసారి ఆగకుండా పడి, హనీకోంబ్ లేకుండా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  footing_column: {
    en: [
      'The starter bars coming up out of the footing, carried to plinth level.',
      'If they are not plumb and on the grid, every column above them is off.',
      'Done when the starters are plumb, tied, and lapped to the drawing length.',
    ],
    te: [
      'ఫుటింగ్ నుంచి పైకి వచ్చే స్టార్టర్ కడ్డీలను ప్లింత్ లెవల్ దాకా తీసుకురావాలి.',
      'ఇవి నిలువుగా, గ్రిడ్ మీద సరిగ్గా లేకపోతే, వీటి మీద నిలబడే ప్రతి కాలమ్ వంకరగానే వెళ్తుంది.',
      'స్టార్టర్లు నిలువుగా ఉండి, కట్టి ఉండి, డ్రాయింగ్ ప్రకారం ల్యాప్ ఇచ్చి ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  backfill: {
    en: [
      'Fill the earth back around the footings and compact it, layer by layer.',
      'Dump it in one go and it sinks later — the floor above it cracks.',
      'Done when it is filled in layers, watered, rammed, and up to plinth level.',
    ],
    te: [
      'ఫుటింగ్‌ల చుట్టూ మట్టిని మళ్లీ నింపి, పొరపొరగా గట్టిగా కొట్టాలి.',
      'ఒకేసారి మట్టి కుమ్మరించేస్తే అది తర్వాత కుంగిపోతుంది. దాని మీద ఉన్న ఫ్లోర్ పగులుతుంది.',
      'పొరలు పొరలుగా నింపి, నీళ్లు కొట్టి, గట్టిగా దంచి, ప్లింత్ లెవల్ దాకా వచ్చాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  plinth_beam: {
    en: [
      'The beam that ties all the columns together at plinth level.',
      'It is what stops the walls above from cracking when the ground moves.',
      'Done when the ring is continuous — no gaps anywhere — and cured.',
    ],
    te: [
      'ప్లింత్ లెవల్‌లో కాలమ్‌లన్నిటినీ కలిపి కట్టే బీమ్ ఇది.',
      'నేల కదిలినప్పుడు పైన ఉన్న గోడలు పగలకుండా పట్టి ఉంచేది ఈ బీమే.',
      'రింగ్ ఎక్కడా తెగకుండా చుట్టూ కలిసి ఉండి, క్యూరింగ్ పూర్తయితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  plinth_fill: {
    en: [
      'Fill inside the plinth beams with earth, in layers, and compact it.',
      'Loose fill here means the ground-floor slab sinks and the tiles crack.',
      'Done when it is rammed layer by layer and level all the way across.',
    ],
    te: [
      'ప్లింత్ బీమ్‌ల లోపల మట్టిని పొరలుగా నింపి గట్టిగా కొట్టాలి.',
      'ఇక్కడ మట్టి వదులుగా ఉంటే గ్రౌండ్ ఫ్లోర్ స్లాబ్ కుంగి, టైల్స్ అన్నీ పగులుతాయి.',
      'పొర పొరగా దంచి, అంతటా ఒకే లెవల్‌లో ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  plinth_slab: {
    en: [
      'The floor slab sitting on the filled plinth.',
      'This is the floor everyone walks on. Get the level wrong and every room is off.',
      'Done when it is poured, level, and cured.',
    ],
    te: [
      'నింపిన ప్లింత్ మీద పడే ఫ్లోర్ స్లాబ్ ఇది.',
      'అందరూ నడిచేది ఈ ఫ్లోర్ మీదే. లెవల్ తప్పితే ఇంట్లో ప్రతి రూమూ తేడాగానే ఉంటుంది.',
      'పోత పడి, లెవల్‌గా ఉండి, క్యూరింగ్ అయ్యాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  foundation: {
    en: [
      'The mass concrete that fills the foundation and carries the load down to the soil.',
      'Poured thin, or in patches, and the load path breaks. Everything above stands on this.',
      'Done when it is poured full, compacted, and cured.',
    ],
    te: [
      'ఫౌండేషన్ నిండా వేసే మాస్ కాంక్రీట్ ఇది — బిల్డింగ్ బరువును నేలకు మోసుకెళ్లేది ఇదే.',
      'పలుచగా, లేదా ముక్కలు ముక్కలుగా పోస్తే బరువు వెళ్లే దారి తెగిపోతుంది. పైన ఉన్నదంతా దీని మీదే నిలబడుతుంది.',
      'నిండుగా పోత పడి, కంపాక్ట్ అయ్యి, క్యూరింగ్ పూర్తయితే ఈ పని పూర్తయినట్టు.',
    ],
  },

  // ── the floor cycle ────────────────────────────────────────────────────────
  columns: {
    en: [
      "This floor's columns — the cage, the shuttering, the pour.",
      'Out of plumb here and every wall, door and tile on the floor above fights it.',
      'Done when they are plumb, the cover is right, and there is no honeycomb at the base.',
    ],
    te: [
      'ఈ ఫ్లోర్ కాలమ్‌లు కట్టాలి — కేజ్ కట్టడం, షట్టరింగ్ పెట్టడం, పోత పోయడం.',
      'ఇక్కడ నిలువు తప్పితే, పై ఫ్లోర్‌లో ప్రతి గోడ, ప్రతి తలుపు, ప్రతి టైల్ దానితో పోరాడాల్సి వస్తుంది.',
      'కాలమ్‌లు నిలువుగా ఉండి, కవర్ సరిగ్గా ఉండి, అడుగున హనీకోంబ్ లేకుంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  floor_shutter: {
    en: [
      "The formwork and props that hold the wet concrete for this floor's slab and beams.",
      'A weak prop or a gap and the slab sags, or the slurry leaks out of the joint.',
      'Done when it is tight, level, propped as drawn, and oiled.',
    ],
    te: [
      'ఈ ఫ్లోర్ స్లాబ్, బీమ్‌ల కోసం షట్టరింగ్, ప్రాప్‌లు పెట్టాలి — తడి కాంక్రీట్‌ను పట్టి ఉంచేవి ఇవే.',
      'ఒక ప్రాప్ బలహీనంగా ఉన్నా, ఒక చోట సందు ఉన్నా, స్లాబ్ కుంగుతుంది లేదా జాయింట్ నుంచి సిమెంట్ పాలు కారిపోతాయి.',
      'షట్టరింగ్ బిగుతుగా, లెవల్‌గా, డ్రాయింగ్ ప్రకారం ప్రాప్ చేసి, ఆయిల్ కొట్టాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  floor_rebar: {
    en: [
      "All the steel for this floor's beams and slab, tied in place.",
      'Wrong spacing, or no cover blocks, and the slab cracks — after everything is finished.',
      'Done when bar size and spacing match the drawing and cover blocks sit under the mesh.',
    ],
    te: [
      'ఈ ఫ్లోర్ బీమ్‌లు, స్లాబ్ కోసం స్టీల్ మొత్తం కట్టి, సరైన చోట పెట్టాలి.',
      'స్పేసింగ్ తప్పినా, కవర్ బ్లాక్‌లు పెట్టకపోయినా స్లాబ్ పగులుతుంది — అదీ అంతా అయిపోయాక.',
      'కడ్డీ సైజు, స్పేసింగ్ డ్రాయింగ్‌తో సరిపోయి, మెష్ కింద కవర్ బ్లాక్‌లు ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  floor_pour: {
    en: [
      'Pour the slab and the beams together, in one continuous go.',
      'Stop halfway and you get a cold joint — a weak line straight through the slab.',
      'Done when it is poured continuous, vibrated, and curing has started.',
    ],
    te: [
      'స్లాబ్, బీమ్‌లు రెండూ కలిపి ఒకేసారి, ఆగకుండా పోత పోయాలి.',
      'మధ్యలో ఆపేస్తే కోల్డ్ జాయింట్ వస్తుంది — స్లాబ్ మధ్యలో ఒక బలహీనమైన గీత అలాగే ఉండిపోతుంది.',
      'ఆగకుండా పోత పడి, వైబ్రేట్ చేసి, క్యూరింగ్ మొదలుపెట్టాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  shuttering_removal: {
    en: [
      'Take the props and formwork off — but only after the concrete has cured.',
      'Strip it early and the slab sags or cracks. That damage never heals.',
      'Done when the curing days are complete and the props come off with no sag.',
    ],
    te: [
      'ప్రాప్‌లు, షట్టరింగ్ తీసేయాలి — కానీ కాంక్రీట్ క్యూరింగ్ పూర్తిగా అయ్యాకే.',
      'ముందుగానే తీసేస్తే స్లాబ్ కుంగుతుంది లేదా పగులుతుంది. ఆ డ్యామేజ్ మళ్లీ సరి అవదు.',
      'క్యూరింగ్ రోజులు పూర్తయ్యి, ప్రాప్‌లు తీసినా స్లాబ్ కుంగకుండా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  blockwork: {
    en: [
      'Build the walls on this floor — the brick or block work.',
      'This is the gate. Nothing on this floor — wiring, plumbing, plaster — starts before the walls stand.',
      'Done when the walls are plumb, the joints are filled, and the openings are the drawing size.',
    ],
    te: [
      'ఈ ఫ్లోర్‌లో గోడలు కట్టాలి — ఇటుక లేదా బ్లాక్ వర్క్.',
      'ఇదే గేటు. గోడలు నిలబడకుండా ఈ ఫ్లోర్‌లో వైరింగ్ గానీ, ప్లంబింగ్ గానీ, ప్లాస్టరింగ్ గానీ ఏదీ మొదలవదు.',
      'గోడలు నిలువుగా ఉండి, జాయింట్లు నిండి, ఓపెనింగ్‌లు డ్రాయింగ్ సైజులో ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },

  // ── services ───────────────────────────────────────────────────────────────
  conduit: {
    en: [
      'Cut the electrical pipes into the walls, before plaster covers them.',
      'Miss a point now and the wall gets broken open again after plastering.',
      'Done when every point is chased in, the boxes are fixed, and the pipes are clear end to end.',
    ],
    te: [
      'ప్లాస్టరింగ్ కప్పేయకముందే గోడల్లో గాడులు కొట్టి కరెంట్ పైపులు వేయాలి.',
      'ఇప్పుడు ఒక్క పాయింట్ మిస్ అయినా, ప్లాస్టరింగ్ అయ్యాక ఆ గోడను మళ్లీ పగలగొట్టాల్సిందే.',
      'ప్రతి పాయింట్ గోడలో పడి, బాక్స్‌లు బిగించి, పైపుల్లో చివరి దాకా దారి క్లియర్‌గా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  in_wall_plumbing: {
    en: [
      'Cut the water lines into the walls and sleeve them, before plaster.',
      'A line missed here means breaking open a finished, tiled wall to reach it.',
      'Done when every line is in, sleeved, held firm — and ready for the pressure test.',
    ],
    te: [
      'ప్లాస్టరింగ్‌కు ముందే గోడల్లో నీటి లైన్లు వేసి, స్లీవ్ చేయాలి.',
      'ఇక్కడ ఒక లైన్ మిస్ అయితే, తర్వాత టైల్స్ వేసిన గోడను పగలగొట్టి మరీ దాన్ని అందుకోవాలి.',
      'ప్రతి లైన్ వేసి, స్లీవ్ చేసి, గట్టిగా బిగించి, ప్రెషర్ టెస్ట్‌కి సిద్ధంగా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  plumb_rough: {
    en: [
      "The drain and water lines that run in this unit's floor.",
      'Get the slope wrong and the water sits instead of draining. Permanently.',
      'Done when the lines are laid to the right fall and every joint is tight.',
    ],
    te: [
      'ఈ ఫ్లాట్ ఫ్లోర్‌లో వెళ్లే డ్రైనేజ్, నీటి లైన్లు వేయాలి.',
      'స్లోప్ తప్పితే నీళ్లు పోకుండా అక్కడే నిలబడతాయి — అది శాశ్వతంగా అలాగే ఉండిపోతుంది.',
      'లైన్లు సరైన స్లోప్‌తో పడి, ప్రతి జాయింట్ బిగుతుగా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  pressure_test: {
    en: [
      'Put the lines under pressure and watch them — before anything covers them.',
      'This is the last chance. Once plaster and tiles go on, a leak means breaking the wall.',
      'Done when the line holds pressure for the full time with no drop.',
    ],
    te: [
      'ఏదీ కప్పేయకముందే లైన్లకు ప్రెషర్ పెట్టి, కారుతున్నాయేమో చూడాలి.',
      'ఇదే చివరి అవకాశం. ప్లాస్టరింగ్, టైల్స్ పడ్డాక లీక్ వస్తే గోడ పగలగొట్టడం ఒక్కటే దారి.',
      'నిర్ణయించిన సమయం మొత్తం ప్రెషర్ తగ్గకుండా లైన్ నిలబడితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  riser: {
    en: [
      'The vertical water pipes going up the shaft — dropped and teed off at this floor.',
      "This floor's whole plumbing hangs off it. It has to be in before the floor's lines connect.",
      'Done when the riser is up through this floor, teed, valved and clamped.',
    ],
    te: [
      'షాఫ్ట్‌లో పైకి వెళ్లే నిలువు నీటి పైపులు — ఈ ఫ్లోర్ దగ్గర దించి, టీ ఇవ్వాలి.',
      'ఈ ఫ్లోర్ ప్లంబింగ్ మొత్తం దీని మీదే ఆధారపడి ఉంటుంది. ఫ్లోర్ లైన్లు కలపాలంటే ముందు ఇది పైకి రావాలి.',
      'రైజర్ ఈ ఫ్లోర్ దాటి పైకి వెళ్లి, టీ ఇచ్చి, వాల్వ్ పెట్టి, క్లాంప్ చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  wiring: {
    en: [
      'Pull the wires through the conduits already laid in the walls.',
      'If a conduit is blocked or crushed, the wire will not go through. That is a broken wall again.',
      'Done when every point is wired, pulled clean, and tested for continuity.',
    ],
    te: [
      'గోడల్లో ఇప్పటికే వేసిన కండ్యూట్ పైపుల్లోంచి వైర్లు లాగాలి.',
      'కండ్యూట్ ఎక్కడైనా మూసుకుపోయినా, నలిగిపోయినా వైరు లోపలికి వెళ్లదు. అంటే మళ్లీ గోడ పగలగొట్టడమే.',
      'ప్రతి పాయింట్‌కి వైరు వెళ్లి, శుభ్రంగా లాగి, కంటిన్యూటీ టెస్ట్ చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  switchboard: {
    en: [
      'Fix the switchboards and the DB, and land every circuit on it.',
      'The wrong circuit on the wrong breaker and the trip protects nothing.',
      'Done when every circuit is landed, labelled, and the earthing is connected.',
    ],
    te: [
      'స్విచ్ బోర్డులు, డీబీ బిగించి, ప్రతి సర్క్యూట్‌ను దానికి కలపాలి.',
      'తప్పు సర్క్యూట్‌ను తప్పు బ్రేకర్ మీద పెడితే, ట్రిప్ అయినా అది ఎవరినీ కాపాడదు.',
      'ప్రతి సర్క్యూట్ కలిపి, లేబుల్ రాసి, ఎర్తింగ్ కనెక్ట్ చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  door_frame: {
    en: [
      'Set the door frames into the wall openings.',
      'A frame out of plumb means the door never closes right, however good the shutter is.',
      'Done when the frame is plumb, square, and grouted solid into the reveal.',
    ],
    te: [
      'గోడ ఓపెనింగ్‌లలో డోర్ ఫ్రేమ్‌లు అమర్చాలి.',
      'ఫ్రేమ్ నిలువు తప్పితే, షట్టర్ ఎంత మంచిదైనా తలుపు సరిగ్గా మూసుకోదు.',
      'ఫ్రేమ్ నిలువుగా, చదరంగా ఉండి, రివీల్‌లో గట్టిగా గ్రౌట్ చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  window_frame: {
    en: [
      'Set the window frames into the openings.',
      'Not sealed, or not sloped outward, and the rain runs inside the wall instead of off it.',
      'Done when the frame is plumb, square, and sealed all the way round.',
    ],
    te: [
      'ఓపెనింగ్‌లలో కిటికీ ఫ్రేమ్‌లు అమర్చాలి.',
      'సీల్ చేయకపోయినా, బయటికి వాలు ఇవ్వకపోయినా, వాన నీరు గోడ మీద నుంచి జారిపోకుండా లోపలికే వస్తుంది.',
      'ఫ్రేమ్ నిలువుగా, చదరంగా ఉండి, చుట్టూ పూర్తిగా సీల్ చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  ceiling_frame: {
    en: [
      'The metal frame the false ceiling hangs from.',
      'Hang it loose, or at the wrong level, and the whole ceiling reads as a wave.',
      'Done when the grid is level, tight, and hung properly off the slab.',
    ],
    te: [
      'ఫాల్స్ సీలింగ్ వేలాడే మెటల్ ఫ్రేమ్ కట్టాలి.',
      'వదులుగా కట్టినా, లెవల్ తప్పినా, సీలింగ్ మొత్తం అలలు అలలుగా కనిపిస్తుంది.',
      'గ్రిడ్ లెవల్‌గా, బిగుతుగా ఉండి, స్లాబ్ నుంచి సరిగ్గా వేలాడితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  overhead_service: {
    en: [
      'All the pipes, ducts and cables that run above the false ceiling.',
      'Once the boards go up, anything you forgot is behind a sealed ceiling.',
      'Done when every service in the void is run, supported, and tested.',
    ],
    te: [
      'ఫాల్స్ సీలింగ్ పైన వెళ్లే పైపులు, డక్ట్‌లు, కేబుళ్లు అన్నీ వేయాలి.',
      'బోర్డులు పడ్డాక, మర్చిపోయిన ప్రతిదీ మూసేసిన సీలింగ్ వెనుకే ఉండిపోతుంది.',
      'వాయిడ్‌లో ఉన్న ప్రతి సర్వీసు వేసి, సపోర్ట్ ఇచ్చి, టెస్ట్ చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  void_wiring: {
    en: [
      'The wiring that runs in the ceiling void for the lights and fans.',
      'Same rule as the pipes — after the boards go up, you cannot reach it without cutting them.',
      'Done when every light and fan point is wired and tested.',
    ],
    te: [
      'లైట్లు, ఫ్యాన్ల కోసం సీలింగ్ వాయిడ్‌లో వెళ్లే వైరింగ్ చేయాలి.',
      'పైపులకు ఏ రూలో ఇక్కడా అదే — బోర్డులు పడ్డాక వాటిని కోయకుండా ఈ వైర్లను అందుకోలేం.',
      'ప్రతి లైట్, ఫ్యాన్ పాయింట్‌కి వైరు వేసి, టెస్ట్ చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },

  // ── finishes ───────────────────────────────────────────────────────────────
  plaster: {
    en: [
      'Plaster the walls. This is what buries the conduits and the pipes for good.',
      'Plaster over an untested line and you will be breaking this wall open later.',
      'Done when the surface is true, there are no hollow patches, and it has been cured.',
    ],
    te: [
      'గోడలకు ప్లాస్టరింగ్ చేయాలి. కండ్యూట్‌లు, పైపులు శాశ్వతంగా కప్పబడేది దీంతోనే.',
      'టెస్ట్ చేయని లైన్ మీద ప్లాస్టరింగ్ చేస్తే, తర్వాత ఆ గోడను పగలగొట్టక తప్పదు.',
      'సర్ఫేస్ సమంగా ఉండి, హాలో ప్యాచ్‌లు లేకుండా, క్యూరింగ్ అయ్యాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  putty: {
    en: [
      'The smoothing coat over the plaster, before paint.',
      'Paint over a rough or damp wall and it peels within a year.',
      'Done when the wall is smooth, sanded, and dry.',
    ],
    te: [
      'పెయింట్‌కు ముందు ప్లాస్టర్ మీద వేసే నునుపు కోటు ఇది.',
      'గరుకుగా ఉన్న గోడ మీద, తడి గోడ మీద పెయింట్ వేస్తే ఏడాది తిరక్కుండానే ఊడిపోతుంది.',
      'గోడ నున్నగా అయ్యి, శాండ్ చేసి, ఆరిపోయాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  waterproof: {
    en: [
      'The waterproof layer in the wet areas, before any screed or tile goes down.',
      'This is the one thing stopping the bathroom leaking into the flat below.',
      'Done when it is coated up the walls too, and the ponding test held.',
    ],
    te: [
      'స్క్రీడ్ గానీ టైల్స్ గానీ పడకముందే, వెట్ ఏరియాల్లో వాటర్‌ప్రూఫింగ్ లేయర్ వేయాలి.',
      'బాత్రూమ్ నీళ్లు కింది ఫ్లాట్‌లోకి కారకుండా ఆపేది ఇదొక్కటే.',
      'గోడల మీదికి కూడా కోటింగ్ ఎక్కి, పాండింగ్ టెస్ట్ నిలబడితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  screed: {
    en: [
      'The levelling layer on the floor, before the tiles.',
      'No fall to the drain and the water just stands there in the bathroom.',
      'Done when it is level — or falls to the drain where it should — and it is bonded.',
    ],
    te: [
      'టైల్స్‌కు ముందు ఫ్లోర్‌ను లెవల్ చేసే స్క్రీడ్ లేయర్ వేయాలి.',
      'డ్రెయిన్ వైపు వాలు లేకపోతే బాత్రూమ్‌లో నీళ్లు పోకుండా అక్కడే నిలబడతాయి.',
      'లెవల్‌గా ఉండి — లేదా డ్రెయిన్ వైపు సరైన వాలుతో ఉండి — కిందికి బాగా అతుక్కుంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  floor_tile: {
    en: [
      'Lay the floor tiles.',
      'A hollow tile sounds fine today and cracks in six months. Tap every one.',
      'Done when the joints line up, nothing sounds hollow, and the level holds across the room.',
    ],
    te: [
      'ఫ్లోర్ టైల్స్ వేయాలి.',
      'హాలో టైల్ ఇవాళ బాగానే ఉంటుంది, ఆరు నెలల్లో పగులుతుంది. అందుకే ప్రతి టైల్‌నీ తట్టి చూడాలి.',
      'జాయింట్లు లైన్‌లో ఉండి, ఎక్కడా హాలో శబ్దం రాకుండా, రూమ్ అంతా లెవల్ నిలిస్తే ఈ పని పూర్తయినట్టు.',
    ],
  },
  wall_tile: {
    en: [
      'The wall tiles and dado in the wet areas and the kitchen.',
      'Cut tiles at eye level, or joints that miss the floor joints, and it looks wrong forever.',
      'Done when the courses are level, the joints align, and nothing is hollow.',
    ],
    te: [
      'వెట్ ఏరియాలు, కిచెన్‌లో గోడ టైల్స్, డాడో వేయాలి.',
      'కంటి ఎత్తులో కట్ టైల్ వచ్చినా, గోడ జాయింట్లు ఫ్లోర్ జాయింట్లతో కలవకపోయినా, అది జీవితాంతం తప్పుగానే కనిపిస్తుంది.',
      'కోర్సులు లెవల్‌గా, జాయింట్లు కలిసి, ఎక్కడా హాలో లేకుంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ceiling_board: {
    en: [
      'Board up the false-ceiling frame.',
      'Once these go on, everything in the void is sealed away. Check it is all finished first.',
      'Done when the boards are flush, screwed off, and the joints are taped.',
    ],
    te: [
      'ఫాల్స్ సీలింగ్ ఫ్రేమ్‌కు బోర్డులు కొట్టాలి.',
      'ఇవి పడ్డాక వాయిడ్‌లో ఉన్నదంతా మూసుకుపోతుంది. అందుకే లోపల పని మొత్తం అయిందో లేదో ముందే చూసుకోవాలి.',
      'బోర్డులు సమంగా ఉండి, స్క్రూలు బిగించి, జాయింట్లకు టేప్ వేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  pop_finish: {
    en: [
      'The POP finish over the ceiling boards.',
      'Cracks at the board joints show up under the light. Do the taping properly or they will.',
      'Done when the surface is smooth, the joints do not show, and the edges are sharp.',
    ],
    te: [
      'సీలింగ్ బోర్డుల మీద పీవోపీ ఫినిష్ వేయాలి.',
      'బోర్డు జాయింట్ల దగ్గర వచ్చే పగుళ్లు లైట్ పడగానే కొట్టొచ్చినట్టు కనిపిస్తాయి. టేపింగ్ సరిగ్గా చేస్తేనే అవి రావు.',
      'సర్ఫేస్ నున్నగా ఉండి, జాయింట్లు కనిపించకుండా, అంచులు షార్ప్‌గా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  paint: {
    en: [
      'Paint the internal walls.',
      'Paint on a damp or dusty wall peels. The wall has to be dry and clean first.',
      'Done when the coats are even, there are no patches, and the cut-lines are clean.',
    ],
    te: [
      'లోపలి గోడలకు పెయింట్ వేయాలి.',
      'తడి గోడ మీద, దుమ్ము ఉన్న గోడ మీద పెయింట్ వేస్తే ఊడిపోతుంది. ముందు గోడ ఆరి, శుభ్రంగా ఉండాలి.',
      'కోట్‌లు సమంగా పడి, ప్యాచ్‌లు లేకుండా, కట్-లైన్లు శుభ్రంగా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  switchplate: {
    en: [
      'Fit the switch plates and sockets — the last electrical job in the flat.',
      'Do it before painting and they end up with paint on them. It is last for a reason.',
      'Done when every plate is flush, level, tight — and the point actually works.',
    ],
    te: [
      'స్విచ్ ప్లేట్లు, సాకెట్లు బిగించాలి — ఫ్లాట్‌లో చివరి కరెంట్ పని ఇదే.',
      'పెయింటింగ్‌కు ముందే బిగిస్తే వాటి మీద పెయింట్ పడుతుంది. అందుకే ఇది చివరన ఉంది.',
      'ప్రతి ప్లేట్ గోడతో సమంగా, లెవల్‌గా, బిగుతుగా ఉండి, పాయింట్ నిజంగా పని చేస్తే ఈ పని పూర్తయినట్టు.',
    ],
  },
  sanitary: {
    en: [
      'Fit the sanitaryware — closet, basin, taps, fittings.',
      "This is the first time the flat's plumbing runs for real. Anything wrong shows up now.",
      'Done when everything is fixed level, water runs, and no joint leaks.',
    ],
    te: [
      'శానిటరీ సామాను బిగించాలి — క్లోసెట్, బేసిన్, ట్యాప్‌లు, ఫిట్టింగులు.',
      'ఫ్లాట్ ప్లంబింగ్ నిజంగా పని చేసేది ఇప్పుడే. ఎక్కడ తప్పున్నా ఇప్పుడే బయటపడుతుంది.',
      'అన్నీ లెవల్‌గా బిగించి, నీళ్లు వచ్చి, ఏ జాయింట్ దగ్గరా లీక్ లేకుంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  door_shutter: {
    en: [
      'Hang the door shutters in their frames.',
      'Hung heavy, or with no clearance, and it drops or scrapes the new floor tile.',
      'Done when it swings free, latches cleanly, and the gaps are even all round.',
    ],
    te: [
      'ఫ్రేమ్‌లలో డోర్ షట్టర్లు వేలాడదీయాలి.',
      'బరువుగా వేలాడదీసినా, క్లియరెన్స్ ఇవ్వకపోయినా, తలుపు కిందికి జారి కొత్త ఫ్లోర్ టైల్‌ను గీరుతుంది.',
      'తలుపు తేలిగ్గా తిరిగి, సరిగ్గా లాక్ అయ్యి, చుట్టూ గ్యాప్‌లు సమంగా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  window_grill: {
    en: [
      'Fit the window grills.',
      'Fixed into the plaster instead of the structure, a grill comes away with one pull.',
      'Done when it is anchored into the structure, square, and coated.',
    ],
    te: [
      'కిటికీ గ్రిల్స్ బిగించాలి.',
      'స్ట్రక్చర్‌కు కాకుండా ప్లాస్టర్‌కు మాత్రమే బిగిస్తే, ఒక్క లాగుడుకే గ్రిల్ ఊడి వస్తుంది.',
      'గ్రిల్ స్ట్రక్చర్‌లోకి ఆంకర్ అయ్యి, చదరంగా ఉండి, కోటింగ్ వేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  fixture: {
    en: [
      'Fit the lights and the fans.',
      'A fan hook that is not in the slab will come down. Check what it is holding on to.',
      'Done when every fitting is fixed, level, and switches on.',
    ],
    te: [
      'లైట్లు, ఫ్యాన్లు బిగించాలి.',
      'ఫ్యాన్ హుక్ స్లాబ్‌లో లేకపోతే ఆ ఫ్యాన్ ఏదో ఒక రోజు కింద పడుతుంది. అది దేనికి వేలాడుతోందో చూసి బిగించాలి.',
      'ప్రతి ఫిట్టింగ్ గట్టిగా, లెవల్‌గా బిగించి, స్విచ్ వేస్తే పని చేస్తే ఈ పని పూర్తయినట్టు.',
    ],
  },
  decorative: {
    en: [
      'The decorative work — cladding, panelling, feature finishes.',
      'It goes on last, over finished surfaces. Damage anything now and it is a repaint.',
      'Done when it is fixed as drawn and nothing around it got damaged.',
    ],
    te: [
      'డెకరేటివ్ పని చేయాలి — క్లాడింగ్, ప్యానెలింగ్, ఫీచర్ ఫినిష్‌లు.',
      'ఇది అన్నిటికీ చివరన, ఫినిష్ అయిన సర్ఫేస్‌ల మీద పడుతుంది. ఇప్పుడు దేన్ని పాడు చేసినా మళ్లీ పెయింట్ వేయాల్సిందే.',
      'డ్రాయింగ్ ప్రకారం బిగించి, చుట్టుపక్కల ఏదీ పాడవకుండా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },

  // ── external & closing ─────────────────────────────────────────────────────
  external_structure: {
    en: [
      'The façade structure — balconies, parapets, external features.',
      'Anything up here that traps water will stain the face and leak into the wall.',
      'Done when it is cast as drawn and water runs off it, not into it.',
    ],
    te: [
      'ఫసాడ్ స్ట్రక్చర్ కట్టాలి — బాల్కనీలు, పారపెట్‌లు, బయటి ఫీచర్లు.',
      'పైన ఎక్కడైనా నీళ్లు నిలిస్తే, అది బిల్డింగ్ ముఖం మీద మరక వేసి, గోడ లోపలికి లీక్ అవుతుంది.',
      'డ్రాయింగ్ ప్రకారం కట్టి, నీళ్లు లోపలికి కాకుండా బయటికి జారిపోతే ఈ పని పూర్తయినట్టు.',
    ],
  },
  facade_plaster: {
    en: [
      'Plaster the outside face of the building.',
      "External plaster is the building's raincoat. A crack here is water inside the wall.",
      'Done when it is true, free of cracks, and cured properly.',
    ],
    te: [
      'బిల్డింగ్ బయటి ముఖానికి ప్లాస్టరింగ్ చేయాలి.',
      'బయటి ప్లాస్టరే బిల్డింగ్‌కు రెయిన్‌కోట్. ఇక్కడ ఒక పగులు అంటే గోడ లోపలికి నీళ్లు వెళ్లినట్టే.',
      'ప్లాస్టర్ సమంగా ఉండి, పగుళ్లు లేకుండా, క్యూరింగ్ సరిగ్గా చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  external_paint: {
    en: [
      'Paint the outside of the building.',
      'External paint on a damp or uncured wall blisters in the first monsoon.',
      'Done when the coats are even and the wall was dry before they went on.',
    ],
    te: [
      'బిల్డింగ్ బయట పెయింట్ వేయాలి.',
      'తడి గోడ మీద, క్యూరింగ్ కాని గోడ మీద బయటి పెయింట్ వేస్తే మొదటి వానకే బొబ్బలు వస్తాయి.',
      'కోట్‌లు సమంగా పడి, వేయకముందు గోడ బాగా ఆరి ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  terrace_waterproof: {
    en: [
      'Waterproof the terrace slab.',
      'Every top-floor leak starts here. Get it wrong and you will be chasing it for years.',
      'Done when it is coated, turned up at the parapet, and the ponding test held.',
    ],
    te: [
      'టెర్రస్ స్లాబ్‌కు వాటర్‌ప్రూఫింగ్ చేయాలి.',
      'టాప్ ఫ్లోర్‌లో వచ్చే ప్రతి లీకూ మొదలయ్యేది ఇక్కడే. ఇది తప్పితే ఏళ్ల తరబడి దాని వెంట పడాల్సిందే.',
      'కోటింగ్ వేసి, పారపెట్ మీదికి ఎక్కించి, పాండింగ్ టెస్ట్ నిలబడితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  terrace_finish: {
    en: [
      'The finish over the terrace waterproofing — tiles or screed.',
      'Punch a nail through the membrane while laying this and the waterproofing under it is dead.',
      'Done when it is laid to fall, the drains run clear, and the membrane was never touched.',
    ],
    te: [
      'టెర్రస్ వాటర్‌ప్రూఫింగ్ మీద ఫినిష్ వేయాలి — టైల్స్ లేదా స్క్రీడ్.',
      'ఇది వేసేటప్పుడు ఒక్క మేకు మెంబ్రేన్‌లోకి దిగినా, కింద ఉన్న వాటర్‌ప్రూఫింగ్ పనికిరాకుండా పోతుంది.',
      'వాలుతో పడి, డ్రెయిన్లు క్లియర్‌గా పోయి, మెంబ్రేన్‌కు ఎక్కడా దెబ్బ తగలకుంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  site_grade: {
    en: [
      'Level and shape the ground around the building.',
      'Slope it towards the building and the rain sits against the wall you just waterproofed.',
      'Done when the ground falls away from the building on every side.',
    ],
    te: [
      'బిల్డింగ్ చుట్టూ ఉన్న నేలను లెవల్ చేసి, సరైన వాలు ఇవ్వాలి.',
      'వాలు బిల్డింగ్ వైపు ఇస్తే, ఇప్పుడే వాటర్‌ప్రూఫ్ చేసిన గోడకే వాన నీరు ఆనుకుని నిలబడుతుంది.',
      'బిల్డింగ్ నుంచి నాలుగు వైపులా నేల కిందికి వాలి ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  site_development: {
    en: [
      'The finishing work outside — paths, drains, paving.',
      'This is what the owner sees first. Rough work here undoes a good building.',
      'Done when the paths are laid to fall, the drains run, and the site is clean.',
    ],
    te: [
      'బయట ఫినిషింగ్ పని చేయాలి — దారులు, డ్రెయిన్లు, పేవింగ్.',
      'ఓనర్ మొదట చూసేది ఇదే. ఇక్కడ పని ముతకగా ఉంటే, లోపల ఎంత మంచి బిల్డింగ్ కట్టినా అది కనిపించదు.',
      'దారులు వాలుతో పడి, డ్రెయిన్లు పోయి, సైట్ శుభ్రంగా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  snagging: {
    en: [
      'Walk the finished work, list what is wrong, and close every item on the list.',
      'A snag signed off without being re-checked is how a defect reaches the owner.',
      'Done when every snag is fixed AND re-inspected — not just ticked.',
    ],
    te: [
      'పూర్తయిన పని అంతా తిరిగి చూసి, తప్పులు లిస్ట్ రాసి, ఆ లిస్ట్‌లో ప్రతిదీ క్లోజ్ చేయాలి.',
      'మళ్లీ చెక్ చేయకుండా స్నాగ్ క్లోజ్ చేస్తే, ఆ లోపం నేరుగా ఓనర్ దాకా వెళ్తుంది.',
      'ప్రతి స్నాగ్ సరిచేసి, మళ్లీ చెక్ చేశాకే ఈ పని పూర్తయినట్టు — టిక్ పెడితే సరిపోదు.',
    ],
  },

  // ── amenity systems ────────────────────────────────────────────────────────
  ca_lift_shaft: {
    en: [
      "The lift shaft walls on this floor, and the opening for this floor's landing door.",
      'The shaft has to stay plumb the whole way up. Out here, and the car will not run.',
      'Done when this floor is plumb, the opening is the right size, and the lintel is in.',
    ],
    te: [
      'ఈ ఫ్లోర్‌లో లిఫ్ట్ షాఫ్ట్ గోడలు కట్టి, ల్యాండింగ్ డోర్ కోసం ఓపెనింగ్ వదలాలి.',
      'షాఫ్ట్ పైదాకా నిలువుగా ఉండాలి. ఇక్కడ తేడా వస్తే లిఫ్ట్ కారు పైకి కిందికి తిరగదు.',
      'ఈ ఫ్లోర్ నిలువుగా ఉండి, ఓపెనింగ్ సరైన సైజులో ఉండి, లింటెల్ పడితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_lift_mech: {
    en: [
      'The lift machine, the car and the guide rails.',
      'Order it early — it takes weeks to arrive, and it cannot go in until the shaft is finished.',
      'Done when the rails are plumb, the car runs free over the full travel, and the pit is dry.',
    ],
    te: [
      'లిఫ్ట్ మెషిన్, కారు, గైడ్ రైల్స్ బిగించాలి.',
      'ఇది ముందే ఆర్డర్ పెట్టాలి — రావడానికి వారాలు పడుతుంది, పైగా షాఫ్ట్ పూర్తయ్యేదాకా బిగించలేం.',
      'రైల్స్ నిలువుగా ఉండి, కారు పైనుంచి కిందిదాకా తేలిగ్గా తిరిగి, పిట్ పొడిగా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_lift_door: {
    en: [
      "The lift's landing door on this floor.",
      'The interlock is the safety: the car must not move while this door is open.',
      'Done when the door interlocks, the sill is level with the floor, and the frame is grouted in.',
    ],
    te: [
      'ఈ ఫ్లోర్‌లో లిఫ్ట్ ల్యాండింగ్ డోర్ బిగించాలి.',
      'ఇంటర్‌లాకే అసలు సేఫ్టీ — ఈ తలుపు తెరిచి ఉంటే లిఫ్ట్ కారు కదలకూడదు.',
      'తలుపు ఇంటర్‌లాక్ అయ్యి, గడప ఫ్లోర్‌తో సమంగా ఉండి, ఫ్రేమ్ గ్రౌట్ చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_lift: {
    en: [
      'Get the lift tested, certified and licensed.',
      'Nobody rides it until this is on paper. That is the law, not a formality.',
      'Done when it is load-tested, the licence is in hand, and the car levels right at every floor.',
    ],
    te: [
      'లిఫ్ట్‌ను టెస్ట్ చేయించి, సర్టిఫికెట్, లైసెన్స్ తీసుకోవాలి.',
      'ఇది కాగితం మీదికి వచ్చేదాకా ఎవరూ లిఫ్ట్ ఎక్కకూడదు. ఇది ఫార్మాలిటీ కాదు, చట్టం.',
      'లోడ్ టెస్ట్ అయ్యి, లైసెన్స్ చేతికొచ్చి, ప్రతి ఫ్లోర్‌లో కారు సరిగ్గా లెవల్ అయితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_stair: {
    en: [
      "The staircase flight for this floor.",
      'One step at a different height from the rest is what people trip on. Every riser must be equal.',
      'Done when every riser and tread in the flight is equal and the landing is at level.',
    ],
    te: [
      'ఈ ఫ్లోర్ మెట్ల ఫ్లైట్ కట్టాలి.',
      'ఒక్క మెట్టు ఎత్తు మిగతా వాటికంటే తేడాగా ఉంటే, జనం తడబడేది సరిగ్గా అక్కడే. ప్రతి రైజర్ ఒకేలా ఉండాలి.',
      'ఫ్లైట్‌లో ప్రతి రైజర్, ట్రెడ్ ఒకేలా ఉండి, ల్యాండింగ్ లెవల్‌గా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  stair_finish: {
    en: [
      "Finish this floor's staircase — treads, nosing, handrail.",
      'The finish itself can make one step a different height. Measure again after tiling.',
      'Done when the steps are still equal after finishing and the handrail is solid.',
    ],
    te: [
      'ఈ ఫ్లోర్ మెట్లకు ఫినిషింగ్ చేయాలి — ట్రెడ్, నోసింగ్, హ్యాండ్‌రైల్.',
      'ఫినిషింగ్ వల్లే ఒక మెట్టు ఎత్తు మారిపోవచ్చు. అందుకే టైల్స్ వేశాక మళ్లీ కొలిచి చూడాలి.',
      'ఫినిషింగ్ అయ్యాక కూడా మెట్లు ఒకేలా ఉండి, హ్యాండ్‌రైల్ గట్టిగా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_corridor: {
    en: [
      'Finish the corridor and lobby on this floor.',
      'Every trade walks through here last — so it gets damaged last, and finished twice.',
      'Done when the finishes run level and clean, and the lighting works.',
    ],
    te: [
      'ఈ ఫ్లోర్ కారిడార్, లాబీ ఫినిషింగ్ చేయాలి.',
      'ప్రతి పనివాడూ చివరిదాకా ఇక్కడి నుంచే నడుస్తాడు — అందుకే ఇది చివరిదాకా పాడవుతూనే ఉంటుంది, రెండుసార్లు ఫినిష్ చేయాల్సి వస్తుంది.',
      'ఫినిష్‌లు లెవల్‌గా, శుభ్రంగా ఉండి, లైటింగ్ పని చేస్తే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_oht: {
    en: [
      'The overhead tank on the roof.',
      'A tank that leaks soaks the terrace slab from above — and you find out when it is full.',
      'Done when it is leak-tested, on a proper support, with the overflow and vent in place.',
    ],
    te: [
      'టెర్రస్ మీద ఓవర్‌హెడ్ ట్యాంక్ కట్టి, దాని సపోర్ట్, పైపు కనెక్షన్లు అమర్చాలి.',
      'ట్యాంక్ లీక్ అయితే టెర్రస్ స్లాబ్ పైనుంచే తడుస్తుంది — అది తెలిసేసరికి ట్యాంక్ నీళ్లతో నిండి ఉంటుంది.',
      'లీక్ టెస్ట్ అయ్యి, సరైన సపోర్ట్ మీద నిలబడి, ఓవర్‌ఫ్లో, వెంట్ పెట్టాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_oht_pump: {
    en: [
      'The pump set and the plumbing room that feed the risers.',
      'If the pump cannot reach the top floor at pressure, the whole water system is useless.',
      'Done when it delivers to the topmost floor, the auto cut-off works, and the standby changes over.',
    ],
    te: [
      'రైజర్లకు నీళ్లు పంపే పంప్ సెట్, ప్లంబింగ్ రూమ్ ఏర్పాటు చేయాలి.',
      'పంప్ టాప్ ఫ్లోర్ దాకా ప్రెషర్‌తో నీళ్లు పంపలేకపోతే, నీటి సిస్టమ్ మొత్తం వృథా.',
      'టాప్ ఫ్లోర్ దాకా నీళ్లు వెళ్లి, ఆటో కట్-ఆఫ్ పని చేసి, స్టాండ్‌బై పంప్ దానంతట అది మారితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_ugt: {
    en: [
      'The underground sump.',
      'Backfill around it before it is leak-tested and you will never find the leak.',
      'Done when it holds water with no seepage, and the cover and vent are sealed.',
    ],
    te: [
      'భూమి కింద సంప్ ట్యాంక్ కట్టాలి.',
      'లీక్ టెస్ట్ చేయకముందే చుట్టూ మట్టి నింపేస్తే, ఆ లీక్ ఎక్కడుందో జీవితాంతం తెలియదు.',
      'ట్యాంక్ నీళ్లు పట్టి ఉంచి, ఎక్కడా ఊరకుండా ఉండి, మూత, వెంట్ సీల్ చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_borewell: {
    en: [
      'The borewell and its pump.',
      'Water that is never tested can be unfit to drink — and nobody goes back and checks later.',
      'Done when the yield is recorded, the water is tested, and the casing is sealed at the top.',
    ],
    te: [
      'బోర్‌వెల్ వేసి, దానికి పంప్ బిగించాలి.',
      'టెస్ట్ చేయని నీళ్లు తాగడానికి పనికిరాకపోవచ్చు — తర్వాత ఎవరూ వెనక్కి వెళ్లి చెక్ చేయరు.',
      'నీటి దిగుబడి రాసుకుని, నీళ్లు టెస్ట్ చేయించి, పైన కేసింగ్ సీల్ చేశాక ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_stp: {
    en: [
      'The sewage treatment plant.',
      'Backfill before the tanks are leak-tested and sewage seeps into the ground under the building.',
      'Done when the tanks hold, the plant is commissioned to its design flow, and the certificate is on record.',
    ],
    te: [
      'మురుగు నీటి శుద్ధి ప్లాంట్ (ఎస్టీపీ) కట్టాలి.',
      'ట్యాంకులు లీక్ టెస్ట్ చేయకముందే మట్టి నింపేస్తే, మురుగు నీరు బిల్డింగ్ కింద భూమిలోకి ఇంకిపోతుంది.',
      'ట్యాంకులు నీళ్లు పట్టి ఉంచి, ప్లాంట్ డిజైన్ ఫ్లో ప్రకారం పని చేసి, సర్టిఫికెట్ రికార్డ్‌లో ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_transformer: {
    en: [
      'The transformer / substation.',
      'Long-lead, and it needs statutory approval. Start it early or it holds up the handover.',
      'Done when the licensed agency has commissioned it, the earthing is tested, and approvals are on record.',
    ],
    te: [
      'ట్రాన్స్‌ఫార్మర్ / సబ్‌స్టేషన్ ఏర్పాటు చేయాలి.',
      'ఇది రావడానికి చాలా సమయం పడుతుంది, పైగా ప్రభుత్వ అనుమతి కావాలి. ముందే మొదలుపెట్టకపోతే హ్యాండోవర్ ఆగిపోతుంది.',
      'లైసెన్స్ ఉన్న ఏజెన్సీ కమిషన్ చేసి, ఎర్తింగ్ టెస్ట్ అయ్యి, అనుమతులు రికార్డ్‌లో ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_generator: {
    en: [
      'The DG set — the backup power.',
      'If the changeover does not work on its own, the backup is useless in a real power cut.',
      'Done when it is load-tested and the changeover to mains happens automatically.',
    ],
    te: [
      'డీజీ సెట్ — కరెంట్ పోయినప్పుడు బ్యాకప్ ఇచ్చేది — బిగించాలి.',
      'ఛేంజ్‌ఓవర్ దానంతట అది జరగకపోతే, నిజంగా కరెంట్ పోయిన రోజు ఆ బ్యాకప్ ఎందుకూ పనికిరాదు.',
      'లోడ్ టెస్ట్ అయ్యి, మెయిన్స్ నుంచి ఛేంజ్‌ఓవర్ ఆటోమేటిక్‌గా జరిగితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_solar: {
    en: [
      'The rooftop solar array.',
      'Bolt the frame through the terrace waterproofing and you have just built a leak.',
      'Done when it is generating, and the mounting did not puncture the waterproofing.',
    ],
    te: [
      'టెర్రస్ మీద సోలార్ ప్యానెల్స్ అమర్చాలి.',
      'టెర్రస్ వాటర్‌ప్రూఫింగ్‌లోంచి బోల్ట్ దించి ఫ్రేమ్ బిగిస్తే, అక్కడితో ఒక లీక్ మీరే కట్టినట్టు.',
      'కరెంట్ ఉత్పత్తి మొదలై, మౌంటింగ్ వల్ల వాటర్‌ప్రూఫింగ్‌కు ఎక్కడా చిల్లు పడకుంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_fire_floor: {
    en: [
      'The fire standpipe and hydrant on this floor.',
      'A hydrant that leaks at the landing valve has no pressure on the day it is needed.',
      "Done when this floor's hydrant is pressure-tested and the hose cabinet is stocked and clear.",
    ],
    te: [
      'ఈ ఫ్లోర్‌లో ఫైర్ స్టాండ్‌పైప్, హైడ్రంట్ బిగించాలి.',
      'ల్యాండింగ్ వాల్వ్ దగ్గర లీక్ ఉన్న హైడ్రంట్‌కు, నిజంగా అవసరమైన రోజు ప్రెషర్ ఉండదు.',
      'ఈ ఫ్లోర్ హైడ్రంట్ ప్రెషర్ టెస్ట్ అయ్యి, హోస్ క్యాబినెట్ నిండా సామాను ఉండి, దారి ఖాళీగా ఉంటే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_fire: {
    en: [
      "The fire pumps, the alarm, and the fire department's approval.",
      'No NOC, no occupancy. This one can hold up the entire handover on its own.',
      'Done when the system is commissioned, the pumps auto-start, and the NOC is in hand.',
    ],
    te: [
      'ఫైర్ పంపులు, అలారం అమర్చి, ఫైర్ డిపార్ట్‌మెంట్ అనుమతి తీసుకోవాలి.',
      'ఎన్‌ఓసీ లేకపోతే ఆక్యుపెన్సీ లేదు. ఇది ఒక్కటే హ్యాండోవర్ మొత్తాన్ని ఆపేయగలదు.',
      'సిస్టమ్ కమిషన్ అయ్యి, పంపులు వాటంతట అవి స్టార్ట్ అయ్యి, ఎన్‌ఓసీ చేతికొస్తే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_parking: {
    en: [
      'The parking deck and its markings.',
      'No fall to the drain and the deck ponds. Wrong bay size and the cars do not fit.',
      'Done when the deck drains, the bays match the layout, and the headroom is clear.',
    ],
    te: [
      'పార్కింగ్ డెక్ వేసి, దాని మీద మార్కింగ్‌లు గీయాలి.',
      'డ్రెయిన్ వైపు వాలు లేకపోతే డెక్ మీద నీళ్లు నిలుస్తాయి. బే సైజు తప్పితే కార్లు సరిపోవు.',
      'డెక్ మీద నీళ్లు పోయి, బేలు లేఅవుట్ ప్రకారం ఉండి, పైన హెడ్‌రూమ్ సరిపోతే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_compound: {
    en: [
      'The compound wall and the gate.',
      'A long wall with no movement joints cracks. It always does.',
      'Done when the wall is plumb on a proper foundation and the gate swings free.',
    ],
    te: [
      'కాంపౌండ్ గోడ కట్టి, గేటు బిగించాలి.',
      'పొడవాటి గోడకు మూవ్‌మెంట్ జాయింట్లు పెట్టకపోతే అది పగులుతుంది. ప్రతిసారీ అదే జరుగుతుంది.',
      'గోడ సరైన ఫౌండేషన్ మీద నిలువుగా నిలబడి, గేటు తేలిగ్గా తిరిగితే ఈ పని పూర్తయినట్టు.',
    ],
  },
  ca_landscaping: {
    en: [
      'Landscaping and hardscape — planting, paving, the finish outside.',
      'Levels that drain towards the building put water against the wall you just waterproofed.',
      'Done when the levels drain away, the paving does not rock underfoot, and the planting is in.',
    ],
    te: [
      'ల్యాండ్‌స్కేపింగ్, హార్డ్‌స్కేప్ పని చేయాలి — మొక్కలు, పేవింగ్, బయటి ఫినిషింగ్.',
      'లెవల్స్ బిల్డింగ్ వైపు వాలి ఉంటే, ఇప్పుడే వాటర్‌ప్రూఫ్ చేసిన గోడకే నీళ్లు ఆనుకుంటాయి.',
      'లెవల్స్ బిల్డింగ్ నుంచి బయటికి వాలి, పేవింగ్ కదలకుండా ఉండి, మొక్కలు నాటాక ఈ పని పూర్తయినట్టు.',
    ],
  },
}
