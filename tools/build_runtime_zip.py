#!/usr/bin/env python3
from pathlib import Path
import zipfile, hashlib, sys

ROOT = Path(__file__).resolve().parents[1]
files = [line.strip() for line in (ROOT/'RUNTIME_FILES.txt').read_text(encoding='utf-8').splitlines() if line.strip() and not line.startswith('#')]
missing = [name for name in files if not (ROOT/name).is_file()]
if missing:
    raise SystemExit('Faltan archivos de runtime: ' + ', '.join(missing))
version_text = (ROOT/'version.js').read_text(encoding='utf-8')
import re
match = re.search(r"version:\s*'([^']+)'", version_text)
version = match.group(1) if match else 'unknown'
out = ROOT.parent / f'residentado-runtime-v{version}.zip'
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in files:
        z.write(ROOT/name, arcname=f'residentado-banco-main/{name}')
sha = hashlib.sha256(out.read_bytes()).hexdigest()
print(out)
print('files=', len(files))
print('sha256=', sha)
