// Common Indian construction brands per material category. Seeds the order-line brand
// datalist. NOT used by the SKU pipeline — purely for purchase-order brand selection.
export const BRANDS_BY_CATEGORY: Record<string, string[]> = {
  Cement:        ['UltraTech', 'ACC', 'Ambuja', 'JK Cement', 'Birla', 'Dalmia', 'Shree', 'Ramco', 'Penna', 'Bharathi'],
  Steel:         ['JSW', 'Tata Tiscon', 'SAIL', 'Jindal', 'Vizag', 'Kamdhenu', 'Rashmi', 'Shyam'],
  Plumbing:      ['Ashirvad', 'Supreme', 'Finolex', 'Astral', 'Prince', 'Jaquar', 'Cera', 'Parryware', 'Hindware', 'Kohler', 'Watertec', 'Sintex'],
  Electrical:    ['Havells', 'Anchor', 'Polycab', 'KEI', 'RR Kabel', 'Finolex', 'Syska', 'Legrand', 'Schneider', 'Crompton', 'Bajaj', 'Wipro', 'Philips', 'GM'],
  Paint:         ['Asian Paints', 'Berger', 'Nerolac', 'Dulux', 'Indigo', 'JSW Paints', 'Birla Opus'],
  Tile:          ['Kajaria', 'Somany', 'Orient Bell', 'Johnson', 'RAK', 'Nitco', 'Simpolo', 'Varmora'],
  Hardware:      ['Godrej', 'Hettich', 'Ebco', 'Dorset', 'Yale', 'Europa', 'Hafele'],
  Waterproofing: ['Dr. Fixit', 'Fosroc', 'Sika', 'MYK Laticrete', 'Asian Paints SmartCare', 'Berger'],
  Plywood:       ['Greenply', 'Century', 'Kitply', 'Archid', 'Merino', 'Action Tesa'],
  Admixture:     ['Fosroc', 'Sika', 'BASF', 'MYK', 'Pidilite'],
  Chemical:      ['Fosroc', 'Sika', 'BASF', 'MYK', 'Pidilite'],
  Sand:          [],
  Aggregate:     [],
};

const LS_KEY = (cat: string) => `briklay_custom_brands_${cat}`;

export function getCustomBrands(category: string): string[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY(category)) || '[]'); }
  catch { return []; }
}

export function addCustomBrand(category: string, brand: string): void {
  const b = brand.trim();
  if (!b) return;
  const prev = getCustomBrands(category);
  if (prev.some(x => x.toLowerCase() === b.toLowerCase())) return;
  try { localStorage.setItem(LS_KEY(category), JSON.stringify([...prev, b])); } catch { /* ignore */ }
}

// Predefined + user-added, deduped, sorted. The list for a category's datalist.
export function brandsFor(category: string): string[] {
  const base = BRANDS_BY_CATEGORY[category] || [];
  const seen = new Set(base.map(b => b.toLowerCase()));
  const extra = getCustomBrands(category).filter(b => !seen.has(b.toLowerCase()));
  return [...base, ...extra].sort((a, b) => a.localeCompare(b));
}
