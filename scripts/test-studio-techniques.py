"""Render all nine shot animations and compare the decoded movie against Chromium.

From the repository root, with the sklubot-desktop image available:
    python scripts/test-studio-techniques.py --sample animations-sklubot.mp4
"""
import argparse
import base64
import inspect
import json
from pathlib import Path
import subprocess


def recipe():
    source = """
import {studioCanvasSource} from './server/src/studiocanvassource.ts';
import {studioTechniques} from './server/src/studiotechniques.ts';
import {techniqueLabels} from './web/src/lib/studioTechniques.ts';
console.log(JSON.stringify({javascript:studioCanvasSource(), techniques:studioTechniques.map(id=>[id,techniqueLabels[id][0]])}));
"""
    data = json.loads(subprocess.check_output([
        "node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", source
    ]))
    folder = Path("server/templates/moneyprinter")
    scenes = [dict(technique=id_, text=label, media="", style="editorial", seconds=2) for id_, label in data["techniques"]]
    assert len(scenes) == 9
    job = dict(bot="animation-test", story=dict(title="Animations Sklubot", aspect="wide", scenes=scenes, audio="", offset=0, muted=False),
               voices=[None] * len(scenes), javascript=data["javascript"])
    return dict(job=job, templates={name: (folder / name).read_text(encoding="utf8") for name in ("frames.py", "render.py", "video_project.py")})


def verify(data, sample):
    import base64
    from contextlib import closing
    from io import BytesIO
    import json
    from pathlib import Path
    import subprocess
    import sys
    import tempfile
    from PIL import Image, ImageChops, ImageStat

    def decode(movie, at):
        frame = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", str(at), "-i", str(movie), "-frames:v", "1",
                                         "-f", "image2pipe", "-c:v", "png", "pipe:1"])
        return Image.open(BytesIO(frame)).convert("RGB")

    def difference(a, b):
        diff = ImageChops.difference(a, b)
        return sum(ImageStat.Stat(diff).mean) / 3

    job = data["job"]
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        for name, source in data["templates"].items():
            (root / name).write_text(source, encoding="utf8")
        sys.path.insert(0, directory)
        from frames import StudioCanvas
        movie = root / "demo.mp4"
        render_job = dict(job, **{name: data["templates"][name] for name in ("frames.py", "video_project.py")})
        with movie.open("wb") as out:
            subprocess.run(["python3", "-I", "-B", str(root / "render.py")], input=json.dumps(render_job).encode(),
                           stdout=out, check=True, timeout=320)
        meta = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(movie)]))
        video = next(item for item in meta["streams"] if item["codec_type"] == "video")
        assert (video["codec_name"],video["width"],video["height"]) == ("h264",1280,720), video
        assert abs(float(meta["format"]["duration"]) - 18) < .12, meta["format"]
        board = Image.new("RGB",(960,540))
        stats = {}
        with closing(StudioCanvas(root / "preview", job["javascript"], job["story"], 1280, 720, {})) as preview:
            for index, scene in enumerate(job["story"]["scenes"]):
                early, late = index * 2 + .24, index * 2 + 1.36
                first, last = decode(movie,early), decode(movie,late)
                reference = Image.open(BytesIO(preview.frame(late))).convert("RGB")
                # Exclude the whole caption area and the progress bar when checking motion.
                box = (50,30,1230,505)
                motion = difference(first.crop(box), last.crop(box))
                error = difference(reference,last)
                assert motion > .30, (scene["technique"], "still", motion)
                assert error < 7, (scene["technique"], "export differs from preview", error)
                early_frame = preview.frame(early)
                preview.frame(late)
                assert early_frame == preview.frame(early), "Seeking back changed the animation"
                board.paste(last.resize((320,180)),((index % 3)*320,(index // 3)*180))
                stats[scene["technique"]] = dict(motion=round(motion,2),previewError=round(error,2))
        # Uploaded media should visibly participate in each effect, including portrait shots.
        source = root / "test.png"
        Image.new("RGB",(160,110),(253,0,193)).save(source)
        portrait = {**job["story"], "aspect":"vertical"}
        with closing(StudioCanvas(root/"portrait",job["javascript"],portrait,360,640,{"uploads/test.png":source})) as preview:
            for i, scene in enumerate(portrait["scenes"]):
                at = i*2+1.36
                bare = Image.open(BytesIO(preview.frame(at))).convert("RGB")
                preview.js(f"story.scenes[{i}].media='uploads/test.png'")
                supplied = Image.open(BytesIO(preview.frame(at))).convert("RGB")
                media_delta = difference(bare,supplied)
                assert media_delta > 2, (scene["technique"],"media not visible",media_delta)
                stats[scene["technique"]]["portraitMedia"] = round(media_delta,2)
        result = dict(seconds=meta["format"]["duration"], bytes=movie.stat().st_size, techniques=stats)
        if sample:
            png=BytesIO()
            board.save(png,format="PNG")
            result["movie"]=base64.b64encode(movie.read_bytes()).decode()
            result["sheet"]=base64.b64encode(png.getvalue()).decode()
        print(json.dumps(result))


def run(command, sample):
    script = inspect.getsource(verify) + "\nverify(" + repr(recipe()) + ", " + repr(bool(sample)) + ")"
    result = json.loads(subprocess.check_output(command, input=script.encode("utf8"), timeout=420))
    if sample:
        sample.write_bytes(base64.b64decode(result.pop("movie"), validate=True))
        sample.with_suffix(".png").write_bytes(base64.b64decode(result.pop("sheet"), validate=True))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", type=Path, help="Save the verified MP4 and a PNG contact sheet")
    output = parser.parse_args().sample
    run(["docker","run","--rm","-i","--network","none","--memory=1g","--cpus=1","--pids-limit=180",
         "--entrypoint","python3","sklubot-desktop","-"],output)
