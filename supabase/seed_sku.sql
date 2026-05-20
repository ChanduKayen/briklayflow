-- SKU Directory Seed — Indian Construction Materials
-- Run once: npx supabase db query --linked --file supabase/seed_sku.sql

INSERT INTO sku_directory (sku_id, category, sub_category, dimension, variant, grade, aliases, standard_unit, is_active) VALUES

-- ── CEMENT ────────────────────────────────────────────────────────────────
('CEMENT-OPC53-50KG-BAG-STD',   'Cement', 'OPC 53 Cement',  '50kg',   'Bag',     'Standard', ARRAY['cement','opc 53','opc53','53 grade cement','ordinary portland cement','portland cement 53'], 'Bags', true),
('CEMENT-OPC43-50KG-BAG-STD',   'Cement', 'OPC 43 Cement',  '50kg',   'Bag',     'Standard', ARRAY['opc 43','opc43','43 grade cement','ordinary portland cement 43'], 'Bags', true),
('CEMENT-PPC-50KG-BAG-STD',     'Cement', 'PPC Cement',     '50kg',   'Bag',     'Standard', ARRAY['ppc','portland pozzolana cement','ppc cement','blended cement','fly ash cement'], 'Bags', true),
('CEMENT-PSC-50KG-BAG-STD',     'Cement', 'PSC Cement',     '50kg',   'Bag',     'Standard', ARRAY['psc','portland slag cement','slag cement','blast furnace slag'], 'Bags', true),
('CEMENT-WC-5KG-TIN-STD',       'Cement', 'White Cement',   '5kg',    'Tin',     'Standard', ARRAY['white cement','grouting cement','tile grout cement','birla white'], 'Nos',  true),

-- ── TMT STEEL BARS ───────────────────────────────────────────────────────
('STEEL-TMT-8MM-BAR-FE500D',    'Steel', 'TMT Bar',  '8mm',  'Bar', 'Fe500D', ARRAY['8mm rod','tmt 8mm','8mm steel','8mm bar','rebar 8mm','8mm tmt','reinforcement 8mm'], 'MT', true),
('STEEL-TMT-10MM-BAR-FE500D',   'Steel', 'TMT Bar', '10mm',  'Bar', 'Fe500D', ARRAY['10mm rod','tmt 10mm','10mm steel','10mm bar','rebar 10mm','10mm tmt','reinforcement 10mm'], 'MT', true),
('STEEL-TMT-12MM-BAR-FE500D',   'Steel', 'TMT Bar', '12mm',  'Bar', 'Fe500D', ARRAY['12mm rod','tmt 12mm','12mm steel','12mm bar','rebar 12mm','12mm tmt','reinforcement 12mm'], 'MT', true),
('STEEL-TMT-16MM-BAR-FE500D',   'Steel', 'TMT Bar', '16mm',  'Bar', 'Fe500D', ARRAY['16mm rod','tmt 16mm','16mm steel','16mm bar','rebar 16mm','16mm tmt','reinforcement 16mm'], 'MT', true),
('STEEL-TMT-20MM-BAR-FE500D',   'Steel', 'TMT Bar', '20mm',  'Bar', 'Fe500D', ARRAY['20mm rod','tmt 20mm','20mm steel','20mm bar','rebar 20mm','20mm tmt','reinforcement 20mm'], 'MT', true),
('STEEL-TMT-25MM-BAR-FE500D',   'Steel', 'TMT Bar', '25mm',  'Bar', 'Fe500D', ARRAY['25mm rod','tmt 25mm','25mm steel','25mm bar','rebar 25mm','25mm tmt','reinforcement 25mm'], 'MT', true),
('STEEL-MSANGLE-50X50X6-EQ-STD','Steel', 'MS Angle', '50x50x6mm', 'Equal Angle', 'Standard', ARRAY['angle iron','ms angle','l angle','steel angle','50x50 angle','equal angle'], 'MT', true),
('STEEL-MSFLAT-50X6-BAR-STD',   'Steel', 'MS Flat Bar', '50x6mm', 'Bar', 'Standard', ARRAY['flat bar','ms flat','steel flat bar','flat iron','patti'], 'MT', true),
('STEEL-MSPLATE-6MM-STD-STD',   'Steel', 'MS Plate', '6mm', 'Standard', 'IS2062', ARRAY['ms plate','steel plate','mild steel plate','chequered plate'], 'MT', true),

