// ── Construction Cost Code Taxonomy ───────────────────────────────────────────
// Type A  : MATERIALS  (MAT-01 … MAT-25)
// Type B  : WORKS      (WRK-01 … WRK-23)
// Type C  : GENERAL    (GEN-01 … GEN-99) — overhead/expense heads with no payee

export interface CostCodeItem {
  code: string;   // e.g. "MAT-09-04"
  name: string;   // e.g. "Marble slabs and tiles"
}

export interface CostCodeDivision {
  code: string;   // e.g. "MAT-09"
  name: string;   // e.g. "Flooring, Tiles & Stone"
  type: 'MAT' | 'WRK' | 'GEN';
  items: CostCodeItem[];
}

// ── TYPE A : MATERIALS ─────────────────────────────────────────────────────────

const MAT: CostCodeDivision[] = [
  {
    code: 'MAT-01', name: 'Site Works & Temporary Infrastructure', type: 'MAT',
    items: [
      { code: 'MAT-01-01', name: 'Temporary site fencing and hoarding' },
      { code: 'MAT-01-02', name: 'Site office / labour camp materials' },
      { code: 'MAT-01-03', name: 'Temporary water supply lines and tanks' },
      { code: 'MAT-01-04', name: 'Temporary electrical connections and DB boards' },
      { code: 'MAT-01-05', name: 'Scaffolding and staging materials' },
      { code: 'MAT-01-06', name: 'Shuttering and formwork (timber/steel/aluminium)' },
      { code: 'MAT-01-07', name: 'Curing compounds and curing materials' },
      { code: 'MAT-01-08', name: 'Barricade tapes, signage and safety boards' },
    ],
  },
  {
    code: 'MAT-02', name: 'Surveying, Testing & QA/QC', type: 'MAT',
    items: [
      { code: 'MAT-02-01', name: 'Survey pegs, profiles and marking materials' },
      { code: 'MAT-02-02', name: 'Soil testing and boring materials' },
      { code: 'MAT-02-03', name: 'Concrete cube moulds and testing kits' },
      { code: 'MAT-02-04', name: 'NDT equipment consumables' },
      { code: 'MAT-02-05', name: 'Water quality testing kits' },
      { code: 'MAT-02-06', name: 'Calibration materials and standards' },
    ],
  },
  {
    code: 'MAT-03', name: 'Earthwork, Foundation & Structural Systems', type: 'MAT',
    items: [
      { code: 'MAT-03-01', name: 'Lean concrete / PCC materials' },
      { code: 'MAT-03-02', name: 'Compacted earth fill and GSB material' },
      { code: 'MAT-03-03', name: 'Geotextile and geomembrane sheets' },
      { code: 'MAT-03-04', name: 'Sheet piling and retaining wall materials' },
      { code: 'MAT-03-05', name: 'Micropile and ground anchor materials' },
      { code: 'MAT-03-06', name: 'Anti-termite treatment chemicals' },
      { code: 'MAT-03-07', name: 'Raft and pile cap reinforcement materials' },
      { code: 'MAT-03-08', name: 'Expansion joints and joint fillers' },
    ],
  },
  {
    code: 'MAT-04', name: 'Cement, Concrete & Construction Chemicals', type: 'MAT',
    items: [
      { code: 'MAT-04-01', name: 'OPC / PPC / PSC cement (bags/bulk)' },
      { code: 'MAT-04-02', name: 'Ready Mix Concrete (RMC) — M15 to M50' },
      { code: 'MAT-04-03', name: 'Concrete admixtures (plasticizer, superplasticizer)' },
      { code: 'MAT-04-04', name: 'Accelerators and retarders' },
      { code: 'MAT-04-05', name: 'Fly ash and GGBS' },
      { code: 'MAT-04-06', name: 'Grout and non-shrink grout' },
      { code: 'MAT-04-07', name: 'Epoxy and polymer concrete repair compounds' },
      { code: 'MAT-04-08', name: 'Concrete bonding agents' },
    ],
  },
  {
    code: 'MAT-05', name: 'Aggregates, Masonry & Building Blocks', type: 'MAT',
    items: [
      { code: 'MAT-05-01', name: 'River sand / M-sand (fine aggregate)' },
      { code: 'MAT-05-02', name: 'Coarse aggregate (6mm / 12mm / 20mm / 40mm)' },
      { code: 'MAT-05-03', name: 'Quarry dust and crushed stone powder' },
      { code: 'MAT-05-04', name: 'Red clay bricks (first class / second class)' },
      { code: 'MAT-05-05', name: 'Fly ash bricks / cement bricks' },
      { code: 'MAT-05-06', name: 'AAC (Autoclaved Aerated Concrete) blocks' },
      { code: 'MAT-05-07', name: 'Concrete hollow blocks and solid blocks' },
      { code: 'MAT-05-08', name: 'Natural stone (granite, limestone, sandstone) for masonry' },
      { code: 'MAT-05-09', name: 'Mortar and ready-mix masonry compounds' },
    ],
  },
  {
    code: 'MAT-06', name: 'Steel, Metal & Fabrication Materials', type: 'MAT',
    items: [
      { code: 'MAT-06-01', name: 'TMT steel bars (Fe415 / Fe500 / Fe550)' },
      { code: 'MAT-06-02', name: 'Structural steel sections (I / H / C / angle)' },
      { code: 'MAT-06-03', name: 'GI pipes and hollow sections' },
      { code: 'MAT-06-04', name: 'Mild steel plates and sheets' },
      { code: 'MAT-06-05', name: 'Stainless steel sheets, pipes and fittings' },
      { code: 'MAT-06-06', name: 'Aluminium sections and extrusions' },
      { code: 'MAT-06-07', name: 'Welding electrodes, rods and gases' },
      { code: 'MAT-06-08', name: 'Metal mesh, expanded metal and perforated sheets' },
      { code: 'MAT-06-09', name: 'Steel gratings and chequered plates' },
      { code: 'MAT-06-10', name: 'Pre-engineered building (PEB) components' },
    ],
  },
  {
    code: 'MAT-07', name: 'Roofing, Cladding & Insulation Systems', type: 'MAT',
    items: [
      { code: 'MAT-07-01', name: 'RCC roof slab materials' },
      { code: 'MAT-07-02', name: 'GI / colour-coated roofing sheets' },
      { code: 'MAT-07-03', name: 'Polycarbonate and FRP sheets' },
      { code: 'MAT-07-04', name: 'Clay / concrete / terracotta roof tiles' },
      { code: 'MAT-07-05', name: 'Roof insulation (glass wool / rock wool / XPS)' },
      { code: 'MAT-07-06', name: 'Facade cladding panels (ACP / HPL / stone)' },
      { code: 'MAT-07-07', name: 'Roof waterproofing membrane and screed' },
      { code: 'MAT-07-08', name: 'Skylights and roof lanterns' },
      { code: 'MAT-07-09', name: 'Wall insulation boards and cavity fill' },
    ],
  },
  {
    code: 'MAT-08', name: 'Waterproofing, Sealants & Protective Systems', type: 'MAT',
    items: [
      { code: 'MAT-08-01', name: 'APP / SBS bituminous waterproofing membranes' },
      { code: 'MAT-08-02', name: 'Crystalline waterproofing compounds' },
      { code: 'MAT-08-03', name: 'Liquid applied waterproofing coatings' },
      { code: 'MAT-08-04', name: 'Polyurethane and epoxy waterproofing' },
      { code: 'MAT-08-05', name: 'Silicone and polyurethane sealants' },
      { code: 'MAT-08-06', name: 'Expansion joint sealing systems' },
      { code: 'MAT-08-07', name: 'Basement tanking materials' },
      { code: 'MAT-08-08', name: 'Terrace and bathroom waterproofing systems' },
      { code: 'MAT-08-09', name: 'Damp proof course (DPC) materials' },
    ],
  },
  {
    code: 'MAT-09', name: 'Flooring, Tiles & Stone', type: 'MAT',
    items: [
      { code: 'MAT-09-01', name: 'Ceramic floor tiles (glazed / unglazed)' },
      { code: 'MAT-09-02', name: 'Vitrified tiles (double charge / GVT / PGVT)' },
      { code: 'MAT-09-03', name: 'Polished porcelain and full body tiles' },
      { code: 'MAT-09-04', name: 'Marble slabs and tiles' },
      { code: 'MAT-09-05', name: 'Granite slabs and tiles' },
      { code: 'MAT-09-06', name: 'Kota stone and natural stone flooring' },
      { code: 'MAT-09-07', name: 'Engineered wood and laminate flooring' },
      { code: 'MAT-09-08', name: 'Vinyl and LVT flooring' },
      { code: 'MAT-09-09', name: 'Epoxy and PU floor coatings' },
      { code: 'MAT-09-10', name: 'Anti-skid tiles and industrial flooring' },
      { code: 'MAT-09-11', name: 'Tile adhesive, grout and tile spacers' },
      { code: 'MAT-09-12', name: 'Skirting and stair nosing' },
    ],
  },
  {
    code: 'MAT-10', name: 'Wall Finishes, Ceiling & Partition Systems', type: 'MAT',
    items: [
      { code: 'MAT-10-01', name: 'Gypsum plaster and ready-mix plaster' },
      { code: 'MAT-10-02', name: 'Cement plaster and S/F mortar' },
      { code: 'MAT-10-03', name: 'Wall cladding tiles (ceramic / stone / designer)' },
      { code: 'MAT-10-04', name: 'Gypsum board and plasterboard' },
      { code: 'MAT-10-05', name: 'Grid ceiling tiles (mineral fibre / metal)' },
      { code: 'MAT-10-06', name: 'GI framework for false ceiling and partition' },
      { code: 'MAT-10-07', name: 'Calcium silicate boards and fire-rated boards' },
      { code: 'MAT-10-08', name: 'Decorative panels (PU / WPC / 3D wall panels)' },
      { code: 'MAT-10-09', name: 'Wallpaper and wall fabric' },
      { code: 'MAT-10-10', name: 'Glass partition systems and movable walls' },
      { code: 'MAT-10-11', name: 'Cornices, mouldings and ceiling medallions' },
    ],
  },
  {
    code: 'MAT-11', name: 'Paints, Coatings & Surface Treatments', type: 'MAT',
    items: [
      { code: 'MAT-11-01', name: 'Interior emulsion paint (economy / premium)' },
      { code: 'MAT-11-02', name: 'Exterior weatherproof paint' },
      { code: 'MAT-11-03', name: 'Enamel and oil-based paint' },
      { code: 'MAT-11-04', name: 'Distemper and lime wash' },
      { code: 'MAT-11-05', name: 'Texture paint and designer finishes' },
      { code: 'MAT-11-06', name: 'Wood primer, stain and polish' },
      { code: 'MAT-11-07', name: 'Metal primer and anti-corrosion paint' },
      { code: 'MAT-11-08', name: 'Putty and wall primer' },
      { code: 'MAT-11-09', name: 'Epoxy paint and floor coatings' },
      { code: 'MAT-11-10', name: 'Waterproof paint and damp shield' },
      { code: 'MAT-11-11', name: 'Varnish, lacquer and clear coat' },
    ],
  },
  {
    code: 'MAT-12', name: 'Doors, Windows, Glass & Facade Systems', type: 'MAT',
    items: [
      { code: 'MAT-12-01', name: 'Solid wood doors and frames' },
      { code: 'MAT-12-02', name: 'Flush doors (commercial / membrane / laminated)' },
      { code: 'MAT-12-03', name: 'Steel and security doors' },
      { code: 'MAT-12-04', name: 'UPVC doors and windows' },
      { code: 'MAT-12-05', name: 'Aluminium doors, windows and sliding systems' },
      { code: 'MAT-12-06', name: 'Wooden windows and ventilators' },
      { code: 'MAT-12-07', name: 'Clear / tinted / frosted float glass' },
      { code: 'MAT-12-08', name: 'Tempered and laminated safety glass' },
      { code: 'MAT-12-09', name: 'Double glazed units (DGU)' },
      { code: 'MAT-12-10', name: 'Structural glazing and curtain wall systems' },
      { code: 'MAT-12-11', name: 'Jaali, louvres and pergola systems' },
      { code: 'MAT-12-12', name: 'Rolling shutters and collapsible gates' },
      { code: 'MAT-12-13', name: 'Compound wall gates (swing / sliding)' },
    ],
  },
  {
    code: 'MAT-13', name: 'Hardware, Fasteners & Fixing Systems', type: 'MAT',
    items: [
      { code: 'MAT-13-01', name: 'Door hardware (handles, hinges, locks, closers)' },
      { code: 'MAT-13-02', name: 'Window hardware (stays, latches, friction stays)' },
      { code: 'MAT-13-03', name: 'Cabinet hardware (channels, hinges, handles)' },
      { code: 'MAT-13-04', name: 'Anchor bolts and chemical anchors' },
      { code: 'MAT-13-05', name: 'Nuts, bolts, screws and washers' },
      { code: 'MAT-13-06', name: 'Nails and staples' },
      { code: 'MAT-13-07', name: 'Construction adhesives and fixatives' },
      { code: 'MAT-13-08', name: 'Rawl plugs and wall anchors' },
      { code: 'MAT-13-09', name: 'Wire rope and turnbuckles' },
    ],
  },
  {
    code: 'MAT-14', name: 'Plumbing, Drainage & Water Management', type: 'MAT',
    items: [
      { code: 'MAT-14-01', name: 'CPVC / UPVC pipes and fittings (hot & cold water)' },
      { code: 'MAT-14-02', name: 'GI pipes and fittings (water supply)' },
      { code: 'MAT-14-03', name: 'PVC drainage pipes and fittings (SWR)' },
      { code: 'MAT-14-04', name: 'HDPE pipes (water supply / drainage / underground)' },
      { code: 'MAT-14-05', name: 'CI / DI pipes (drainage and sewerage)' },
      { code: 'MAT-14-06', name: 'Water storage tanks (HDPE / FRP / RCC)' },
      { code: 'MAT-14-07', name: 'Water pumps (domestic / submersible / booster)' },
      { code: 'MAT-14-08', name: 'Valves, stopcocks and ball valves' },
      { code: 'MAT-14-09', name: 'Water meters and pressure gauges' },
      { code: 'MAT-14-10', name: 'STP and ETP components' },
      { code: 'MAT-14-11', name: 'Rainwater harvesting systems' },
      { code: 'MAT-14-12', name: 'Manhole covers and chamber materials' },
      { code: 'MAT-14-13', name: 'Grease traps and inspection chambers' },
    ],
  },
  {
    code: 'MAT-15', name: 'Sanitaryware, Bathroom & Kitchen Systems', type: 'MAT',
    items: [
      { code: 'MAT-15-01', name: 'WC / EWC (wall-hung / floor-mounted)' },
      { code: 'MAT-15-02', name: 'Wash basins and pedestals' },
      { code: 'MAT-15-03', name: 'Bathroom fittings (taps, mixers, showers)' },
      { code: 'MAT-15-04', name: 'Bathtubs and shower enclosures' },
      { code: 'MAT-15-05', name: 'Bathroom accessories (towel bars, soap holders)' },
      { code: 'MAT-15-06', name: 'Kitchen sinks (SS / granite / ceramic)' },
      { code: 'MAT-15-07', name: 'Kitchen taps and sink mixers' },
      { code: 'MAT-15-08', name: 'Water heaters (geyser / heat pump / solar)' },
      { code: 'MAT-15-09', name: 'Mirror and medicine cabinets' },
      { code: 'MAT-15-10', name: 'Modular kitchen materials (carcass, shutters, countertop)' },
    ],
  },
  {
    code: 'MAT-16', name: 'Electrical Systems', type: 'MAT',
    items: [
      { code: 'MAT-16-01', name: 'Cables and wires (FR / FRLS / XLPE)' },
      { code: 'MAT-16-02', name: 'Conduit pipes and accessories (PVC / GI)' },
      { code: 'MAT-16-03', name: 'Switch boxes, junction boxes and enclosures' },
      { code: 'MAT-16-04', name: 'Switches and sockets (modular)' },
      { code: 'MAT-16-05', name: 'MCBs, ELCBs and RCCBs' },
      { code: 'MAT-16-06', name: 'Distribution boards and consumer units' },
      { code: 'MAT-16-07', name: 'Main LT panels and bus ducts' },
      { code: 'MAT-16-08', name: 'Earthing materials (plates, pipes, chemicals)' },
      { code: 'MAT-16-09', name: 'Lightning arrestors and surge protectors' },
      { code: 'MAT-16-10', name: 'Transformers and HT panels' },
      { code: 'MAT-16-11', name: 'Diesel generators and AMF panels' },
      { code: 'MAT-16-12', name: 'UPS and battery backup systems' },
      { code: 'MAT-16-13', name: 'Cable trays and cable management' },
    ],
  },
  {
    code: 'MAT-17', name: 'Lighting, ELV & Smart Automation', type: 'MAT',
    items: [
      { code: 'MAT-17-01', name: 'LED lights (panel / downlight / strip / spotlight)' },
      { code: 'MAT-17-02', name: 'Decorative and designer light fixtures' },
      { code: 'MAT-17-03', name: 'Outdoor and landscape lighting' },
      { code: 'MAT-17-04', name: 'Emergency and exit lighting' },
      { code: 'MAT-17-05', name: 'CCTV cameras and NVR systems' },
      { code: 'MAT-17-06', name: 'Video door phones and access control' },
      { code: 'MAT-17-07', name: 'Structured cabling (CAT6 / fibre optic)' },
      { code: 'MAT-17-08', name: 'PA / intercom systems' },
      { code: 'MAT-17-09', name: 'Home automation and smart switches' },
      { code: 'MAT-17-10', name: 'DTH and networking equipment' },
    ],
  },
  {
    code: 'MAT-18', name: 'HVAC, Fire Safety & Building Services', type: 'MAT',
    items: [
      { code: 'MAT-18-01', name: 'Split ACs and VRF / VRV systems' },
      { code: 'MAT-18-02', name: 'Ducting materials (GI / flexible)' },
      { code: 'MAT-18-03', name: 'Exhaust fans and ventilation systems' },
      { code: 'MAT-18-04', name: 'Fire alarm panels and detectors' },
      { code: 'MAT-18-05', name: 'Fire sprinkler systems and pipes' },
      { code: 'MAT-18-06', name: 'Fire extinguishers and suppression systems' },
      { code: 'MAT-18-07', name: 'Smoke detectors and heat detectors' },
      { code: 'MAT-18-08', name: 'Lifts and elevators (materials / components)' },
      { code: 'MAT-18-09', name: 'Escalators and moving walkways' },
      { code: 'MAT-18-10', name: 'BMS (Building Management System) components' },
    ],
  },
  {
    code: 'MAT-19', name: 'Renewable Energy & Utility Infrastructure', type: 'MAT',
    items: [
      { code: 'MAT-19-01', name: 'Solar PV panels and inverters' },
      { code: 'MAT-19-02', name: 'Solar mounting structures' },
      { code: 'MAT-19-03', name: 'Battery storage systems (lithium / lead acid)' },
      { code: 'MAT-19-04', name: 'Rainwater harvesting tanks and filters' },
      { code: 'MAT-19-05', name: 'STP plant materials and bio media' },
      { code: 'MAT-19-06', name: 'Gas piping systems (PNG / LPG)' },
      { code: 'MAT-19-07', name: 'EV charging points and infrastructure' },
    ],
  },
  {
    code: 'MAT-20', name: 'Exterior Development, Roads & Landscaping', type: 'MAT',
    items: [
      { code: 'MAT-20-01', name: 'Paving blocks and kerb stones' },
      { code: 'MAT-20-02', name: 'Bitumen and asphalt materials' },
      { code: 'MAT-20-03', name: 'Compound wall / boundary wall materials' },
      { code: 'MAT-20-04', name: 'Fencing (chain link / MS / GI)' },
      { code: 'MAT-20-05', name: 'Landscaping soil, mulch and compost' },
      { code: 'MAT-20-06', name: 'Plants, turf and irrigation materials' },
      { code: 'MAT-20-07', name: 'Outdoor furniture and pergola materials' },
      { code: 'MAT-20-08', name: 'Swimming pool materials and equipment' },
      { code: 'MAT-20-09', name: 'Car parking materials (sensors, markings)' },
      { code: 'MAT-20-10', name: 'Outdoor signage and wayfinding' },
    ],
  },
  {
    code: 'MAT-21', name: 'Furniture, Interior Fitouts & Architectural Elements', type: 'MAT',
    items: [
      { code: 'MAT-21-01', name: 'Loose furniture (sofas, beds, tables, chairs)' },
      { code: 'MAT-21-02', name: 'Built-in joinery (TV unit, bookshelves)' },
      { code: 'MAT-21-03', name: 'Curtains, blinds and upholstery' },
      { code: 'MAT-21-04', name: 'Decorative elements (artifacts, rugs, plants)' },
      { code: 'MAT-21-05', name: 'Stair railings (SS / MS / glass / wood)' },
      { code: 'MAT-21-06', name: 'Balcony railings and balustrades' },
      { code: 'MAT-21-07', name: 'Feature walls and accent elements' },
      { code: 'MAT-21-08', name: 'Artwork, murals and bespoke installations' },
    ],
  },
  {
    code: 'MAT-22', name: 'Industrial, Prefabricated & Specialized Construction', type: 'MAT',
    items: [
      { code: 'MAT-22-01', name: 'Precast concrete elements (beams, slabs, walls)' },
      { code: 'MAT-22-02', name: 'PEB (Pre-Engineered Building) structure' },
      { code: 'MAT-22-03', name: 'Modular and portable cabin materials' },
      { code: 'MAT-22-04', name: 'Industrial flooring (epoxy / PU / hardener)' },
      { code: 'MAT-22-05', name: 'Mezzanine floor materials' },
      { code: 'MAT-22-06', name: 'Cold storage and cleanroom materials' },
      { code: 'MAT-22-07', name: 'Blast-resistant and fire-rated materials' },
    ],
  },
  {
    code: 'MAT-23', name: 'Tools, Equipment & Material Handling', type: 'MAT',
    items: [
      { code: 'MAT-23-01', name: 'Hand tools (trowels, hammers, levels)' },
      { code: 'MAT-23-02', name: 'Power tools (drills, grinders, saws)' },
      { code: 'MAT-23-03', name: 'Construction equipment hire (JCB, crane, transit mixer)' },
      { code: 'MAT-23-04', name: 'Scaffolding hire' },
      { code: 'MAT-23-05', name: 'Material hoists and tower cranes' },
      { code: 'MAT-23-06', name: 'Concrete mixers and vibrators' },
      { code: 'MAT-23-07', name: 'Welding machines and gas cutting sets' },
      { code: 'MAT-23-08', name: 'Survey instruments (total station, level)' },
    ],
  },
  {
    code: 'MAT-24', name: 'Safety, Security & Site Protection', type: 'MAT',
    items: [
      { code: 'MAT-24-01', name: 'Helmets, gloves, safety shoes and PPE' },
      { code: 'MAT-24-02', name: 'Safety nets and fall arrest systems' },
      { code: 'MAT-24-03', name: 'First aid kits and medical supplies' },
      { code: 'MAT-24-04', name: 'Fire blankets and extinguishers (site)' },
      { code: 'MAT-24-05', name: 'Site security cameras and alarms' },
      { code: 'MAT-24-06', name: 'Dust and noise control materials' },
      { code: 'MAT-24-07', name: 'Reflective vests and site clothing' },
    ],
  },
  {
    code: 'MAT-25', name: 'Repair, Maintenance & Rehabilitation', type: 'MAT',
    items: [
      { code: 'MAT-25-01', name: 'Crack repair materials (epoxy injection, sealants)' },
      { code: 'MAT-25-02', name: 'Concrete repair mortars' },
      { code: 'MAT-25-03', name: 'Corrosion inhibitors and rust converters' },
      { code: 'MAT-25-04', name: 'Retrofitting and strengthening materials' },
      { code: 'MAT-25-05', name: 'Demolition and breaking materials' },
      { code: 'MAT-25-06', name: 'Waterproofing repair systems' },
      { code: 'MAT-25-07', name: 'Regrouting and tile repair materials' },
      { code: 'MAT-25-08', name: 'Plumbing repair fittings and spares' },
      { code: 'MAT-25-09', name: 'Electrical repair spares' },
    ],
  },
];

