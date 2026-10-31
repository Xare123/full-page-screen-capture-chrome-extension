"""Render the source UI clips from actual Playwright recordings.

For publication, use --visuals-only followed by render-neural-narration.py.
The historical Flite track is retained for reproduction, not current publishing.
"""
from pathlib import Path
import json, subprocess, re, sys

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'source'
OUT=ROOT/'video'
BUILD=SOURCE/'video-build'
BUILD.mkdir(parents=True,exist_ok=True)
OUT.mkdir(parents=True,exist_ok=True)
data=json.loads((SOURCE/'recordings.json').read_text())
scenes={scene['name']:scene for scene in data['scenes']}
FONT='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
SERIF='/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'

# Each shot references a real recording. Cards and the popup inset are the only
# editorial composition. Captions are also supplied as a standalone WebVTT file.
chapters=[
 {'title':'Your whole workflow. All yours.', 'duration':4, 'shots':[('intro',4)], 'voice':'Capture Studio. Your free, local capture workspace.'},
 {'title':'01 / Install the unpacked extension', 'duration':9, 'shots':[('install',9)], 'voice':'Extract the download. Open Chrome extensions, enable Developer mode, then choose Load unpacked. Select the extracted folder, and pin Capture Studio.'},
 {'title':'02 / Choose how much to capture', 'duration':10, 'shots':[('capture-options',4),('full-capture',3),('region-capture',3)], 'voice':'Open a page. Choose Full page, Visible area, or Select a region. Keep the source tab active while it captures.'},
 {'title':'03 / Capture the complete email', 'duration':11, 'shots':[('email-auto',3.5),('email-manual',3.5),('email-result',4)], 'voice':'For long emails, Full page detects the main reading pane automatically. Or choose scrolling area, then click the message pane. Only that pane is stitched.'},
 {'title':'04 / Annotate, redact, refine', 'duration':11, 'shots':[('annotate',7),('redact-undo',4)], 'voice':'Add arrows, highlights, text, and numbered steps. Use solid Redact to hide details in exports. Undo and redo help refine your work.'},
 {'title':'05 / Put your PDF on the right page', 'duration':11, 'shots':[('pdf-options',8),('pdf-export',3)], 'voice':'Choose PDF. Auto recommends paper and orientation, or select a common paper size. Image sized keeps each capture part on one continuous page. Then export.'},
 {'title':'06 / Lighter images, measured results', 'duration':8, 'shots':[('image-compression',8)], 'voice':'Choose PNG, JPEG, or Web P. Adjust image size or quality. Check export size measures the actual file before you download.'},
 {'title':'07 / Compress an existing PDF', 'duration':12, 'shots':[('pdf-compression',7),('raster-options',5)], 'voice':'Already have a PDF? Optimize preserves text and vectors. Rasterize creates image based viewing copies, removing searchable features. Results show actual savings. Compact files may not shrink.'},
 {'title':'08 / Keep your collection local', 'duration':7, 'shots':[('library',7)], 'voice':'Search and reopen your local captures. Everything stays in this browser. Export important files as a backup.'},
 {'title':'Every pixel. All yours.', 'duration':4, 'shots':[('outro',4)], 'voice':'Capture Studio. Every pixel, all yours.'},
]

def run(args):
    subprocess.run(args,check=True,stdout=subprocess.DEVNULL)
def probe(path):
    return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(path)]))
def escaped(value):
    return str(value).replace('\\','\\\\').replace(':','\\:').replace("'","\\'")
def txtfile(name,value):
    path=BUILD/name;path.write_text(value);return str(path)
def ffbase():
    return ['ffmpeg','-hide_banner','-loglevel','error','-y']