-- ── COARSE AGGREGATE ─────────────────────────────────────────────────────
('AGG-COARSE-20MM-CRUSHED-STD', 'Aggregate', 'Coarse Aggregate', '20mm', 'Crushed Stone', 'Standard', ARRAY['20mm metal','20mm aggregate','20mm jelly','jelly','coarse aggregate','gravel 20mm','stone chips'], 'MT', true),
('AGG-COARSE-40MM-CRUSHED-STD', 'Aggregate', 'Coarse Aggregate', '40mm', 'Crushed Stone', 'Standard', ARRAY['40mm metal','40mm aggregate','40mm jelly','coarse aggregate 40mm'], 'MT', true),
('AGG-COARSE-12MM-CRUSHED-STD', 'Aggregate', 'Coarse Aggregate', '12mm', 'Crushed Stone', 'Standard', ARRAY['12mm metal','12mm aggregate','12mm jelly','pea gravel','fine metal'], 'MT', true),
('AGG-GSB-STD-GRADED-STD',      'Aggregate', 'GSB',             'Standard', 'Graded', 'Zone I', ARRAY['gsb','granular sub base','road base material','sub base gravel'], 'MT', true),

-- ── SAND ─────────────────────────────────────────────────────────────────
('SAND-RIVER-MED-FINE-ZONE2',   'Sand', 'River Sand',  'Medium', 'Fine Aggregate', 'Zone II', ARRAY['sand','river sand','natural sand','fine aggregate','building sand','bay sand'], 'MT', true),
('SAND-MSAND-STD-CRUSHED-STD',  'Sand', 'M-Sand',      'Standard', 'Crushed', 'Zone II',  ARRAY['msand','m-sand','manufactured sand','crushed sand','artificial sand','robo sand'], 'MT', true),
('SAND-PLASTER-FNE-WASHED-STD', 'Sand', 'Plaster Sand', 'Fine', 'Washed', 'Standard',     ARRAY['plaster sand','fine sand','rendering sand','screeding sand','finished sand'], 'MT', true),

-- ── BRICKS & BLOCKS ──────────────────────────────────────────────────────
('BRICK-CLAY-STD-SOLID-FC1',    'Brick', 'Clay Brick',   'Standard (228x114x76mm)', 'Solid',  'First Class', ARRAY['brick','red brick','clay brick','burnt brick','common brick','ita','mitti ita'], 'Nos', true),
('BLOCK-AAC-600X200X200-STD-A', 'Block', 'AAC Block',    '600x200x200mm',  'Standard', 'Grade A', ARRAY['aac block','autoclaved aerated concrete','lightweight block','fly ash block','siporex block','thermoblock'], 'Nos', true),
('BLOCK-AAC-600X200X150-STD-A', 'Block', 'AAC Block',    '600x200x150mm',  'Standard', 'Grade A', ARRAY['aac 150mm','lightweight block 150','aac 6 inch'], 'Nos', true),
('BLOCK-HOLLOW-400X200X200-STD','Block', 'Hollow Block', '400x200x200mm',  'Hollow', 'Standard', ARRAY['hollow block','concrete block','cmu block','cement block','hcu'], 'Nos', true),

-- ── PAINT & WATERPROOFING ─────────────────────────────────────────────────
('PAINT-EMULSION-1LTR-INT-STD', 'Paint', 'Emulsion Paint', '1 Ltr', 'Interior', 'Standard', ARRAY['paint','interior paint','emulsion','wall paint','acrylic emulsion','distemper'], 'Ltr', true),
('PAINT-EMULSION-1LTR-EXT-STD', 'Paint', 'Emulsion Paint', '1 Ltr', 'Exterior', 'Standard', ARRAY['exterior paint','outdoor paint','weather coat','apex paint','weather shield'], 'Ltr', true),
('PAINT-PRIMER-1LTR-WALL-STD',  'Paint', 'Wall Primer',    '1 Ltr', 'Wall',     'Standard', ARRAY['primer','wall primer','sealer','paint primer','acrylic primer'], 'Ltr', true),
('PAINT-ENAMEL-1LTR-STD-STD',   'Paint', 'Enamel Paint',   '1 Ltr', 'Standard', 'Standard', ARRAY['enamel paint','synthetic enamel','oil paint','gloss paint','enamel'], 'Ltr', true),
('WPRF-CEMENT-1KG-FLEX-STD',    'Waterproofing', 'Flexible Waterproofing', '1 kg', 'Cement Based', 'Standard', ARRAY['waterproofing','dr fixit','pidilite waterproofing','terrace waterproofing','wet area waterproofing'], 'kg', true),

