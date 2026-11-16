/* Visual pieces for planning: the maturity timeline, harvest-date tiles, income vs cost bars,
   and the "Future crops" card on the Dashboard. All plain HTML/CSS, no chart library. */
import { useMemo, type CSSProperties } from "react";
import type { FuturePlan, PlanEcon } from "./types";
import { CROP_DATA, cropEcon, dateText, dayDiff, dayNum, monthShort, parseISO, peso, pesoShort, todayISO, type CropInfo } from "./cropData";

/* ================= harvest date tile (a little calendar leaf) ================= */

export function HarvestTile({ iso, label = "Harvest" }: { iso: string; label?: string }) {
  if (!parseISO(iso)) return null;
  return (
    <div className="cal-tile" aria-label={`${label} ${dateText(iso)}`}>
      <span className="cal-tile-month">{monthShort(iso)}</span>
      <b className="cal-tile-day">{dayNum(iso)}</b>
      <small>{label}</small>
    </div>
  );
}

/* ================= maturity timeline ================= */

export interface Seg {
  from: number; // days after the start date
  days: number; // typical length
  lo?: number; // earliest length (p10 / minimum)
  hi?: number; // latest length (p90 / maximum)
  label: string;
  tone: "pre" | "rice" | "crop" | "r1" | "r2" | "r3";
}
export interface MaturityRow {
  key: string;
  label: string;
  badge?: string;
  sub?: string;
  segs: Seg[];
}

const pct = (v: number, total: number) => `${Math.max(0, Math.min(100, (v / total) * 100))}%`;

export function MaturityChart({
  rows,
  startDate,
  title,
  note,
}: {
  rows: MaturityRow[];
  startDate?: string; // when given, the axis shows months; otherwise days
  title: string;
  note?: string;
}) {
  const { total, ticks } = useMemo(() => {
    const end = Math.max(30, ...rows.flatMap((r) => r.segs.map((s) => s.from + Math.max(s.days, s.hi ?? 0))));
    const total = Math.ceil((end + 8) / 10) * 10;
    const ticks: { pos: number; label: string }[] = [];
    const base = startDate ? parseISO(startDate) : null;
    if (base !== null) {
      const b = new Date(base);
      for (let i = 0; i < 40; i++) {
        const t = Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + i, 1);
        const off = Math.round((t - base) / 86_400_000);
        if (off > total) break;
        if (off < 0) continue;
        const d = new Date(t);
        ticks.push({ pos: off, label: d.getUTCMonth() === 0 || ticks.length === 0 ? `${monthShort(d.toISOString().slice(0, 10))} ’${String(d.getUTCFullYear()).slice(2)}` : monthShort(d.toISOString().slice(0, 10)) });
      }
    } else {
      const step = total <= 150 ? 30 : 60;
      for (let d = 0; d <= total; d += step) ticks.push({ pos: d, label: d === 0 ? "0" : `${d} d` });
    }
    return { total, ticks };
  }, [rows, startDate]);

  const summary = rows
    .map((r) => `${r.label}: ${r.segs.map((s) => `${s.label} about ${Math.round(s.days)} days`).join(", then ")}`)
    .join(". ");

  return (
    <section className="mc" aria-label={title}>
      <h3 className="mc-title">{title}</h3>
      {note && <p className="mc-note">{note}</p>}
      <div role="img" aria-label={summary}>
        <div className="mc-axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t.pos} style={{ left: pct(t.pos, total) }}>
              {t.label}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div className="mc-row" key={r.key}>
            <div className="mc-head">
              <b>{r.label}</b>
              {r.badge && <span className="mc-badge">{r.badge}</span>}
              {r.sub && <small>{r.sub}</small>}
            </div>
            <div className="mc-track" aria-hidden="true">
              {ticks.map((t) => (
                <i className="mc-grid" key={t.pos} style={{ left: pct(t.pos, total) }} />
              ))}
              {r.segs.map((s, i) => (
                <span key={i}>
                  {s.lo != null && s.hi != null && s.hi > s.lo && (
                    <i className={`mc-band ${s.tone}`} style={{ left: pct(s.from + s.lo, total), width: pct(s.hi - s.lo, total) }} />
                  )}
                  <span className={`mc-bar ${s.tone}`} style={{ left: pct(s.from, total), width: pct(s.days, total) }}>
                    {s.days >= total * 0.16 ? `${s.label} · ${Math.round(s.days)} d` : `${Math.round(s.days)} d`}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mc-legend">Solid bar = typical time to harvest. Lighter extension = the earlier–later range.</p>
    </section>
  );
}

/* ================= income vs cost ================= */

export interface EconRow {
  key: string;
  label: string;
  econ: PlanEcon;
  badge?: string;
}

export function netOf(e: PlanEcon, otherCostHa: number) {
  return {
    low: e.incomeLow - e.costHigh - otherCostHa,
    mid: e.incomeMid - e.costMid - otherCostHa,
    high: e.incomeHigh - e.costLow - otherCostHa,
  };
}

export function EconChart({ rows, areaHa, otherCostHa = 0, title }: { rows: EconRow[]; areaHa: number; otherCostHa?: number; title: string }) {
  const m = areaHa > 0 ? areaHa : 1;
  const max = Math.max(1, ...rows.map((r) => r.econ.incomeHigh * m));
  const unit = areaHa > 0 ? `for your ${fmtHa(areaHa)} ha farm` : "per hectare";
  return (
    <section className="ec" aria-label={title}>
      <h3 className="mc-title">{title}</h3>
      <p className="mc-note">Estimated {unit}. The thin line on the income bar is the low–high range.</p>
      {rows.map((r) => {
        const income = r.econ.incomeMid * m;
        const cost = (r.econ.costMid + otherCostHa) * m;
        const net = income - cost;
        return (
          <div className="ec-row" key={r.key}>
            <div className="mc-head">
              <b>{r.label}</b>
              {r.badge && <span className="mc-badge">{r.badge}</span>}
            </div>
            <div className="ec-bars">
              <div className="ec-line">
                <span className="ec-tag">Income</span>
                <div className="ec-track">
                  <span className="ec-bar income" style={{ width: pct(income, max) }} />
                  <i className="ec-whisker" style={{ left: pct(r.econ.incomeLow * m, max), width: pct((r.econ.incomeHigh - r.econ.incomeLow) * m, max) }} />
                </div>
                <b className="ec-val">{pesoShort(income)}</b>
              </div>
              <div className="ec-line">
                <span className="ec-tag">Cost</span>
                <div className="ec-track">
                  <span className="ec-bar cost" style={{ width: pct(cost, max) }} />
                </div>
                <b className="ec-val">{pesoShort(cost)}</b>
              </div>
            </div>
            <p className={`ec-net ${net >= 0 ? "pos" : "neg"}`}>
              {net >= 0 ? "Left after costs" : "Short by"} about <b>{pesoShort(Math.abs(net))}</b>
            </p>
          </div>
        );
      })}
      <p className="mc-legend">Cost = seed or planting material{otherCostHa > 0 ? " plus the other costs you entered" : " only"}. Prices and yields are estimates.</p>
    </section>
  );
}

export const fmtHa = (ha: number) => (ha < 0.1 ? ha.toFixed(3) : ha.toFixed(2));

// Optional box: labour, fertiliser, water and so on, per hectare.
export function OtherCostField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="plan-field ec-other">
      <span>Other costs per hectare (optional)</span>
      <input
        value={value}
        inputMode="decimal"
        placeholder="₱ for labour, fertilizer, water…"
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        autoComplete="off"
      />
      <small className="plan-raw">The chart counts seed only. Add your other costs per hectare to see what is left.</small>
    </label>
  );
}

