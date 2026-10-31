"""Inspect publication media without changing pixels or audio."""
from pathlib import Path
import hashlib,json,subprocess
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
names=['01-private-capture-library.jpg','02-annotate-full-page.jpg','03-complete-email.jpg','04-flexible-pdf-export.jpg','05-local-pdf-compression.jpg']
results=[]
for name in names:
    path=ROOT/'screenshots'/name
    with Image.open(path) as im:
        assert im.size==(1280,800),(name,im.size)
        assert im.mode=='RGB',(name,im.mode)
        assert im.format=='JPEG',(name,im.format)
        im.verify()
    results.append({'path':str(path.relative_to(ROOT)),'dimensions':[1280,800],'format':'JPEG','channels':'RGB / no alpha','sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
video=ROOT/'video/capture-studio-tutorial.mp4'
info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(video)]))
vs=next(s for s in info['streams']if s['codec_type']=='video')
au=next(s for s in info['streams']if s['codec_type']=='audio')
assert (vs['width'],vs['height'])==(1280,800),vs
assert vs['codec_name']=='h264',vs['codec_name']
assert au['codec_name']=='aac',au['codec_name']
manifest=json.loads((ROOT/'source/video-manifest.json').read_text())
assert 60<=float(info['format']['duration'])<=180,info['format']['duration']
assert abs(float(info['format']['duration'])-manifest['duration'])<.1
assert abs(float(au['duration'])-float(vs['duration']))<.1,(au['duration'],vs['duration'])
vtt=(ROOT/'video/captions.vtt').read_text()
assert vtt.startswith('WEBVTT\n')
assert vtt.count(' --> ')>=25
def caption_time(value):
    hours,minutes,seconds=value.split(':')
    return int(hours)*3600+int(minutes)*60+float(seconds)
previous_end=0
for line in vtt.splitlines():
    if ' --> ' not in line:continue
    start,end=map(caption_time,line.split(' --> '))
    assert previous_end<=start<end<=manifest['duration']+.001,(start,end)
    previous_end=end
for name in ['transcript.md','youtube-metadata.md','tutorial-poster.jpg']:
    assert (ROOT/'video'/name).stat().st_size>100
result={'screenshots':results,'video':{'path':str(video.relative_to(ROOT)),'dimensions':[vs['width'],vs['height']],'durationSeconds':float(info['format']['duration']),'audioDurationSeconds':float(au['duration']),'videoCodec':vs['codec_name'],'pixelFormat':vs['pix_fmt'],'audioCodec':au['codec_name'],'audioSampleRate':au['sample_rate'],'bytes':video.stat().st_size,'sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'captionCues':vtt.count(' --> ')},'source':'Actual extension UI and fictional local example pages. No customer data. Captions and narration supplied.'}
(ROOT/'source/media-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
