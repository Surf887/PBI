"""Offline PBIR validator: validates visual.json files against Microsoft's published JSON schemas
(a local clone of github.com/microsoft/json-schemas), resolving cross-schema $refs locally.
Usage: python -I tools/validate_pbir.py <json-schemas-definition-dir> <visual.json> [...]
"""
import json
import pathlib
import sys

from jsonschema import Draft7Validator, Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

BASE = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/"
root = pathlib.Path(sys.argv[1])

resources = []
for p in root.rglob("*.json"):
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        continue
    url = BASE + p.relative_to(root).as_posix()
    resources.append((url, Resource.from_contents(doc, default_specification=DRAFT7)))
registry = Registry().with_resources(resources)

failures = 0
for f in sys.argv[2:]:
    inst = json.loads(pathlib.Path(f).read_text(encoding="utf-8"))
    url = inst["$schema"]
    schema = registry.contents(url)
    cls = Draft202012Validator if "2020-12" in schema.get("$schema", "") else Draft7Validator
    errors = sorted(cls(schema, registry=registry).iter_errors(inst), key=lambda e: list(e.path))
    status = "VALID" if not errors else f"{len(errors)} ERROR(S)"
    print(f"[{status}] {f}  (schema {url.split('definition/')[1]})")
    for e in errors[:10]:
        print("   -", "/".join(map(str, e.path)) or "<root>", ":", e.message[:200])
    failures += bool(errors)
sys.exit(1 if failures else 0)
