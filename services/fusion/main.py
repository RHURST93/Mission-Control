from fastapi import FastAPI, WebSocket
import math, asyncio, time
from itertools import combinations
import numpy as np
from sklearn.cluster import DBSCAN

def compute_clusters():
    pts = np.array([[e["lat"], e["lon"]] for e in entities.values()])
    if len(pts) < 2:
        return []

    clustering = DBSCAN(eps=0.02, min_samples=2).fit(pts)
    labels = clustering.labels_

    clusters = {}
    for i, label in enumerate(labels):
        if label == -1:
            continue
        clusters.setdefault(label, []).append(list(pts[i]))

    return list(clusters.values())

def detect_anomalies():
    anomalies = []
    for e in entities.values():
        if e["speed"] > 120 or e["severity"] > 85:
            anomalies.append(e)
    return anomalies

def predict(e):
    return [
        [e["lon"], e["lat"]],
        [e["lon"] + e["speed"] * 0.0001, e["lat"] + e["speed"] * 0.0001]
    ]

app = FastAPI()
entities = {}
history = []

def anomaly(e):
    return min((e.get("speed",0)/2),100)

def relationships():
    edges=[]
    vals=list(entities.values())
    for a,b in combinations(vals,2):
        d=math.hypot(a["lat"]-b["lat"],a["lon"]-b["lon"])
        if d<0.02:
            edges.append({"source":a["id"],"target":b["id"]})
    return edges

def cone(e):
    return [
        [e["lon"],e["lat"]],
        [e["lon"]+0.01,e["lat"]+0.005],
        [e["lon"]+0.01,e["lat"]-0.005]
    ]

@app.post("/ingest")
def ingest(e:dict):
    e["severity"]=anomaly(e)
    entities[e["id"]] = e
    history.append((time.time(),e))
    return {"ok":True}

@app.get("/snapshot")
def snapshot():
    return {
        "entities": list(entities.values()),
        "edges": relationships(),
        "cones": [cone(e) for e in entities.values()]
    }

@app.websocket("/ws")
async def ws(ws:WebSocket):
    await ws.accept()
    while True:
        await ws.send_json({
            "entities": list(entities.values()),
            "edges": relationships(),
            "clusters": compute_clusters(),
            "anomalies": detect_anomalies(),
            "predictions": [predict(e) for e in entities.values()]
        })
        await asyncio.sleep(1)