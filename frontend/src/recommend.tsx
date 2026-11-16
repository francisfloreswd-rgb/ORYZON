/* Plan next season: the spec's recommendation flow (AGENT-README.md §3, §6).
   Previous Farm Record -> branch selector -> planting date -> top-3 lists -> Yields.
   Top-3 lists display best first: rank 1, rank 2, rank 3, with rank badges.
   "A crop before rice" is NOT simulated (the DSSAT backend only simulates rice). Those options come from the
   reference table in cropData.ts (typical days to harvest, yield, price, seed cost). Only the rice that follows
   the chosen crop is simulated, starting on the crop's harvest date.
   "percent of ideal" is relative yield (RY) — the term RY never appears in the UI.
   Absolute yields are never summed (rule 4): the end screen shows separate figures. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { centroid, loadStore, polygonAreaHa, type Farm } from "./map";
import { fetchCandidates, fetchExperiments, getRecommendation, startRecommendation, HttpError } from "./api";
import type { Branch, Candidates, ExperimentPreset, FuturePlan, RecommendationResult, RangeStat, VarietyEntry } from "./types";
import { CROP_DATA, cropEcon, cropInfo, dateText, isoAdd, riceEcon, type CropInfo } from "./cropData";
import { CropPlanFacts, EconChart, EconSummary, HarvestTile, MaturityChart, OtherCostField, type EconRow, type MaturityRow } from "./planVisuals";

const BRANCHES: { value: Branch; label: string; hint: string }[] = [
  { value: "rice", label: "Rice", hint: "Which rice variety to plant next" },
  { value: "yield_crops", label: "A crop before rice", hint: "Compare crops for the season before rice" },
];

// Spec §4: the fixed label for the soil net-change block.
const SOIL_NOTE =
  "Model-derived, not field-validated; two-season carbon change is small relative to model uncertainty.";

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}
function pctOf(r: RangeStat) {
  const base = `${pct(r.mean)} of ideal`;
  if (r.p10 == null || r.p90 == null) return base;
  return `${base} (${pct(r.p10)}–${pct(r.p90)})`;
}
function presetSummary(x: ExperimentPreset) {
  const est = x.establishment === "T" ? "transplanted" : "direct-seeded";
  return `${est} · ${x.irrigation} irrigation · ${x.fertilizer_kg_n_ha} kg N/ha in ${x.fertilizer_events} splits`;
}
function kg(v: number | null | undefined) {
  return v == null ? "—" : `${Math.round(v).toLocaleString("en-US")} kg DM/ha`;
}

// Waits `ms`, or less if `signal` is aborted.
function addDays(isoDate: string, days: number): Date | null {
  if (!isoDate || !Number.isFinite(days)) return null;
  const parts = isoDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  const result = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  result.setUTCDate(result.getUTCDate() + Math.round(days));
  return result;
}
function maturityLabel(stat: RangeStat | null | undefined, planDate: string, label = "Estimated maturity") {
  if (!stat || !Number.isFinite(stat.mean)) return null;
  const projected = addDays(planDate, stat.mean);
  const dateLabel = projected
    ? new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(projected)
    : null;
  const range = stat.p10 != null && stat.p90 != null
    ? "Typical range: " + Math.round(stat.p10) + "–" + Math.round(stat.p90) + " days"
    : "Based on one successful weather scenario";
  return (
    <div className="plan-maturity">
      <b>{label}</b>
      {dateLabel && <strong>{dateLabel}</strong>}
      <span>About {Math.round(stat.mean)} days after planting · {range}</span>
    </div>
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(t); resolve(); }, { once: true });
  });
}
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const POLL_MS = 2000;           // how often a running simulation is checked (one check at a time, never overlapping)
const MAX_FAILS = 8;            // this many checks in a row without an answer (about 2 minutes) and we stop and say so
const STALL_HINT_MS = 90_000;   // still at 0 runs after this long: explain why

// How the rice cultivars to simulate are chosen.
type CultivarMode = "best" | "random" | "custom";
const MAX_CULTIVARS = 10;
const BEST_COUNT = 3; // how many cultivars "Pick the best for me" simulates
const CULTIVAR_MODES: { value: CultivarMode; label: string; hint: string }[] = [
  { value: "best", label: "Pick the best for me", hint: "We choose the cultivars. Fastest option." },
  { value: "random", label: "Try 10 random cultivars", hint: "Takes a lot longer to simulate." },
  { value: "custom", label: "I'll choose my own", hint: "Pick up to 10 from the full list." },
];
function pickRandom<T>(list: T[], n: number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// ---- Farming tips shown while a simulation runs ----
const TIP_MS = 9000; // a tip stays this long, then the next one appears (tapping a tip skips ahead)
const FARM_TIPS: { title: string; text: string }[] = [
  { title: "Level the field", text: "A well-levelled field holds water evenly, so seedlings emerge together and less water is wasted." },
  { title: "Use clean, healthy seed", text: "Good seed gives even emergence and fewer disease problems. Soaking seed in salt water and keeping only the ones that sink removes light, poor grains." },
  { title: "Watch the water at tillering", text: "Keeping a shallow layer of water in the early weeks helps control weeds, but there is no need to keep the field deeply flooded." },
  { title: "Alternate wetting and drying", text: "Letting the field dry briefly between irrigations (without stressing the plants) can save water and reduce methane from flooded paddies." },
  { title: "Split your nitrogen", text: "Applying fertilizer in two or three smaller doses, instead of all at once, lets the crop use more of it and lets less wash away." },
  { title: "Match fertilizer to the soil", text: "A soil test shows what your field actually needs. It can save money on fertilizer you would not have used." },
  { title: "Check for pests regularly", text: "Walk the field every few days. Catching planthoppers, stem borers or disease early makes them far easier to manage." },
  { title: "Keep the harvest moisture right", text: "Harvest when most grains in the panicle have turned straw-colored, and dry the grain soon after to avoid spoilage and broken grains." },
  { title: "Rotate your crops", text: "Growing something other than rice between seasons, such as mung beans, can break pest cycles and improve the soil." },
  { title: "Legumes feed the soil", text: "Mung bean and other legumes work with soil bacteria to capture nitrogen from the air. Leaving the residues in the field gives some of it back." },
  { title: "Return the straw", text: "Straw left or worked back into the field returns organic matter and nutrients to the soil. Burning it loses most of that." },
  { title: "Plan around the rains", text: "Timing planting so that the critical flowering stage avoids typhoon season and very hot days can protect your yield." },
  { title: "Keep records", text: "Writing down planting dates, inputs and harvests each season helps you see what worked and makes every future plan better." },
  { title: "Talk to your neighbors", text: "Farmers' associations and your local agriculture office often share local advice on varieties, pests and water schedules." },
];

// Rotates on its own, and a tap or click moves to the next tip right away. The timer restarts after every change,
// so a tip you just tapped always gets its full time on screen.
function FarmTips() {
  const [i, setI] = useState(() => Math.floor(Math.random() * FARM_TIPS.length));
  useEffect(() => {
    const t = window.setTimeout(() => setI((n) => (n + 1) % FARM_TIPS.length), TIP_MS);
    return () => window.clearTimeout(t);
  }, [i]);
  const tip = FARM_TIPS[i];
  return (
    <button
      type="button"
      className="plan-tip"
      onClick={() => setI((n) => (n + 1) % FARM_TIPS.length)}
      aria-label={`Farming tip: ${tip.title}. ${tip.text} Tap for the next tip.`}
    >
      <span className="plan-tip-label">Farming tip</span>
      <span className="plan-tip-body" key={i}>
        <b>{tip.title}</b>
        <span>{tip.text}</span>
      </span>
      <span className="plan-tip-foot" aria-hidden="true">
        <span className="plan-tip-bar" key={`bar-${i}`} style={{ animationDuration: `${TIP_MS}ms` }} />
        <small>Tap for the next tip</small>
      </span>
    </button>
  );
}

// ---- Maturity and money views for the result screens ----

// When the simulation gave no maturity for a crop, use the reference table (typical days and the usual range).
function refStat(name: string): RangeStat | null {
  const info = cropInfo(name);
  return info ? { mean: info.days.typ, p10: info.days.min, p90: info.days.max } : null;
}

const RANK_TONE = ["r1", "r2", "r3"] as const;

// Crops that take longer than this to harvest do not fit in the gap before the next rice (sugarcane, about 11 months).
const MAX_PRE_DAYS = 200;

// The options for "A crop before rice", straight from the reference table. Ranked by money left after seed
// (typical income minus seed cost, per hectare).
function referenceCrops(): { ranked: { info: CropInfo; rank: number }[]; skipped: CropInfo[] } {
  const all = Object.values(CROP_DATA);
  const ranked = all
    .filter((c) => c.days.typ <= MAX_PRE_DAYS)
    .map((info) => {
      const e = cropEcon(info);
      return { info, net: e.incomeMid - e.costMid };
    })
    .sort((a, b) => b.net - a.net)
    .map((x, i) => ({ info: x.info, rank: i + 1 }));
  return { ranked, skipped: all.filter((c) => c.days.typ > MAX_PRE_DAYS) };
}

function CropCompare({ crops, plantingDate, areaHa, otherCostHa }: { crops: { crop: string; rank: number; maturity_days?: RangeStat | null }[]; plantingDate: string; areaHa: number; otherCostHa: number }) {
  const sorted = [...crops].sort((a, b) => a.rank - b.rank);
  const rows: MaturityRow[] = sorted.map((c, i) => {
    const info = cropInfo(c.crop);
    const stat = c.maturity_days ?? refStat(c.crop);
    return {
      key: c.crop,
      label: `${info?.emoji ?? "🌱"} ${info?.label ?? c.crop}`,
      badge: `#${c.rank}`,
      sub: c.maturity_days ? "simulated" : "reference data",
      segs: stat
        ? [{ from: 0, days: stat.mean, lo: stat.p10 ?? undefined, hi: stat.p90 ?? undefined, label: info?.label ?? c.crop, tone: RANK_TONE[Math.min(i, 2)] }]
        : [],
    };
  }).filter((r) => r.segs.length > 0);
  const money: EconRow[] = sorted.flatMap((c) => {
    const info = cropInfo(c.crop);
    return info ? [{ key: c.crop, label: `${info.emoji} ${info.label}`, badge: `#${c.rank}`, econ: cropEcon(info) }] : [];
  });
  return (
    <>
      {rows.length > 0 && <MaturityChart rows={rows} startDate={plantingDate} title="When each crop is ready" note="Starting from your planting date." />}
      {money.length > 0 && <EconChart rows={money} areaHa={areaHa} otherCostHa={otherCostHa} title="Income and cost" />}
    </>
  );
}

function RiceCompare({
  varieties,
  plantingDate,
  areaHa,
  otherCostHa,
  preDays,
  preName,
}: {
  varieties: VarietyEntry[];
  plantingDate: string; // when the first crop is planted (the rice date when there is no crop before it)
  areaHa: number;
  otherCostHa: number;
  preDays: number | null; // days the crop before rice takes; the rice is simulated from its harvest
  preName: string | null;
}) {
  const sorted = [...varieties].sort((a, b) => a.rank - b.rank);
  const rows: MaturityRow[] = sorted.flatMap((v, i) => {
    const rice = v.maturity_days;
    if (!rice) return [];
    const fromStart = v.days_from_plan_start?.mean ?? rice.mean;
    const lead = preName && preDays ? preDays : 0;
    const riceStart = lead + Math.max(0, fromStart - rice.mean);
    const segs: MaturityRow["segs"] = [];
    if (preName && lead > 0) segs.push({ from: 0, days: lead, label: preName, tone: "pre" });
    segs.push({ from: riceStart, days: rice.mean, lo: rice.p10 ?? undefined, hi: rice.p90 ?? undefined, label: "Rice", tone: RANK_TONE[Math.min(i, 2)] });
    return [{ key: v.variety, label: v.variety, badge: `#${v.rank}`, segs }];
  });
  const money: EconRow[] = sorted.map((v) => ({ key: v.variety, label: v.variety, badge: `#${v.rank}`, econ: riceEcon(v.rice_actual.mean) }));
  return (
    <>
      {rows.length > 0 && (
        <MaturityChart
          rows={rows}
          startDate={plantingDate}
          title="When each rice variety is ready"
          note={preName ? "The gold bar is the crop before rice; the green bars are the rice that follows." : "Starting from your planting date."}
        />
      )}
      {money.length > 0 && <EconChart rows={money} areaHa={areaHa} otherCostHa={otherCostHa} title="Rice income and cost" />}
    </>
  );
}

type Phase =
  | { kind: "form" }
  | { kind: "running"; runId: string; label: string }
  | { kind: "refcrops" } // crop options from the reference table (no simulation)
  | { kind: "varieties"; result: RecommendationResult }
  | { kind: "yields"; result: RecommendationResult };

export function PlanNext({
  onBack,
  initialBranch,
  onChoose,
}: {
  onBack?: () => void;
  initialBranch?: Branch;
  // called when the farmer picks a crop or a rice variety, so it can be saved on the farm and shown on the Dashboard
  onChoose?: (farmId: string, plan: FuturePlan, opts?: { clearPre?: boolean }) => void;
}) {
  const [store] = useState(() => loadStore());
  const [farmId, setFarmId] = useState(store.activeId ?? store.farms[0]?.id ?? "");
  const [branch, setBranch] = useState<Branch>(initialBranch ?? "rice");
  const [establishment, setEstablishment] = useState<"T" | "DS">("DS");
  const [pdate, setPdate] = useState("");
  const [cands, setCands] = useState<Candidates | null>(null);
  const [cultivarMode, setCultivarMode] = useState<CultivarMode>("best");
  const [selectedCultivars, setSelectedCultivars] = useState<string[]>([]);
  const [candsError, setCandsError] = useState<string | null>(null);
  const [presets, setPresets] = useState<ExperimentPreset[]>([]);
  const [experimentId, setExperimentId] = useState(""); // "" = the service's default management
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [progress, setProgress] = useState<{ done: number; total: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false); // waiting for the service to accept the request
  const runCtl = useRef<AbortController | null>(null);   // stops the checking loop of the current run
  const startCtl = useRef<AbortController | null>(null);  // stops the "start the run" request
  const backTo = useRef<Phase>({ kind: "form" });         // where to return if a run fails or is cancelled
  // what the running screen shows: the service's own status ("waiting" = no answer yet), when it began, failed checks
  const [runInfo, setRunInfo] = useState<{ status: "waiting" | "queued" | "running"; startedAt: number; fails: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const farm: Farm | null = store.farms.find((f) => f.id === farmId) ?? null;
  const preset = presets.find((x) => x.id === experimentId) ?? null;
  // A preset fixes how the rice is established (transplanted vs. direct-seeded).
  const effectiveEstablishment = preset ? preset.establishment : establishment;
  const areaHa = farm ? polygonAreaHa(farm.points) : 0;
  const [otherCost, setOtherCost] = useState(""); // other costs per hectare, typed by the farmer
  const otherCostHa = Number(otherCost) > 0 ? Number(otherCost) : 0;
  const [added, setAdded] = useState<{ pre?: string; rice?: string }>({}); // what was added to the Dashboard in this visit
  const preChoice = useRef<{ name: string; days: number } | null>(null); // the crop before rice the farmer picked
  const [afterCrop, setAfterCrop] = useState(false); // the rice results are for the rice that follows that crop
  const [ricePlanDate, setRicePlanDate] = useState(""); // the date the simulated rice starts (the harvest date of the crop before it)

  useEffect(() => {
    // The service sleeps when idle and can take a minute to wake: keep trying instead of giving up on the first miss.
    const c = new AbortController();
    (async () => {
      for (let attempt = 0; attempt < 8 && !c.signal.aborted; attempt++) {
        try {
          const available = await fetchCandidates(c.signal);
          setCands(available);
          setSelectedCultivars((current) => current.filter((id) => available.rice_varieties.some((v) => v.id === id)));
          setCandsError(null);
          return;
        } catch (e) {
          if (c.signal.aborted) return;
          setCandsError(String((e as Error)?.message ?? e));
          await sleep(5000, c.signal);
        }
      }
    })();
    return () => c.abort();
  }, []);
  useEffect(() => {
    // Presets are optional: if the list can't be loaded the picker is simply not shown.
    const c = new AbortController();
    fetchExperiments(c.signal)
      .then((r) => setPresets(r.experiments))
      .catch(() => { /* no picker */ });
    return () => c.abort();
  }, []);
  useEffect(() => () => { runCtl.current?.abort(); startCtl.current?.abort(); }, []);

  // A clock for the "elapsed" time, only while a run is on screen.
  useEffect(() => {
    if (phase.kind !== "running") return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [phase.kind]);

  function stopWatching() {
    runCtl.current?.abort();
    runCtl.current = null;
  }

  // Stop, go back to the screen the farmer came from, and say what happened.
  function failRun(message: string) {
    stopWatching();
    setError(message);
    setProgress(null);
    setRunInfo(null);
    setPhase(backTo.current);
  }

  function cancelRun() {
    stopWatching();
    setError(null);
    setProgress(null);
    setRunInfo(null);
    setPhase(backTo.current);
  }

  // Checks the run one request at a time (the old version fired a new request every 1.5 s even when the last had not
  // come back, which piled requests onto a slow free server). Transient misses are tolerated; a lost run or a long
  // silence is reported instead of spinning forever.
  function watch(runId: string, after: (r: RecommendationResult) => void) {
    stopWatching();
    const ctl = new AbortController();
    runCtl.current = ctl;
    const startedAt = Date.now();
    setRunInfo({ status: "waiting", startedAt, fails: 0 });
    (async () => {
      let fails = 0;
      while (!ctl.signal.aborted) {
        try {
          const st = await getRecommendation(runId, ctl.signal);
          if (ctl.signal.aborted) return;
          fails = 0;
          setProgress(st.progress);
          if (st.status === "done") {
            if (st.result) {
              stopWatching();
              setRunInfo(null);
              after(st.result);
            } else {
              failRun("The simulation finished but returned no result. Please try again.");
            }
            return;
          }
          if (st.status === "failed") {
            failRun(st.error ?? "The recommendation run failed.");
            return;
          }
          setRunInfo({ status: st.status === "queued" ? "queued" : "running", startedAt, fails: 0 });
        } catch (e) {
          if (ctl.signal.aborted) return;
          if (e instanceof HttpError && e.status === 404) {
            // The service no longer knows this run: it restarted (free servers do) and runs are kept in memory.
            failRun("The simulation service restarted and lost this run. Please start it again.");
            return;
          }
          fails += 1;
          setRunInfo((prev) => (prev ? { ...prev, fails } : prev));
          if (fails >= MAX_FAILS) {
            failRun("Lost contact with the simulation service. Wait a minute for it to wake up, then try again.");
            return;
          }
        }
        await sleep(POLL_MS, ctl.signal);
      }
    })();
  }

  // The cultivar choice is valid for the chosen mode ("best" needs nothing, "random" needs the list loaded).
  const cultivarsOk =
    branch !== "rice" ||
    (((cultivarMode === "best" || cultivarMode === "random") && !!cands && cands.rice_varieties.length > 0) ||
      (cultivarMode === "custom" && selectedCultivars.length >= 1 && selectedCultivars.length <= MAX_CULTIVARS));

  // The ids to send: undefined = let the service choose; otherwise an explicit list.
  function cultivarIdsToSend(mode: CultivarMode): string[] | undefined {
    if (mode === "custom") return selectedCultivars;
    if (mode === "random") return pickRandom(cands?.rice_varieties ?? [], MAX_CULTIVARS).map((v) => v.id);
    // "best": a small explicit shortlist so the run stays fast. Prefer cultivars the farming-practice presets
    // were built around (known to be calibrated), then fill from the start of the list.
    // TODO: replace with your agronomists' recommended shortlist (an array of cultivar ids).
    const available = new Set((cands?.rice_varieties ?? []).map((v) => v.id));
    const fromPresets = presets.map((x) => x.cultivar).filter((id) => available.has(id));
    const fill = (cands?.rice_varieties ?? []).map((v) => v.id);
    return [...new Set([...fromPresets, ...fill])].slice(0, BEST_COUNT);
  }

  // Starts a RICE simulation. `riceDate` is given when rice follows a crop before rice: it is that crop's harvest date.
  // (Only rice is simulated; the crop before rice comes from the reference table.)
  function launch(riceDate?: string) {
    const startDate = riceDate ?? pdate;
    if (!farm || !startDate || starting) return;
    if (!riceDate && !cultivarsOk) return;
    // After a crop, keep the run short: let the service pick a small shortlist of cultivars.
    const cultivarIds = cultivarIdsToSend(riceDate ? "best" : cultivarMode);
    setError(null);
    setStarting(true);
    // If this run fails or is cancelled, return to where the farmer is now (the crop choice, or the form).
    backTo.current = riceDate ? { kind: "refcrops" } : { kind: "form" };
    startCtl.current?.abort();
    const ctl = new AbortController();
    startCtl.current = ctl;
    const [lat, lng] = centroid(farm.points);
    startRecommendation({
      farm: { lat, lon: lng, establishment: effectiveEstablishment },
      branch: "rice",
      planting_date: startDate,
      ...(experimentId ? { experiment_id: experimentId } : {}),
      ...(cultivarIds ? { cultivar_ids: cultivarIds } : {}),
    }, ctl.signal)
      .then(({ run_id }) => {
        if (ctl.signal.aborted) return;
        setProgress(null);
        setRicePlanDate(startDate);
        setAfterCrop(!!riceDate);
        setPhase({
          kind: "running",
          runId: run_id,
          label: riceDate && preChoice.current
            ? `Rice after ${preChoice.current.name}: comparing rice varieties…`
            : "Simulating the season under past weather…",
        });
        watch(run_id, (r) => setPhase({ kind: "varieties", result: r }));
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(String(e?.message ?? e));
      })
      .finally(() => setStarting(false));
  }

  // "A crop before rice": no simulation. Show the reference-table crops for the farmer to choose from.
  function showReferenceCrops() {
    if (!farm || !pdate) return;
    setError(null);
    preChoice.current = null;
    setAdded({});
    setAfterCrop(false);
    setPhase({ kind: "refcrops" });
  }

  // The farmer picked a crop before rice: save it on the farm (it appears on the Dashboard), then simulate the rice
  // that follows, starting on the day this crop is harvested.
  function chooseCrop(info: CropInfo) {
    if (!farm || !pdate) return;
    const days = info.days.typ;
    const plan: FuturePlan = {
      id: "pre",
      kind: "yield_crop",
      name: info.label,
      cropKey: info.key,
      plantingDate: pdate,
      harvestDate: isoAdd(pdate, days),
      maturityDays: Math.round(days),
      yieldKgHa: info.yieldT.typ * 1000,
      econ: cropEcon(info),
      savedAt: Date.now(),
    };
    onChoose?.(farm.id, plan);
    preChoice.current = { name: plan.name, days: plan.maturityDays };
    setAdded((a) => ({ ...a, pre: plan.name }));
    launch(plan.harvestDate);
  }

  // The farmer picked a rice variety: save it on the farm.
  function chooseRice(v: VarietyEntry) {
    const riceDays = v.maturity_days?.mean;
    if (!farm || !pdate || riceDays == null) return;
    const fromStart = v.days_from_plan_start?.mean ?? riceDays;
    const plan: FuturePlan = {
      id: "rice",
      kind: "rice",
      name: v.variety,
      cropKey: null,
      plantingDate: isoAdd(ricePlanDate, Math.max(0, fromStart - riceDays)),
      harvestDate: isoAdd(ricePlanDate, fromStart),
      maturityDays: Math.round(riceDays),
      yieldKgHa: v.rice_actual.mean,
      econ: riceEcon(v.rice_actual.mean),
      savedAt: Date.now(),
    };
    onChoose?.(farm.id, plan, { clearPre: !afterCrop });
    setAdded((a) => ({ ...a, rice: v.variety }));
  }
  const riceAction = (v: VarietyEntry) => {
    if (!v.maturity_days) return null;
    const done = added.rice === v.variety;
    return (
      <button type="button" className={`plan-add ${done ? "done" : ""}`} disabled={done} onClick={() => chooseRice(v)}>
        {done ? "✓ Added to your dashboard" : "Plant this variety"}
      </button>
    );
  };

  const byRank = (list: VarietyEntry[]) => [...list].sort((a, b) => a.rank - b.rank);

  return (
    <>
      {phase.kind === "form" && (
        <form
          className="plan-form plan"
          onSubmit={(e) => { e.preventDefault(); if (branch === "yield_crops") showReferenceCrops(); else launch(); }}
        >
          <header className="plan-top">
            <button type="button" className="plan-back" onClick={onBack}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
              Dashboard
            </button>
            <p className="plan-intro">
              {branch === "yield_crops"
                ? "Crops before rice are compared using typical days to harvest, yield and price. The rice that follows is simulated under past weather."
                : "Choose what you want to plant and when. We simulate the season under past weather to compare your options."}
            </p>
          </header>
          {store.farms.length === 0 ? (
            <p className="plan-note">Set up a farm on the map first — the plan uses your farm's answers.</p>
          ) : (
            <>
                  <label className="plan-field">
                <span>Farm</span>
                <select value={farmId} onChange={(e) => setFarmId(e.target.value)}>
                  {store.farms.map((f) => (
                    <option key={f.id} value={f.id}>{f.name.trim() || "Unnamed farm"}</option>
                  ))}
                </select>
              </label>

              <fieldset className="plan-radios">
                <legend>What to plant next?</legend>
                {BRANCHES.map((b) => (
                  <label key={b.value} className="plan-radio">
                    <input
                      type="radio"
                      name="branch"
                      value={b.value}
                      checked={branch === b.value}
                      onChange={() => setBranch(b.value)}
                    />
                    <span>
                      <b>{b.label}</b>
                      <small>{b.hint}</small>
                    </span>
                  </label>
                ))}
              </fieldset>

              {(
                <fieldset className="plan-radios">
                  <legend>How will the rice be established?</legend>
                  <label className="plan-radio">
                    <input type="radio" name="est" disabled={!!preset} checked={effectiveEstablishment === "T"} onChange={() => setEstablishment("T")} />
                    <span><b>Transplanted</b></span>
                  </label>
                  <label className="plan-radio">
                    <input type="radio" name="est" disabled={!!preset} checked={effectiveEstablishment === "DS"} onChange={() => setEstablishment("DS")} />
                    <span><b>Direct-seeded</b></span>
                  </label>
                </fieldset>
              )}

              {presets.length > 0 && (
                <label className="plan-field">
                  <span>Farming practice</span>
                  <select value={experimentId} onChange={(e) => setExperimentId(e.target.value)}>
                    <option value="">Standard practice (default)</option>
                    {presets.map((x) => (
                      <option key={x.id} value={x.id}>{x.title || x.id}</option>
                    ))}
                  </select>
                  {preset && (
                    <small className="plan-raw">
                      {presetSummary(preset)}. Dates are moved onto your planting date; weather and soil are your farm's.
                    </small>
                  )}
                </label>
              )}

              {branch === "rice" && (
                <fieldset className="plan-radios">
                  <legend>Which rice cultivars should we compare?</legend>
                  {CULTIVAR_MODES.map((m) => (
                    <label key={m.value} className="plan-radio">
                      <input
                        type="radio"
                        name="cultivar-mode"
                        value={m.value}
                        checked={cultivarMode === m.value}
                        onChange={() => setCultivarMode(m.value)}
                      />
                      <span>
                        <b>{m.label}</b>
                        <small>{m.hint}</small>
                      </span>
                    </label>
                  ))}

                  {cultivarMode === "random" && cands && (
                    <p className="plan-note">
                      Estimated runs: {Math.min(MAX_CULTIVARS, cands.rice_varieties.length) * cands.weather_windows * 2}
                      {" "}(10 cultivars × {cands.weather_windows} weather windows × actual/ideal). A new random set is drawn each time.
                    </p>
                  )}

                  {cultivarMode === "custom" && (
                    <>
                      <p className="plan-note">
                        Choose 1–{MAX_CULTIVARS} cultivars.
                        {cands ? ` ${cands.rice_varieties.length} available.` : " Loading the list…"}
                      </p>
                      <div className="plan-cultivar-actions">
                        <button type="button" className="plan-run secondary"
                          onClick={() => setSelectedCultivars([])}
                          disabled={selectedCultivars.length === 0}>
                          Clear
                        </button>
                        <b>{selectedCultivars.length}/{MAX_CULTIVARS} selected</b>
                      </div>
                      {cands?.rice_varieties.map((v) => {
                        const checked = selectedCultivars.includes(v.id);
                        return (
                          <label key={v.id} className="plan-radio">
                            <input type="checkbox" checked={checked}
                              disabled={!checked && selectedCultivars.length >= MAX_CULTIVARS}
                              onChange={(e) => setSelectedCultivars((current) =>
                                e.target.checked ? [...current, v.id] : current.filter((id) => id !== v.id)
                              )} />
                            <span><b>{v.id}</b><small>{v.name}</small></span>
                          </label>
                        );
                      })}
                      {cands && selectedCultivars.length > 0 && (
                        <p className="plan-note">
                          Estimated runs: {selectedCultivars.length * cands.weather_windows * 2}
                          {" "}({selectedCultivars.length} cultivars × {cands.weather_windows} weather windows × actual/ideal).
                        </p>
                      )}
                    </>
                  )}
                </fieldset>
              )}

              <label className="plan-field">
                <span>Planting date</span>
                <input
                  type="date"
                  required
                  value={pdate}
                  onChange={(e) => setPdate(e.target.value)}
                />
              </label>

              <p className="plan-note">
                {branch === "yield_crops"
                  ? "Crop options come from the app's reference data, not a simulation. Only the rice after the crop is simulated."
                  : cands
                    ? `Available rice cultivars: ${cands.rice_varieties.length}.`
                    : "Checking what is calibrated on the service…"}
                {branch === "rice" && candsError && !cands && <> Could not reach the recommendation service yet ({candsError}). It may be waking up, so we keep trying.</>}
              </p>

              <button className="plan-run" type="submit"
            disabled={!farm || !pdate || starting || !cultivarsOk}
            aria-busy={starting}>
                {starting ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    Starting…
                  </>
                ) : (
                  branch === "yield_crops" ? "Compare crops" : "Get recommendation"
                )}
              </button>
            </>
          )}
          {error && <p className="plan-error" role="alert">{error}</p>}
          {store.farms.length === 0 && onBack && (
            <button type="button" className="plan-run" onClick={onBack}>Back to the map</button>
          )}
        </form>
      )}

      {phase.kind === "running" && (() => {
        const elapsed = runInfo ? now - runInfo.startedAt : 0;
        const done = progress?.done ?? 0;
        const stalled = elapsed > STALL_HINT_MS && done === 0;
        const headline =
          !runInfo || runInfo.status === "waiting"
            ? "Contacting the simulation service…"
            : runInfo.status === "queued"
              ? "Waiting for the simulation to start…"
              : phase.label;
        return (
          <div className="plan-running" role="status">
            <span className="spinner" aria-hidden="true" />
            <p>{headline}</p>
            {progress && progress.total != null && progress.total > 0 ? (
              <>
                <progress className="plan-bar" max={progress.total} value={done} aria-label="Simulation progress" />
                <p className="plan-progress">{done} of {progress.total} simulation runs</p>
              </>
            ) : (
              <p className="plan-progress">{done} simulation runs finished</p>
            )}
            <p className="plan-raw">Time so far: {clock(elapsed)}</p>
            {runInfo && runInfo.fails > 0 && (
              <p className="plan-note">Having trouble reaching the service (try {runInfo.fails} of {MAX_FAILS}). Still trying…</p>
            )}
            {stalled && (!runInfo || runInfo.fails === 0) && (
              <p className="plan-note">
                Still working. The service may be waking up or finishing an earlier run, and the first crop-model runs are the slowest. You can keep this open.
              </p>
            )}
            <FarmTips />
            <p className="plan-note">Real crop-model runs; this can take a few minutes.</p>
            <button type="button" className="plan-run secondary" onClick={cancelRun}>Cancel</button>
          </div>
        );
      })()}

      {phase.kind === "refcrops" && (() => {
        const { ranked, skipped } = referenceCrops();
        return (
          <div className="plan-step">
            <h2>Crops to plant before rice</h2>
            <p className="plan-note">
              Ranked by the money left after seed. These use typical yield, price and days to harvest from the app's reference
              table; they are not simulated.
            </p>
            <ol className="plan-ranks">
              {ranked.map(({ info, rank }) => (
                <li key={info.key} className="plan-entry">
                  <span className="plan-badge" aria-label={`Rank ${rank}`}>#{rank}</span>
                  <div>
                    <b>{info.emoji} {info.label}</b>
                    {info.rough && <div className="plan-raw">Rough estimate</div>}
                    {maturityLabel(refStat(info.key), pdate, "Typical maturity (reference data)")}
                    <EconSummary econ={cropEcon(info)} areaHa={areaHa} otherCostHa={otherCostHa} />
                    <details className="plan-soil">
                      <summary>Numbers behind this</summary>
                      <CropPlanFacts info={info} />
                    </details>
                  </div>
                  <HarvestTile iso={isoAdd(pdate, info.days.typ)} />
                </li>
              ))}
            </ol>
            {skipped.length > 0 && (
              <p className="plan-raw">
                Not shown: {skipped.map((c) => `${c.label} (about ${c.days.typ} days)`).join(", ")}. Too long to finish before the next rice.
              </p>
            )}
            <CropCompare
              crops={ranked.map(({ info, rank }) => ({ crop: info.key, rank }))}
              plantingDate={pdate}
              areaHa={areaHa}
              otherCostHa={otherCostHa}
            />
            <OtherCostField value={otherCost} onChange={setOtherCost} />
            <h3 className="plan-ask">Which crop will you plant?</h3>
            <p className="plan-note">
              Your choice is added to the Dashboard as a future crop. Then we simulate the rice that follows, starting the day it is harvested.
            </p>
            <div className="plan-choices">
              {ranked.map(({ info, rank }) => (
                <button key={info.key} type="button" className="plan-choice" disabled={starting} aria-busy={starting} onClick={() => chooseCrop(info)}>
                  <span className="plan-badge" aria-label={`Rank ${rank}`}>#{rank}</span> {info.emoji} {info.label}
                </button>
              ))}
            </div>
            {starting && (
              <p className="plan-note" role="status">
                <span className="spinner" aria-hidden="true" />
                Starting the rice simulation…
              </p>
            )}
            {error && <p className="plan-error" role="alert">{error}</p>}
            <p className="plan-note">
              Estimates only. ORYZON supports, and does not replace, farmer and agronomist judgment. Confirm with your local
              agriculture office before deciding.
            </p>
            <button type="button" className="plan-run secondary" onClick={() => setPhase({ kind: "form" })}>
              Start over
            </button>
          </div>
        );
      })()}

      {phase.kind === "varieties" && (
        <div className="plan-step">
          <h2>Top 3 rice varieties</h2>
          {added.pre && <p className="plan-saved">✓ {added.pre} was added to your Dashboard as a future crop.</p>}
          {afterCrop && preChoice.current && (
            <p className="plan-precrop">
              Rice is simulated from <b>{dateText(ricePlanDate)}</b>, the day <b>{preChoice.current.name}</b> is harvested
              (about {preChoice.current.days} days after {dateText(pdate)}).
            </p>
          )}
          <VarietyList varieties={byRank(phase.result.varieties)} plantingDate={ricePlanDate} action={riceAction} />
          <RiceCompare
            varieties={phase.result.varieties}
            plantingDate={pdate}
            areaHa={areaHa}
            otherCostHa={otherCostHa}
            preDays={afterCrop ? preChoice.current?.days ?? null : null}
            preName={afterCrop ? preChoice.current?.name ?? null : null}
          />
          <OtherCostField value={otherCost} onChange={setOtherCost} />
          <ResultNotes result={phase.result} />
          <button type="button" className="plan-run" onClick={() => setPhase({ kind: "yields", result: phase.result })}>
            See yields
          </button>
          <button type="button" className="plan-run secondary" onClick={() => setPhase({ kind: "form" })}>
            Start over
          </button>
        </div>
      )}

      {phase.kind === "yields" && (
        <div className="plan-step">
          <h2>Yields</h2>
          <p className="plan-note">Separate figures — they are never added together.</p>
          {afterCrop && preChoice.current && (() => {
            const pc = preChoice.current;
            const info = cropInfo(pc.name);
            return (
              <div className="plan-yieldbox">
                <h3>Crop before rice: {pc.name}</h3>
                {info && <p>About {info.yieldT.typ} t/ha <span className="plan-raw">(typical, range {info.yieldT.low}–{info.yieldT.high})</span></p>}
                <p className="plan-raw">Reference estimate, not simulated.</p>
              </div>
            );
          })()}
          {phase.result.varieties.map((v) => (
            <div className="plan-yieldbox" key={v.variety}>
              <h3>Rice: {v.variety} <span className="plan-badge" aria-label={`Rank ${v.rank}`}>#{v.rank}</span></h3>
              <p>{kg(v.rice_actual.mean)} — {pctOf(v.relative_yield)}</p>
              <p className="plan-raw">compared with an ideal yield of {kg(v.rice_ideal.mean)}</p>
              {maturityLabel(v.days_from_plan_start ?? v.maturity_days, ricePlanDate, "Estimated maturity")}
              <EconSummary econ={riceEcon(v.rice_actual.mean)} areaHa={areaHa} otherCostHa={otherCostHa} />
              <SoilBlock d={v.soil_delta} />
              {riceAction(v)}
            </div>
          ))}
          <ResultMetaFooter result={phase.result} />
          <ResultNotes result={phase.result} />
          <button type="button" className="plan-run secondary" onClick={onBack}>Back to the map</button>
        </div>
      )}
    </>
  );
}

