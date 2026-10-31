"""Attach reproducible package hashes to the reviewed, completed verification record."""
from pathlib import Path
from zipfile import ZipFile
import hashlib
import json
import subprocess

version = json.loads(Path('manifest.json').read_text())['version']
record = json.loads(Path(f'docs/RELEASE-{version}.json').read_text())
assert record['status'] == 'verified', 'Verification must finish before publication'
assert record['ci']['conclusion'] == 'success'
stress = record.get('longRecordingStress')
if stress:
    assert stress['status'] == 'passed' and stress['hiddenSeconds'] >= 360
    assert stress['quietElapsedSeconds'] >= 360
    for name, expected in stress['bundleSHA256'].items():
        assert hashlib.sha256((Path('dist') / name).read_bytes()).hexdigest() == expected
report = dict(record)
report['packagedSourceCommit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
report['packageSmoke'] = json.loads(Path(f'artifacts/release-smoke-{version}.json').read_text())
report['distribution'] = {}
for kind, name in [('extension', f'capture-studio-{version}.zip'),
                   ('source', f'capture-studio-source-{version}.zip'),
                   ('storeAssets', f'capture-studio-store-assets-{version}.zip')]:
    path = Path('release') / name
    with ZipFile(path) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(set(archive.namelist())), 'Duplicate ZIP entries'
        if kind == 'extension':
            manifest = json.loads(archive.read('manifest.json'))
            assert manifest['version'] == version and not manifest.get('host_permissions')
            assert not any(n.endswith('.zip') for n in archive.namelist())
            files = [file for file in Path('dist').rglob('*') if file.is_file()]
            assert set(archive.namelist()) == {str(file.relative_to('dist')) for file in files}
            for file in files:
                if file.is_file():
                    assert archive.read(str(file.relative_to('dist'))) == file.read_bytes()
        entries = len(archive.namelist())
    report['distribution'][kind] = dict(file=name, bytes=path.stat().st_size, entries=entries,
                                       sha256=hashlib.sha256(path.read_bytes()).hexdigest())
target = Path(f'release/capture-studio-test-results-{version}.json')
target.write_text(json.dumps(report, indent=2) + '\n')
paths = [Path('release') / d['file'] for d in report['distribution'].values()] + [target]
Path('release/SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in paths))
print(json.dumps(report['distribution']))