rendered=[]
for n,chapter in enumerate(chapters):
    for j,(name,duration) in enumerate(chapter['shots']):
        dest=BUILD/f'{n:02}-{j:02}-{name}.mp4'
        if '--reuse-shots' in sys.argv and dest.exists():
            rendered.append(dest)
            continue
        title=txtfile(f'{n:02}-chapter.txt',chapter['title'])
        chip=f"drawbox=x=20:y=18:w=650:h=44:color=0x24242e@0.94:t=fill,drawtext=fontfile={FONT}:textfile='{escaped(title)}':fontsize=18:fontcolor=white:x=36:y=31"
        if name in ('intro','outro'):
            primary=txtfile(f'{name}-title.txt','The whole page.\nAll the possibilities.' if name=='intro' else 'Every pixel.\nAll yours.')
            sub=txtfile(f'{name}-sub.txt','CAPTURE STUDIO  /  QUICK START' if name=='intro' else 'FREE TO USE.  PROCESSED LOCALLY.')
            vf=f"scale=1280:800:out_range=tv,format=yuv420p,boxblur=18,eq=brightness=-0.46:saturation=0.6,drawbox=x=0:y=0:w=iw:h=ih:color=0x1e1e2b@0.35:t=fill,drawtext=fontfile={BOLD}:textfile='{escaped(sub)}':fontsize=17:fontcolor=0xc7b8ff:x=92:y=220,drawtext=fontfile={SERIF}:textfile='{escaped(primary)}':fontsize=66:line_spacing=15:fontcolor=white:x=87:y=280"
            run(ffbase()+['-loop','1','-i',str(ROOT/'screenshots/01-private-capture-library.jpg'),'-t',str(duration),'-vf',vf,'-an','-r','24','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt470bg',str(dest)])
        else:
            scene=scenes[name];raw=data['pages'][scene['page']]
            length=scene['end']-scene['start']
            if name=='raster-options': length=min(length,1.6)
            # Playwright starts with the first presented frame, shortly after newPage.
            start=max(0,scene['start']-.08)
            ratio=duration/length
            if name=='capture-options':
                # Actual extension popup, placed over the actual example webpage.
                # The inset is clearly a product UI demonstration, not a fabricated page.
                filters=f"[0:v]crop=354:742:0:0,setpts={ratio}*(PTS-STARTPTS),fps=24[popup];[1:v]scale=1280:800:out_range=tv,format=yuv420p,drawbox=x=880:y=72:w=380:h=728:color=0x24242e@0.12:t=fill[bg];[bg][popup]overlay=x=894:y=78,{chip}[v]"
                run(ffbase()+['-ss',str(start),'-t',str(length),'-i',raw,'-loop','1','-i',str(SOURCE/'fieldnotes-source.jpg'),'-filter_complex',filters,'-map','[v]','-t',str(duration),'-an','-r','24','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt470bg',str(dest)])
            else:
                vf=f"setpts={ratio}*(PTS-STARTPTS),fps=24,scale=1280:800:out_range=tv,format=yuv420p,{chip},tpad=stop_mode=clone:stop_duration=1"
                run(ffbase()+['-ss',str(start),'-t',str(length),'-i',raw,'-vf',vf,'-t',str(duration),'-an','-r','24','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt470bg',str(dest)])
        rendered.append(dest)
    print(f"Rendered {chapter['title']}",flush=True)

concat=BUILD/'video-concat.txt'
concat.write_text('\n'.join(f"file '{p}'" for p in rendered)+'\n')
silent=BUILD/'silent.mp4'
run(ffbase()+['-f','concat','-safe','0','-i',str(concat),'-c','copy',str(silent)])

if '--visuals-only' in sys.argv:
    print('Silent UI clips are ready for render-neural-narration.py.',flush=True)
    sys.exit(0)

audio=[]
cues=[]
offset=0.0
for n,chapter in enumerate(chapters):
    voice=txtfile(f'{n:02}-narration.txt',chapter['voice'])
    original=BUILD/f'{n:02}-voice-original.wav'
    wav=BUILD/f'{n:02}-voice.wav'
    run(ffbase()+['-f','lavfi','-i',f"flite=textfile='{escaped(voice)}':voice=slt",'-ar','48000','-ac','2',str(original)])
    originalLength=probe(original)
    available=chapter['duration']-.65
    tempo=max(1.02,originalLength/available)
    narrationLength=originalLength/tempo
    af=f"atempo={tempo},afade=t=in:st=0:d=0.03,afade=t=out:st={max(0,narrationLength-.08)}:d=0.08,adelay=300|300,apad"
    # Bound the output after padding: filter-level atrim can cut atempo's
    # buffered tail early, accumulating timestamp drift across chapter files.
    run(ffbase()+['-i',str(original),'-af',af,'-t',str(chapter['duration']),'-ar','48000','-ac','2',str(wav)])
    assert abs(probe(wav)-chapter['duration'])<.001
    audio.append(wav)
    # Sentence captions follow speech in approximate word-proportional timing.
    sentences=re.findall(r'[^.!?]+[.!?]?',chapter['voice'])
    words=sum(len(s.split()) for s in sentences)
    cursor=offset+.3
    for sentence in sentences:
        sentence=sentence.strip()
        span=narrationLength*len(sentence.split())/words
        cues.append((cursor,min(cursor+span,offset+chapter['duration']-.1),sentence))
        cursor+=span
    chapter['start']=offset
    offset+=chapter['duration']
    print(f"Narration {n+1}: {originalLength:.1f}s, tempo {tempo:.2f}",flush=True)