function VarietyList({ varieties, plantingDate, action }: { varieties: VarietyEntry[]; plantingDate: string; action?: (v: VarietyEntry) => ReactNode }) {
  return (
    <ol className="plan-ranks">
      {varieties.map((v) => (
        <li key={v.variety} className="plan-entry">
          <span className="plan-badge" aria-label={`Rank ${v.rank}`}>#{v.rank}</span>
          <div>
            <b>{v.variety}</b>
            <div>{pctOf(v.relative_yield)}</div>
            <div className="plan-raw">mean rice yield {kg(v.rice_actual.mean)}</div>
            {maturityLabel(v.days_from_plan_start ?? v.maturity_days, plantingDate,
              v.pre_crop ? "Estimated rice maturity (from first planting)" : "Estimated maturity")}
            {v.pre_crop && v.maturity_days && (
              <div className="plan-raw">Rice itself: about {Math.round(v.maturity_days.mean)} days after rice planting.</div>
            )}
            <SoilBlock d={v.soil_delta} />
            {action?.(v)}
          </div>
          {(() => {
            const d = v.days_from_plan_start?.mean ?? v.maturity_days?.mean;
            return d != null && plantingDate ? <HarvestTile iso={isoAdd(plantingDate, d)} /> : null;
          })()}
        </li>
      ))}
    </ol>
  );
}

