import { useId, useMemo } from "react";
import type { LossPoint, RunVal } from "../../types";

/**
 * Inline-SVG loss curve. The x axis always spans the full planned run, so an in-progress run shows
 * how much is left (hatched). Validation points (loss or protocol accuracy) sit on the curve as markers.
 */
export function LossChart({
  loss,
  valLoss = [],
  val = [],
  total,
  running = false,
  color = "#0F7B88",
  height = 180,
  compact = false,
  label = "Training loss",
  best
}: {
  loss: LossPoint[];
  valLoss?: LossPoint[];
  val?: RunVal[];
  total: number;
  running?: boolean;
  color?: string;
  height?: number;
  compact?: boolean;
  label?: string;
  /** Step of the best checkpoint; its label is drawn bold. */
  best?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const W = compact ? 340 : 640;
  const H = height;
  const pad = { l: compact ? 30 : 38, r: 14, t: 14, b: compact ? 20 : 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const { path, area, yTicks, x, y, last, maxStep } = useMemo(() => {
    const all = [...loss, ...valLoss].map((p) => p.loss);
    const hi = all.length ? Math.max(...all) : 3;
    const top = Math.ceil(hi * 2) / 2 || 1;
    const maxStep = Math.max(total, loss.at(-1)?.step ?? 1, 1);
    const x = (s: number) => pad.l + (s / maxStep) * iw;
    const y = (v: number) => pad.t + ih - (v / top) * ih;
    const pts = loss.map((p) => [x(p.step), y(p.loss)] as const);
    // light smoothing: Catmull-Rom to cubic Bezier
    let path = "";
    pts.forEach((p, i) => {
      if (i === 0) {
        path = `M${p[0].toFixed(1)},${p[1].toFixed(1)}`;
        return;
      }
      const p0 = pts[i - 2] ?? pts[i - 1];
      const p1 = pts[i - 1];
      const p3 = pts[i + 1] ?? p;
      const c1x = p1[0] + (p[0] - p0[0]) / 6;
      const c1y = p1[1] + (p[1] - p0[1]) / 6;
      const c2x = p[0] - (p3[0] - p1[0]) / 6;
      const c2y = p[1] - (p3[1] - p1[1]) / 6;
      path += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    });
    const area = pts.length ? `${path} L${pts.at(-1)![0].toFixed(1)},${pad.t + ih} L${pts[0][0].toFixed(1)},${pad.t + ih} Z` : "";
    const yTicks = [0, top / 2, top];
    return { path, area, yTicks, x, y, last: loss.at(-1), maxStep };
  }, [loss, valLoss, total, iw, ih, pad.l, pad.t]);

  const remainingX = last ? x(last.step) : pad.l;
  const summary = last
    ? `${label}: ${loss[0]?.loss.toFixed(2)} at step ${loss[0]?.step} to ${last.loss.toFixed(2)} at step ${last.step} of ${total}.`
    : `${label}: no steps logged yet.`;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={summary}>
        <defs>
          <linearGradient id={`fill-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <pattern id={`hatch-${uid}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="#102C3C" strokeOpacity="0.07" strokeWidth="3" />
          </pattern>
        </defs>

        {/* grid */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#102C3C" strokeOpacity={t === 0 ? 0.18 : 0.07} />
            <text x={pad.l - 7} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="#5C7482" className="tabular-nums">
              {t.toFixed(1)}
            </text>
          </g>
        ))}

        {/* not yet trained */}
        {last && last.step < maxStep && (
          <g>
            <rect x={remainingX} y={pad.t} width={W - pad.r - remainingX} height={ih} fill={`url(#hatch-${uid})`} />
            {!compact && (
              <text x={(remainingX + W - pad.r) / 2} y={pad.t + ih / 2 + 4} textAnchor="middle" fontSize="11.5" fill="#5C7482">
                {running ? `${maxStep - last.step} steps to go` : `stopped at ${last.step}`}
              </text>
            )}
          </g>
        )}

        {area && <path d={area} fill={`url(#fill-${uid})`} />}
        {path && <path d={path} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />}

        {/* validation loss markers */}
        {valLoss.map((p) => (
          <g key={`vl${p.step}`}>
            <circle cx={x(p.step)} cy={y(p.loss)} r="4" fill="#fff" stroke="#E9A93A" strokeWidth="2" />
          </g>
        ))}

        {/* protocol validation markers (River): a tick at the checkpoint step */}
        {val.map((v, i) => (
          <g key={`v${v.step}`}>
            <line x1={x(v.step)} x2={x(v.step)} y1={pad.t} y2={pad.t + ih} stroke="#E9A93A" strokeDasharray="3 4" strokeOpacity="0.8" />
            {!compact && v.exact !== undefined && (
              <text
                x={x(v.step) > W - pad.r - 40 ? x(v.step) - 4 : x(v.step) + 4}
                textAnchor={x(v.step) > W - pad.r - 40 ? "end" : "start"}
                y={pad.t + 10}
                fontSize="10.5"
                fill="#8A5A08"
                fontWeight={best === v.step ? 700 : 400}
              >
                {i === 0 ? "ACTION+STM " : ""}{Math.round((v.exact ?? 0) * 100)}%
              </text>
            )}
          </g>
        ))}

        {/* now marker */}
        {last && (
          <g>
            {running && (
              <circle cx={x(last.step)} cy={y(last.loss)} r="9" fill={color} opacity="0.18" className="animate-pulse2" />
            )}
            <circle cx={x(last.step)} cy={y(last.loss)} r="4" fill={color} stroke="#fff" strokeWidth="1.5" />
          </g>
        )}

        {/* x axis */}
        {!compact &&
          [0, Math.round(maxStep / 2), maxStep].map((s) => (
            <text key={s} x={x(s)} y={H - 7} textAnchor={s === 0 ? "start" : s === maxStep ? "end" : "middle"} fontSize="10.5" fill="#5C7482">
              {s === 0 ? "step 0" : s}
            </text>
          ))}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
