export interface TradeGroup {
  group: string;
  trades: string[];
}

export const OTHER_TRADE = 'Other (specify)';

export const WORKER_TRADE_GROUPS: TradeGroup[] = [
  {
    group: 'Civil & Structural',
    trades: [
      'Mason',
      'Bar Bender / Reinforcement',
      'Shuttering Carpenter',
      'Concrete Worker',
      'Excavation Worker',
      'Stone Mason',
      'Waterproofing Worker',
    ],
  },
  {
    group: 'Finishing',
    trades: [
      'Tile Fitter',
      'Marble Fixer',
      'Granite Fixer',
      'False Ceiling Worker',
      'Painting Worker',
      'Polish Worker',
    ],
  },
  {
    group: 'Carpentry & Joinery',
    trades: [
      'Carpenter',
      'Modular Kitchen Installer',
      'Wardrobe Installer',
      'Wood Polish Worker',
    ],
  },
  {
    group: 'MEP',
    trades: [
      'Electrician',
      'Plumber',
      'HVAC Technician',
      'Solar Panel Installer',
      'CCTV / Security Installer',
      'Fire Safety Installer',
    ],
  },
  {
    group: 'Structural & Exterior',
    trades: [
      'Steel Fabricator',
      'Welder',
      'Glass / Glazing Worker',
      'Aluminium Fabricator',
      'Roofing Worker',
      'Waterproofing Applicator',
    ],
  },
  {
    group: 'Site Support',
    trades: [
      'Unskilled Labour',
      'Site Supervisor',
      'Security Guard',
      'Housekeeping / Cleaner',
      'Material Handler',
      'Crane / JCB Operator',
      'Driver',
    ],
  },
  {
    group: 'Other',
    trades: [OTHER_TRADE],
  },
];

export const VENDOR_TRADE_GROUPS: TradeGroup[] = [
  {
    group: 'Building Materials',
    trades: [
      'Cement Supplier',
      'Sand & Aggregate Supplier',
      'Bricks / Blocks Supplier',
      'Steel / TMT Bar Supplier',
      'Waterproofing Materials Supplier',
      'Admixture Supplier',
    ],
  },
  {
    group: 'Finishing Materials',
    trades: [
      'Tiles Supplier',
      'Marble / Granite Supplier',
      'Paint Supplier',
      'Hardware & Fittings Supplier',
      'Glass & Aluminium Supplier',
      'False Ceiling Materials Supplier',
      'Flooring Materials Supplier',
    ],
  },
  {
    group: 'MEP Materials',
    trades: [
      'Electrical Materials Supplier',
      'Plumbing Materials Supplier',
      'HVAC Materials Supplier',
      'Sanitary Ware Supplier',
      'Lighting Supplier',
      'Cables & Conduits Supplier',
    ],
  },
  {
    group: 'Carpentry & Woodwork',
    trades: [
      'Carpenter / Joinery Contractor',
      'Modular Furniture Manufacturer',
      'Custom Wardrobe Maker',
      'Modular Kitchen Manufacturer',
      'Wood & Plywood Supplier',
      'Laminate & Veneer Supplier',
      'Hardware Fittings Supplier (Hinges / Channels)',
      'Wood Polish & Lacquer Supplier',
      'CNC / Router Work Vendor',
    ],
  },
  {
    group: 'Interior Design & Décor',
    trades: [
      'Interior Designer',
      'Interior Design Firm',
      'Space Planner',
      'Turnkey Interior Contractor',
      'False Ceiling Contractor',
      'Wall Panelling Vendor',
      'Decorative Laminates Supplier',
      'Wallpaper / Wall Texture Vendor',
      'Soft Furnishings Vendor',
      'Curtains & Blinds Vendor',
      'Upholstery Vendor',
      'Lighting Designer',
      'Decorative Lighting Supplier',
      'Rugs & Carpets Vendor',
      'Artefacts & Décor Vendor',
      '3D Visualisation / Rendering Studio',
    ],
  },
  {
    group: 'Furniture & Fixtures',
    trades: [
      'Modular Kitchen Vendor',
      'Furniture Vendor',
      'Wardrobe / Storage Vendor',
      'Curtains & Blinds Vendor',
    ],
  },
  {
    group: 'Machinery & Equipment',
    trades: [
      'Equipment Rental (JCB / Crane)',
      'Scaffolding Supplier',
      'Tools & Machinery Vendor',
      'Diesel / Fuel Supplier',
    ],
  },
  {
    group: 'Professional Services',
    trades: [
      'Architect / Designer',
      'Structural Engineer',
      'MEP Consultant',
      'Surveyor',
      'Soil Testing Lab',
      'Legal / Documentation',
      'Interior Designer',
    ],
  },
  {
    group: 'Logistics',
    trades: [
      'Transport / Lorry',
      'Ready Mix Concrete (RMC) Plant',
      'Labour Contractor',
    ],
  },
  {
    group: 'Other',
    trades: [OTHER_TRADE],
  },
];

/** Flat lists — useful for validation and display helpers */
export const ALL_WORKER_TRADES = WORKER_TRADE_GROUPS.flatMap((g) => g.trades);
export const ALL_VENDOR_TRADES = VENDOR_TRADE_GROUPS.flatMap((g) => g.trades);
