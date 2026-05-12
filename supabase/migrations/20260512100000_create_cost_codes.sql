-- ── cost_codes lookup table ────────────────────────────────────────────────────
-- Stores the exhaustive construction cost code taxonomy.
-- Two top-level types: MAT (Materials) and WRK (Works / Labour / Services)
-- Codes follow the pattern:  TYPE-NN-NN  e.g.  MAT-09-04 / WRK-03-07

CREATE TABLE IF NOT EXISTS public.cost_codes (
  id             SERIAL       PRIMARY KEY,
  code           TEXT         NOT NULL UNIQUE,   -- e.g. 'MAT-09-04'
  type           TEXT         NOT NULL,           -- 'MAT' | 'WRK'
  division_code  TEXT         NOT NULL,           -- e.g. 'MAT-09'
  division_name  TEXT         NOT NULL,           -- e.g. 'Flooring, Tiles & Stone'
  name           TEXT         NOT NULL,           -- e.g. 'Marble slabs and tiles'
  sort_order     INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cost_codes_type         ON public.cost_codes (type);
CREATE INDEX IF NOT EXISTS idx_cost_codes_division     ON public.cost_codes (division_code);

-- ── TYPE A : MATERIALS ─────────────────────────────────────────────────────────

-- MAT-01 · Site Works & Temporary Infrastructure
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-01-01','MAT','MAT-01','Site Works & Temporary Infrastructure','Temporary site fencing and hoarding',101),
  ('MAT-01-02','MAT','MAT-01','Site Works & Temporary Infrastructure','Site office / labour camp materials',102),
  ('MAT-01-03','MAT','MAT-01','Site Works & Temporary Infrastructure','Temporary water supply lines and tanks',103),
  ('MAT-01-04','MAT','MAT-01','Site Works & Temporary Infrastructure','Temporary electrical connections and DB boards',104),
  ('MAT-01-05','MAT','MAT-01','Site Works & Temporary Infrastructure','Scaffolding and staging materials',105),
  ('MAT-01-06','MAT','MAT-01','Site Works & Temporary Infrastructure','Shuttering and formwork (timber/steel/aluminium)',106),
  ('MAT-01-07','MAT','MAT-01','Site Works & Temporary Infrastructure','Curing compounds and curing materials',107),
  ('MAT-01-08','MAT','MAT-01','Site Works & Temporary Infrastructure','Barricade tapes, signage and safety boards',108);

-- MAT-02 · Surveying, Testing & QA/QC
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-02-01','MAT','MAT-02','Surveying, Testing & QA/QC','Survey pegs, profiles and marking materials',201),
  ('MAT-02-02','MAT','MAT-02','Surveying, Testing & QA/QC','Soil testing and boring materials',202),
  ('MAT-02-03','MAT','MAT-02','Surveying, Testing & QA/QC','Concrete cube moulds and testing kits',203),
  ('MAT-02-04','MAT','MAT-02','Surveying, Testing & QA/QC','NDT equipment consumables',204),
  ('MAT-02-05','MAT','MAT-02','Surveying, Testing & QA/QC','Water quality testing kits',205),
  ('MAT-02-06','MAT','MAT-02','Surveying, Testing & QA/QC','Calibration materials and standards',206);

-- MAT-03 · Earthwork, Foundation & Structural Systems
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-03-01','MAT','MAT-03','Earthwork, Foundation & Structural Systems','Lean concrete / PCC materials',301),
  ('MAT-03-02','MAT','MAT-03','Earthwork, Foundation & Structural Systems','Compacted earth fill and GSB material',302),
  ('MAT-03-03','MAT','MAT-03','Earthwork, Foundation & Structural Systems','Geotextile and geomembrane sheets',303),
  ('MAT-03-04','MAT','MAT-03','Earthwork, Foundation & Structural Systems','Sheet piling and retaining wall materials',304),
  ('MAT-03-05','MAT','MAT-03','Earthwork, Foundation & Structural Systems','Micropile and ground anchor materials',305),
  ('MAT-03-06','MAT','MAT-03','Earthwork, Foundation & Structural Systems','Anti-termite treatment chemicals',306),
  ('MAT-03-07','MAT','MAT-03','Earthwork, Foundation & Structural Systems','Raft and pile cap reinforcement materials',307),
  ('MAT-03-08','MAT','MAT-03','Earthwork, Foundation & Structural Systems','Expansion joints and joint fillers',308);

-- MAT-04 · Cement, Concrete & Construction Chemicals
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-04-01','MAT','MAT-04','Cement, Concrete & Construction Chemicals','OPC / PPC / PSC cement (bags/bulk)',401),
  ('MAT-04-02','MAT','MAT-04','Cement, Concrete & Construction Chemicals','Ready Mix Concrete (RMC) — M15 to M50',402),
  ('MAT-04-03','MAT','MAT-04','Cement, Concrete & Construction Chemicals','Concrete admixtures (plasticizer, superplasticizer)',403),
  ('MAT-04-04','MAT','MAT-04','Cement, Concrete & Construction Chemicals','Accelerators and retarders',404),
  ('MAT-04-05','MAT','MAT-04','Cement, Concrete & Construction Chemicals','Fly ash and GGBS',405),
  ('MAT-04-06','MAT','MAT-04','Cement, Concrete & Construction Chemicals','Grout and non-shrink grout',406),
  ('MAT-04-07','MAT','MAT-04','Cement, Concrete & Construction Chemicals','Epoxy and polymer concrete repair compounds',407),
  ('MAT-04-08','MAT','MAT-04','Cement, Concrete & Construction Chemicals','Concrete bonding agents',408);

-- MAT-05 · Aggregates, Masonry & Building Blocks
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-05-01','MAT','MAT-05','Aggregates, Masonry & Building Blocks','River sand / M-sand (fine aggregate)',501),
  ('MAT-05-02','MAT','MAT-05','Aggregates, Masonry & Building Blocks','Coarse aggregate (6mm / 12mm / 20mm / 40mm)',502),
  ('MAT-05-03','MAT','MAT-05','Aggregates, Masonry & Building Blocks','Quarry dust and crushed stone powder',503),
  ('MAT-05-04','MAT','MAT-05','Aggregates, Masonry & Building Blocks','Red clay bricks (first class / second class)',504),
  ('MAT-05-05','MAT','MAT-05','Aggregates, Masonry & Building Blocks','Fly ash bricks / cement bricks',505),
  ('MAT-05-06','MAT','MAT-05','Aggregates, Masonry & Building Blocks','AAC (Autoclaved Aerated Concrete) blocks',506),
  ('MAT-05-07','MAT','MAT-05','Aggregates, Masonry & Building Blocks','Concrete hollow blocks and solid blocks',507),
  ('MAT-05-08','MAT','MAT-05','Aggregates, Masonry & Building Blocks','Natural stone (granite, limestone, sandstone) for masonry',508),
  ('MAT-05-09','MAT','MAT-05','Aggregates, Masonry & Building Blocks','Mortar and ready-mix masonry compounds',509);

-- MAT-06 · Steel, Metal & Fabrication Materials
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-06-01','MAT','MAT-06','Steel, Metal & Fabrication Materials','TMT steel bars (Fe415 / Fe500 / Fe550)',601),
  ('MAT-06-02','MAT','MAT-06','Steel, Metal & Fabrication Materials','Structural steel sections (I / H / C / angle)',602),
  ('MAT-06-03','MAT','MAT-06','Steel, Metal & Fabrication Materials','GI pipes and hollow sections',603),
  ('MAT-06-04','MAT','MAT-06','Steel, Metal & Fabrication Materials','Mild steel plates and sheets',604),
  ('MAT-06-05','MAT','MAT-06','Steel, Metal & Fabrication Materials','Stainless steel sheets, pipes and fittings',605),
  ('MAT-06-06','MAT','MAT-06','Steel, Metal & Fabrication Materials','Aluminium sections and extrusions',606),
  ('MAT-06-07','MAT','MAT-06','Steel, Metal & Fabrication Materials','Welding electrodes, rods and gases',607),
  ('MAT-06-08','MAT','MAT-06','Steel, Metal & Fabrication Materials','Metal mesh, expanded metal and perforated sheets',608),
  ('MAT-06-09','MAT','MAT-06','Steel, Metal & Fabrication Materials','Steel gratings and chequered plates',609),
  ('MAT-06-10','MAT','MAT-06','Steel, Metal & Fabrication Materials','Pre-engineered building (PEB) components',610);

-- MAT-07 · Roofing, Cladding & Insulation Systems
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-07-01','MAT','MAT-07','Roofing, Cladding & Insulation Systems','RCC roof slab materials',701),
  ('MAT-07-02','MAT','MAT-07','Roofing, Cladding & Insulation Systems','GI / colour-coated roofing sheets',702),
  ('MAT-07-03','MAT','MAT-07','Roofing, Cladding & Insulation Systems','Polycarbonate and FRP sheets',703),
  ('MAT-07-04','MAT','MAT-07','Roofing, Cladding & Insulation Systems','Clay / concrete / terracotta roof tiles',704),
  ('MAT-07-05','MAT','MAT-07','Roofing, Cladding & Insulation Systems','Roof insulation (glass wool / rock wool / XPS)',705),
  ('MAT-07-06','MAT','MAT-07','Roofing, Cladding & Insulation Systems','Facade cladding panels (ACP / HPL / stone)',706),
  ('MAT-07-07','MAT','MAT-07','Roofing, Cladding & Insulation Systems','Roof waterproofing membrane and screed',707),
  ('MAT-07-08','MAT','MAT-07','Roofing, Cladding & Insulation Systems','Skylights and roof lanterns',708),
  ('MAT-07-09','MAT','MAT-07','Roofing, Cladding & Insulation Systems','Wall insulation boards and cavity fill',709);

-- MAT-08 · Waterproofing, Sealants & Protective Systems
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-08-01','MAT','MAT-08','Waterproofing, Sealants & Protective Systems','APP / SBS bituminous waterproofing membranes',801),
  ('MAT-08-02','MAT','MAT-08','Waterproofing, Sealants & Protective Systems','Crystalline waterproofing compounds',802),
  ('MAT-08-03','MAT','MAT-08','Waterproofing, Sealants & Protective Systems','Liquid applied waterproofing coatings',803),
  ('MAT-08-04','MAT','MAT-08','Waterproofing, Sealants & Protective Systems','Polyurethane and epoxy waterproofing',804),
  ('MAT-08-05','MAT','MAT-08','Waterproofing, Sealants & Protective Systems','Silicone and polyurethane sealants',805),
  ('MAT-08-06','MAT','MAT-08','Waterproofing, Sealants & Protective Systems','Expansion joint sealing systems',806),
  ('MAT-08-07','MAT','MAT-08','Waterproofing, Sealants & Protective Systems','Basement tanking materials',807),
  ('MAT-08-08','MAT','MAT-08','Waterproofing, Sealants & Protective Systems','Terrace and bathroom waterproofing systems',808),
  ('MAT-08-09','MAT','MAT-08','Waterproofing, Sealants & Protective Systems','Damp proof course (DPC) materials',809);

-- MAT-09 · Flooring, Tiles & Stone
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-09-01','MAT','MAT-09','Flooring, Tiles & Stone','Ceramic floor tiles (glazed / unglazed)',901),
  ('MAT-09-02','MAT','MAT-09','Flooring, Tiles & Stone','Vitrified tiles (double charge / GVT / PGVT)',902),
  ('MAT-09-03','MAT','MAT-09','Flooring, Tiles & Stone','Polished porcelain and full body tiles',903),
  ('MAT-09-04','MAT','MAT-09','Flooring, Tiles & Stone','Marble slabs and tiles',904),
  ('MAT-09-05','MAT','MAT-09','Flooring, Tiles & Stone','Granite slabs and tiles',905),
  ('MAT-09-06','MAT','MAT-09','Flooring, Tiles & Stone','Kota stone and natural stone flooring',906),
  ('MAT-09-07','MAT','MAT-09','Flooring, Tiles & Stone','Engineered wood and laminate flooring',907),
  ('MAT-09-08','MAT','MAT-09','Flooring, Tiles & Stone','Vinyl and LVT flooring',908),
  ('MAT-09-09','MAT','MAT-09','Flooring, Tiles & Stone','Epoxy and PU floor coatings',909),
  ('MAT-09-10','MAT','MAT-09','Flooring, Tiles & Stone','Anti-skid tiles and industrial flooring',910),
  ('MAT-09-11','MAT','MAT-09','Flooring, Tiles & Stone','Tile adhesive, grout and tile spacers',911),
  ('MAT-09-12','MAT','MAT-09','Flooring, Tiles & Stone','Skirting and stair nosing',912);

-- MAT-10 · Wall Finishes, Ceiling & Partition Systems
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-10-01','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','Gypsum plaster and ready-mix plaster',1001),
  ('MAT-10-02','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','Cement plaster and S/F mortar',1002),
  ('MAT-10-03','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','Wall cladding tiles (ceramic / stone / designer)',1003),
  ('MAT-10-04','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','Gypsum board and plasterboard',1004),
  ('MAT-10-05','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','Grid ceiling tiles (mineral fibre / metal)',1005),
  ('MAT-10-06','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','GI framework for false ceiling and partition',1006),
  ('MAT-10-07','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','Calcium silicate boards and fire-rated boards',1007),
  ('MAT-10-08','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','Decorative panels (PU / WPC / 3D wall panels)',1008),
  ('MAT-10-09','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','Wallpaper and wall fabric',1009),
  ('MAT-10-10','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','Glass partition systems and movable walls',1010),
  ('MAT-10-11','MAT','MAT-10','Wall Finishes, Ceiling & Partition Systems','Cornices, mouldings and ceiling medallions',1011);

-- MAT-11 · Paints, Coatings & Surface Treatments
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-11-01','MAT','MAT-11','Paints, Coatings & Surface Treatments','Interior emulsion paint (economy / premium)',1101),
  ('MAT-11-02','MAT','MAT-11','Paints, Coatings & Surface Treatments','Exterior weatherproof paint',1102),
  ('MAT-11-03','MAT','MAT-11','Paints, Coatings & Surface Treatments','Enamel and oil-based paint',1103),
  ('MAT-11-04','MAT','MAT-11','Paints, Coatings & Surface Treatments','Distemper and lime wash',1104),
  ('MAT-11-05','MAT','MAT-11','Paints, Coatings & Surface Treatments','Texture paint and designer finishes',1105),
  ('MAT-11-06','MAT','MAT-11','Paints, Coatings & Surface Treatments','Wood primer, stain and polish',1106),
  ('MAT-11-07','MAT','MAT-11','Paints, Coatings & Surface Treatments','Metal primer and anti-corrosion paint',1107),
  ('MAT-11-08','MAT','MAT-11','Paints, Coatings & Surface Treatments','Putty and wall primer',1108),
  ('MAT-11-09','MAT','MAT-11','Paints, Coatings & Surface Treatments','Epoxy paint and floor coatings',1109),
  ('MAT-11-10','MAT','MAT-11','Paints, Coatings & Surface Treatments','Waterproof paint and damp shield',1110),
  ('MAT-11-11','MAT','MAT-11','Paints, Coatings & Surface Treatments','Varnish, lacquer and clear coat',1111);

-- MAT-12 · Doors, Windows, Glass & Facade Systems
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-12-01','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Solid wood doors and frames',1201),
  ('MAT-12-02','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Flush doors (commercial / membrane / laminated)',1202),
  ('MAT-12-03','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Steel and security doors',1203),
  ('MAT-12-04','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','UPVC doors and windows',1204),
  ('MAT-12-05','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Aluminium doors, windows and sliding systems',1205),
  ('MAT-12-06','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Wooden windows and ventilators',1206),
  ('MAT-12-07','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Clear / tinted / frosted float glass',1207),
  ('MAT-12-08','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Tempered and laminated safety glass',1208),
  ('MAT-12-09','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Double glazed units (DGU)',1209),
  ('MAT-12-10','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Structural glazing and curtain wall systems',1210),
  ('MAT-12-11','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Jaali, louvres and pergola systems',1211),
  ('MAT-12-12','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Rolling shutters and collapsible gates',1212),
  ('MAT-12-13','MAT','MAT-12','Doors, Windows, Glass & Facade Systems','Compound wall gates (swing / sliding)',1213);

-- MAT-13 · Hardware, Fasteners & Fixing Systems
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-13-01','MAT','MAT-13','Hardware, Fasteners & Fixing Systems','Door hardware (handles, hinges, locks, closers)',1301),
  ('MAT-13-02','MAT','MAT-13','Hardware, Fasteners & Fixing Systems','Window hardware (stays, latches, friction stays)',1302),
  ('MAT-13-03','MAT','MAT-13','Hardware, Fasteners & Fixing Systems','Cabinet hardware (channels, hinges, handles)',1303),
  ('MAT-13-04','MAT','MAT-13','Hardware, Fasteners & Fixing Systems','Anchor bolts and chemical anchors',1304),
  ('MAT-13-05','MAT','MAT-13','Hardware, Fasteners & Fixing Systems','Nuts, bolts, screws and washers',1305),
  ('MAT-13-06','MAT','MAT-13','Hardware, Fasteners & Fixing Systems','Nails and staples',1306),
  ('MAT-13-07','MAT','MAT-13','Hardware, Fasteners & Fixing Systems','Construction adhesives and fixatives',1307),
  ('MAT-13-08','MAT','MAT-13','Hardware, Fasteners & Fixing Systems','Rawl plugs and wall anchors',1308),
  ('MAT-13-09','MAT','MAT-13','Hardware, Fasteners & Fixing Systems','Wire rope and turnbuckles',1309);

-- MAT-14 · Plumbing, Drainage & Water Management
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-14-01','MAT','MAT-14','Plumbing, Drainage & Water Management','CPVC / UPVC pipes and fittings (hot & cold water)',1401),
  ('MAT-14-02','MAT','MAT-14','Plumbing, Drainage & Water Management','GI pipes and fittings (water supply)',1402),
  ('MAT-14-03','MAT','MAT-14','Plumbing, Drainage & Water Management','PVC drainage pipes and fittings (SWR)',1403),
  ('MAT-14-04','MAT','MAT-14','Plumbing, Drainage & Water Management','HDPE pipes (water supply / drainage / underground)',1404),
  ('MAT-14-05','MAT','MAT-14','Plumbing, Drainage & Water Management','CI / DI pipes (drainage and sewerage)',1405),
  ('MAT-14-06','MAT','MAT-14','Plumbing, Drainage & Water Management','Water storage tanks (HDPE / FRP / RCC)',1406),
  ('MAT-14-07','MAT','MAT-14','Plumbing, Drainage & Water Management','Water pumps (domestic / submersible / booster)',1407),
  ('MAT-14-08','MAT','MAT-14','Plumbing, Drainage & Water Management','Valves, stopcocks and ball valves',1408),
  ('MAT-14-09','MAT','MAT-14','Plumbing, Drainage & Water Management','Water meters and pressure gauges',1409),
  ('MAT-14-10','MAT','MAT-14','Plumbing, Drainage & Water Management','STP and ETP components',1410),
  ('MAT-14-11','MAT','MAT-14','Plumbing, Drainage & Water Management','Rainwater harvesting systems',1411),
  ('MAT-14-12','MAT','MAT-14','Plumbing, Drainage & Water Management','Manhole covers and chamber materials',1412),
  ('MAT-14-13','MAT','MAT-14','Plumbing, Drainage & Water Management','Grease traps and inspection chambers',1413);

-- MAT-15 · Sanitaryware, Bathroom & Kitchen Systems
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-15-01','MAT','MAT-15','Sanitaryware, Bathroom & Kitchen Systems','WC / EWC (wall-hung / floor-mounted)',1501),
  ('MAT-15-02','MAT','MAT-15','Sanitaryware, Bathroom & Kitchen Systems','Wash basins and pedestals',1502),
  ('MAT-15-03','MAT','MAT-15','Sanitaryware, Bathroom & Kitchen Systems','Bathroom fittings (taps, mixers, showers)',1503),
  ('MAT-15-04','MAT','MAT-15','Sanitaryware, Bathroom & Kitchen Systems','Bathtubs and shower enclosures',1504),
  ('MAT-15-05','MAT','MAT-15','Sanitaryware, Bathroom & Kitchen Systems','Bathroom accessories (towel bars, soap holders)',1505),
  ('MAT-15-06','MAT','MAT-15','Sanitaryware, Bathroom & Kitchen Systems','Kitchen sinks (SS / granite / ceramic)',1506),
  ('MAT-15-07','MAT','MAT-15','Sanitaryware, Bathroom & Kitchen Systems','Kitchen taps and sink mixers',1507),
  ('MAT-15-08','MAT','MAT-15','Sanitaryware, Bathroom & Kitchen Systems','Water heaters (geyser / heat pump / solar)',1508),
  ('MAT-15-09','MAT','MAT-15','Sanitaryware, Bathroom & Kitchen Systems','Mirror and medicine cabinets',1509),
  ('MAT-15-10','MAT','MAT-15','Sanitaryware, Bathroom & Kitchen Systems','Modular kitchen materials (carcass, shutters, countertop)',1510);

-- MAT-16 · Electrical Systems
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-16-01','MAT','MAT-16','Electrical Systems','Cables and wires (FR / FRLS / XLPE)',1601),
  ('MAT-16-02','MAT','MAT-16','Electrical Systems','Conduit pipes and accessories (PVC / GI)',1602),
  ('MAT-16-03','MAT','MAT-16','Electrical Systems','Switch boxes, junction boxes and enclosures',1603),
  ('MAT-16-04','MAT','MAT-16','Electrical Systems','Switches and sockets (modular)',1604),
  ('MAT-16-05','MAT','MAT-16','Electrical Systems','MCBs, ELCBs and RCCBs',1605),
  ('MAT-16-06','MAT','MAT-16','Electrical Systems','Distribution boards and consumer units',1606),
  ('MAT-16-07','MAT','MAT-16','Electrical Systems','Main LT panels and bus ducts',1607),
  ('MAT-16-08','MAT','MAT-16','Electrical Systems','Earthing materials (plates, pipes, chemicals)',1608),
  ('MAT-16-09','MAT','MAT-16','Electrical Systems','Lightning arrestors and surge protectors',1609),
  ('MAT-16-10','MAT','MAT-16','Electrical Systems','Transformers and HT panels',1610),
  ('MAT-16-11','MAT','MAT-16','Electrical Systems','Diesel generators and AMF panels',1611),
  ('MAT-16-12','MAT','MAT-16','Electrical Systems','UPS and battery backup systems',1612),
  ('MAT-16-13','MAT','MAT-16','Electrical Systems','Cable trays and cable management',1613);

-- MAT-17 · Lighting, ELV & Smart Automation
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-17-01','MAT','MAT-17','Lighting, ELV & Smart Automation','LED lights (panel / downlight / strip / spotlight)',1701),
  ('MAT-17-02','MAT','MAT-17','Lighting, ELV & Smart Automation','Decorative and designer light fixtures',1702),
  ('MAT-17-03','MAT','MAT-17','Lighting, ELV & Smart Automation','Outdoor and landscape lighting',1703),
  ('MAT-17-04','MAT','MAT-17','Lighting, ELV & Smart Automation','Emergency and exit lighting',1704),
  ('MAT-17-05','MAT','MAT-17','Lighting, ELV & Smart Automation','CCTV cameras and NVR systems',1705),
  ('MAT-17-06','MAT','MAT-17','Lighting, ELV & Smart Automation','Video door phones and access control',1706),
  ('MAT-17-07','MAT','MAT-17','Lighting, ELV & Smart Automation','Structured cabling (CAT6 / fibre optic)',1707),
  ('MAT-17-08','MAT','MAT-17','Lighting, ELV & Smart Automation','PA / intercom systems',1708),
  ('MAT-17-09','MAT','MAT-17','Lighting, ELV & Smart Automation','Home automation and smart switches',1709),
  ('MAT-17-10','MAT','MAT-17','Lighting, ELV & Smart Automation','DTH and networking equipment',1710);

-- MAT-18 · HVAC, Fire Safety & Building Services
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-18-01','MAT','MAT-18','HVAC, Fire Safety & Building Services','Split ACs and VRF / VRV systems',1801),
  ('MAT-18-02','MAT','MAT-18','HVAC, Fire Safety & Building Services','Ducting materials (GI / flexible)',1802),
  ('MAT-18-03','MAT','MAT-18','HVAC, Fire Safety & Building Services','Exhaust fans and ventilation systems',1803),
  ('MAT-18-04','MAT','MAT-18','HVAC, Fire Safety & Building Services','Fire alarm panels and detectors',1804),
  ('MAT-18-05','MAT','MAT-18','HVAC, Fire Safety & Building Services','Fire sprinkler systems and pipes',1805),
  ('MAT-18-06','MAT','MAT-18','HVAC, Fire Safety & Building Services','Fire extinguishers and suppression systems',1806),
  ('MAT-18-07','MAT','MAT-18','HVAC, Fire Safety & Building Services','Smoke detectors and heat detectors',1807),
  ('MAT-18-08','MAT','MAT-18','HVAC, Fire Safety & Building Services','Lifts and elevators (materials / components)',1808),
  ('MAT-18-09','MAT','MAT-18','HVAC, Fire Safety & Building Services','Escalators and moving walkways',1809),
  ('MAT-18-10','MAT','MAT-18','HVAC, Fire Safety & Building Services','BMS (Building Management System) components',1810);

-- MAT-19 · Renewable Energy & Utility Infrastructure
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-19-01','MAT','MAT-19','Renewable Energy & Utility Infrastructure','Solar PV panels and inverters',1901),
  ('MAT-19-02','MAT','MAT-19','Renewable Energy & Utility Infrastructure','Solar mounting structures',1902),
  ('MAT-19-03','MAT','MAT-19','Renewable Energy & Utility Infrastructure','Battery storage systems (lithium / lead acid)',1903),
  ('MAT-19-04','MAT','MAT-19','Renewable Energy & Utility Infrastructure','Rainwater harvesting tanks and filters',1904),
  ('MAT-19-05','MAT','MAT-19','Renewable Energy & Utility Infrastructure','STP plant materials and bio media',1905),
  ('MAT-19-06','MAT','MAT-19','Renewable Energy & Utility Infrastructure','Gas piping systems (PNG / LPG)',1906),
  ('MAT-19-07','MAT','MAT-19','Renewable Energy & Utility Infrastructure','EV charging points and infrastructure',1907);

-- MAT-20 · Exterior Development, Roads & Landscaping
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-20-01','MAT','MAT-20','Exterior Development, Roads & Landscaping','Paving blocks and kerb stones',2001),
  ('MAT-20-02','MAT','MAT-20','Exterior Development, Roads & Landscaping','Bitumen and asphalt materials',2002),
  ('MAT-20-03','MAT','MAT-20','Exterior Development, Roads & Landscaping','Compound wall / boundary wall materials',2003),
  ('MAT-20-04','MAT','MAT-20','Exterior Development, Roads & Landscaping','Fencing (chain link / MS / GI)',2004),
  ('MAT-20-05','MAT','MAT-20','Exterior Development, Roads & Landscaping','Landscaping soil, mulch and compost',2005),
  ('MAT-20-06','MAT','MAT-20','Exterior Development, Roads & Landscaping','Plants, turf and irrigation materials',2006),
  ('MAT-20-07','MAT','MAT-20','Exterior Development, Roads & Landscaping','Outdoor furniture and pergola materials',2007),
  ('MAT-20-08','MAT','MAT-20','Exterior Development, Roads & Landscaping','Swimming pool materials and equipment',2008),
  ('MAT-20-09','MAT','MAT-20','Exterior Development, Roads & Landscaping','Car parking materials (sensors, markings)',2009),
  ('MAT-20-10','MAT','MAT-20','Exterior Development, Roads & Landscaping','Outdoor signage and wayfinding',2010);

-- MAT-21 · Furniture, Interior Fitouts & Architectural Elements
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-21-01','MAT','MAT-21','Furniture, Interior Fitouts & Architectural Elements','Loose furniture (sofas, beds, tables, chairs)',2101),
  ('MAT-21-02','MAT','MAT-21','Furniture, Interior Fitouts & Architectural Elements','Built-in joinery (TV unit, bookshelves)',2102),
  ('MAT-21-03','MAT','MAT-21','Furniture, Interior Fitouts & Architectural Elements','Curtains, blinds and upholstery',2103),
  ('MAT-21-04','MAT','MAT-21','Furniture, Interior Fitouts & Architectural Elements','Decorative elements (artifacts, rugs, plants)',2104),
  ('MAT-21-05','MAT','MAT-21','Furniture, Interior Fitouts & Architectural Elements','Stair railings (SS / MS / glass / wood)',2105),
  ('MAT-21-06','MAT','MAT-21','Furniture, Interior Fitouts & Architectural Elements','Balcony railings and balustrades',2106),
  ('MAT-21-07','MAT','MAT-21','Furniture, Interior Fitouts & Architectural Elements','Feature walls and accent elements',2107),
  ('MAT-21-08','MAT','MAT-21','Furniture, Interior Fitouts & Architectural Elements','Artwork, murals and bespoke installations',2108);

-- MAT-22 · Industrial, Prefabricated & Specialized Construction
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-22-01','MAT','MAT-22','Industrial, Prefabricated & Specialized Construction','Precast concrete elements (beams, slabs, walls)',2201),
  ('MAT-22-02','MAT','MAT-22','Industrial, Prefabricated & Specialized Construction','PEB (Pre-Engineered Building) structure',2202),
  ('MAT-22-03','MAT','MAT-22','Industrial, Prefabricated & Specialized Construction','Modular and portable cabin materials',2203),
  ('MAT-22-04','MAT','MAT-22','Industrial, Prefabricated & Specialized Construction','Industrial flooring (epoxy / PU / hardener)',2204),
  ('MAT-22-05','MAT','MAT-22','Industrial, Prefabricated & Specialized Construction','Mezzanine floor materials',2205),
  ('MAT-22-06','MAT','MAT-22','Industrial, Prefabricated & Specialized Construction','Cold storage and cleanroom materials',2206),
  ('MAT-22-07','MAT','MAT-22','Industrial, Prefabricated & Specialized Construction','Blast-resistant and fire-rated materials',2207);

-- MAT-23 · Tools, Equipment & Material Handling
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-23-01','MAT','MAT-23','Tools, Equipment & Material Handling','Hand tools (trowels, hammers, levels)',2301),
  ('MAT-23-02','MAT','MAT-23','Tools, Equipment & Material Handling','Power tools (drills, grinders, saws)',2302),
  ('MAT-23-03','MAT','MAT-23','Tools, Equipment & Material Handling','Construction equipment hire (JCB, crane, transit mixer)',2303),
  ('MAT-23-04','MAT','MAT-23','Tools, Equipment & Material Handling','Scaffolding hire',2304),
  ('MAT-23-05','MAT','MAT-23','Tools, Equipment & Material Handling','Material hoists and tower cranes',2305),
  ('MAT-23-06','MAT','MAT-23','Tools, Equipment & Material Handling','Concrete mixers and vibrators',2306),
  ('MAT-23-07','MAT','MAT-23','Tools, Equipment & Material Handling','Welding machines and gas cutting sets',2307),
  ('MAT-23-08','MAT','MAT-23','Tools, Equipment & Material Handling','Survey instruments (total station, level)',2308);

-- MAT-24 · Safety, Security & Site Protection
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-24-01','MAT','MAT-24','Safety, Security & Site Protection','Helmets, gloves, safety shoes and PPE',2401),
  ('MAT-24-02','MAT','MAT-24','Safety, Security & Site Protection','Safety nets and fall arrest systems',2402),
  ('MAT-24-03','MAT','MAT-24','Safety, Security & Site Protection','First aid kits and medical supplies',2403),
  ('MAT-24-04','MAT','MAT-24','Safety, Security & Site Protection','Fire blankets and extinguishers (site)',2404),
  ('MAT-24-05','MAT','MAT-24','Safety, Security & Site Protection','Site security cameras and alarms',2405),
  ('MAT-24-06','MAT','MAT-24','Safety, Security & Site Protection','Dust and noise control materials',2406),
  ('MAT-24-07','MAT','MAT-24','Safety, Security & Site Protection','Reflective vests and site clothing',2407);

-- MAT-25 · Repair, Maintenance & Rehabilitation
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('MAT-25-01','MAT','MAT-25','Repair, Maintenance & Rehabilitation','Crack repair materials (epoxy injection, sealants)',2501),
  ('MAT-25-02','MAT','MAT-25','Repair, Maintenance & Rehabilitation','Concrete repair mortars',2502),
  ('MAT-25-03','MAT','MAT-25','Repair, Maintenance & Rehabilitation','Corrosion inhibitors and rust converters',2503),
  ('MAT-25-04','MAT','MAT-25','Repair, Maintenance & Rehabilitation','Retrofitting and strengthening materials',2504),
  ('MAT-25-05','MAT','MAT-25','Repair, Maintenance & Rehabilitation','Demolition and breaking materials',2505),
  ('MAT-25-06','MAT','MAT-25','Repair, Maintenance & Rehabilitation','Waterproofing repair systems',2506),
  ('MAT-25-07','MAT','MAT-25','Repair, Maintenance & Rehabilitation','Regrouting and tile repair materials',2507),
  ('MAT-25-08','MAT','MAT-25','Repair, Maintenance & Rehabilitation','Plumbing repair fittings and spares',2508),
  ('MAT-25-09','MAT','MAT-25','Repair, Maintenance & Rehabilitation','Electrical repair spares',2509);

-- ── TYPE B : WORKS ─────────────────────────────────────────────────────────────

-- WRK-01 · Site Preparation & Enabling Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-01-01','WRK','WRK-01','Site Preparation & Enabling Works','Site clearing and demolition of existing structures',10101),
  ('WRK-01-02','WRK','WRK-01','Site Preparation & Enabling Works','Tree removal and stump extraction',10102),
  ('WRK-01-03','WRK','WRK-01','Site Preparation & Enabling Works','Temporary access road and site entry construction',10103),
  ('WRK-01-04','WRK','WRK-01','Site Preparation & Enabling Works','Site office and labour camp setup',10104),
  ('WRK-01-05','WRK','WRK-01','Site Preparation & Enabling Works','Hoarding, fencing and barricading',10105),
  ('WRK-01-06','WRK','WRK-01','Site Preparation & Enabling Works','Temporary power and water connection work',10106),
  ('WRK-01-07','WRK','WRK-01','Site Preparation & Enabling Works','Site survey and setting out',10107),
  ('WRK-01-08','WRK','WRK-01','Site Preparation & Enabling Works','Soil investigation and bore log',10108);

-- WRK-02 · Earthwork & Substructure
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-02-01','WRK','WRK-02','Earthwork & Substructure','Excavation (manual and machine)',10201),
  ('WRK-02-02','WRK','WRK-02','Earthwork & Substructure','Earth filling, grading and compaction',10202),
  ('WRK-02-03','WRK','WRK-02','Earthwork & Substructure','Dewatering and pumping',10203),
  ('WRK-02-04','WRK','WRK-02','Earthwork & Substructure','Anti-termite soil treatment',10204),
  ('WRK-02-05','WRK','WRK-02','Earthwork & Substructure','PCC (Plain Cement Concrete) laying',10205),
  ('WRK-02-06','WRK','WRK-02','Earthwork & Substructure','Pile foundation work',10206),
  ('WRK-02-07','WRK','WRK-02','Earthwork & Substructure','Raft / isolated / combined footing construction',10207),
  ('WRK-02-08','WRK','WRK-02','Earthwork & Substructure','Retaining wall construction',10208),
  ('WRK-02-09','WRK','WRK-02','Earthwork & Substructure','Basement construction and tanking',10209);

-- WRK-03 · RCC Structural Work
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-03-01','WRK','WRK-03','RCC Structural Work','Reinforcement bar bending and binding',10301),
  ('WRK-03-02','WRK','WRK-03','RCC Structural Work','Shuttering and formwork (erection and striking)',10302),
  ('WRK-03-03','WRK','WRK-03','RCC Structural Work','Concrete mixing and pouring (manual)',10303),
  ('WRK-03-04','WRK','WRK-03','RCC Structural Work','RMC placement and compaction',10304),
  ('WRK-03-05','WRK','WRK-03','RCC Structural Work','Concrete curing',10305),
  ('WRK-03-06','WRK','WRK-03','RCC Structural Work','Columns and shear wall casting',10306),
  ('WRK-03-07','WRK','WRK-03','RCC Structural Work','Beams and slab casting',10307),
  ('WRK-03-08','WRK','WRK-03','RCC Structural Work','Staircase construction',10308),
  ('WRK-03-09','WRK','WRK-03','RCC Structural Work','Lift pit and core wall construction',10309),
  ('WRK-03-10','WRK','WRK-03','RCC Structural Work','Precast element erection',10310);

-- WRK-04 · Masonry & Block Work
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-04-01','WRK','WRK-04','Masonry & Block Work','Brick masonry (load-bearing and partition walls)',10401),
  ('WRK-04-02','WRK','WRK-04','Masonry & Block Work','AAC / fly ash / hollow block masonry',10402),
  ('WRK-04-03','WRK','WRK-04','Masonry & Block Work','Stone masonry (rubble / coursed / ashlar)',10403),
  ('WRK-04-04','WRK','WRK-04','Masonry & Block Work','Lintel and band beam laying',10404),
  ('WRK-04-05','WRK','WRK-04','Masonry & Block Work','Parapet and compound wall masonry',10405),
  ('WRK-04-06','WRK','WRK-04','Masonry & Block Work','Arch construction',10406);

-- WRK-05 · Waterproofing Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-05-01','WRK','WRK-05','Waterproofing Works','Terrace / roof waterproofing',10501),
  ('WRK-05-02','WRK','WRK-05','Waterproofing Works','Bathroom and wet area waterproofing',10502),
  ('WRK-05-03','WRK','WRK-05','Waterproofing Works','Basement and below-grade waterproofing',10503),
  ('WRK-05-04','WRK','WRK-05','Waterproofing Works','External wall anti-carbonation coating',10504),
  ('WRK-05-05','WRK','WRK-05','Waterproofing Works','Swimming pool waterproofing',10505),
  ('WRK-05-06','WRK','WRK-05','Waterproofing Works','Water tank waterproofing (internal)',10506),
  ('WRK-05-07','WRK','WRK-05','Waterproofing Works','Expansion joint sealing work',10507);

-- WRK-06 · Plastering & Surface Preparation
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-06-01','WRK','WRK-06','Plastering & Surface Preparation','Internal wall plastering (cement / gypsum)',10601),
  ('WRK-06-02','WRK','WRK-06','Plastering & Surface Preparation','External wall plastering and rendering',10602),
  ('WRK-06-03','WRK','WRK-06','Plastering & Surface Preparation','Ceiling plastering',10603),
  ('WRK-06-04','WRK','WRK-06','Plastering & Surface Preparation','Wall putty and skim coat application',10604),
  ('WRK-06-05','WRK','WRK-06','Plastering & Surface Preparation','Surface preparation for painting (sanding, priming)',10605),
  ('WRK-06-06','WRK','WRK-06','Plastering & Surface Preparation','Textured and decorative plaster application',10606),
  ('WRK-06-07','WRK','WRK-06','Plastering & Surface Preparation','Grouting and pointing',10607);

-- WRK-07 · Flooring & Tiling Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-07-01','WRK','WRK-07','Flooring & Tiling Works','Ceramic and vitrified tile laying (floor)',10701),
  ('WRK-07-02','WRK','WRK-07','Flooring & Tiling Works','Wall tile fixing (bathroom, kitchen, elevation)',10702),
  ('WRK-07-03','WRK','WRK-07','Flooring & Tiling Works','Marble and granite fixing (floor and stairs)',10703),
  ('WRK-07-04','WRK','WRK-07','Flooring & Tiling Works','Kota stone and natural stone laying',10704),
  ('WRK-07-05','WRK','WRK-07','Flooring & Tiling Works','Wooden and laminate flooring installation',10705),
  ('WRK-07-06','WRK','WRK-07','Flooring & Tiling Works','Vinyl and LVT flooring laying',10706),
  ('WRK-07-07','WRK','WRK-07','Flooring & Tiling Works','Epoxy and PU flooring application',10707),
  ('WRK-07-08','WRK','WRK-07','Flooring & Tiling Works','Tile grouting and finishing',10708),
  ('WRK-07-09','WRK','WRK-07','Flooring & Tiling Works','Skirting and stair nosing fixing',10709);

-- WRK-08 · False Ceiling & Partition Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-08-01','WRK','WRK-08','False Ceiling & Partition Works','Gypsum board false ceiling',10801),
  ('WRK-08-02','WRK','WRK-08','False Ceiling & Partition Works','Grid / modular ceiling installation',10802),
  ('WRK-08-03','WRK','WRK-08','False Ceiling & Partition Works','Wooden and metal ceiling systems',10803),
  ('WRK-08-04','WRK','WRK-08','False Ceiling & Partition Works','Gypsum / glass partition wall',10804),
  ('WRK-08-05','WRK','WRK-08','False Ceiling & Partition Works','Movable partition systems',10805),
  ('WRK-08-06','WRK','WRK-08','False Ceiling & Partition Works','Cornice and moulding installation',10806);

-- WRK-09 · Doors, Windows & Glazing Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-09-01','WRK','WRK-09','Doors, Windows & Glazing Works','Door frame fixing and door hanging',10901),
  ('WRK-09-02','WRK','WRK-09','Doors, Windows & Glazing Works','UPVC door and window installation',10902),
  ('WRK-09-03','WRK','WRK-09','Doors, Windows & Glazing Works','Aluminium door / window / sliding system fitting',10903),
  ('WRK-09-04','WRK','WRK-09','Doors, Windows & Glazing Works','Glass installation (float / tempered / frosted)',10904),
  ('WRK-09-05','WRK','WRK-09','Doors, Windows & Glazing Works','Structural glazing and curtain wall installation',10905),
  ('WRK-09-06','WRK','WRK-09','Doors, Windows & Glazing Works','Rolling shutter and gate erection',10906),
  ('WRK-09-07','WRK','WRK-09','Doors, Windows & Glazing Works','Jaali and louvre panel fixing',10907);

-- WRK-10 · Painting & Finishing Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-10-01','WRK','WRK-10','Painting & Finishing Works','Interior wall and ceiling painting',11001),
  ('WRK-10-02','WRK','WRK-10','Painting & Finishing Works','Exterior painting and weather coating',11002),
  ('WRK-10-03','WRK','WRK-10','Painting & Finishing Works','Wood painting, polishing and varnishing',11003),
  ('WRK-10-04','WRK','WRK-10','Painting & Finishing Works','Metal and grille painting',11004),
  ('WRK-10-05','WRK','WRK-10','Painting & Finishing Works','Texture and designer finish application',11005),
  ('WRK-10-06','WRK','WRK-10','Painting & Finishing Works','Epoxy and enamel painting',11006),
  ('WRK-10-07','WRK','WRK-10','Painting & Finishing Works','Anti-corrosion and protective coating',11007);

-- WRK-11 · Carpentry & Joinery Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-11-01','WRK','WRK-11','Carpentry & Joinery Works','Site carpentry (shuttering, temporary works)',11101),
  ('WRK-11-02','WRK','WRK-11','Carpentry & Joinery Works','Finished carpentry (door, window frames)',11102),
  ('WRK-11-03','WRK','WRK-11','Carpentry & Joinery Works','Furniture and cabinet making (on-site)',11103),
  ('WRK-11-04','WRK','WRK-11','Carpentry & Joinery Works','Modular kitchen installation',11104),
  ('WRK-11-05','WRK','WRK-11','Carpentry & Joinery Works','Wardrobe and built-in storage installation',11105),
  ('WRK-11-06','WRK','WRK-11','Carpentry & Joinery Works','Wooden deck and pergola construction',11106),
  ('WRK-11-07','WRK','WRK-11','Carpentry & Joinery Works','TV unit and bookshelf installation',11107);

-- WRK-12 · Steel & Metal Fabrication Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-12-01','WRK','WRK-12','Steel & Metal Fabrication Works','Structural steel fabrication and erection',11201),
  ('WRK-12-02','WRK','WRK-12','Steel & Metal Fabrication Works','MS grille and railing fabrication',11202),
  ('WRK-12-03','WRK','WRK-12','Steel & Metal Fabrication Works','Staircase fabrication (MS / SS / glass)',11203),
  ('WRK-12-04','WRK','WRK-12','Steel & Metal Fabrication Works','Aluminium fabrication (windows / partitions)',11204),
  ('WRK-12-05','WRK','WRK-12','Steel & Metal Fabrication Works','Welding and cutting works',11205),
  ('WRK-12-06','WRK','WRK-12','Steel & Metal Fabrication Works','Metal cladding and roofing installation',11206),
  ('WRK-12-07','WRK','WRK-12','Steel & Metal Fabrication Works','GI duct fabrication and installation',11207);

-- WRK-13 · Plumbing & Drainage Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-13-01','WRK','WRK-13','Plumbing & Drainage Works','Water supply rough-in (concealed piping)',11301),
  ('WRK-13-02','WRK','WRK-13','Plumbing & Drainage Works','Water supply finishing (exposed piping + fittings)',11302),
  ('WRK-13-03','WRK','WRK-13','Plumbing & Drainage Works','Drainage and sewerage piping',11303),
  ('WRK-13-04','WRK','WRK-13','Plumbing & Drainage Works','Rainwater downpipe and gutter installation',11304),
  ('WRK-13-05','WRK','WRK-13','Plumbing & Drainage Works','Water tank installation and connection',11305),
  ('WRK-13-06','WRK','WRK-13','Plumbing & Drainage Works','Pump room installation',11306),
  ('WRK-13-07','WRK','WRK-13','Plumbing & Drainage Works','Manhole and inspection chamber construction',11307),
  ('WRK-13-08','WRK','WRK-13','Plumbing & Drainage Works','STP installation and commissioning',11308),
  ('WRK-13-09','WRK','WRK-13','Plumbing & Drainage Works','Underground drainage network',11309);

-- WRK-14 · Sanitaryware & Bathroom Fitting Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-14-01','WRK','WRK-14','Sanitaryware & Bathroom Fitting Works','WC and wash basin installation',11401),
  ('WRK-14-02','WRK','WRK-14','Sanitaryware & Bathroom Fitting Works','Shower, bathtub and enclosure fitting',11402),
  ('WRK-14-03','WRK','WRK-14','Sanitaryware & Bathroom Fitting Works','Tap and mixer installation',11403),
  ('WRK-14-04','WRK','WRK-14','Sanitaryware & Bathroom Fitting Works','Geyser and water heater installation',11404),
  ('WRK-14-05','WRK','WRK-14','Sanitaryware & Bathroom Fitting Works','Bathroom accessories fixing',11405),
  ('WRK-14-06','WRK','WRK-14','Sanitaryware & Bathroom Fitting Works','Kitchen sink and tap installation',11406);

-- WRK-15 · Electrical Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-15-01','WRK','WRK-15','Electrical Works','Conduit laying (concealed)',11501),
  ('WRK-15-02','WRK','WRK-15','Electrical Works','Cable and wire pulling',11502),
  ('WRK-15-03','WRK','WRK-15','Electrical Works','Switch and socket fitting',11503),
  ('WRK-15-04','WRK','WRK-15','Electrical Works','DB and panel board installation',11504),
  ('WRK-15-05','WRK','WRK-15','Electrical Works','Earthing and lightning protection installation',11505),
  ('WRK-15-06','WRK','WRK-15','Electrical Works','DG set installation and commissioning',11506),
  ('WRK-15-07','WRK','WRK-15','Electrical Works','HT / LT panel installation',11507),
  ('WRK-15-08','WRK','WRK-15','Electrical Works','Transformer installation',11508),
  ('WRK-15-09','WRK','WRK-15','Electrical Works','UPS and battery system installation',11509),
  ('WRK-15-10','WRK','WRK-15','Electrical Works','Cable tray installation',11510);

-- WRK-16 · Lighting & ELV Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-16-01','WRK','WRK-16','Lighting & ELV Works','Light fixture installation (indoor)',11601),
  ('WRK-16-02','WRK','WRK-16','Lighting & ELV Works','Outdoor and landscape lighting installation',11602),
  ('WRK-16-03','WRK','WRK-16','Lighting & ELV Works','CCTV and security system installation',11603),
  ('WRK-16-04','WRK','WRK-16','Lighting & ELV Works','Structured cabling and networking',11604),
  ('WRK-16-05','WRK','WRK-16','Lighting & ELV Works','Home automation and smart system installation',11605),
  ('WRK-16-06','WRK','WRK-16','Lighting & ELV Works','PA and intercom system installation',11606),
  ('WRK-16-07','WRK','WRK-16','Lighting & ELV Works','Access control system installation',11607);

-- WRK-17 · HVAC & Fire Safety Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-17-01','WRK','WRK-17','HVAC & Fire Safety Works','Split AC installation',11701),
  ('WRK-17-02','WRK','WRK-17','HVAC & Fire Safety Works','VRF / VRV system installation',11702),
  ('WRK-17-03','WRK','WRK-17','HVAC & Fire Safety Works','Ducting and ventilation installation',11703),
  ('WRK-17-04','WRK','WRK-17','HVAC & Fire Safety Works','Fire alarm system installation',11704),
  ('WRK-17-05','WRK','WRK-17','HVAC & Fire Safety Works','Fire sprinkler system installation',11705),
  ('WRK-17-06','WRK','WRK-17','HVAC & Fire Safety Works','Fire suppression system commissioning',11706),
  ('WRK-17-07','WRK','WRK-17','HVAC & Fire Safety Works','Exhaust and pressurization system installation',11707);

-- WRK-18 · Lift, Escalator & Specialist Building Services
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-18-01','WRK','WRK-18','Lift, Escalator & Specialist Building Services','Lift / elevator installation and commissioning',11801),
  ('WRK-18-02','WRK','WRK-18','Lift, Escalator & Specialist Building Services','Escalator installation',11802),
  ('WRK-18-03','WRK','WRK-18','Lift, Escalator & Specialist Building Services','BMS installation and integration',11803),
  ('WRK-18-04','WRK','WRK-18','Lift, Escalator & Specialist Building Services','Swimming pool construction and commissioning',11804),
  ('WRK-18-05','WRK','WRK-18','Lift, Escalator & Specialist Building Services','Water feature and fountain construction',11805);

-- WRK-19 · Renewable Energy & Utility Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-19-01','WRK','WRK-19','Renewable Energy & Utility Works','Solar panel installation and commissioning',11901),
  ('WRK-19-02','WRK','WRK-19','Renewable Energy & Utility Works','Battery storage system installation',11902),
  ('WRK-19-03','WRK','WRK-19','Renewable Energy & Utility Works','Rainwater harvesting system installation',11903),
  ('WRK-19-04','WRK','WRK-19','Renewable Energy & Utility Works','STP / ETP plant commissioning',11904),
  ('WRK-19-05','WRK','WRK-19','Renewable Energy & Utility Works','EV charging point installation',11905),
  ('WRK-19-06','WRK','WRK-19','Renewable Energy & Utility Works','Gas piping installation',11906);

-- WRK-20 · External Development & Landscaping Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-20-01','WRK','WRK-20','External Development & Landscaping Works','Compound wall / boundary wall construction',12001),
  ('WRK-20-02','WRK','WRK-20','External Development & Landscaping Works','Main gate and wicket gate installation',12002),
  ('WRK-20-03','WRK','WRK-20','External Development & Landscaping Works','Paving and hardscape laying',12003),
  ('WRK-20-04','WRK','WRK-20','External Development & Landscaping Works','Road and driveway construction',12004),
  ('WRK-20-05','WRK','WRK-20','External Development & Landscaping Works','Soft landscaping (planting, turf, irrigation)',12005),
  ('WRK-20-06','WRK','WRK-20','External Development & Landscaping Works','Outdoor furniture and pergola construction',12006),
  ('WRK-20-07','WRK','WRK-20','External Development & Landscaping Works','Signage and wayfinding installation',12007);

-- WRK-21 · Professional & Consultancy Services
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-21-01','WRK','WRK-21','Professional & Consultancy Services','Architectural design and drawing fees',12101),
  ('WRK-21-02','WRK','WRK-21','Professional & Consultancy Services','Structural engineering fees',12102),
  ('WRK-21-03','WRK','WRK-21','Professional & Consultancy Services','MEP consultancy fees',12103),
  ('WRK-21-04','WRK','WRK-21','Professional & Consultancy Services','Interior design fees',12104),
  ('WRK-21-05','WRK','WRK-21','Professional & Consultancy Services','Project management consultancy',12105),
  ('WRK-21-06','WRK','WRK-21','Professional & Consultancy Services','Quantity surveying and estimation',12106),
  ('WRK-21-07','WRK','WRK-21','Professional & Consultancy Services','Legal and documentation charges',12107),
  ('WRK-21-08','WRK','WRK-21','Professional & Consultancy Services','Liaisoning and approval charges',12108),
  ('WRK-21-09','WRK','WRK-21','Professional & Consultancy Services','Labour contractor charges',12109);

-- WRK-22 · Site Operations & Overhead Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-22-01','WRK','WRK-22','Site Operations & Overhead Works','Security and watchman services',12201),
  ('WRK-22-02','WRK','WRK-22','Site Operations & Overhead Works','Site cleaning and housekeeping',12202),
  ('WRK-22-03','WRK','WRK-22','Site Operations & Overhead Works','Waste disposal and debris removal',12203),
  ('WRK-22-04','WRK','WRK-22','Site Operations & Overhead Works','Material loading, unloading and stacking',12204),
  ('WRK-22-05','WRK','WRK-22','Site Operations & Overhead Works','Crane and hoist operation charges',12205),
  ('WRK-22-06','WRK','WRK-22','Site Operations & Overhead Works','Water tanker supply charges',12206),
  ('WRK-22-07','WRK','WRK-22','Site Operations & Overhead Works','Diesel and fuel for site equipment',12207);

-- WRK-23 · Repair, Renovation & Rehabilitation Works
INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('WRK-23-01','WRK','WRK-23','Repair, Renovation & Rehabilitation Works','Crack repair and grouting',12301),
  ('WRK-23-02','WRK','WRK-23','Repair, Renovation & Rehabilitation Works','Concrete repair and patching',12302),
  ('WRK-23-03','WRK','WRK-23','Repair, Renovation & Rehabilitation Works','Tile removal and re-laying',12303),
  ('WRK-23-04','WRK','WRK-23','Repair, Renovation & Rehabilitation Works','Replastering and resurfacing',12304),
  ('WRK-23-05','WRK','WRK-23','Repair, Renovation & Rehabilitation Works','Structural retrofitting and strengthening',12305),
  ('WRK-23-06','WRK','WRK-23','Repair, Renovation & Rehabilitation Works','Waterproofing redone and repair',12306),
  ('WRK-23-07','WRK','WRK-23','Repair, Renovation & Rehabilitation Works','Electrical rewiring',12307),
  ('WRK-23-08','WRK','WRK-23','Repair, Renovation & Rehabilitation Works','Plumbing repair and re-routing',12308),
  ('WRK-23-09','WRK','WRK-23','Repair, Renovation & Rehabilitation Works','Demolition (partial or full)',12309),
  ('WRK-23-10','WRK','WRK-23','Repair, Renovation & Rehabilitation Works','False ceiling and partition removal and rework',12310);