-- ── TILES ────────────────────────────────────────────────────────────────
('TILE-VITRIFIED-600X600-FLR-P1','Tile', 'Vitrified Tile', '600x600mm', 'Floor', 'P1 Grade', ARRAY['tile','vitrified tile','floor tile','2x2 tile','600 tile','glazed vitrified tile','gvt'], 'Sqft', true),
('TILE-CERAMIC-300X450-WALL-Q1', 'Tile', 'Ceramic Tile',   '300x450mm', 'Wall',  'First Quality', ARRAY['wall tile','300x450 tile','bathroom tile','kitchen tile','ceramic wall tile'], 'Sqft', true),
('TILE-PARKING-600X600-FLR-STD', 'Tile', 'Parking Tile',   '600x600mm', 'Parking', 'Standard', ARRAY['parking tile','heavy duty tile','industrial tile','outdoor floor tile'], 'Sqft', true),
('TILE-GRANITE-600X600-FLR-STD', 'Tile', 'Granite Tile',   '600x600mm', 'Floor', 'Standard',  ARRAY['granite','granite tile','natural stone','polished granite','granite slab'], 'Sqft', true),

-- ── PLUMBING ─────────────────────────────────────────────────────────────
('PIPE-CPVC-25MM-SDR11-STD',    'Plumbing', 'CPVC Pipe', '25mm (1")',  'SDR11', 'IS15778', ARRAY['cpvc pipe','25mm cpvc','1 inch cpvc','hot water pipe','chlorinated pvc','flowguard'], 'Rmt', true),
('PIPE-CPVC-20MM-SDR11-STD',    'Plumbing', 'CPVC Pipe', '20mm (3/4")', 'SDR11', 'IS15778', ARRAY['20mm cpvc','3/4 inch cpvc','cpvc 20mm'], 'Rmt', true),
('PIPE-UPVC-110MM-SWR-STD',     'Plumbing', 'UPVC Pipe', '110mm (4")', 'SWR',   'IS13592', ARRAY['pvc pipe','drainage pipe','swr pipe','upvc drainage','110mm pvc','4 inch pipe'], 'Rmt', true),
('PIPE-UPVC-75MM-SWR-STD',      'Plumbing', 'UPVC Pipe',  '75mm (3")', 'SWR',   'IS13592', ARRAY['75mm pvc','3 inch drainage pipe','swr 75mm','upvc 75mm'], 'Rmt', true),
('PIPE-GI-25MM-MED-IS1239',     'Plumbing', 'GI Pipe',   '25mm (1")',  'Medium', 'IS1239',  ARRAY['gi pipe','1 inch pipe','galvanized pipe','gi tube','iron pipe','gi water pipe'], 'Rmt', true),
('FIXT-WC-STD-FLOOR-STD',       'Plumbing', 'WC Pan',    'Standard',   'Floor Mounted', 'Standard', ARRAY['toilet','wc','water closet','commode','toilet pan','indian toilet','european wc'], 'Nos', true),

-- ── ELECTRICAL ───────────────────────────────────────────────────────────
('WIRE-CU-2.5SQMM-FR-IS694',    'Electrical', 'Copper Wire', '2.5 sq.mm', 'FR Grade', 'IS694', ARRAY['wire','electric wire','copper wire','2.5sqmm wire','house wiring','electrical wire','2.5mm wire'], 'Rmt', true),
('WIRE-CU-4SQMM-FR-IS694',      'Electrical', 'Copper Wire', '4 sq.mm',   'FR Grade', 'IS694', ARRAY['4sqmm wire','4mm wire','power cable','4mm copper wire'], 'Rmt', true),
('WIRE-CU-6SQMM-FR-IS694',      'Electrical', 'Copper Wire', '6 sq.mm',   'FR Grade', 'IS694', ARRAY['6sqmm wire','6mm wire','6mm copper wire','6sqmm cable'], 'Rmt', true),
('WIRE-CU-1.5SQMM-FR-IS694',    'Electrical', 'Copper Wire', '1.5 sq.mm', 'FR Grade', 'IS694', ARRAY['1.5sqmm wire','1.5mm wire','light wiring','thin wire'], 'Rmt', true),
('COND-PVC-20MM-STD-IS9537',    'Electrical', 'PVC Conduit', '20mm',     'Standard',  'IS9537', ARRAY['conduit','pvc conduit','emt conduit','electrical conduit','20mm conduit'], 'Rmt', true),
('MCB-2P-32A-STD-IS8828',       'Electrical', 'MCB',        '32 Amp',   '2 Pole',    'IS8828', ARRAY['mcb','circuit breaker','miniature circuit breaker','32a mcb','2 pole mcb'], 'Nos', true),

