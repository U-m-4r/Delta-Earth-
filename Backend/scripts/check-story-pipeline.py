"""Exercise the current API with real discovered scenes; save a credential-free report.

Usage: .venv/Scripts/python Backend/scripts/check-story-pipeline.py stories/umar/bangalore
Reads the backend's local Earthdata configuration. Individual retrieved TIFFs stay
in ignored data directories; the report records API outcomes, not invented metrics.
"""
import argparse
import asyncio
import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import rasterio

from app import main
from app.harmony import _sanitize_text


async def check(folder: Path):
    feature = json.loads((folder / "study-area.geojson").read_text(encoding="utf-8"))
    discovery = json.loads((folder / "discovery.json").read_text(encoding="utf-8"))
    chosen = discovery["candidateComparisons"][0]
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "steps": [], "candidate": chosen,
              "status": "running"}
    report_path = folder / "pipeline-check.json"
    def save():
        report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    async def request(client, method, path, **kwargs):
        response = await client.request(method, path, **kwargs)
        step = {"method": method, "path": path, "statusCode": response.status_code}
        report["steps"].append(step)
        print(f"{method} {path}: {response.status_code}", flush=True)
        save()
        if response.is_error:
            raise RuntimeError(f"HTTP {response.status_code}: {_sanitize_text(response.text)}")
        return response
    main.settings = main.settings.model_copy(update={
        "visualization_temp_dir": Path(".local-run/visualization").resolve()})
    save()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://local") as client:
            await request(client, "GET", "/api/health")
            analysis = (await request(client, "POST", "/api/nisar/scenes/search", json={
                "studyArea": feature, "startDate": discovery["requestedDates"][0],
                "endDate": discovery["requestedDates"][1]})).json()
            study_id = analysis["studyId"]
            report["studyId"] = study_id
            selected = [next(row for row in analysis["observations"] if row["id"] == chosen[label])
                        for label in ("before", "after")]
            batch = (await request(client, "POST", "/api/nisar/extractions/batch", json={
                "studyId": study_id, "studyArea": feature,
                "startDate": discovery["requestedDates"][0], "endDate": discovery["requestedDates"][1],
                "combinations": [{"granuleId": row["id"], "frequency": chosen["frequency"],
                                  "variable": chosen["variable"], "acquisitionMetadata": row} for row in selected]})).json()
            retrieval_id = batch["retrievalSessionId"]
            task = main._retrieval_tasks.get(retrieval_id)
            if task:
                await task
            state = (await request(client, "GET", f"/api/retrieval-sessions/{retrieval_id}")).json()
            report["retrievalStatus"] = state["status"]
            if state["status"] != "completed":
                raise RuntimeError("Batch retrieval failed: " + "; ".join(_sanitize_text(row.get("error", ""))
                                   for row in state["combinations"] if row["status"] != "completed"))
            report["downloads"] = []
            refs = []
            for label in ("before", "after"):
                observation = next(row for row in analysis["observations"] if row["id"] == chosen[label])
                result = (await request(client, "POST", "/api/nisar/extractions", json={
                    "granuleId": observation["id"], "studyArea": feature,
                    "variables": [chosen["variable"]], "frequency": chosen["frequency"],
                    "acquisitionMetadata": {**observation, "frequency": chosen["frequency"],
                                            "retrievalSessionId": retrieval_id}})).json()
                layer = result["variables"][0]
                report["downloads"].append({"label": label, "observationId": observation["id"],
                    "date": observation["acquiredAt"], "status": layer["status"],
                    "bytes": layer.get("bytes"), "error": _sanitize_text(layer.get("error", ""))})
                save()
                if layer["status"] not in {"downloaded", "already_present"}:
                    raise RuntimeError(f"GeoTIFF retrieval did not complete: {layer['status']}")
                tif = await request(client, "GET", f"/api/visualization/{study_id}/raster/{observation['id']}/{chosen['variable']}", params={"frequency": chosen["frequency"]})
                report["downloads"][-1]["sha256"] = hashlib.sha256(tif.content).hexdigest()
                local_download = Path(".local-run/story-downloads") / folder.name / f"{label}.tif"
                local_download.parent.mkdir(parents=True, exist_ok=True)
                local_download.write_bytes(tif.content)
                report["downloads"][-1]["localFile"] = local_download.as_posix()
                preview = await request(client, "GET", f"/api/visualization/{study_id}/preview/{observation['id']}/{chosen['variable']}", params={"frequency": chosen["frequency"]})
                (folder / f"preview-{label}.png").write_bytes(preview.content)
                if preview.headers.get("X-Raster-Legend"):
                    report["downloads"][-1]["previewLegend"] = json.loads(preview.headers["X-Raster-Legend"])
                refs.append({"observationId": observation["id"], "sourceVariable": chosen["variable"], "frequency": chosen["frequency"]})
            session = (await request(client, "POST", "/api/visualization/sessions", json={
                "studyId": study_id, "retrievalSessionId": retrieval_id})).json()
            report["sessionCreated"] = True
            # Session credentials intentionally remain only in process memory.
            headers = {"X-Visualization-Session-Token": session["sessionToken"]}
            session_id = session["sessionId"]
            catalog = (await request(client, "GET", f"/api/visualization/sessions/{session_id}/catalog", headers=headers)).json()
            if len(catalog["observations"]) != 2:
                raise RuntimeError("Session catalog did not contain both retrieved observations")
            await request(client, "GET", f"/api/visualization/sessions/{session_id}/timeline", headers=headers)
            comparison = (await request(client, "GET", f"/api/visualization/sessions/{session_id}/compare", headers=headers,
                params={"baseline": refs[0]["observationId"], "current": refs[1]["observationId"],
                        "variable": f"{chosen['frequency']}:{chosen['variable']}", "mode": "side_by_side"})).json()
            image = await request(client, "GET", comparison["productUrl"], headers=headers)
            (folder / "comparison.png").write_bytes(image.content)
            change = (await request(client, "POST", f"/api/visualization/sessions/{session_id}/changes", headers=headers,
                json={"left": refs[0], "right": refs[1]})).json()
            archive = await request(client, "GET", change["downloadUrl"], headers=headers)
            export_dir = Path(".local-run/story-downloads") / folder.name
            (export_dir / "changes.zip").write_bytes(archive.content)
            with zipfile.ZipFile(io.BytesIO(archive.content)) as files:
                statistics = json.loads(files.read("change_statistics.json"))
                (folder / "change-statistics.json").write_text(json.dumps(statistics, indent=2, allow_nan=False) + "\n", encoding="utf-8")
                (folder / "change.png").write_bytes(files.read("change.png"))
            report["changeExport"] = {"bytes": len(archive.content), "sha256": hashlib.sha256(archive.content).hexdigest(),
                                      "localFile": (export_dir / "changes.zip").as_posix(),
                                      "legend": change["legend"], "boundsWgs84": change["boundsWgs84"]}
            samples = []
            for label in ("before", "after"):
                with rasterio.open(export_dir / f"{label}.tif") as source:
                    values = source.read(1, masked=True).compressed()
                    samples.append(values[np.isfinite(values)])
            limits = np.percentile(np.concatenate(samples), [2, 98])
            display = {"palette": "viridis", "stretch": "linear", "bands": 0,
                       "lowerPercentile": 2, "upperPercentile": 98,
                       "minimum": float(limits[0]), "maximum": float(limits[1])}
            job = (await request(client, "POST", f"/api/visualization/sessions/{session_id}/timeline/exports", headers=headers,
                json={"frames": refs, "settings": display})).json()
            task = main._timeline_export_tasks.get(job["exportId"])
            if task:
                await task
            state = (await request(client, "GET", f"/api/visualization/sessions/{session_id}/timeline/exports/{job['exportId']}", headers=headers)).json()
            if state["status"] != "completed":
                raise RuntimeError(f"Timeline export failed: {state.get('error', state['status'])}")
            timeline = await request(client, "GET", state["downloadUrl"], headers=headers)
            (export_dir / "timeline.zip").write_bytes(timeline.content)
            with zipfile.ZipFile(io.BytesIO(timeline.content)) as files:
                names = files.namelist()
                if not {"timeline.gif", "timeline_report.pdf", "timeline_metadata.json"}.issubset(names):
                    raise RuntimeError("Timeline export is incomplete")
            report["timelineExport"] = {"bytes": len(timeline.content), "sha256": hashlib.sha256(timeline.content).hexdigest(),
                                        "localFile": (export_dir / "timeline.zip").as_posix(), "members": names,
                                        "display": display}
            await request(client, "DELETE", f"/api/visualization/sessions/{session_id}", headers=headers)
            report["status"] = "passed: discovery, retrieval, individual GeoTIFF downloads, previews, session catalog, timeline, comparison, change export, animated timeline export and session cleanup"
    except Exception as exc:
        report.update({"status": "blocked", "error": _sanitize_text(exc),
                       "unverified": "Later processing, comparison, timeline and exports were not verified after this failure."})
        print(report["error"], flush=True)
    finally:
        save()
    return report["status"] != "blocked"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    args = parser.parse_args()
    raise SystemExit(0 if asyncio.run(check(args.folder)) else 1)