// One option in words: income, cost, what is left, for the farm's size.
export function EconSummary({ econ, areaHa, otherCostHa = 0 }: { econ: PlanEcon; areaHa: number; otherCostHa?: number }) {
  const m = areaHa > 0 ? areaHa : 1;
  const n = netOf(econ, otherCostHa);
  return (
    <div className="es">
      <div className="es-grid">
        <div>
          <small>Income</small>
          <b>{peso(econ.incomeMid * m)}</b>
          <span>{pesoShort(econ.incomeLow * m)}–{pesoShort(econ.incomeHigh * m)}</span>
        </div>
        <div>
          <small>Cost</small>
          <b>{peso((econ.costMid + otherCostHa) * m)}</b>
          <span>{otherCostHa > 0 ? "seed + other" : "seed only"}</span>
        </div>
        <div className={n.mid >= 0 ? "pos" : "neg"}>
          <small>Left over</small>
          <b>{peso(n.mid * m)}</b>
          <span>{pesoShort(n.low * m)}–{pesoShort(n.high * m)}</span>
        </div>
      </div>
      <p className="plan-raw">
        {areaHa > 0 ? `For your ${fmtHa(areaHa)} ha farm. ` : ""}Per hectare: {peso(econ.incomeMid)} income, {peso(econ.costMid + otherCostHa)} cost.
      </p>
    </div>
  );
}

/* ================= dashboard: future crops ================= */