// ── TYPE B : WORKS ─────────────────────────────────────────────────────────────

const WRK: CostCodeDivision[] = [
  {
    code: 'WRK-01', name: 'Site Preparation & Enabling Works', type: 'WRK',
    items: [
      { code: 'WRK-01-01', name: 'Site clearing and demolition of existing structures' },
      { code: 'WRK-01-02', name: 'Tree removal and stump extraction' },
      { code: 'WRK-01-03', name: 'Temporary access road and site entry construction' },
      { code: 'WRK-01-04', name: 'Site office and labour camp setup' },
      { code: 'WRK-01-05', name: 'Hoarding, fencing and barricading' },
      { code: 'WRK-01-06', name: 'Temporary power and water connection work' },
      { code: 'WRK-01-07', name: 'Site survey and setting out' },
      { code: 'WRK-01-08', name: 'Soil investigation and bore log' },
    ],
  },
  {
    code: 'WRK-02', name: 'Earthwork & Substructure', type: 'WRK',
    items: [
      { code: 'WRK-02-01', name: 'Excavation (manual and machine)' },
      { code: 'WRK-02-02', name: 'Earth filling, grading and compaction' },
      { code: 'WRK-02-03', name: 'Dewatering and pumping' },
      { code: 'WRK-02-04', name: 'Anti-termite soil treatment' },
      { code: 'WRK-02-05', name: 'PCC (Plain Cement Concrete) laying' },
      { code: 'WRK-02-06', name: 'Pile foundation work' },
      { code: 'WRK-02-07', name: 'Raft / isolated / combined footing construction' },
      { code: 'WRK-02-08', name: 'Retaining wall construction' },
      { code: 'WRK-02-09', name: 'Basement construction and tanking' },
    ],
  },
  {
    code: 'WRK-03', name: 'RCC Structural Work', type: 'WRK',
    items: [
      { code: 'WRK-03-01', name: 'Reinforcement bar bending and binding' },
      { code: 'WRK-03-02', name: 'Shuttering and formwork (erection and striking)' },
      { code: 'WRK-03-03', name: 'Concrete mixing and pouring (manual)' },
      { code: 'WRK-03-04', name: 'RMC placement and compaction' },
      { code: 'WRK-03-05', name: 'Concrete curing' },
      { code: 'WRK-03-06', name: 'Columns and shear wall casting' },
      { code: 'WRK-03-07', name: 'Beams and slab casting' },
      { code: 'WRK-03-08', name: 'Staircase construction' },
      { code: 'WRK-03-09', name: 'Lift pit and core wall construction' },
      { code: 'WRK-03-10', name: 'Precast element erection' },
    ],
  },
  {
    code: 'WRK-04', name: 'Masonry & Block Work', type: 'WRK',
    items: [
      { code: 'WRK-04-01', name: 'Brick masonry (load-bearing and partition walls)' },
      { code: 'WRK-04-02', name: 'AAC / fly ash / hollow block masonry' },
      { code: 'WRK-04-03', name: 'Stone masonry (rubble / coursed / ashlar)' },
      { code: 'WRK-04-04', name: 'Lintel and band beam laying' },
      { code: 'WRK-04-05', name: 'Parapet and compound wall masonry' },
      { code: 'WRK-04-06', name: 'Arch construction' },
    ],
  },
  {
    code: 'WRK-05', name: 'Waterproofing Works', type: 'WRK',
    items: [
      { code: 'WRK-05-01', name: 'Terrace / roof waterproofing' },
      { code: 'WRK-05-02', name: 'Bathroom and wet area waterproofing' },
      { code: 'WRK-05-03', name: 'Basement and below-grade waterproofing' },
      { code: 'WRK-05-04', name: 'External wall anti-carbonation coating' },
      { code: 'WRK-05-05', name: 'Swimming pool waterproofing' },
      { code: 'WRK-05-06', name: 'Water tank waterproofing (internal)' },
      { code: 'WRK-05-07', name: 'Expansion joint sealing work' },
    ],
  },
  {
    code: 'WRK-06', name: 'Plastering & Surface Preparation', type: 'WRK',
    items: [
      { code: 'WRK-06-01', name: 'Internal wall plastering (cement / gypsum)' },
      { code: 'WRK-06-02', name: 'External wall plastering and rendering' },
      { code: 'WRK-06-03', name: 'Ceiling plastering' },
      { code: 'WRK-06-04', name: 'Wall putty and skim coat application' },
      { code: 'WRK-06-05', name: 'Surface preparation for painting (sanding, priming)' },
      { code: 'WRK-06-06', name: 'Textured and decorative plaster application' },
      { code: 'WRK-06-07', name: 'Grouting and pointing' },
    ],
  },
  {
    code: 'WRK-07', name: 'Flooring & Tiling Works', type: 'WRK',
    items: [
      { code: 'WRK-07-01', name: 'Ceramic and vitrified tile laying (floor)' },
      { code: 'WRK-07-02', name: 'Wall tile fixing (bathroom, kitchen, elevation)' },
      { code: 'WRK-07-03', name: 'Marble and granite fixing (floor and stairs)' },
      { code: 'WRK-07-04', name: 'Kota stone and natural stone laying' },
      { code: 'WRK-07-05', name: 'Wooden and laminate flooring installation' },
      { code: 'WRK-07-06', name: 'Vinyl and LVT flooring laying' },
      { code: 'WRK-07-07', name: 'Epoxy and PU flooring application' },
      { code: 'WRK-07-08', name: 'Tile grouting and finishing' },
      { code: 'WRK-07-09', name: 'Skirting and stair nosing fixing' },
    ],
  },
  {
    code: 'WRK-08', name: 'False Ceiling & Partition Works', type: 'WRK',
    items: [
      { code: 'WRK-08-01', name: 'Gypsum board false ceiling' },
      { code: 'WRK-08-02', name: 'Grid / modular ceiling installation' },
      { code: 'WRK-08-03', name: 'Wooden and metal ceiling systems' },
      { code: 'WRK-08-04', name: 'Gypsum / glass partition wall' },
      { code: 'WRK-08-05', name: 'Movable partition systems' },
      { code: 'WRK-08-06', name: 'Cornice and moulding installation' },
    ],
  },
  {
    code: 'WRK-09', name: 'Doors, Windows & Glazing Works', type: 'WRK',
    items: [
      { code: 'WRK-09-01', name: 'Door frame fixing and door hanging' },
      { code: 'WRK-09-02', name: 'UPVC door and window installation' },
      { code: 'WRK-09-03', name: 'Aluminium door / window / sliding system fitting' },
      { code: 'WRK-09-04', name: 'Glass installation (float / tempered / frosted)' },
      { code: 'WRK-09-05', name: 'Structural glazing and curtain wall installation' },
      { code: 'WRK-09-06', name: 'Rolling shutter and gate erection' },
      { code: 'WRK-09-07', name: 'Jaali and louvre panel fixing' },
    ],
  },
  {
    code: 'WRK-10', name: 'Painting & Finishing Works', type: 'WRK',
    items: [
      { code: 'WRK-10-01', name: 'Interior wall and ceiling painting' },
      { code: 'WRK-10-02', name: 'Exterior painting and weather coating' },
      { code: 'WRK-10-03', name: 'Wood painting, polishing and varnishing' },
      { code: 'WRK-10-04', name: 'Metal and grille painting' },
      { code: 'WRK-10-05', name: 'Texture and designer finish application' },
      { code: 'WRK-10-06', name: 'Epoxy and enamel painting' },
      { code: 'WRK-10-07', name: 'Anti-corrosion and protective coating' },
    ],
  },
  {
    code: 'WRK-11', name: 'Carpentry & Joinery Works', type: 'WRK',
    items: [
      { code: 'WRK-11-01', name: 'Site carpentry (shuttering, temporary works)' },
      { code: 'WRK-11-02', name: 'Finished carpentry (door, window frames)' },
      { code: 'WRK-11-03', name: 'Furniture and cabinet making (on-site)' },
      { code: 'WRK-11-04', name: 'Modular kitchen installation' },
      { code: 'WRK-11-05', name: 'Wardrobe and built-in storage installation' },
      { code: 'WRK-11-06', name: 'Wooden deck and pergola construction' },
      { code: 'WRK-11-07', name: 'TV unit and bookshelf installation' },
    ],
  },
  {
    code: 'WRK-12', name: 'Steel & Metal Fabrication Works', type: 'WRK',
    items: [
      { code: 'WRK-12-01', name: 'Structural steel fabrication and erection' },
      { code: 'WRK-12-02', name: 'MS grille and railing fabrication' },
      { code: 'WRK-12-03', name: 'Staircase fabrication (MS / SS / glass)' },
      { code: 'WRK-12-04', name: 'Aluminium fabrication (windows / partitions)' },
      { code: 'WRK-12-05', name: 'Welding and cutting works' },
      { code: 'WRK-12-06', name: 'Metal cladding and roofing installation' },
      { code: 'WRK-12-07', name: 'GI duct fabrication and installation' },
    ],
  },
  {
    code: 'WRK-13', name: 'Plumbing & Drainage Works', type: 'WRK',
    items: [
      { code: 'WRK-13-01', name: 'Water supply rough-in (concealed piping)' },
      { code: 'WRK-13-02', name: 'Water supply finishing (exposed piping + fittings)' },
      { code: 'WRK-13-03', name: 'Drainage and sewerage piping' },
      { code: 'WRK-13-04', name: 'Rainwater downpipe and gutter installation' },
      { code: 'WRK-13-05', name: 'Water tank installation and connection' },
      { code: 'WRK-13-06', name: 'Pump room installation' },
      { code: 'WRK-13-07', name: 'Manhole and inspection chamber construction' },
      { code: 'WRK-13-08', name: 'STP installation and commissioning' },
      { code: 'WRK-13-09', name: 'Underground drainage network' },
    ],
  },
  {
    code: 'WRK-14', name: 'Sanitaryware & Bathroom Fitting Works', type: 'WRK',
    items: [
      { code: 'WRK-14-01', name: 'WC and wash basin installation' },
      { code: 'WRK-14-02', name: 'Shower, bathtub and enclosure fitting' },
      { code: 'WRK-14-03', name: 'Tap and mixer installation' },
      { code: 'WRK-14-04', name: 'Geyser and water heater installation' },
      { code: 'WRK-14-05', name: 'Bathroom accessories fixing' },
      { code: 'WRK-14-06', name: 'Kitchen sink and tap installation' },
    ],
  },
  {
    code: 'WRK-15', name: 'Electrical Works', type: 'WRK',
    items: [
      { code: 'WRK-15-01', name: 'Conduit laying (concealed)' },
      { code: 'WRK-15-02', name: 'Cable and wire pulling' },
      { code: 'WRK-15-03', name: 'Switch and socket fitting' },
      { code: 'WRK-15-04', name: 'DB and panel board installation' },
      { code: 'WRK-15-05', name: 'Earthing and lightning protection installation' },
      { code: 'WRK-15-06', name: 'DG set installation and commissioning' },
      { code: 'WRK-15-07', name: 'HT / LT panel installation' },
      { code: 'WRK-15-08', name: 'Transformer installation' },
      { code: 'WRK-15-09', name: 'UPS and battery system installation' },
      { code: 'WRK-15-10', name: 'Cable tray installation' },
    ],
  },
  {
    code: 'WRK-16', name: 'Lighting & ELV Works', type: 'WRK',
    items: [
      { code: 'WRK-16-01', name: 'Light fixture installation (indoor)' },
      { code: 'WRK-16-02', name: 'Outdoor and landscape lighting installation' },
      { code: 'WRK-16-03', name: 'CCTV and security system installation' },
      { code: 'WRK-16-04', name: 'Structured cabling and networking' },
      { code: 'WRK-16-05', name: 'Home automation and smart system installation' },
      { code: 'WRK-16-06', name: 'PA and intercom system installation' },
      { code: 'WRK-16-07', name: 'Access control system installation' },
    ],
  },
  {
    code: 'WRK-17', name: 'HVAC & Fire Safety Works', type: 'WRK',
    items: [
      { code: 'WRK-17-01', name: 'Split AC installation' },
      { code: 'WRK-17-02', name: 'VRF / VRV system installation' },
      { code: 'WRK-17-03', name: 'Ducting and ventilation installation' },
      { code: 'WRK-17-04', name: 'Fire alarm system installation' },
      { code: 'WRK-17-05', name: 'Fire sprinkler system installation' },
      { code: 'WRK-17-06', name: 'Fire suppression system commissioning' },
      { code: 'WRK-17-07', name: 'Exhaust and pressurization system installation' },
    ],
  },
  {
    code: 'WRK-18', name: 'Lift, Escalator & Specialist Building Services', type: 'WRK',
    items: [
      { code: 'WRK-18-01', name: 'Lift / elevator installation and commissioning' },
      { code: 'WRK-18-02', name: 'Escalator installation' },
      { code: 'WRK-18-03', name: 'BMS installation and integration' },
      { code: 'WRK-18-04', name: 'Swimming pool construction and commissioning' },
      { code: 'WRK-18-05', name: 'Water feature and fountain construction' },
    ],
  },
  {
    code: 'WRK-19', name: 'Renewable Energy & Utility Works', type: 'WRK',
    items: [
      { code: 'WRK-19-01', name: 'Solar panel installation and commissioning' },
      { code: 'WRK-19-02', name: 'Battery storage system installation' },
      { code: 'WRK-19-03', name: 'Rainwater harvesting system installation' },
      { code: 'WRK-19-04', name: 'STP / ETP plant commissioning' },
      { code: 'WRK-19-05', name: 'EV charging point installation' },
      { code: 'WRK-19-06', name: 'Gas piping installation' },
    ],
  },
  {
    code: 'WRK-20', name: 'External Development & Landscaping Works', type: 'WRK',
    items: [
      { code: 'WRK-20-01', name: 'Compound wall / boundary wall construction' },
      { code: 'WRK-20-02', name: 'Main gate and wicket gate installation' },
      { code: 'WRK-20-03', name: 'Paving and hardscape laying' },
      { code: 'WRK-20-04', name: 'Road and driveway construction' },
      { code: 'WRK-20-05', name: 'Soft landscaping (planting, turf, irrigation)' },
      { code: 'WRK-20-06', name: 'Outdoor furniture and pergola construction' },
      { code: 'WRK-20-07', name: 'Signage and wayfinding installation' },
    ],
  },
  {
    code: 'WRK-21', name: 'Professional & Consultancy Services', type: 'WRK',
    items: [
      { code: 'WRK-21-01', name: 'Architectural design and drawing fees' },
      { code: 'WRK-21-02', name: 'Structural engineering fees' },
      { code: 'WRK-21-03', name: 'MEP consultancy fees' },
      { code: 'WRK-21-04', name: 'Interior design fees' },
      { code: 'WRK-21-05', name: 'Project management consultancy' },
      { code: 'WRK-21-06', name: 'Quantity surveying and estimation' },
      { code: 'WRK-21-07', name: 'Legal and documentation charges' },
      { code: 'WRK-21-08', name: 'Liaisoning and approval charges' },
      { code: 'WRK-21-09', name: 'Labour contractor charges' },
    ],
  },
  {
    code: 'WRK-22', name: 'Site Operations & Overhead Works', type: 'WRK',
    items: [
      { code: 'WRK-22-01', name: 'Security and watchman services' },
      { code: 'WRK-22-02', name: 'Site cleaning and housekeeping' },
      { code: 'WRK-22-03', name: 'Waste disposal and debris removal' },
      { code: 'WRK-22-04', name: 'Material loading, unloading and stacking' },
      { code: 'WRK-22-05', name: 'Crane and hoist operation charges' },
      { code: 'WRK-22-06', name: 'Water tanker supply charges' },
      { code: 'WRK-22-07', name: 'Diesel and fuel for site equipment' },
    ],
  },
  {
    code: 'WRK-23', name: 'Repair, Renovation & Rehabilitation Works', type: 'WRK',
    items: [
      { code: 'WRK-23-01', name: 'Crack repair and grouting' },
      { code: 'WRK-23-02', name: 'Concrete repair and patching' },
      { code: 'WRK-23-03', name: 'Tile removal and re-laying' },
      { code: 'WRK-23-04', name: 'Replastering and resurfacing' },
      { code: 'WRK-23-05', name: 'Structural retrofitting and strengthening' },
      { code: 'WRK-23-06', name: 'Waterproofing redone and repair' },
      { code: 'WRK-23-07', name: 'Electrical rewiring' },
      { code: 'WRK-23-08', name: 'Plumbing repair and re-routing' },
      { code: 'WRK-23-09', name: 'Demolition (partial or full)' },
      { code: 'WRK-23-10', name: 'False ceiling and partition removal and rework' },
    ],
  },
];

