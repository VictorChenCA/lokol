import { ViewportPortal } from "@xyflow/react";
import type { GraphNode } from "../../types";
import { STAGES, COL_W, CARD_W, stageIndex } from "./layout";
import { useTrace } from "./trace";

const CARD_H = 172;

/** Faint stage columns drawn in flow space behind the cards, with numbered stage names on top. */
export function StageLanes({ nodes }: { nodes: GraphNode[] }) {
  const steps = useTrace((s) => s.steps);
  if (!nodes.length) return null;
  const ys = nodes.map((n) => n.position.y);
  const top = Math.min(...ys) - 78;
  const bottom = Math.max(...ys) + CARD_H + 36;
  const activeStage = (() => {
    const active = nodes.find((n) => steps[n.id]?.state === "active");
    return active ? stageIndex(active) : -1;
  })();
  return (
    <ViewportPortal>
      <div className="lk-lanes" aria-hidden>
        {STAGES.map((s, i) => {
          const members = nodes.filter((n) => stageIndex(n) === i);
          const xs = members.map((n) => n.position.x);
          const left = (xs.length ? Math.min(...xs) : i * COL_W) - 20;
          const right = (xs.length ? Math.max(...xs) : i * COL_W) + CARD_W + 20;
          return (
            <div
              key={s.key}
              className={`lk-lane ${activeStage === i ? "is-active" : ""} ${members.length ? "" : "is-empty"}`}
              style={{ transform: `translate(${left}px, ${top}px)`, width: right - left, height: bottom - top }}
            >
              <div className="lk-lane__label">
                <span className="lk-lane__num">{i + 1}</span>
                <span className="lk-lane__en">{s.en}</span>
                <span className="lk-lane__pis">{s.pis}</span>
              </div>
            </div>
          );
        })}
      </div>
    </ViewportPortal>
  );
}