export function FutureCrops({
  plans,
  areaHa,
  onRemove,
  onOpen,
}: {
  plans: FuturePlan[];
  areaHa: number;
  onRemove: (id: string) => void;
  onOpen: () => void;
}) {
  const today = todayISO();
  const sorted = [...plans].sort((a, b) => a.plantingDate.localeCompare(b.plantingDate));
  return (
    <section className="fc" aria-label="Future crops" data-tour="future">
      <header className="fc-head">
        <h3>FUTURE CROPS</h3>
        <button type="button" className="fc-edit" onClick={onOpen}>
          Change plan
        </button>
      </header>
      {sorted.map((p) => {
        const toPlant = dayDiff(today, p.plantingDate);
        const span = Math.max(1, dayDiff(p.plantingDate, p.harvestDate));
        const progress = Math.max(0, Math.min(1, dayDiff(p.plantingDate, today) / span));
        const status =
          toPlant > 0 ? `Plant in ${toPlant} day${toPlant === 1 ? "" : "s"}` : dayDiff(today, p.harvestDate) > 0 ? "Growing now" : "Ready to harvest";
        const info: CropInfo | null = p.cropKey ? CROP_DATA[p.cropKey] ?? null : null;
        const m = areaHa > 0 ? areaHa : 1;
        const econ = p.econ ?? (info ? cropEcon(info) : null);
        return (
          <article className="fc-item" key={p.id}>
            <div className="fc-top">
              <span className="fc-emoji" aria-hidden="true">{p.kind === "rice" ? "🌾" : info?.emoji ?? "🌱"}</span>
              <div className="fc-name">
                <b>{p.name}</b>
                <span className={`fc-pill ${p.kind}`}>{p.kind === "rice" ? "Future rice" : "Future crop"}</span>
              </div>
              <button type="button" className="fc-x" aria-label={`Remove ${p.name} from future crops`} onClick={() => onRemove(p.id)}>
                ×
              </button>
            </div>
            <div className="fc-dates">
              <HarvestTile iso={p.plantingDate} label="Plant" />
              <div className="fc-mid">
                <span className="fc-status">{status}</span>
                <div className="fc-bar" aria-hidden="true">
                  <i style={{ width: `${progress * 100}%` }} />
                </div>
                <small>About {p.maturityDays} days to harvest</small>
              </div>
              <HarvestTile iso={p.harvestDate} label="Harvest" />
            </div>
            {econ && (
              <p className="fc-econ">
                Income about <b>{pesoShort(econ.incomeMid * m)}</b> · cost <b>{pesoShort(econ.costMid * m)}</b>
                {areaHa > 0 ? ` · ${fmtHa(areaHa)} ha` : " per ha"}
              </p>
            )}
          </article>
        );
      })}
      <p className="fc-note">Estimates only. Cost counts seed. Tap Change plan to compare other options.</p>
    </section>
  );
}

/* ================= crop guide: planning numbers for one crop ================= */

export function CropPlanFacts({ info }: { info: CropInfo }) {
  const e = cropEcon(info);
  const total = info.days.max * 1.05;
  return (
    <div className="cpf">
      <div className="cpf-days" aria-label={`Typical ${info.days.typ} days, range ${info.days.min} to ${info.days.max} days`}>
        <div className="cpf-track" aria-hidden="true">
          <i className="cpf-range" style={{ left: pct(info.days.min, total), width: pct(info.days.max - info.days.min, total) }} />
          <b className="cpf-dot" style={{ left: pct(info.days.typ, total) } as CSSProperties} />
        </div>
        <span>
          <b>~{info.days.typ} days</b> to harvest <small>(range {info.days.min}–{info.days.max})</small>
        </span>
      </div>
      <dl className="cpf-grid">
        <div>
          <dt>Seed per hectare</dt>
          <dd>
            {info.seed.priceLow === info.seed.priceHigh ? peso(e.costMid) : `${peso(e.costLow)}–${peso(e.costHigh)}`}
            <small>{info.seed.rate}</small>
          </dd>
        </div>
        <div>
          <dt>Income per hectare</dt>
          <dd>
            {pesoShort(e.incomeLow)}–{pesoShort(e.incomeHigh)}
            <small>
              {info.yieldT.typ} t × ₱{info.price.typ}/kg ({info.sold})
            </small>
          </dd>
        </div>
      </dl>
      <p className="cpf-basis">
        {info.rough && <span className="cpf-rough">Rough estimate</span>} {info.basis}
      </p>
    </div>
  );
}

export function CropDaysOverview() {
  const rows: MaturityRow[] = Object.values(CROP_DATA)
    .sort((a, b) => a.days.typ - b.days.typ)
    .map((c) => ({
      key: c.key,
      label: `${c.emoji} ${c.label}`,
      segs: [{ from: 0, days: c.days.typ, lo: c.days.min, hi: c.days.max, label: c.label, tone: "crop" as const }],
    }));
  return <MaturityChart rows={rows} title="How long each crop takes" note="Days from planting to harvest, shortest first. Sugarcane takes close to a year, so it does not fit before the next rice." />;
}