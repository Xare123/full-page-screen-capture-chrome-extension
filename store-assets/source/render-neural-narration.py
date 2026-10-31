"""Create conversational neural narration and retime the real-UI tutorial.

Run using the isolated Kokoro environment described in MEDIA.md. The canonical
script retains original shot lengths, so repeated runs do not compound timing.
"""
from pathlib import Path
import argparse, hashlib, json, math, re, shutil, subprocess
import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parent
BUILD=ROOT/'source/video-build/neural'
OUT=ROOT/'video'
SCRIPT=ROOT/'source/narration-script.json'
parser=argparse.ArgumentParser()
parser.add_argument('--models',type=Path,default=REPO/'artifacts/neural-narration/models')
parser.add_argument('--reuse-voice',action='store_true')
args=parser.parse_args()
BUILD.mkdir(parents=True,exist_ok=True)
OUT.mkdir(parents=True,exist_ok=True)
data=json.loads(SCRIPT.read_text())
options=ort.SessionOptions()
options.intra_op_num_threads=4
options.inter_op_num_threads=1
session=ort.InferenceSession(str(args.models/'kokoro-v1.0.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
tts=Kokoro.from_session(session,str(args.models/'voices-v1.0.bin'))

def run(arguments):
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y']+arguments,check=True)
def stamp(seconds):
    ms=round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
def chapter_stamp(seconds):
    return f'{int(seconds)//60}:{int(seconds)%60:02}'

chapters=[]
cues=[]
voices=[]
offset=0.0
max_peak=0.0
for index,base in enumerate(data['chapters']):
    chapter=dict(base)
    sentences=re.split(r'(?<=[.!?])\s+',base['text'])
    pieces=[]
    sentence_times=[]
    cursor=.25
    sr=24000
    pieces.append(np.zeros(round(cursor*sr),dtype=np.float32))
    for number,text in enumerate(sentences):
        spoken=text.replace('PDF','P D F').replace('JPEG','jay peg').replace('WebP','web P')
        cache_key=hashlib.sha256(json.dumps([spoken,data['voice'],data['speed'],'kokoro-v1.0']).encode()).hexdigest()[:16]
        cache=BUILD/f'{index:02}-{number:02}-{cache_key}.wav'
        if args.reuse_voice and cache.is_file():
            samples,sr=sf.read(cache,dtype='float32')
        else:
            samples,sr=tts.create(spoken,voice=data['voice'],speed=data['speed'],lang=data['language'],trim=True,sentence_pause=.18,clause_pause=.08)
            assert len(samples)>sr*.15,(index,number,'Empty or truncated speech')
            assert np.isfinite(samples).all(),(index,number,'Invalid samples')
            sf.write(cache,samples,sr,subtype='FLOAT')
        peak=float(np.max(np.abs(samples)))
        max_peak=max(max_peak,peak)
        length=len(samples)/sr
        pieces.append(samples)
        sentence_times.append((cursor,cursor+length,text))
        cursor+=length
        pause=.16 if number<len(sentences)-1 else .3
        pieces.append(np.zeros(round(pause*sr),dtype=np.float32))
        cursor+=pause
    # Fit the visuals to the voice, preserving the narrator's original cadence.
    duration=math.ceil(max(base['base_duration'],cursor)*2)/2
    audio=np.concatenate(pieces)
    target=round(duration*sr)
    assert len(audio)<=target
    audio=np.pad(audio,(0,target-len(audio)))
    wav=BUILD/f'{index:02}-chapter.wav'
    sf.write(wav,audio,sr,subtype='FLOAT')
    voices.append(audio)
    for start,end,text in sentence_times:
        cues.append((offset+start,offset+end,text))
    chapter.update({'duration':duration,'start':offset,'voice':base['text'],'spoken_seconds':round(cursor,3)})
    chapters.append(chapter)
    offset+=duration
    print(f'Neural voice {index+1}/10: {duration:.1f}s — {base["title"]}',flush=True)

assert max_peak<1.0,('Source speech clips',max_peak)
narration=BUILD/'narration.wav'
sf.write(narration,np.concatenate(voices),24000,subtype='FLOAT')
# A short listenable sample is useful when choosing or revising the narrator.
preview=REPO/'artifacts/neural-narration/voice-preview.mp3'
preview.parent.mkdir(parents=True,exist_ok=True)
run(['-i',str(narration),'-t','18','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:a','libmp3lame','-b:a','192k',str(preview)])

rendered=[]
for index,chapter in enumerate(chapters):
    total_frames=round(chapter['duration']*24)
    elapsed_base=0.0
    elapsed_frames=0
    anchors=chapter.get('shot_sentence_anchors')
    if anchors:
        assert len(anchors)==len(chapter['shots'])
        chapter_cues=[cue for cue in cues if chapter['start']<=cue[0]<chapter['start']+chapter['duration']]
        # Show the matching controls just before their sentence starts.
        boundaries=[0]+[round((chapter_cues[sentence][0]-chapter['start']-.12)*24) for sentence in anchors[1:]]+[total_frames]
        assert all(a<b for a,b in zip(boundaries,boundaries[1:])),boundaries
    chapter['shot_timing']=[]
    for number,(name,base_seconds) in enumerate(chapter['shots']):
        original=ROOT/'source/video-build'/f'{index:02}-{number:02}-{name}.mp4'
        if not original.is_file():
            raise FileNotFoundError(f'{original}: first run render-tutorial.py --visuals-only')
        elapsed_base+=base_seconds
        next_boundary=boundaries[number+1] if anchors else round(elapsed_base/chapter['base_duration']*total_frames)
        frames=next_boundary-elapsed_frames
        start_frame=elapsed_frames
        elapsed_frames=next_boundary
        duration=frames/24
        destination=BUILD/f'{index:02}-{number:02}-{name}.mp4'
        ratio=duration/base_seconds
        run(['-i',str(original),'-vf',f'setpts={ratio:.10f}*(PTS-STARTPTS),fps=24,tpad=stop_mode=clone:stop_duration=2','-frames:v',str(frames),'-an','-c:v','libx264','-preset','veryfast','-crf','16','-pix_fmt','yuv420p',str(destination)])
        rendered.append(destination)
        chapter['shot_timing'].append({'name':name,'start':chapter['start']+start_frame/24,'duration':frames/24,'frames':frames,'anchor_sentence':anchors[number] if anchors else None})
    assert elapsed_frames==total_frames
    print(f'Retimed chapter {index+1}/10',flush=True)

concat=BUILD/'video-concat.txt'
concat.write_text('\n'.join(f"file '{path}'" for path in rendered)+'\n')
silent=BUILD/'silent.mp4'
run(['-f','concat','-safe','0','-i',str(concat),'-c','copy',str(silent)])
final=BUILD/'capture-studio-tutorial.mp4'
run(['-i',str(silent),'-i',str(narration),'-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:v','copy','-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-movflags','+faststart','-t',str(offset),str(final)])
shutil.copy2(final,OUT/'capture-studio-tutorial.mp4')
run(['-ss','1','-i',str(final),'-frames:v','1','-q:v','2',str(OUT/'tutorial-poster.jpg')])
(OUT/'captions.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{stamp(start)} --> {stamp(end)}\n{text}' for start,end,text in cues)+'\n')
(OUT/'transcript.md').write_text('# Capture Studio — quick start\n\nA narrated walkthrough using the real Capture Studio 2.2 interface and fictional example content. The extension is demonstrated as an unpacked installation.\n\n'+'\n\n'.join(f'**{chapter_stamp(c["start"])} — {c["title"]}**\n\n{c["text"]}' for c in chapters)+'\n\nNarration uses the stock Kokoro af_heart neural AI voice. Sentence captions follow the generated speech, with no narration subtitles burned into the video. Savings shown are measured for the example file and vary by document.\n')
metadata=OUT/'youtube-metadata.md'
description=(ROOT/'source/youtube-description.md').read_text().rstrip()
chapter_text='\n'.join(f'{int(c["start"])//60:02}:{int(c["start"])%60:02} {c["title"].split(" / ")[-1]}' for c in chapters)
tail='\n\n**Upload file:** capture-studio-tutorial.mp4\n\n**Caption file:** captions.vtt (English; upload separately to YouTube)\n\n**Thumbnail:** tutorial-poster.jpg\n\n**Audience:** General productivity tutorial; not specifically made for children.\n\n**Web Store global promo video:** Paste the public YouTube video URL after uploading. No YouTube publication is performed by these scripts.\n'
metadata.write_text(description+'\n'+chapter_text+tail)
model_info={'engine':data['engine'],'voice':data['voice'],'speed':data['speed'],'language':data['language'],'model_sha256':hashlib.sha256((args.models/'kokoro-v1.0.onnx').read_bytes()).hexdigest(),'voices_sha256':hashlib.sha256((args.models/'voices-v1.0.bin').read_bytes()).hexdigest(),'source_peak':max_peak,'sentence_caption_count':len(cues),'speech_time_stretched':False}
(ROOT/'source/video-manifest.json').write_text(json.dumps({'duration':offset,'dimensions':[1280,800],'codec':'H.264/AAC','chapters':chapters,'narration':model_info,'source':'Real MV3 UI recordings; editorial title cards and popup inset only'},indent=2)+'\n')
print(json.dumps({'video':str(OUT/'capture-studio-tutorial.mp4'),'duration':offset,'narration':model_info}),flush=True)