-- ── PLYWOOD & FORMWORK ───────────────────────────────────────────────────
('PLY-COMM-18MM-8X4-IS303',     'Plywood', 'Commercial Plywood', '18mm (8x4 ft)', 'Standard',  'IS:303', ARRAY['plywood','18mm plywood','shuttering ply','formwork ply','commercial ply','8x4 ply'], 'Nos', true),
('PLY-SHUT-12MM-8X4-STD',       'Plywood', 'Shuttering Plywood', '12mm (8x4 ft)', 'Shuttering', 'Standard', ARRAY['shuttering','12mm shuttering','form ply','centering sheet','shuttering board'], 'Nos', true),
('PLY-BWR-19MM-8X4-IS303',      'Plywood', 'BWR Plywood',        '19mm (8x4 ft)', 'Boiling Water Resistant', 'IS:303', ARRAY['bwr plywood','waterproof ply','marine ply','external grade ply'], 'Nos', true),

-- ── HARDWARE & BINDING ───────────────────────────────────────────────────
('WIRE-BIND-18G-GI-STD',        'Hardware', 'Binding Wire', '18 Gauge', 'GI Annealed', 'Standard', ARRAY['binding wire','gi wire','tying wire','18 gauge wire','annealed wire','steel tying wire'], 'kg',  true),
('NAIL-CMN-3IN-MS-STD',         'Hardware', 'Common Nail',  '3 inch',   'MS',           'Standard', ARRAY['nail','wire nail','3 inch nail','common nail','iron nail'], 'kg',  true),
('BOLT-HEX-M12-STD-STD',        'Hardware', 'Hex Bolt',     'M12x50mm', 'MS',           'Grade 4.8', ARRAY['bolt','hex bolt','m12 bolt','nut bolt','fastener','anchor bolt'], 'Nos', true),

-- ── ADMIXTURE & CHEMICALS ────────────────────────────────────────────────
('ADMIX-PLAST-1LTR-WR-STD',     'Admixture', 'Plasticizer',     '1 Ltr',   'Water Reducing', 'Standard', ARRAY['admixture','plasticizer','concrete admixture','water reducer','superplasticizer','conplast'], 'Ltr', true),
('ADMIX-ACCEL-1LTR-STD-STD',    'Admixture', 'Accelerator',     '1 Ltr',   'Standard',       'Standard', ARRAY['accelerator','curing agent','rapid hardener','set accelerator'], 'Ltr', true),
('CHEM-CURING-1LTR-STD-STD',    'Chemical', 'Curing Compound', '1 Ltr',   'Standard',       'Standard', ARRAY['curing compound','membrane curing','concrete curing','wax curing compound'], 'Ltr', true),

-- ── GLASS ────────────────────────────────────────────────────────────────
('GLASS-FLOAT-4MM-CLR-STD',     'Glass', 'Float Glass',    '4mm', 'Clear', 'Standard', ARRAY['glass','plain glass','float glass','clear glass','window glass','4mm glass'], 'Sqft', true),
('GLASS-TEMPERED-8MM-CLR-STD',  'Glass', 'Tempered Glass', '8mm', 'Clear', 'Standard', ARRAY['toughened glass','tempered glass','safety glass','8mm tempered'], 'Sqft', true),

