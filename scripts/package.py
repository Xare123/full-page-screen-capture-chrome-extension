from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

version = json.loads(Path('manifest.json').read_text())['version']
Path('release').mkdir(exist_ok=True)
target = Path('release') / f'capture-studio-{version}.zip'
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(Path('dist').rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to('dist'))
print(target.resolve())
