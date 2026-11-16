/* Reference numbers for crops that have no simulation (and the money sums for rice).
   Everything here is an ESTIMATE meant for planning, not a quote. Prices change by region and by month.
   Edit the numbers in CROP_DATA to update every screen at once.

   - days   : planting to harvest. min/max = the usual range, typ = the figure used for the bar and the harvest date.
   - yieldT : marketable yield in tonnes per hectare (low / typical / high).
   - price  : farmgate (what the farmer is paid) in pesos per kg (low / typical / high).
   - seed   : price of the planting material, from the Oryzon price table (priceLow-priceHigh per priceUnit),
              and how many of those units one hectare needs (unitsPerHa).
   - rough  : true when the yield or price is a rough estimate rather than taken from a published figure. */
import type { PlanEcon } from "./types";

export interface CropInfo {
  key: string;
  label: string;
  emoji: string;
  days: { min: number; typ: number; max: number };
  yieldT: { low: number; typ: number; high: number };
  price: { low: number; typ: number; high: number };
  sold: string; // what the price is for
  seed: { priceLow: number; priceHigh: number; priceUnit: string; unitsPerHa: number; rate: string };
  basis: string; // where the numbers come from, in one line
  rough: boolean;
}

export const CROP_DATA: Record<string, CropInfo> = {
  maize: {
    key: "maize", label: "Maize", emoji: "🌽",
    days: { min: 100, typ: 115, max: 180 },
    yieldT: { low: 3, typ: 5, high: 7 },
    price: { low: 15, typ: 18, high: 22 },
    sold: "dry yellow grain",
    seed: { priceLow: 63, priceHigh: 188, priceUnit: "kg", unitsPerHa: 20, rate: "about 20 kg of seed per hectare" },
    basis: "Price: DA and PSA farmgate reports (about ₱17–22/kg dry grain). Yield: national average and UPLB field trials.",
    rough: false,
  },
  soybean: {
    key: "soybean", label: "Soybean", emoji: "🫘",
    days: { min: 90, typ: 100, max: 110 },
    yieldT: { low: 1.0, typ: 1.5, high: 2.5 },
    price: { low: 28, typ: 33, high: 36 },
    sold: "dry beans",
    seed: { priceLow: 55, priceHigh: 70, priceUnit: "kg", unitsPerHa: 70, rate: "about 70 kg of seed per hectare" },
    basis: "Days and yield: Philippine soybean program (90–110 days, 1.0–2.5 t/ha). Price: local soybean market ₱35–36/kg, less at the farm gate.",
    rough: false,
  },
  dry_bean: {
    key: "dry_bean", label: "Dry bean", emoji: "🫘",
    days: { min: 90, typ: 100, max: 120 },
    yieldT: { low: 0.8, typ: 1.0, high: 1.2 },
    price: { low: 50, typ: 65, high: 80 },
    sold: "dry beans",
    seed: { priceLow: 100, priceHigh: 160, priceUnit: "kg", unitsPerHa: 60, rate: "about 60 kg of seed per hectare" },
    basis: "Yield: Philippine legume program figures for mungbean (0.8–1.2 t/ha) used as a stand-in. Price: rough estimate.",
    rough: true,
  },
  tomato: {
    key: "tomato", label: "Tomato", emoji: "🍅",
    days: { min: 100, typ: 115, max: 130 },
    yieldT: { low: 10, typ: 15, high: 25 },
    price: { low: 8, typ: 25, high: 60 },
    sold: "fresh fruit",
    seed: { priceLow: 563, priceHigh: 563, priceUnit: "50 g", unitsPerHa: 5, rate: "about 250 g of seed per hectare" },
    basis: "Price swings a lot: farmgate fell to ₱4–12/kg in early 2025 and reached ₱80/kg in some provinces. Yield: rough estimate.",
    rough: true,
  },
  cabbage: {
    key: "cabbage", label: "Cabbage", emoji: "🥬",
    days: { min: 90, typ: 110, max: 140 },
    yieldT: { low: 12, typ: 18, high: 30 },
    price: { low: 25, typ: 35, high: 45 },
    sold: "fresh heads",
    seed: { priceLow: 1188, priceHigh: 1188, priceUnit: "50 g", unitsPerHa: 8, rate: "about 400 g of seed per hectare" },
    basis: "Price: PSA farmgate reports (about ₱34–40/kg). Yield: rough estimate (lowland is lower, highland higher).",
    rough: true,
  },
  potato: {
    key: "potato", label: "Potato", emoji: "🥔",
    days: { min: 90, typ: 110, max: 140 },
    yieldT: { low: 10, typ: 15, high: 22 },
    price: { low: 30, typ: 45, high: 60 },
    sold: "fresh tubers",
    seed: { priceLow: 53, priceHigh: 80, priceUnit: "kg", unitsPerHa: 1500, rate: "about 1,500 kg of seed tubers per hectare" },
    basis: "Both yield and price are rough estimates (shop prices run near ₱117/kg, the farm gate pays much less).",
    rough: true,
  },
  sugarcane: {
    key: "sugarcane", label: "Sugarcane", emoji: "🎋",
    days: { min: 270, typ: 330, max: 365 },
    yieldT: { low: 50, typ: 60, high: 80 },
    price: { low: 2.0, typ: 2.8, high: 3.5 },
    sold: "cane (per kg of stalk)",
    seed: { priceLow: 150, priceHigh: 300, priceUnit: "100 stem cuttings", unitsPerHa: 350, rate: "about 35,000 stem cuttings per hectare" },
    basis: "Days: 9–12 months or longer, so it does not fit before the next rice. Yield and price: rough estimates.",
    rough: true,
  },
};