aconcat=BUILD/'audio-concat.txt';aconcat.write_text('\n'.join(f"file '{p}'" for p in audio)+'\n')
narration=BUILD/'narration.wav'
run(ffbase()+['-f','concat','-safe','0','-i',str(aconcat),'-c','copy',str(narration)])

def vtt_time(sec):
    ms=round(sec*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
vtt='WEBVTT\n\n'+'\n\n'.join(f'{vtt_time(a)} --> {vtt_time(b)}\n{text}'for a,b,text in cues)+'\n'
(OUT/'captions.vtt').write_text(vtt)
final=OUT/'capture-studio-tutorial.mp4'
run(ffbase()+['-i',str(silent),'-i',str(narration),'-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:v','copy','-c:a','aac','-b:a','160k','-ar','48000','-movflags','+faststart','-t',str(offset),str(final)])
run(ffbase()+['-ss','1','-i',str(final),'-frames:v','1','-q:v','2',str(OUT/'tutorial-poster.jpg')])
(OUT/'transcript.md').write_text('# Capture Studio — quick start\n\nA narrated walkthrough using the real Capture Studio 2.2 interface and fictional example content. The extension is demonstrated as an unpacked installation; the video does not claim an existing Chrome Web Store listing.\n\n'+ '\n\n'.join(f"**{int(c['start'])//60}:{int(c['start'])%60:02} — {c['title']}**\n\n{c['voice']}"for c in chapters)+'\n\nNarration is synthesized offline with Flite. Selectable captions are supplied as WebVTT; narration subtitles are not burned into the MP4. Savings shown are measured for the example file and vary by document.\n')
chapterText='\n'.join(f"{int(c['start'])//60:02}:{int(c['start'])%60:02} {c['title'].split(' / ')[-1]}"for c in chapters)
(OUT/'youtube-metadata.md').write_text('''# YouTube upload metadata

**Title:** Capture Studio: capture full pages, long emails, edit & compress — free Chrome extension

**Description:**

Capture the whole webpage or a long email, annotate and redact, then export a PDF or a lighter image. This quick start shows the actual Capture Studio interface using fictional example content.

Capture Studio runs locally in your Chrome browser. Every included feature is free: full-page, visible-area and region capture; automatic reading-pane detection; annotation, solid redaction, undo/redo; PNG/JPEG/WebP/PDF export; automatic PDF paper sizing and continuous pages; local image and existing PDF compression; and a searchable local library.

Requires Chrome 147 or newer. This video demonstrates installing the downloaded extension with Developer mode and Load unpacked. Keep your source tab active during capture. Export important files as a backup; uninstalling removes the local library.

PDF rasterization removes selectable text, links, forms, annotations and signatures. Compression savings depend on the original file. All examples are fictional. Narration is synthesized; selectable captions are supplied.

'''+chapterText+'\n\n**Upload file:** capture-studio-tutorial.mp4\n\n**Caption file:** captions.vtt (English; upload separately to YouTube)\n\n**Thumbnail:** tutorial-poster.jpg\n\n**Audience:** General productivity tutorial; not specifically made for children.\n\n**Web Store global promo video:** Paste the public YouTube video URL after uploading. A local MP4 URL cannot be used in the Web Store YouTube field. No YouTube publication has been performed by these source scripts.\n')
(SOURCE/'video-manifest.json').write_text(json.dumps({'duration':offset,'dimensions':[1280,800],'codec':'H.264/AAC','chapters':chapters,'source':'Real MV3 UI recordings; editorial title cards and popup inset only'},indent=2))
print(f'Created {final} ({offset:.0f} seconds)',flush=True)
