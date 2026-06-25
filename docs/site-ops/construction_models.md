# Construction Sequence Models — The Core

This file is the **single source of truth** for how the site-ops task generator
builds a project's task skeleton. Each model below is a *sequence document*: a
structured description of how a building type is constructed. The expander reads
the active version of a model + a project's seed answers and emits `site_tasks`.

**Change the core here → everything the generator produces changes.** That is
the whole point. The generator holds no construction knowledge of its own; all of
it lives in these documents.

---

## How the expander reads a model (the contract)

A model is an ordered list of **buckets**. Each bucket:

| field | meaning |
|---|---|
| `key` | machine id of the bucket |
| `label` | human name |
| `cardinality` | `once` (emit 1×), `per_floor` (×floors), `per_floor_unit` (×floors×units) |
| `walk` | `floor_major` (finish a floor before next) or `trade_major` (sweep one trade up all floors) — only matters for per_floor / per_floor_unit |
| `include_when.scope` | which scope values include this bucket (omit = all scopes) |
| `requires` | seed boolean flags that must ALL be true to emit (e.g. `has_basement`) |
| `trades` | ordered trade list — one `site_task` per trade |
| `reference_notes` | per-trade grounding text the Pass-2 LLM reads to write descriptions |
| `branch` | optional; a seed field selects a variant that OVERRIDES trades + notes |

**Expander logic:** walk buckets in order → gate by `include_when.scope` + `requires`
→ resolve trades (branch variant via seed field, else top-level `trades`) → emit
per `cardinality`, stamping a monotonic `seq_no` and the `model_key` + `model_version`
onto each task.