function SoilBlock({ d }: { d: { d_soc_kg_ha: number; d_son_kg_ha: number; mineral_n_end_kg_ha: number } }) {
  return (
    <details className="plan-soil">
      <summary>Soil net change over the run</summary>
      <div>
        Soil organic carbon: {d.d_soc_kg_ha > 0 ? "+" : ""}{Math.round(d.d_soc_kg_ha)} kg C/ha
        {" · "}soil organic N: {d.d_son_kg_ha > 0 ? "+" : ""}{Math.round(d.d_son_kg_ha)} kg N/ha
        {" · "}mineral N at end: {Math.round(d.mineral_n_end_kg_ha)} kg N/ha
      </div>
      <small>{SOIL_NOTE}</small>
    </details>
  );
}

function ResultNotes({ result }: { result: RecommendationResult }) {
  if (result.notes.length === 0 && result.failed_runs.length === 0) return null;
  return (
    <div className="plan-notes">
      {result.notes.map((n, i) => <p key={i}>{n}</p>)}
      {result.failed_runs.length > 0 && (
        <details>
          <summary>{result.failed_runs.length} simulation run(s) failed and were excluded</summary>
          <ul>
            {result.failed_runs.map((f, i) => (
              <li key={i}>{f.sequence} · {f.run_type} · scenario {f.scenario}: {f.error}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ResultMetaFooter({ result }: { result: RecommendationResult }) {
  const m = result.metadata;
  return (
    <details className="plan-meta">
      <summary>About these numbers</summary>
      <ul>
        <li>Weather scenarios: {result.scenarios.join(", ")}</li>
        <li>Weather source: {m.weather_source}</li>
        <li>DSSAT version: {m.dssat_version}</li>
        <li>Soil organic matter module: {m.soil_om_module}</li>
        <li>Cultivar coefficients: {m.cultivar_coefficient_source}</li>
        <li>Ideal yield source: {m.ideal_yield_source}</li>
      </ul>
      <small>
        ORYZON supports, and does not replace, farmer and agronomist judgment. Confirm with your
        local agriculture office or irrigators' association before deciding.
      </small>
    </details>
  );
}