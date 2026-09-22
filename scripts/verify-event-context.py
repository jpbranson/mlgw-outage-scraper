"""Independently check event/area selection and UTC times against source originals.

Uses Python's CSV/date/gzip readers, including the textual NOAA date fields rather
than the numeric components used by the JS decoder. No network requests.
"""
import csv
import gzip
import hashlib
import io
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

root = Path(__file__).resolve().parents[1]
cache = root / "data/weather/cache"
report = json.loads((root / "reports/event-context-validation.json").read_text())
assert report["complete"]
areas = {"TNC157", "TNZ088"}
originals = {}
annuals = {}

def original(source_id, digest):
    manifest = json.loads((cache / "manifests" / (source_id + ".json")).read_text())
    assert manifest["body"]["sha256"] == digest
    if digest not in originals:
        body = (cache / "objects" / (digest + ".raw")).read_bytes()
        assert hashlib.sha256(body).hexdigest() == digest
        assert len(body) == manifest["body"]["bytes"]
        originals[digest] = body
    return originals[digest]

def derivative(part):
    meta = part["derived"]
    body = (cache / meta["key"]).read_bytes()
    assert len(body) == meta["bytes"] and hashlib.sha256(body).hexdigest() == meta["sha256"]
    data = json.loads(body)
    assert data["sourceId"] == part["sourceId"] and data["sourceSha256"] == part["sourceSha256"]
    return data

def utc(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))

def event_time(text):
    return datetime.strptime(text, "%d-%b-%y %H:%M:%S").replace(tzinfo=timezone(timedelta(hours=-6))).astimezone(timezone.utc)

def warning_time(text):
    return datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)

checks = []
for sample in report["samples"]:
    part = sample["events"]
    body = original(part["sourceId"], part["sourceSha256"])
    if part["sourceSha256"] not in annuals:
        local = []
        rows, months = 0, set()
        for row in csv.DictReader(io.StringIO(gzip.decompress(body).decode())):
            rows += 1
            months.add(row["BEGIN_YEARMONTH"])
            if row["STATE_FIPS"] == "47" and ((row["CZ_TYPE"] == "C" and int(row["CZ_FIPS"]) == 157)
                                               or (row["CZ_TYPE"] == "Z" and int(row["CZ_FIPS"]) == 88)):
                assert row["CZ_TIMEZONE"] == "CST-6"
                local.append(row)
        annuals[part["sourceSha256"]] = {"rows": rows, "months": sorted(months), "local": local}
    annual = annuals[part["sourceSha256"]]
    assert annual["rows"] == part["sourceRows"] and annual["months"] == part["observedBeginMonths"]
    assert len(annual["local"]) == part["sourceShelbyRecords"]
    start, end = utc(sample["from"]), utc(sample["to"])
    selected = {}
    for row in annual["local"]:
        begins, ends = event_time(row["BEGIN_DATE_TIME"]), event_time(row["END_DATE_TIME"])
        if begins < end and (ends > start or begins == ends >= start):
            selected[int(row["EVENT_ID"])] = row
    data = derivative(part)
    assert set(selected) == {r["eventId"] for r in data["records"]}
    for record in data["records"]:
        raw = selected[record["eventId"]]
        assert record["raw"] == raw and record["geometry"] is None
        assert utc(record["beginsAt"]) == event_time(raw["BEGIN_DATE_TIME"])
        assert utc(record["endsAt"]) == event_time(raw["END_DATE_TIME"])

    part = sample["warnings"]
    rows = list(csv.DictReader(io.StringIO(original(part["sourceId"], part["sourceSha256"]).decode())))
    at = utc(sample["warningAt"])
    selected_warnings = {}
    for raw in rows:
        if raw["wfo"] == "MEG" and raw["gtype"] == "C" and raw["ugc"] in areas and warning_time(raw["utc_issue"]) <= at < warning_time(raw["utc_expire"]):
            key = f'{raw["vtec_year"]}-MEG-{raw["phenomena"]}-{raw["significance"]}-{int(raw["eventid"])}-{raw["ugc"]}'
            assert key not in selected_warnings
            selected_warnings[key] = raw
    data = derivative(part)
    assert set(selected_warnings) == {r["key"] for r in data["records"]}
    vertices = 0
    for record in data["records"]:
        raw = selected_warnings[record["key"]]
        assert record["raw"] == raw
        assert utc(record["beginsAt"]) == warning_time(raw["utc_issue"])
        assert utc(record["endsAt"]) == warning_time(raw["utc_expire"])
        geometry = record["administrativeGeometry"]
        collection = json.loads(original(geometry["sourceId"], geometry["sourceSha256"]))
        features = [f for f in collection["features"] if f["id"] == raw["ugc"]]
        assert features == [geometry["feature"]]
        shape = features[0]["geometry"]
        polygons = [shape["coordinates"]] if shape["type"] == "Polygon" else shape["coordinates"]
        points = []
        for polygon in polygons:
            for ring in polygon:
                assert ring[0] == ring[-1] and len(ring) >= 4
                assert abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:]))) > 0
                points.extend(ring)
        assert len(points) == geometry["vertices"]
        assert geometry["bbox"] == [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
        vertices += len(points)
    checks.append({"name": sample["name"], "eventsVerified": len(selected), "warningsVerified": len(selected_warnings),
                   "geometryVerticesVerified": vertices, "passed": True})

result = {"checkedAt": datetime.now(timezone.utc).isoformat(), "samples": checks,
          "annualSourceRowsVerified": sum(a["rows"] for a in annuals.values()), "originalsVerified": len(originals),
          "eventsVerified": sum(s["eventsVerified"] for s in checks), "warningsVerified": sum(s["warningsVerified"] for s in checks),
          "geometryVerticesVerified": sum(s["geometryVerticesVerified"] for s in checks), "networkRequests": 0, "passed": True}
(root / "reports/event-context-provenance-verification.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
