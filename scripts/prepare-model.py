"""Extract runtime files privately; never extract PSDs into the plugin package."""
import argparse
import json
from pathlib import Path, PurePosixPath
import zipfile

p = argparse.ArgumentParser()
p.add_argument('archive', type=Path)
p.add_argument('--destination', type=Path, required=True, help='Private directory OUTSIDE the plugin source')
p.add_argument('--core', type=Path, required=True, help='Official Cubism Core JS downloaded separately')
p.add_argument('--config', type=Path, required=True)
a = p.parse_args()
root = a.destination.resolve()
package = Path(__file__).resolve().parents[1]
if root == package or root.is_relative_to(package):
    p.error('Model destination must be outside the distributable plugin directory')
if not a.core.is_file():
    p.error('Cubism Core file does not exist')
with zipfile.ZipFile(a.archive) as z:
    entries = [n for n in z.namelist() if n.endswith('.model3.json')]
    if len(entries) != 1:
        p.error('Expected exactly one model3.json; extract and select a model manually instead')
    parent = str(PurePosixPath(entries[0]).parent) + '/'
    for item in z.infolist():
        n = item.filename
        if item.is_dir() or not n.startswith(parent):
            continue
        rel = n[len(parent):]
        if '\\' in rel or ':' in rel or '..' in PurePosixPath(rel).parts:
            p.error('Unsafe archive entry')
        out = (root / rel).resolve()
        if not out.is_relative_to(root):
            p.error('Unsafe archive destination')
        if out.exists():
            p.error('Destination must be empty; refusing to overwrite model resources')
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(z.read(item))
    model = root / PurePosixPath(entries[0]).name
a.config.parent.mkdir(parents=True, exist_ok=True)
a.config.write_text(json.dumps({'modelFile': str(model), 'coreFile': str(a.core.resolve())}, ensure_ascii=False, indent=2), encoding='utf-8')
print('Prepared private model and configuration. Original model3.json is unchanged.')