-- ── DOORS & WINDOWS ──────────────────────────────────────────────────────
('DOOR-FLUSH-STD-SOLID-IS2202',  'Doors', 'Flush Door',   '900x2100mm', 'Solid Core',  'IS:2202', ARRAY['door','flush door','wooden door','interior door','solid core door','plywood door'], 'Nos', true),
('FRAME-DOOR-STD-TEAK-STD',      'Doors', 'Door Frame',   '100x75mm',   'Teak Wood',   'Standard', ARRAY['door frame','chowkat','wood frame','teak frame','door chowkat'], 'Nos', true),
('WINDOW-UPVC-STD-SLIDNG-STD',   'Windows', 'UPVC Window', '1200x900mm', 'Sliding',    'Standard', ARRAY['window','upvc window','sliding window','pvc window','aluminium window'], 'Nos', true),

-- ── PLUMBING FIXTURES & FITTINGS ─────────────────────────────────────────
('FIXT-HFAUCET-STD-CP-STD',      'Plumbing', 'Health Faucet',  'Standard', 'Chrome Plated', 'Standard', ARRAY['health faucet','health facet','health fasset','health faucets','jet spray','bidet spray','toilet spray','hand shower'], 'Nos', true),
('FIXT-BIBCOCK-15MM-CP-STD',     'Plumbing', 'Bib Cock',       '15mm',     'Chrome Plated', 'IS1795',   ARRAY['bib cock','bibcock','water tap','tap','faucet','wall tap','garden tap','outdoor tap'], 'Nos', true),
('FIXT-STOPCOCK-15MM-CP-STD',    'Plumbing', 'Stop Cock',      '15mm',     'Chrome Plated', 'IS1804',   ARRAY['stop cock','stopcock','inline valve','isolation valve','water stop valve'], 'Nos', true),
('FIXT-BALLVALVE-25MM-GI-STD',   'Plumbing', 'Ball Valve',     '25mm',     'GI',            'IS9890',   ARRAY['ball valve','ballvalve','shut off valve','1 inch valve','gate valve'], 'Nos', true),
('FIXT-FLUSHVALVE-STD-CP-STD',   'Plumbing', 'Flush Valve',    'Standard', 'Chrome Plated', 'Standard', ARRAY['flush valve','flushvalve','concealed flush','flush plate','wc flush'], 'Nos', true),
('FIXT-WASHBASIN-STD-WH-STD',    'Plumbing', 'Wash Basin',     'Standard', 'White',         'IS771',    ARRAY['wash basin','washbasin','hand wash basin','lavatory','basin','sink basin'], 'Nos', true),
('FIXT-KITCHEN-SINK-SS-STD',     'Plumbing', 'Kitchen Sink',   '24x18 inch', 'SS 304',      'Standard', ARRAY['kitchen sink','sink','stainless steel sink','ss sink','double bowl sink'], 'Nos', true),
('TANK-SUMP-1000L-PE-STD',       'Plumbing', 'Water Tank',     '1000 Ltr', 'Overhead',      'IS12701',  ARRAY['water tank','overhead tank','sintex tank','plastic tank','poly tank','loft tank'], 'Nos', true),
('PIPE-CPVC-32MM-SDR11-STD',     'Plumbing', 'CPVC Pipe',      '32mm (1.25")', 'SDR11',     'IS15778',  ARRAY['32mm cpvc','1.25 inch cpvc','cpvc 32mm'], 'Rmt', true),
('PIPE-UPVC-160MM-SWR-STD',      'Plumbing', 'UPVC Pipe',      '160mm (6")', 'SWR',         'IS13592',  ARRAY['160mm pvc','6 inch drainage','swr 160mm','upvc 160mm'], 'Rmt', true),
('FIXT-SHOWER-STD-CP-STD',       'Plumbing', 'Shower Set',     'Standard', 'Chrome Plated', 'Standard', ARRAY['shower','shower head','rain shower','overhead shower','shower set','shower panel'], 'Nos', true),
('FIXT-CPELBOW-25MM-STD',        'Plumbing', 'CPVC Elbow',     '25mm',     '90 Degree',     'IS15778',  ARRAY['cpvc elbow','elbow fitting','90 degree elbow','pipe bend'], 'Nos', true),
('FIXT-CPTEE-25MM-STD',          'Plumbing', 'CPVC Tee',       '25mm',     'Equal',         'IS15778',  ARRAY['cpvc tee','tee fitting','equal tee','pipe tee'], 'Nos', true)

ON CONFLICT (sku_id) DO NOTHING;
