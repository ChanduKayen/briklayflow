-- ===========================================================================
-- Block 0 - seed: rcc_residential as IMMUTABLE v1.
-- Spec is the faithful rcc_residential block from
-- docs/site-ops/construction_models.md (field-corrected; answers #1, #2 already
-- reflected; scopes declared per answer #3). model_key/version/name are the
-- authoritative COLUMNS the expander stamps; they mirror the spec.
-- Idempotent (ON CONFLICT DO NOTHING) - v1 never mutates; a new version is a new row.
-- Commercial/industrial are NOT seeded here (drafts; separate model_keys later).
-- ===========================================================================
INSERT INTO public.construction_models (model_key, name, description, version, status, spec)
VALUES (
  'rcc_residential',
  'RCC Residential',
  'RCC framed villas and apartments. Villa = units_per_floor 1; apartment = units_per_floor N. Field-corrected v1.',
  1,
  'active',
  $spec$
{
  "model_key": "rcc_residential",
  "version": 1,
  "scopes": [
    "structure_only",
    "structure_finishing",
    "full"
  ],
  "buckets": [
    {
      "key": "site_foundation",
      "label": "Site & Foundation",
      "cardinality": "once",
      "walk": "trade_major",
      "include_when": {
        "scope": [
          "structure_only",
          "structure_finishing",
          "full"
        ]
      },
      "branch": {
        "on": "footing_type",
        "default": "isolated",
        "variants": {
          "isolated": {
            "trades": [
              "ground_leveling",
              "site_marking",
              "excavation",
              "pcc",
              "isolated_footings",
              "plinth_beam",
              "backfill",
              "plinth_slab"
            ],
            "reference_notes": {
              "excavation": "Dig to founding depth per soil; keep sides safe, dewater if water table high (coastal AP — common).",
              "isolated_footings": "Individual pad footing under each column. PCC bed, reinforcement cage, shutter, pour, cure before plinth beam.",
              "plinth_beam": "Ties columns at plinth, carries blockwork above. Level is critical — every floor stacks true off this.",
              "plinth_slab": "Ground-floor base after backfill compaction; sets finished ground level."
            }
          },
          "combined": {
            "trades": [
              "ground_leveling",
              "site_marking",
              "excavation",
              "pcc",
              "combined_footings",
              "plinth_beam",
              "backfill",
              "plinth_slab"
            ],
            "reference_notes": {
              "combined_footings": "Shared footing under two or more close columns where pads would overlap. PCC, reinforcement, pour, cure."
            }
          },
          "raft": {
            "trades": [
              "ground_leveling",
              "site_marking",
              "excavation",
              "pcc",
              "raft_mat",
              "plinth_beam",
              "backfill",
              "plinth_slab"
            ],
            "reference_notes": {
              "raft_mat": "Single continuous mat slab under whole footprint — weak/soft soil or heavy load. Reinforcement mat, pour in planned bays, cure."
            }
          },
          "pile": {
            "trades": [
              "ground_leveling",
              "site_marking",
              "piling",
              "pile_cap",
              "pcc",
              "plinth_beam",
              "backfill",
              "plinth_slab"
            ],
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
      "include_when": {
        "scope": [
          "structure_only",
          "structure_finishing",
          "full"
        ]
      },
      "trades": [
        "columns",
        "beams_shuttering",
        "slab_reinforcement",
        "slab_pour"
      ],
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
      "include_when": {
        "scope": [
          "structure_finishing",
          "full"
        ]
      },
      "trades": [
        "blockwork",
        "door_frames",
        "window_frames",
        "electrical_conduit",
        "plumbing_conduit",
        "plastering",
        "false_ceiling",
        "wiring",
        "putty",
        "floor_preparation"
      ],
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
      "include_when": {
        "scope": [
          "structure_finishing",
          "full"
        ]
      },
      "trades": [
        "vertical_plumbing_risers",
        "floor_plumbing_rough_ins"
      ],
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
      "include_when": {
        "scope": [
          "full"
        ]
      },
      "trades": [
        "wet_area_waterproofing",
        "tiling",
        "door_installation",
        "window_grills",
        "painting"
      ],
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
      "include_when": {
        "scope": [
          "structure_finishing",
          "full"
        ]
      },
      "trades": [
        "facade_treatment",
        "terrace_waterproofing",
        "terrace_finishing",
        "external_painting"
      ],
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
      "include_when": {
        "scope": [
          "full"
        ]
      },
      "trades": [
        "cellar_parking_flooring",
        "fixtures",
        "decorative_installations",
        "snagging_handover"
      ],
      "reference_notes": {
        "cellar_parking_flooring": "Stilt/parking/cellar floor — often last to avoid construction-traffic damage.",
        "fixtures": "CP fittings, sanitaryware, electrical fixtures/switches, fans. Near the very end to avoid damage/theft.",
        "decorative_installations": "Final decorative elements, cladding features, landscaping touches.",
        "snagging_handover": "Defect walk, touch-ups, deep clean, handover. The done-of-done."
      }
    }
  ]
}
$spec$::jsonb
)
ON CONFLICT (model_key) DO NOTHING;
