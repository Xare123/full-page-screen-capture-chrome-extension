"""Download the pinned public model assets used for the neural narration."""
from pathlib import Path
import hashlib,urllib.request

root=Path(__file__).resolve().parents[2]/'artifacts/neural-narration/models'
root.mkdir(parents=True,exist_ok=True)
base='https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'
files={
 'kokoro-v1.0.onnx':'7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5',
 'voices-v1.0.bin':'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
}
for name,expected in files.items():
    path=root/name
    if not path.exists():
        temporary=path.with_suffix(path.suffix+'.part')
        with urllib.request.urlopen(base+name,timeout=60) as source,temporary.open('wb') as target:
            while chunk:=source.read(1024*1024):target.write(chunk)
        if hashlib.sha256(temporary.read_bytes()).hexdigest()!=expected:
            temporary.unlink()
            raise ValueError('Unexpected model checksum: '+name)
        temporary.replace(path)
    if hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
        raise ValueError('Unexpected cached model checksum: '+name)
    print('Verified '+name,flush=True)