// Names the service or the guide may use for the same crop.
const ALIASES: Record<string, string> = {
  corn: "maize", maize: "maize", yellowcorn: "maize",
  soybean: "soybean", soybeans: "soybean", soy: "soybean",
  drybean: "dry_bean", drybeans: "dry_bean", bean: "dry_bean", beans: "dry_bean", commonbean: "dry_bean",
  tomato: "tomato", tomatoes: "tomato",
  cabbage: "cabbage",
  potato: "potato", potatoes: "potato", whitepotato: "potato",
  sugarcane: "sugarcane", sugar: "sugarcane", cane: "sugarcane",
};

export function cropKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/[^a-z]/g, "");
  return ALIASES[n] ?? (CROP_DATA[n] ? n : null);
}
export const cropInfo = (name: string | null | undefined): CropInfo | null => {
  const k = cropKey(name);
  return k ? CROP_DATA[k] : null;
};

/* ---------- money ---------- */

// Per hectare. Income uses yield x price (low/typical/high); cost is the seed (or planting material).
export function cropEcon(c: CropInfo): PlanEcon {
  const seed = (p: number) => p * c.seed.unitsPerHa;
  return {
    incomeLow: c.yieldT.low * 1000 * c.price.low,
    incomeMid: c.yieldT.typ * 1000 * c.price.typ,
    incomeHigh: c.yieldT.high * 1000 * c.price.high,
    costLow: seed(c.seed.priceLow),
    costMid: seed((c.seed.priceLow + c.seed.priceHigh) / 2),
    costHigh: seed(c.seed.priceHigh),
  };
}

// Rice: the yield comes from the simulation (kg of dry grain per hectare). Palay is sold at about 14% moisture,
// so the weight is raised by 1/0.86. Prices: PSA/DA farmgate reports (about ₱16-22 per kg). Seed: rough estimate.
export const RICE = {
  price: { low: 16, typ: 19, high: 22 },
  seedKgHa: 50,
  seedPrice: { low: 40, high: 60 },
  moistureFactor: 1 / 0.86,
};
export function riceEcon(yieldKgHa: number): PlanEcon {
  const kg = yieldKgHa * RICE.moistureFactor;
  return {
    incomeLow: kg * RICE.price.low,
    incomeMid: kg * RICE.price.typ,
    incomeHigh: kg * RICE.price.high,
    costLow: RICE.seedKgHa * RICE.seedPrice.low,
    costMid: (RICE.seedKgHa * (RICE.seedPrice.low + RICE.seedPrice.high)) / 2,
    costHigh: RICE.seedKgHa * RICE.seedPrice.high,
  };
}

export function peso(n: number): string {
  return `₱${Math.round(n).toLocaleString("en-US")}`;
}
// Short form for chart labels: ₱1.2M, ₱85k, ₱950
export function pesoShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}₱${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 10_000) return `${sign}₱${Math.round(a / 1000)}k`;
  return `${sign}₱${Math.round(a).toLocaleString("en-US")}`;
}

/* ---------- dates (ISO "YYYY-MM-DD", always UTC so the day never shifts) ---------- */

export function parseISO(iso: string): number | null {
  const p = iso.split("-").map(Number);
  if (p.length !== 3 || p.some((x) => !Number.isFinite(x) || !x)) return null;
  return Date.UTC(p[0], p[1] - 1, p[2]);
}
export function isoAdd(iso: string, days: number): string {
  const t = parseISO(iso);
  if (t === null) return iso;
  return new Date(t + Math.round(days) * 86_400_000).toISOString().slice(0, 10);
}
export function dayDiff(fromISO: string, toISO: string): number {
  const a = parseISO(fromISO);
  const b = parseISO(toISO);
  return a === null || b === null ? 0 : Math.round((b - a) / 86_400_000);
}
export function todayISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthShort(iso: string): string {
  const t = parseISO(iso);
  return t === null ? "" : MONTH_SHORT[new Date(t).getUTCMonth()];
}
export function dayNum(iso: string): string {
  const t = parseISO(iso);
  return t === null ? "" : String(new Date(t).getUTCDate());
}
export function dateText(iso: string): string {
  const t = parseISO(iso);
  if (t === null) return iso;
  const d = new Date(t);
  return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}