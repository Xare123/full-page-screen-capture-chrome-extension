from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json

version=json.loads(Path('manifest.json').read_text())['version']
Path('release').mkdir(exist_ok=True)
Path('artifacts').mkdir(exist_ok=True)
root=Path.cwd()
root_files=['.gitattributes','.gitignore','README.md','CHANGES.md','LICENSE','manifest.json','package.json','package-lock.json','playwright.config.js','archiver.sh','icon16.png','icon48.png','icon128.png']
paths=[root/name for name in root_files]
for folder in ['src','tests','scripts','docs','.github','website']:
    paths.extend(p for p in (root/folder).rglob('*') if p.is_file())
assert all(p.exists() and not p.is_symlink() for p in paths)
assert len(paths)==len(set(paths))
archive=Path(f'release/capture-studio-source-{version}.zip')
with ZipFile(archive,'w',ZIP_DEFLATED) as output:
    for path in sorted(paths):
        relative=path.relative_to(root)
        assert not any(part in ['node_modules','artifacts','.git','.local','release','__pycache__'] for part in relative.parts)
        assert path.suffix not in ['.pem','.key','.pyc']
        output.write(path,Path('capture-studio-source')/relative)
with ZipFile(archive) as check:
    assert check.testzip() is None
    for path in paths:
        assert check.read(str(Path('capture-studio-source')/path.relative_to(root)))==path.read_bytes()
result={'version':version,'files':len(paths),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'zipIntegrity':True,'scope':'Implementation, tests, build scripts, package lockfile, documentation, CI, website source and runtime icons. Store artwork and tutorial are supplied separately in the store kit.'}
Path(f'artifacts/source-archive-{version}.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