// ── TYPE C : GENERAL EXPENSES ───────────────────────────────────────────────────
// Overhead / running-cost heads. A general expense is filed under one of these and
// carries NO payee (stakeholder_id null). GEN-99 is the catch-all fallback.

const GEN: CostCodeDivision = {
  code: 'GEN', name: 'General Expenses', type: 'GEN',
  items: [
    { code: 'GEN-01', name: 'Transport & logistics' },
    { code: 'GEN-02', name: 'Fuel & diesel' },
    { code: 'GEN-03', name: 'Site utilities (power, water, internet)' },
    { code: 'GEN-04', name: 'Tools & consumables' },
    { code: 'GEN-05', name: 'Food & refreshments' },
    { code: 'GEN-06', name: 'Site accommodation & stay' },
    { code: 'GEN-07', name: 'Office & administration' },
    { code: 'GEN-08', name: 'Professional & consultant fees' },
    { code: 'GEN-09', name: 'Government, taxes & statutory fees' },
    { code: 'GEN-10', name: 'Repairs & maintenance' },
    { code: 'GEN-11', name: 'Safety & PPE' },
    { code: 'GEN-12', name: 'Equipment & machinery rental' },
    { code: 'GEN-13', name: 'Bank & finance charges' },
    { code: 'GEN-14', name: 'Medical & first-aid' },
    { code: 'GEN-15', name: 'Security & watchman' },
    { code: 'GEN-16', name: 'Loading & unloading (hamali)' },
    { code: 'GEN-99', name: 'Miscellaneous / uncategorised' },
  ],
};

