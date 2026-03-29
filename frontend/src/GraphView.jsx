import React, { useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";

const severityColor = (severity = 0, anomaly = false) =>
  anomaly ? "#ff4966" : severity > 70 ? "#ff8b3d" : severity > 40 ? "#ffd166" : "#39f5ff";

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export default function GraphView({ data, onSelect }) {
  const graphData = useMemo(() => {
    if (!data?.entities?.length) return { nodes: [], links: [] };

    const entities = data.entities.map((e) => ({
      id: e.id,
      label: e.label ?? e.id,
      severity: e.severity ?? 0,
      speed: e.speed ?? 0,
      lat: e.lat,
      lon: e.lon,
      anomaly: (e.speed ?? 0) > 120 || (e.severity ?? 0) > 85,
      type: "drone",
    }));

    const clusters = (data.clusters || []).map((cluster, idx) => {
      const members = cluster
        .map(([lat, lon]) => entities.find((n) => n.lat === lat && n.lon === lon))
        .filter(Boolean);
      return {
        id: `cluster-${idx}`,
        label: `Cluster ${idx + 1}`,
        type: "cluster",
        members,
        x: mean(members.map((n) => n.lon)),
        y: mean(members.map((n) => n.lat)),
      };
    });

    const links = (data.edges || []).map((e) => ({ source: e.source, target: e.target, kind: "relationship" }));
    const membershipLinks = clusters.flatMap((c) => c.members.map((m) => ({ source: c.id, target: m.id, kind: "membership" })));

    return { nodes: [...entities, ...clusters], links: [...links, ...membershipLinks] };
  }, [data]);

  if (!graphData.nodes.length) return <div className="graph-empty">Awaiting live swarm data…</div>;

  return (
    <ForceGraph2D
      graphData={graphData}
      backgroundColor="transparent"
      nodeRelSize={6}
      nodeLabel={(n) => n.label}
      linkColor={(l) => (l.kind === "membership" ? "rgba(57,245,255,0.25)" : "rgba(57,245,255,0.85)")}
      linkWidth={(l) => (l.kind === "membership" ? 1 : 1.8)}
      linkDirectionalParticles={(l) => (l.kind === "relationship" ? 2 : 0)}
      linkDirectionalParticleSpeed={0.01}
      nodeCanvasObject={(node, ctx, globalScale) => {
        const x = node.x;
        const y = node.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        if (node.type === "cluster") {
          const r = Math.max(14, 24 / globalScale);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(57,245,255,0.08)";
          ctx.fill();
          ctx.strokeStyle = "rgba(57,245,255,0.95)";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "#bdfcff";
          ctx.font = `${11 / globalScale}px Inter, sans-serif`;
          ctx.fillText(`${node.label} (${node.members.length})`, x + r + 6, y + 3);
          return;
        }

        const color = severityColor(node.severity, node.anomaly);
        const r = Math.max(3, 5 / globalScale);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1;
        ctx.stroke();

        if (node.anomaly) {
          ctx.beginPath();
          ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
          ctx.strokeStyle = "rgba(255,73,102,0.35)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.fillStyle = "#d7faff";
        ctx.font = `${10 / globalScale}px Inter, sans-serif`;
        ctx.fillText(node.label, x + 7 / globalScale, y + 3 / globalScale);
      }}
      onNodeClick={(node) => onSelect?.(node.id)}
    />
  );
}