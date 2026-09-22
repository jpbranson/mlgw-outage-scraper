"""Independent offline provenance check using stdlib CSV/gzip/SHA-256 readers.

Verifies every interpreted sample record and its five sets of raw field metadata
against the retained PSV originals. This does not certify NOAA measurements.
"""
import csv
import gzip
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
cache = root / "data/weather/cache"
report = json.loads((root / "reports/station-quality-validation.json").read_text())
suffixes = {"value": "", "qualityCode": "_Quality_Code", "measurementCode": "_Measurement_Code",
            "sourceCode": "_Source_Code", "reportType": "_Report_Type", "sourceStationId": "_Source_Station_ID"}
parsed = {}
checks = []
for sample in report["samples"]:
    digest = sample["sourceSha256"]
    if digest not in parsed:
        manifest = json.loads((cache / "manifests" / (sample["sourceId"] + ".json")).read_text())
        compressed = cache / "objects" / (digest + ".raw.gz")
        original = gzip.decompress(compressed.read_bytes()) if compressed.exists() else (cache / "objects" / (digest + ".raw")).read_bytes()
        assert hashlib.sha256(original).hexdigest() == digest
        assert len(original) == manifest["body"]["bytes"] and manifest["body"]["sha256"] == digest
        parsed[digest] = list(csv.DictReader(io.StringIO(original.decode()), delimiter="|"))
    derivative = (cache / sample["derived"]["key"]).read_bytes()
    assert hashlib.sha256(derivative).hexdigest() == sample["derived"]["sha256"]
    assert len(derivative) == sample["derived"]["bytes"]
    data = json.loads(derivative)
    assert data["sourceSha256"] == digest and data["sourceId"] == sample["sourceId"]
    documentation = (root / "data/weather/discovery/ghcnh-format.raw").read_bytes()
    assert hashlib.sha256(documentation).hexdigest() == data["documentation"]["sha256"]
    # Source timestamps are documented UTC; explicit datetime parsing is independent of JS.
    start, end = (datetime.fromisoformat(sample[k].replace("Z", "+00:00")) for k in ("from", "to"))
    expected = {}
    for source in parsed[digest]:
        at = datetime.fromisoformat(source["DATE"].removesuffix("Z")).replace(tzinfo=timezone.utc)
        if start <= at < end:
            key = at.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            assert key not in expected
            expected[key] = source
    assert set(expected) == {row["at"] for row in data["rows"]}
    fields = 0
    for row in data["rows"]:
        source = expected[row["at"]]
        assert row["station"] == source["STATION"]
        assert row["latitude"] == float(source["LATITUDE"]) and row["longitude"] == float(source["LONGITUDE"])
        for field, interpreted in row["fields"].items():
            assert interpreted["raw"] == {key: source.get(field + suffix, "") for key, suffix in suffixes.items()}
            if interpreted["value"] is not None:
                assert interpreted["value"] == float(source[field])
                assert interpreted["status"] == "accepted" and interpreted["eligible"]
            else:
                assert interpreted["status"] != "accepted"
            if interpreted["status"] == "trace":
                assert interpreted["value"] is None and source[field + "_Measurement_Code"] in ("T", "2")
            fields += 1
    checks.append({"name": sample["name"], "records": len(expected), "fieldMetadataSets": fields, "passed": True})
result = {"checkedAt": datetime.now(timezone.utc).isoformat(), "samples": checks, "originalsVerified": len(parsed),
          "recordsVerified": sum(s["records"] for s in checks), "fieldMetadataSetsVerified": sum(s["fieldMetadataSets"] for s in checks),
          "networkRequests": 0, "passed": True}
(root / "reports/station-quality-provenance-verification.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