**Walk order is per-bucket, not global.** The frame sweeps *up* the building
(`trade_major` — all slabs cast as floors rise; you don't finish floor 1 before
starting floor 2's columns). Build-out and finishes go *floor at a time*
(`floor_major` — a plastering crew finishes a floor before moving up).

---

## Verification legend

| status | meaning |
|---|---|
| ✅ **field-corrected** | sequence reviewed against real site practice |
| 🟡 **v1 draft** | research-grounded, structurally sound, NOT yet corrected against a real project — correct from your first real job of this type before trusting |

---

## Cross-cutting notes

**Apartment = `rcc_residential`.** An apartment is not a separate model. It is the
residential model run with `units_per_floor > 1` and more `floors_above`. The
sequence is identical; only the seed differs. Apartment-specific *additions* (lift
core, common-area finishes, multiple staircases) are candidate buckets to fold in
when you build a real apartment — listed at the end of the residential model, not
active yet.

**Commercial borrows residential short-term, but has its own model below** because
its real sequence diverges enough (open floor plates, shell-and-core handover,
heavy MEP, glazed envelope) that residential would generate wrong tasks for a real
commercial job.

**Scope vocabulary differs by building type.** Residential uses
`structure_only | structure_finishing | full`. Commercial needs
`structure_only | shell_and_core | full_fitout`. Industrial needs
`structure_only | structure_envelope | full`. The seed's `scope` field should
accept the vocabulary the selected model defines, OR you keep one universal triple
and map it per model. **Open decision — flagged at the end.**

**`requires` is boolean-flag only for now** (`has_basement`, `has_stilt`,
`has_false_ceiling`). The `">= N floors"` style numeric gate is a later extension,
not needed by any model below.

---

# Model 1 — `rcc_residential` ✅ field-corrected (v1)

**Covers:** RCC framed villas and apartments. Villa = `units_per_floor: 1`.
Apartment = `units_per_floor: N`. Multi-floor handled by `floors_above`.

**Two assumptions still flagged for your confirmation (correct before freezing):**
1. Wet-area waterproofing is a **separate finishes task before tiling** (not folded
   into floor preparation).
2. Plumbing **services sit in `structure_finishing` scope**, not `structure_only`.

```jsonc
{
  "model_key": "rcc_residential",
  "version": 1,
  "scopes": ["structure_only", "structure_finishing", "full"],
  "buckets": [
    {
      "key": "site_foundation",
      "label": "Site & Foundation",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_only","structure_finishing","full"] },
      "branch": {
        "on": "footing_type",
        "default": "isolated",
        "variants": {
          "isolated": {
            "trades": ["ground_leveling","site_marking","excavation","pcc","isolated_footings","plinth_beam","backfill","plinth_slab"],
            "reference_notes": {
              "excavation": "Dig to founding depth per soil; keep sides safe, dewater if water table high (coastal AP — common).",
              "isolated_footings": "Individual pad footing under each column. PCC bed, reinforcement cage, shutter, pour, cure before plinth beam.",
              "plinth_beam": "Ties columns at plinth, carries blockwork above. Level is critical — every floor stacks true off this.",
              "plinth_slab": "Ground-floor base after backfill compaction; sets finished ground level."
            }
          },
          "combined": {
            "trades": ["ground_leveling","site_marking","excavation","pcc","combined_footings","plinth_beam","backfill","plinth_slab"],
            "reference_notes": {
              "combined_footings": "Shared footing under two or more close columns where pads would overlap. PCC, reinforcement, pour, cure."
            }
          },
          "raft": {
            "trades": ["ground_leveling","site_marking","excavation","pcc","raft_mat","plinth_beam","backfill","plinth_slab"],
            "reference_notes": {
              "raft_mat": "Single continuous mat slab under whole footprint — weak/soft soil or heavy load. Reinforcement mat, pour in planned bays, cure."
            }
          },
          "pile": {
            "trades": ["ground_leveling","site_marking","piling","pile_cap","pcc","plinth_beam","backfill","plinth_slab"],
            "reference_notes": {
              "piling": "Bored/driven piles to deep strata — poor soil, high water table. Integrity test before capping.",
              "pile_cap": "RCC cap tying pile group, transfers column load to piles."
            }
          }
        }
      },
      "reference_notes": {
        "ground_leveling": "Clear and level the plot to working datum.",
        "site_marking": "Set out the building grid from drawings — column centres, axes. Errors here cascade everywhere.",
        "pcc": "Plain cement concrete blinding layer below footings — clean, level base for reinforcement.",
        "backfill": "Fill and compact around foundation in layers before plinth slab."
      }
    },
    {
      "key": "frame",
      "label": "Structural Frame",
      "cardinality": "per_floor",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_only","structure_finishing","full"] },
      "trades": ["columns","beams_shuttering","slab_reinforcement","slab_pour"],
      "reference_notes": {
        "columns": "This floor's vertical members. Reinforcement, shutter, plumb-check, pour. Plumb is non-negotiable — out-of-plumb compounds upward.",
        "beams_shuttering": "Beam formwork and props for this floor's slab level, set to line and level.",
        "slab_reinforcement": "Deck this floor's slab. Reinforcement laid; conduits for the floor ABOVE are cast in now, before pour.",
        "slab_pour": "THE stage-gate event. Shuttering + reinforcement + cast-in conduits checked before concrete. Cure 7–14 days before loading."
      }
    },
    {
      "key": "build_out",
      "label": "Floor Build-out",
      "cardinality": "per_floor_unit",
      "walk": "floor_major",
      "include_when": { "scope": ["structure_finishing","full"] },
      "trades": ["blockwork","door_frames","window_frames","electrical_conduit","plumbing_conduit","plastering","false_ceiling","wiring","putty","floor_preparation"],
      "reference_notes": {
        "blockwork": "Partition + external walls for this unit. Line, level, plumb. Lintels over openings.",
        "door_frames": "Frames set during/before plaster — NOT shutters (those hang late in finishes). Don't call a door 'done' here.",
        "window_frames": "Window frames/sub-frames fixed before plaster so plaster closes neatly to them.",
        "electrical_conduit": "Wall + ceiling conduiting and back-boxes before plaster, positioned per electrical layout.",
        "plumbing_conduit": "In-wall water/drainage chases and sleeves for this unit before plaster.",
        "plastering": "Internal cement plaster AFTER conduiting + frames, BEFORE putty. Two-coat, cured.",
        "false_ceiling": "Gypsum/POP grid where specified. Gate behind has_false_ceiling if many jobs skip it.",
        "wiring": "Pull wires through conduit after plaster; not yet fixtures.",
        "putty": "Wall finishing over plaster before paint. Only where a painted finish is in scope.",
        "floor_preparation": "Level/screed the base for tiling. NOTE: wet-area waterproofing is a SEPARATE finishes task, not here."
      }
    },
    {
      "key": "services",
      "label": "Building Services",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_finishing","full"] },
      "trades": ["vertical_plumbing_risers","floor_plumbing_rough_ins"],
      "reference_notes": {
        "vertical_plumbing_risers": "Main vertical stacks run ONCE all frames are up — they pass through every floor, so gated on frame complete.",
        "floor_plumbing_rough_ins": "In-floor lines per wet area. Positions can shift — confirm against fixture layout before tiling seals them in."
      }
    },
    {
      "key": "finishes",
      "label": "Finishes",
      "cardinality": "per_floor_unit",
      "walk": "floor_major",
      "include_when": { "scope": ["full"] },
      "trades": ["wet_area_waterproofing","tiling","door_installation","window_grills","painting"],
      "reference_notes": {
        "wet_area_waterproofing": "Bathrooms/balconies before tiling. Ponding test BEFORE covering — leaks found later mean breaking tile.",
        "tiling": "Floor + wall tiling after plumbing rough-ins and waterproofing. Once tiled, in-floor lines are sealed.",
        "door_installation": "Hang shutters now (frames went in at build-out). After painting prep to avoid damage.",
        "window_grills": "Protection/safety grills fixed to window openings.",
        "painting": "Final interior coats after putty. Façade painting is the separate envelope track."
      }
    },
    {
      "key": "envelope",
      "label": "Envelope & Terrace",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_finishing","full"] },
      "trades": ["facade_treatment","terrace_waterproofing","terrace_finishing","external_painting"],
      "reference_notes": {
        "facade_treatment": "Runs PARALLEL to interior finishes (separate crew/track), not blocking them.",
        "terrace_waterproofing": "After roof slab cured. Ponding test. Critical — a terrace leak ruins everything below it.",
        "terrace_finishing": "Protective screed / tiles / china-mosaic over terrace waterproofing.",
        "external_painting": "Exterior coats — weather-dependent, sequence around monsoon (coastal AP)."
      }
    },
    {
      "key": "final",
      "label": "Final & Handover",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["full"] },
      "trades": ["cellar_parking_flooring","fixtures","decorative_installations","snagging_handover"],
      "reference_notes": {
        "cellar_parking_flooring": "Stilt/parking/cellar floor — often last to avoid construction-traffic damage.",
        "fixtures": "CP fittings, sanitaryware, electrical fixtures/switches, fans. Near the very end to avoid damage/theft.",
        "decorative_installations": "Final decorative elements, cladding features, landscaping touches.",
        "snagging_handover": "Defect walk, touch-ups, deep clean, handover. The done-of-done."
      }
    }
  ]
}
```

**Apartment-specific candidate additions (NOT active — fold in from a real apartment job):**
- `lift_core` — lift shaft + machine room as part of frame/services; lift installation as a `once` task in services.
- `common_areas` — lobby, corridors, common staircase finishes as a `once` finishes bucket (corridors are per-floor but shared, not per-unit).
- `external_development` — compound wall, gate, driveway, STP/sump as a `once` final bucket.

---

# Model 2 — `rcc_commercial` 🟡 v1 draft

**Covers:** RCC framed commercial — shops, showrooms, offices, small malls (defer
large malls). Diverges from residential: open floor plates (far less blockwork),
service cores, heavy MEP, glazed/clad envelope, and a **shell-and-core vs full-fitout
scope split** (developer hands over a shell; tenant fits out).

**Scope vocab:** `structure_only` · `shell_and_core` · `full_fitout`.

```jsonc
{
  "model_key": "rcc_commercial",
  "version": 1,
  "buckets": [
    {
      "key": "site_foundation",
      "label": "Site & Foundation",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_only","shell_and_core","full_fitout"] },
      "branch": {
        "on": "footing_type",
        "default": "raft",
        "variants": {
          "isolated": { "trades": ["ground_leveling","site_marking","excavation","pcc","isolated_footings","plinth_beam","backfill"] },
          "raft":     { "trades": ["ground_leveling","site_marking","excavation","pcc","raft_mat","plinth_beam","backfill"], "reference_notes": { "raft_mat": "Common default for commercial — heavier, more uniform loads." } },
          "pile":     { "trades": ["ground_leveling","site_marking","piling","pile_cap","pcc","plinth_beam","backfill"] }
        }
      },
      "reference_notes": {
        "site_marking": "Larger grid, wider spans. Setting-out tolerance tighter for column-free retail/office plates."
      }
    },
    {
      "key": "frame",
      "label": "Structural Frame",
      "cardinality": "per_floor",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_only","shell_and_core","full_fitout"] },
      "trades": ["columns","beams_shuttering","slab_reinforcement","slab_pour"],
      "reference_notes": {
        "columns": "Larger sections, wider spacing for clear retail/office spans.",
        "slab_pour": "Larger pours — often planned in bays/pours per floor. Stage-gate per pour."
      }
    },
    {
      "key": "cores",
      "label": "Service & Circulation Cores",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["shell_and_core","full_fitout"] },
      "trades": ["staircase_cores","lift_cores","service_shafts","toilet_cores"],
      "reference_notes": {
        "staircase_cores": "RCC stair cores rise with the frame; fire-escape stairs.",
        "lift_cores": "Lift shaft walls + machine room/pit. Built with frame, fitted out in services.",
        "service_shafts": "Vertical shafts for MEP risers — electrical, plumbing, HVAC, fire.",
        "toilet_cores": "Commercial toilets clustered in cores (not distributed like residential)."
      }
    },
    {
      "key": "build_out",
      "label": "Floor Build-out",
      "cardinality": "per_floor",
      "walk": "floor_major",
      "include_when": { "scope": ["shell_and_core","full_fitout"] },
      "trades": ["external_blockwork","core_blockwork","electrical_conduit","plastering"],
      "reference_notes": {
        "external_blockwork": "Perimeter infill walls where not glazed. Internal partitions are usually TENANT scope, so minimal here.",
        "core_blockwork": "Walls around cores/toilets/shafts only — open plate left open for tenant fit-out.",
        "plastering": "Plaster to built walls + core/soffit where specified. Open plate may stay fair-faced."
      }
    },
    {
      "key": "mep_services",
      "label": "MEP & Services",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["shell_and_core","full_fitout"] },
      "trades": ["plumbing_risers","electrical_main","hvac_provision","fire_fighting","lift_installation"],
      "reference_notes": {
        "plumbing_risers": "Vertical stacks + core toilet rough-ins.",
        "electrical_main": "Main panels, risers, busbar to each floor. Tenant does final distribution.",
        "hvac_provision": "Shaft/duct provisioning and main plant; full HVAC often tenant scope.",
        "fire_fighting": "Sprinkler mains, hydrants, pump room, fire stairs pressurisation — statutory, gating occupancy.",
        "lift_installation": "Install + commission lifts in the lift cores."
      }
    },
    {
      "key": "envelope",
      "label": "Envelope / Façade",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["shell_and_core","full_fitout"] },
      "trades": ["facade_glazing","acp_cladding","terrace_waterproofing","external_finishing"],
      "reference_notes": {
        "facade_glazing": "Structural/curtain glazing or window systems. Major commercial trade, parallel to interior.",
        "acp_cladding": "ACP/stone/composite cladding to façade.",
        "terrace_waterproofing": "Roof waterproofing + ponding test; houses plant/services on terrace.",
        "external_finishing": "External paint/finish to non-clad surfaces."
      }
    },
    {
      "key": "fitout_finishes",
      "label": "Fit-out & Finishes",
      "cardinality": "per_floor",
      "walk": "floor_major",
      "include_when": { "scope": ["full_fitout"] },
      "trades": ["partitions","flooring","false_ceiling","painting","toilet_finishes"],
      "reference_notes": {
        "partitions": "Internal partition layout per fit-out (gypsum/glass/block).",
        "flooring": "Vitrified/granite/carpet/raised-access per use.",
        "false_ceiling": "Grid ceiling with integrated lighting/HVAC diffusers/sprinklers.",
        "toilet_finishes": "Core toilet tiling, waterproofing, fixtures."
      }
    },
    {
      "key": "final",
      "label": "Final & Handover",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["full_fitout"] },
      "trades": ["fixtures","fire_commissioning","external_development","snagging_handover"],
      "reference_notes": {
        "fire_commissioning": "Fire systems test + statutory NOC — gates occupancy certificate.",
        "external_development": "Parking, driveway, compound, signage, landscaping.",
        "snagging_handover": "Defect walk, clean, handover / OC."
      }
    }
  ]
}
```

---

# Model 3 — `peb_industrial` 🟡 v1 draft

**Covers:** Pre-engineered steel buildings — warehouses, factory sheds, industrial
units. Fundamentally different from RCC: structure is **fabricated off-site in a
factory while civil foundation runs in parallel**, then **erected** by crane. Almost
entirely `once` buckets (single-storey clear-span; mezzanine is the only repeat and
is optional). The make-or-break risk is the **civil-to-steel interface** —
anchor-bolt placement and base levels — flagged heavily in the notes.

**Scope vocab:** `structure_only` · `structure_envelope` · `full`.

```jsonc
{
  "model_key": "peb_industrial",
  "version": 1,
  "buckets": [
    {
      "key": "site_prep",
      "label": "Site Preparation",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_only","structure_envelope","full"] },
      "trades": ["site_clearing","ground_leveling","soil_compaction","site_marking"],
      "reference_notes": {
        "soil_compaction": "Compaction + sub-grade prep — heavy floor loads demand a sound base.",
        "site_marking": "Set out grid + anchor-bolt positions to tight tolerance. THE reference for everything that follows."
      }
    },
    {
      "key": "foundation",
      "label": "Foundation & Anchor Bolts",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_only","structure_envelope","full"] },
      "trades": ["excavation","pcc","column_pedestals","anchor_bolt_setting","plinth_beam","plinth_protection","backfill"],
      "reference_notes": {
        "excavation": "Pit excavation for isolated pedestals/footings under each PEB column.",
        "column_pedestals": "RCC pedestals/footings carrying steel column base plates.",
        "anchor_bolt_setting": "THE critical interface. Anchor-bolt template position, level, projection must match shop drawings exactly. Most PEB delays start here — wrong bolts = re-drill or recast.",
        "plinth_beam": "Tie beam at plinth between pedestals.",
        "plinth_protection": "Apron/protection around plinth.",
        "backfill": "Compacted fill to floor sub-grade level. Runs in PARALLEL with off-site steel fabrication."
      }
    },
    {
      "key": "fabrication_delivery",
      "label": "Fabrication & Delivery (off-site milestone)",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_only","structure_envelope","full"] },
      "trades": ["shop_fabrication","material_delivery"],
      "reference_notes": {
        "shop_fabrication": "Primary frames + secondary members fabricated in factory — runs PARALLEL to foundation. Track as a milestone, not site labour. Mill test certs + QA on receipt.",
        "material_delivery": "Components dispatched per erection sequence. Check member list/marks + transport damage before erection."
      }
    },
    {
      "key": "erection",
      "label": "Steel Erection",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_only","structure_envelope","full"] },
      "trades": ["column_erection","rafter_assembly","purlin_girt_fixing","bracing","bolt_tightening_alignment"],
      "reference_notes": {
        "column_erection": "Crane-set columns onto anchor bolts; plumb + temporary guy/brace before release.",
        "rafter_assembly": "Lift and bolt rafters to columns — main frames. Crane-driven, weather/wind sensitive.",
        "purlin_girt_fixing": "Secondary members — roof purlins + wall girts tying frames. Don't release crane until purlins + fly-bracing in.",
        "bracing": "Roof + wall bracing for wind/seismic stability (coastal AP — wind matters).",
        "bolt_tightening_alignment": "Final alignment + torque all connections to spec. Structure stands true."
      }
    },
    {
      "key": "envelope",
      "label": "Roofing & Cladding",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["structure_envelope","full"] },
      "trades": ["roof_sheeting","wall_cladding","gutters_downpipes","skylights_ventilators","flashing_trims"],
      "reference_notes": {
        "roof_sheeting": "Galvalume/insulated sandwich panel roofing from ridge down. Leak-critical — laps + fasteners + sealing.",
        "wall_cladding": "Wall sheets/panels (insulated if cold-chain).",
        "gutters_downpipes": "Rainwater system — sized for local rainfall (coastal AP — heavy monsoon).",
        "skylights_ventilators": "Translucent sheets + ridge/turbo ventilators for daylight + airflow.",
        "flashing_trims": "Closure flashings, corner/eave/ridge trims — weather-seal the envelope."
      }
    },
    {
      "key": "flooring",
      "label": "Industrial Flooring",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["full"] },
      "trades": ["sub_base","vdf_trimix_flooring","floor_hardener","joint_cutting"],
      "reference_notes": {
        "vdf_trimix_flooring": "Vacuum-dewatered / trimix floor — the big industrial floor trade. Flat, level, load-bearing for racking/forklifts.",
        "floor_hardener": "Surface hardener for abrasion resistance.",
        "joint_cutting": "Control/expansion joint cutting + sealing to prevent cracking."
      }
    },
    {
      "key": "mep_services",
      "label": "MEP & Services",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["full"] },
      "trades": ["electrical_lighting","fire_fighting","plumbing_drainage","ventilation"],
      "reference_notes": {
        "electrical_lighting": "Power, high-bay lighting, panels, earthing.",
        "fire_fighting": "Hydrants/sprinklers/pump room — statutory, gates occupancy.",
        "plumbing_drainage": "Water + drainage for toilets/utility blocks.",
        "ventilation": "Exhaust/HVAC where process needs it."
      }
    },
    {
      "key": "finishing",
      "label": "Finishing & Fit-out",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["full"] },
      "trades": ["rolling_shutters_doors","dock_levellers","office_mezzanine_fitout","painting"],
      "reference_notes": {
        "rolling_shutters_doors": "Rolling shutters, personnel doors, dock doors.",
        "dock_levellers": "Loading-dock levellers + bumpers where logistics spec needs.",
        "office_mezzanine_fitout": "Mezzanine office block fit-out if present — the only per-floor-ish element.",
        "painting": "Steel touch-up, line marking, safety markings."
      }
    },
    {
      "key": "final",
      "label": "Handover",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": { "scope": ["full"] },
      "trades": ["fire_commissioning","external_development","snagging_handover"],
      "reference_notes": {
        "external_development": "Yard paving, approach roads, compound, weighbridge if any.",
        "snagging_handover": "Defect walk, commissioning, as-built drawings, handover."
      }
    }
  ]
}
```

---

## Open questions to resolve before freezing these as immutable v1

1. **Residential — wet-area waterproofing**: separate finishes task before tiling
   (current), or folded into floor preparation?
2. **Residential — scope split**: do plumbing services belong in `structure_finishing`
   (current) or `structure_only` in your contracts?
3. **Scope vocabulary**: one universal scope triple mapped per model, or each model
   carries its own scope enum (residential/commercial/industrial differ)? This
   affects the `project_construction_meta.scope` column design.
4. **Commercial**: is shell-and-core a real handover mode you do, or do you always
   full-fitout? If always full, the `shell_and_core` scope simplifies away.
5. **Industrial**: do you actually run mezzanine/office blocks (per-floor element),
   or pure single-volume sheds (all `once`)?
6. **Footing defaults per type**: residential default `isolated`, commercial `raft`,
   industrial pedestals — confirm these match your norms.

Each model freezes as immutable **v1** only after its open questions are answered
against real practice. Residential is closest; commercial and industrial are
research-grounded drafts awaiting your first real project of each type.
