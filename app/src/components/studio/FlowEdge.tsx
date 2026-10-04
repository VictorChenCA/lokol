import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps, type Edge } from "@xyflow/react";
import { useTrace } from "./trace";

export type FlowEdgeData = { readOnly?: boolean; online?: boolean };
export type FlowEdgeT = Edge<FlowEdgeData, "flow">;

/** Edge with a slow dash that shows data direction, and a glowing particle while a trace passes. */
function FlowEdgeInner({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, data }: EdgeProps<FlowEdgeT>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.32 });
  const live = useTrace((s) => (data?.readOnly ? false : s.liveEdges.includes(id)));
  const done = useTrace((s) => (data?.readOnly ? false : s.doneEdges.includes(id)));
  const tracing = useTrace((s) => (data?.readOnly ? false : s.status === "running" || s.status === "done"));
  const cls = ["lk-edge", selected ? "is-selected" : "", live ? "is-live" : "", done ? "is-done" : "", tracing && !live && !done ? "is-dim" : "", data?.online ? "is-online" : ""].join(" ");
  return (
    <g className={cls}>
      <BaseEdge id={id} path={path} className="lk-edge__base" interactionWidth={18} />
      <path d={path} className="lk-edge__flow" fill="none" />
      {live && (
        <>
          <path d={path} className="lk-edge__glow" fill="none" />
          <circle r="5.5" className="lk-edge__particle">
            <animateMotion dur="0.52s" repeatCount="1" fill="freeze" path={path} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.25 1" />
          </circle>
          <circle r="11" className="lk-edge__halo">
            <animateMotion dur="0.52s" repeatCount="1" fill="freeze" path={path} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.25 1" />
          </circle>
        </>
      )}
    </g>
  );
}

export const FlowEdge = memo(FlowEdgeInner);
export const edgeTypes = { flow: FlowEdge };
