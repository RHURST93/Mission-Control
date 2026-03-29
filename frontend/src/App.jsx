import "mapbox-gl/dist/mapbox-gl.css";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import GraphView from "./GraphView";
import "./app.css";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const TABS = ["Overview", "Incidents", "Agent"];

export default function App() {
  const mapRef = useRef(null);
  const container = useRef(null);
  const wsRef = useRef(null);

  const [entities, setEntities] = useState({});
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [graphData, setGraphData] = useState(null);
  const [mode, setMode] = useState("overview");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("Overview");
  const [replayIndex, setReplayIndex] = useState(0);
  const [banner, setBanner] = useState(null);

  const selectedId = selected?.id;
  const liveIndex = Math.max(0, history.length - 1);
  const isReplaying = replayIndex < liveIndex;
  const replaySnapshot = history[replayIndex] || null;
  const visibleData = isReplaying ? replaySnapshot : graphData;

  // Stable updateMap callback
  const updateMap = useCallback((map, d) => {
    if (!map || !d) return;
    try {
      if (!map.isStyleLoaded()) return;
      
      ["entities", "clusters", "anomalies", "predictions"].forEach(id => {
        const src = map.getSource(id);
        if (src) {
          let features = [];
          if (id === "entities") {
            features = (d.entities || []).map((e) => ({ type: "Feature", geometry: { type: "Point", coordinates: [e.lon || 0, e.lat || 0] }, properties: e }));
          } else if (id === "clusters") {
            features = (d.clusters || []).map((cluster, idx) => ({ type: "Feature", properties: { id: `cluster-${idx}`, memberCount: cluster.length }, geometry: { type: "Polygon", coordinates: [normalizeClusterRing(cluster)] } }));
          } else if (id === "anomalies") {
            features = (d.anomalies || []).map((e) => ({ type: "Feature", geometry: { type: "Point", coordinates: [e.lon || 0, e.lat || 0] }, properties: e }));
          } else if (id === "predictions") {
            features = (d.predictions || []).map((p, idx) => ({ type: "Feature", properties: { id: `prediction-${idx}` }, geometry: { type: "LineString", coordinates: p || [] } }));
          }
          src.setData({ type: "FeatureCollection", features });
        }
      });
    } catch (e) {
      console.error("Map update error:", e);
    }
  }, []);

  // WebSocket - PERMANENTLY RUNNING
  useEffect(() => {
    const ws = new WebSocket("ws://127.0.0.1:8000/ws");
    wsRef.current = ws;

    ws.onmessage = (msg) => {
      try {
        const d = JSON.parse(msg.data);
        setHistory((prev) => [...prev.slice(-119), d]);
        setGraphData(d);
        const mapEntities = Object.fromEntries((d.entities || []).map((e) => [e.id, e]));
        setEntities(mapEntities);
        if (selectedId && mapEntities[selectedId]) setSelected(mapEntities[selectedId]);
        setBanner(buildBanner(d));
      } catch (e) {
        console.error("WS message error:", e);
      }
    };

    ws.onerror = (e) => console.error("WS error:", e);
    ws.onclose = () => setBanner({ level: "warning", text: "Connection closed. Reconnect in 3s..." });

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Map updates - triggers on graphData change when in overview
  useEffect(() => {
    if (mode !== "overview" || !mapRef.current || !graphData) return;
    updateMap(mapRef.current, graphData);
  }, [graphData, mode, updateMap]);

  // Map container management
  useEffect(() => {
    if (mode !== "overview") {
      // Clean up map when leaving overview
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }

    // Init map when entering overview
    if (!container.current) return;

    container.current.innerHTML = '';

    const map = new mapboxgl.Map({
      container: container.current,
      style: "mapbox://styles/mapbox/dark-v11",
      projection: 'globe',
      center: [-122.41, 37.77],
      zoom: 10,
      pitch: 55,
      bearing: -20,
      antialias: true,
      hash: true,
    });
    
    map.on("load", () => {
      ["entities", "clusters", "anomalies", "predictions"].forEach((id) => {
        map.addSource(id, { type: "geojson", data: emptyFC() });
      });

      const layers = map.getStyle().layers;
      const labelLayerId = layers.find(
        (layer) => layer.type === 'symbol' && layer.layout['text-field']
      )?.id;

      // Add all layers
      map.addLayer({ id: "clusters", type: "fill", source: "clusters", paint: { "fill-color": "#00ffff", "fill-opacity": 0.12 } });
      map.addLayer({ id: "predictions", type: "line", source: "predictions", paint: { "line-color": "#ffaa00", "line-width": 2, "line-dasharray": [2, 2] } });
      map.addLayer({
        id: "entities",
        type: "circle",
        source: "entities",
        paint: {
          "circle-radius": 6,
          "circle-color": ["interpolate", ["linear"], ["get", "severity"], 0, "#00ffcc", 50, "#ffaa00", 100, "#ff0033"],
          "circle-blur": 0.5,
        },
      });
      map.addLayer({ id: "anomalies", type: "circle", source: "anomalies", paint: { "circle-radius": 10, "circle-color": "#ff0033", "circle-blur": 1 } });

      map.addLayer({
        id: "add-3d-buildings",
        source: "composite",
        "source-layer": "building",
        filter: ['>', 'height', 0],
        type: "fill-extrusion",
        minzoom: 15,
        paint: {
          "fill-extrusion-color": "#aaa",
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 15, 0, 15.05, ["get", "height"]],
          "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 15, 0, 15.05, ["get", "min_height"]],
          "fill-extrusion-opacity": 0.6
        }
      }, labelLayerId);
    });

    mapRef.current = map;

    map.on("click", "entities", (e) => {
      const props = e.features?.[0]?.properties;
      if (props) setSelected(props);
    });

    map.on("error", (e) => {
      console.error("Mapbox error:", e);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [mode]);

  const overviewStats = useMemo(() => {
    const list = Object.values(entities);
    const total = list.length;
    const anomalies = list.filter((e) => isAnomaly(e)).length;
    const avgSeverity = total ? list.reduce((s, e) => s + (e.severity ?? 0), 0) / total : 0;
    return { total, anomalies, avgSeverity: avgSeverity.toFixed(1), clusters: graphData?.clusters?.length ?? 0 };
  }, [entities, graphData]);

  const operationsStats = useMemo(() => ({
    total: Object.keys(entities).length,
    clusters: graphData?.clusters?.length || 0,
    anomalies: overviewStats.anomalies,
    maxThreat: Math.max(...Object.values(entities).map(e => e.severity || 0), 0)
  }), [entities, graphData, overviewStats.anomalies]);

  const incidentRows = useMemo(() => Object.values(entities).filter(isAnomaly).sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0)), [entities]);
  const agentCard = useMemo(() => buildAgentCard(selected, visibleData), [selected, visibleData]);

  const Header = () => (
    <div className="header glass">
      <div className="brand">FUSION COMMAND</div>
      <div className="header-actions">
        <button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>Overview</button>
        <button className={mode === "operations" ? "active" : ""} onClick={() => setMode("operations")}>Operations</button>
        <button className={mode === "agent" ? "active" : ""} onClick={() => setMode("agent")}>AIP Agent</button>
      </div>
    </div>
  );

  if (mode === "operations") {
    return (
      <div className="dashboard dashboard-full operations-page">
        <div className={`banner critical`}>OPERATION CONTROL - {operationsStats.total} TARGETS ACTIVE</div>
        {Header()}
        <div className="operations-grid">
          <div className="op-main glass">
            <h2>OPERATION CONTROL</h2>
            <div className="op-stats">
              <Metric label="Active Targets" value={operationsStats.total} />
              <Metric label="Threat Clusters" value={operationsStats.clusters} />
              <Metric label="Critical Anomalies" value={operationsStats.anomalies} accent />
              <Metric label="Max Threat Level" value={operationsStats.maxThreat} />
            </div>
            <div className="op-threat-list">
              {incidentRows.slice(0, 5).map((threat) => (
                <div key={threat.id} className="threat-item danger">
                  <strong>{threat.id}</strong> - Threat: {threat.severity}
                </div>
              ))}
            </div>
          </div>
          <div className="op-controls glass">
            <h3>COMMAND PANEL</h3>
            <button className="op-btn primary">FULL SWARM SCAN</button>
            <button className="op-btn danger">LOCK CRITICAL TARGETS</button>
            <button className="op-btn">SIMULATE INTERCEPT</button>
            <button className="op-btn">DEPLOY COUNTERMEASURES</button>
            <button className="op-btn critical">AUTHORIZE ENGAGEMENT</button>
          </div>
          <div className="op-timeline glass">
            <h3>RECENT ACTIONS</h3>
            <div className="action-log">
              <div className="log-entry">Cluster scan complete - {operationsStats.clusters} formations</div>
              <div className="log-entry warning">{operationsStats.anomalies > 0 ? `${operationsStats.anomalies} anomalies detected` : 'No new threats'}</div>
              <div className="log-entry">Threat assessment updated</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "agent") {
    return (
      <div className="dashboard dashboard-full agent-page">
        <div className={`banner info`}>AIP AGENT - ONLINE</div>
        {Header()}
        <div className="agent-container">
          <div className="agent-chat glass">
            <div className="agent-messages">
              <div className="message agent">Swarm telemetry online. {overviewStats.total} targets detected.</div>
              <div className="message agent">{overviewStats.anomalies > 0 ? `ALERT: ${overviewStats.anomalies} anomalies identified.` : 'All targets within operational parameters.'}</div>
              <div className="message user">Status report</div>
              <div className="message agent">Swarm stable. {overviewStats.clusters || 0} formations. Max threat level: {Math.max(...Object.values(entities).map(e => e.severity || 0))}. Ready for intercept analysis.</div>
            </div>
            <div className="agent-input">
              <input placeholder="Issue command to AIP Agent..." />
              <button>Transmit</button>
            </div>
          </div>
          <div className="agent-stats glass">
            <h3>AGENT METRICS</h3>
            <Metric label="Confidence" value="98.7%" />
            <Metric label="Threat Accuracy" value="94.2%" />
            <Metric label="Prediction Horizon" value="2min" />
          </div>
        </div>
      </div>
    );
  }

  // Overview mode dashboard
  return (
    <div className="dashboard dashboard-full">
      <div className={`banner ${banner?.level || "info"}`}>{banner?.text || "System nominal. Live telemetry synchronized."}</div>
      <div className="header glass">
        <div className="brand">FUSION COMMAND</div>
        <div className="header-actions">
          <button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>Overview</button>
          <button className={mode === "operations" ? "active" : ""} onClick={() => setMode("operations")}>Operations</button>
          <button className={mode === "agent" ? "active" : ""} onClick={() => setMode("agent")}>AIP Agent</button>
          <button onClick={() => setDrawerOpen((v) => !v)}>{drawerOpen ? "Collapse" : "Expand"}</button>
        </div>
      </div>
      <div className="topbar glass">
        <Metric label="Targets" value={overviewStats.total} />
        <Metric label="Clusters" value={overviewStats.clusters} />
        <Metric label="Anomalies" value={overviewStats.anomalies} accent={overviewStats.anomalies > 0} />
        <Metric label="Avg Severity" value={overviewStats.avgSeverity} />
      </div>
      <div className={`left glass drawer ${drawerOpen ? "open" : "closed"}`}>
        <div className="drawer-head"><h4>MISSION PANEL</h4><span>{drawerOpen ? "LIVE" : "HIDDEN"}</span></div>
        <div className="tabs">{TABS.map((t) => <button key={t} className={activeTab === t ? "active" : ""} onClick={() => setActiveTab(t)}>{t}</button>)}</div>
        {activeTab === "Overview" && <div className="scroll-list">{Object.values(entities).map((e) => <div key={e.id} onClick={() => setSelected(e)} className={`target ${selectedId === e.id ? "selected" : ""}`}><span>{e.id}</span><span className={isAnomaly(e) ? "danger" : "muted"}>{e.severity ?? 0}</span></div>)}</div>}
        {activeTab === "Incidents" && <div className="scroll-list">{incidentRows.length ? incidentRows.map((e) => <div key={e.id} className="incident" onClick={() => setSelected(e)}><strong>{e.id}</strong><div>Speed {e.speed ?? "—"} · Sev {e.severity ?? "—"}</div></div>) : <p>No incidents.</p>}</div>}
        {activeTab === "Agent" && <div className="agent-panel glass"><h4>AIP AGENT</h4><p>{agentCard.text}</p><div className="suggestions">{agentCard.actions.map((a) => <button key={a}>{a}</button>)}</div></div>}
      </div>
      <div ref={container} className="map" />
      <div className="right glass drawer open">
        <div className="drawer-head"><h4>INTEL</h4><span>{selected ? selected.id : "NONE"}</span></div>
        {selected ? <IntelCard selected={selected} /> : <p className="muted-copy">Select target</p>}
        <div className="graph glass">
          <GraphView data={graphData} />
        </div>
      </div>
      <div className="timeline glass">
        <div className="timeline-head"><span>HISTORY REPLAY</span><span>{history.length ? `${Math.min(replayIndex, liveIndex) + 1}/${history.length}` : "0/0"}</span></div>
        <input type="range" min="0" max={liveIndex} value={Math.min(replayIndex, liveIndex)} onChange={(e) => setReplayIndex(Number(e.target.value))} />
        <button onClick={() => setReplayIndex(liveIndex)}>Live</button>
      </div>
    </div>
  );
}

function Metric({ label, value, accent = false }) { return <div className={`metric ${accent ? "accent" : ""}`}><div>{label}</div><strong>{value}</strong></div>; }
function IntelCard({ selected }) { const anomaly = isAnomaly(selected); return <><p>ID: {selected.id}</p><p>Speed: {selected.speed ?? "—"}</p><p>Altitude: {selected.altitude ?? "—"}</p><p>Threat: {selected.severity ?? "—"}</p><p>Status: {anomaly ? "ANOMALY" : "NORMAL"}</p></>; }
function buildAgentCard(selected, data) { if (!selected) return { text: "The agent is waiting for a selected entity or cluster to explain formation, drift, and risk in context.", actions: ["Review swarm", "Run anomaly scan", "Predict drift"] }; const anomaly = isAnomaly(selected); const clusterCount = data?.clusters?.length ?? 0; return { text: `${selected.id} is ${anomaly ? "behaving anomalously" : "within normal operating bounds"}. The swarm currently shows ${clusterCount} clusters, and the agent is tracking proximity, speed, and severity to anticipate re-clustering or separation.`, actions: anomaly ? ["Isolate target", "Notify operators", "Recompute clusters"] : ["Track target", "Forecast movement", "Inspect neighbors"] }; }
function buildBanner(d) { const anomalies = d.anomalies?.length ?? 0; if (anomalies > 0) return { level: "critical", text: `ALERT: ${anomalies} anomaly${anomalies === 1 ? "" : "ies"} detected across the swarm.` }; const clusters = d.clusters?.length ?? 0; if (clusters >= 3) return { level: "warning", text: `WATCH: ${clusters} active clusters observed in the live swarm.` }; return { level: "info", text: "System nominal. Live telemetry synchronized." }; }
function isAnomaly(e) { if (!e) return false; return (e.speed ?? 0) > 120 || (e.severity ?? 0) > 85; }
function emptyFC() { return { type: "FeatureCollection", features: [] }; }
function fc(features) { return { type: "FeatureCollection", features }; }
function setSource(map, id, data) { 
  try {
    const src = map.getSource(id); 
    if (src) src.setData(data); 
  } catch(e) {
    console.error(`Failed to update source ${id}:`, e);
  }
}
function normalizeClusterRing(cluster) { 
  const coords = cluster.map(([lat, lon]) => [lon, lat]); 
  if (!coords.length) return []; 
  const xs = coords.map((c) => c[0]); 
  const ys = coords.map((c) => c[1]); 
  const minX = Math.min(...xs) - 0.0012; 
  const maxX = Math.max(...xs) + 0.0012; 
  const minY = Math.min(...ys) - 0.0012; 
  const maxY = Math.max(...ys) + 0.0012; 
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]; 
}