from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

version = json.loads(Path("manifest.json").read_text())["version"]
excluded = {"recordings", "video-build", "__pycache__"}
files = sorted(p for p in Path("store-assets").rglob("*") if p.is_file()
               and not excluded.intersection(p.parts) and p.suffix != ".pyc")
target = Path(f"release/capture-studio-store-assets-{version}.zip")
target.parent.mkdir(exist_ok=True)
with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for path in files:
        assert not path.is_symlink()
        archive.write(path, path)
print(target.resolve())