// ── Exports ────────────────────────────────────────────────────────────────────

// COST_DIVISIONS stays MAT+WRK so the MAT/WRK CostCodePicker and ALL_COST_CODES
// (the candidate list for normal-payment classification) are unchanged. GEN is a
// separate axis used only by the general-expense flow.
export const COST_DIVISIONS: CostCodeDivision[] = [...MAT, ...WRK];

export const MAT_DIVISIONS = MAT;
export const WRK_DIVISIONS = WRK;

/** The general-expense heads (GEN-xx) — the candidate set for expense classification. */
export const GEN_DIVISION = GEN;
export const GEN_HEADS: CostCodeItem[] = GEN.items;
export const GEN_FALLBACK = 'GEN-99';
export const isGenCode = (code: string | null | undefined): boolean => !!code && code.startsWith('GEN-');

/** Flat list of every leaf item */
export const ALL_COST_CODES: CostCodeItem[] = COST_DIVISIONS.flatMap((d) => d.items);

/** Look up an item by its full code (e.g. "MAT-09-04" or "GEN-01") */
export function getCostCode(code: string): {
  division: CostCodeDivision;
  item: CostCodeItem;
} | null {
  for (const div of [...COST_DIVISIONS, GEN]) {
    const item = div.items.find((i) => i.code === code);
    if (item) return { division: div, item };
  }
  return null;
}

/** Human-readable label: "MAT-09-04 · Marble slabs and tiles" */
export function costCodeLabel(code: string): string {
  const found = getCostCode(code);
  if (!found) return code;
  return `${found.item.code} · ${found.item.name}`;
}
