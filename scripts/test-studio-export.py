"""Run from the repository root after building sklubot-desktop. Uses synthetic media only."""
from pathlib import Path
import subprocess,json
tpl=Path("server/templates/moneyprinter")
js=subprocess.check_output(["node","--disable-warning=ExperimentalWarning","--experimental-strip-types","--input-type=module","-e","import {studioCanvasSource} from './server/src/studiocanvassource.ts';process.stdout.write(studioCanvasSource());"],text=True,encoding="utf8")
clip=lambda id,kind,path,start,srcin,srcout,**opts:dict(id=id,kind=kind,name=id,path=path,start=start,inPoint=srcin,outPoint=srcout,**opts)
source="uploads/colors.mp4"
# The same video and voice recordings overlap at independent source times.
story=dict(title="Layer proof",aspect="wide",scenes=[dict(seconds=1.5,text="",media="",style="capture")],audio="",offset=0,muted=False,clips=[
 clip("red","visual",source,.25,.05,1.0,x=.5,y=.5,scale=.8),clip("blue","visual",source,.5,1.1,1.85,x=0,y=0,scale=.3),
 clip("voice440","audio","audio/tones.wav",.2,.05,1),clip("voice880","audio","audio/tones.wav",.6,1.05,2.0),
 clip("tail","audio","audio/tones.wav",1.5,1.05,1.55)])
job=dict(story=story,bot="qa",voices=[None],javascript=js)
for f in ["frames.py","video_project.py"]:job[f]=(tpl/f).read_text(encoding="utf8")
remote=r"""
import wave,math,struct,array
from pathlib import Path
root=Path('/root/files')
(root/'uploads').mkdir(parents=True)
(root/'audio').mkdir()
def run(*args):return subprocess.check_output(list(map(str,args)),stderr=subprocess.PIPE)
run('ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=320x180:r=25:d=1','-f','lavfi','-i','color=c=blue:s=320x180:r=25:d=1','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-threads','1',root/'uploads/colors.mp4')
with wave.open(str(root/'audio/tones.wav'),'wb') as w:
 w.setparams((1,2,16000,0,'NONE',''));w.writeframes(b''.join(struct.pack('<h',int(5000*math.sin(2*math.pi*(440 if n<16000 else 880)*n/16000))) for n in range(32000)))
out=Path('/tmp/layers.mp4')
with out.open('wb') as stream:
 p=subprocess.run(['python3','-I','-B','-c',render],input=json.dumps(job).encode(),stdout=stream,stderr=subprocess.PIPE,timeout=150)
if p.returncode:raise SystemExit(p.stderr.decode()[-2000:])
info=json.loads(run('ffprobe','-v','error','-show_entries','format=duration:stream=codec_name,width,height','-of','json',out))
assert abs(float(info['format']['duration'])-2)<.13,info
assert {s['codec_name'] for s in info['streams']}=={'aac','h264'},info
for t,checks in [(.1,[(640,360,'bg')]),(.4,[(640,360,'red')]),(.8,[(640,360,'red'),(200,150,'blue')]),(1.4,[(200,150,'bg')])]:
 raw=run('ffmpeg','-v','error','-ss',t,'-i',out,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-')
 for x,y,expected in checks:
  rgb=tuple(raw[(1280*y+x)*3:(1280*y+x)*3+3]);r,g,b=rgb
  assert (r>180 and b<80 if expected=='red' else b>180 and r<80 if expected=='blue' else max(rgb)<110),(t,x,y,expected,rgb)
  print('pixel',t,x,y,expected,rgb)
samples=array.array('h',run('ffmpeg','-v','error','-i',out,'-vn','-ar','8000','-ac','1','-f','s16le','-'))
for t,wanted in [(.02,(False,False)),(.35,(True,False)),(.75,(True,True)),(1.3,(False,True)),(1.72,(False,True))]:
 s=samples[int(t*8000):int(t*8000)+800]
 power=[round(abs(sum(v*complex(math.cos(2*math.pi*f*n/8000),math.sin(2*math.pi*f*n/8000)) for n,v in enumerate(s)))/len(s)) for f in (440,880)]
 assert tuple(v>500 for v in power)==wanted,(t,power,wanted)
 print('audio',t,power)
print('MP4 proof',info,out.stat().st_size)
"""
# Run on the configured Docker host. This container has its own temporary library and no network.
cmd=["docker","run","--rm","-i","--network","none","--memory=1g","--cpus=1","--pids-limit=180",
     "--tmpfs","/root/files:rw,nosuid,nodev,size=24m","--entrypoint","python3","sklubot-desktop","-"]
subprocess.run(cmd,input=("import subprocess,json\njob="+repr(job)+"\nrender="+repr((tpl/"render.py").read_text(encoding="utf8"))+"\n"+remote).encode(),check=True,timeout=180)
