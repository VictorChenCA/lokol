type Drug = { name?: string; dose?: string; route?: string; frequency?: string };

function age(months: unknown): string | null {
  const n = Number(months);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 24) return `${n} months`;
  const y = Math.floor(n / 12);
  const r = n % 12;
  return r ? `${y} y ${r} m` : `${y} years`;
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

/** Structured visit record from a dictated note (SPEC §2 note JSON). Unknown fields are listed at the end, nothing is dropped. */
export function NoteRecord({ note }: { note: Record<string, unknown> }) {
  const a = age(note.age_months);
  const w = note.weight_kg !== undefined && note.weight_kg !== null ? `${note.weight_kg} kg` : null;
  const symptoms = list(note.symptoms);
  const danger = list(note.danger_signs);
  const drugs = (Array.isArray(note.drugs) ? note.drugs : []) as Drug[];
  const known = new Set(["age_months", "weight_kg", "symptoms", "danger_signs", "assessment_per_stm", "action", "drugs", "follow_up", "referral"]);
  const extra = Object.entries(note).filter(([k, v]) => !known.has(k) && v !== null && v !== "");

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="bg-sand px-3 py-2">
        <p className="font-display text-[15px] font-semibold leading-tight">Visit record</p>
        <p className="text-[12px] text-ink-3">Visit note. Kept on this phone until the nurse sends it.</p>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-line-2 text-[14px]">
        <div className="bg-white px-3 py-2">
          <dt className="text-[11.5px] text-ink-3">Age</dt>
          <dd className="font-medium">{a ?? "not stated"}</dd>
        </div>
        <div className="bg-white px-3 py-2">
          <dt className="text-[11.5px] text-ink-3">Weight</dt>
          <dd className="font-medium">{w ?? "not stated"}</dd>
        </div>
        <div className="col-span-2 bg-white px-3 py-2">
          <dt className="text-[11.5px] text-ink-3">Symptoms</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {symptoms.length ? symptoms.map((s) => <span key={s} className="rounded-md bg-reef-pale px-2 py-0.5 text-[13px] text-reef-deep">{s}</span>) : <span className="text-ink-3">none recorded</span>}
          </dd>
        </div>
        <div className="col-span-2 bg-white px-3 py-2">
          <dt className="text-[11.5px] text-ink-3">Danger signs</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {danger.length ? danger.map((s) => <span key={s} className="rounded-md bg-hibiscus-tint px-2 py-0.5 text-[13px] text-hibiscus">{s}</span>) : <span className="text-[13px] text-[#24603A]">None</span>}
          </dd>
        </div>
        {typeof note.assessment_per_stm === "string" && note.assessment_per_stm && (
          <div className="col-span-2 bg-white px-3 py-2">
            <dt className="text-[11.5px] text-ink-3">Assessment (per STM)</dt>
            <dd>{note.assessment_per_stm}</dd>
          </div>
        )}
        {drugs.length > 0 && (
          <div className="col-span-2 bg-white px-3 py-2">
            <dt className="text-[11.5px] text-ink-3">Medicines given</dt>
            <dd className="mt-1 space-y-1">
              {drugs.map((d, i) => (
                <div key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium capitalize">{d.name ?? "medicine"}</span>
                  <span className="text-ink-2">{[d.dose, d.route, d.frequency].filter(Boolean).join(", ")}</span>
                </div>
              ))}
            </dd>
          </div>
        )}
        {Boolean(note.follow_up || note.referral) && (
          <div className="col-span-2 bg-white px-3 py-2">
            <dt className="text-[11.5px] text-ink-3">{note.referral ? "Referral" : "Follow-up"}</dt>
            <dd>{String(note.referral ?? note.follow_up)}</dd>
            {note.referral && note.follow_up ? <dd className="mt-1 text-ink-2">Follow-up: {String(note.follow_up)}</dd> : null}
          </div>
        )}
        {extra.map(([k, v]) => (
          <div key={k} className="col-span-2 bg-white px-3 py-2">
            <dt className="text-[11.5px] text-ink-3">{k.replace(/_/g, " ")}</dt>
            <dd className="break-words">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
