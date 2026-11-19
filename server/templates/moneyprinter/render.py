"""Render one immutable Sklubot timeline using MoneyPrinterTurbo's local VideoProject."""
import base64
from contextlib import ExitStack, closing
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import wave


def ffmpeg(*args):
    return ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-filter_threads", "1", *map(str, args)]


def asset_files(bot, paths, temp, stack):
    if not re.fullmatch(r"[\w-]+", bot):
        raise ValueError("invalid bot")
    if not paths:
        return {}
    shared = Path("/root/libraries") / bot
    root = shared if shared.is_dir() else Path("/root/files")
    if root.is_symlink() and root.resolve() != shared:
        raise ValueError("invalid library")
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    stack.callback(os.close, root_fd)
    result = {}
    folders = {}
    for index, name in enumerate(sorted(paths)):
        if not (re.fullmatch(r"uploads/[^/\\]+", name) or
                re.fullmatch(r"audio/[^/\\]+\.(?i:wav|mp3|m4a|aac|ogg|flac|opus)", name)):
            raise ValueError("invalid asset")
        folder, filename = name.split("/")
        if folder not in folders:
            folders[folder] = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
            stack.callback(os.close, folders[folder])
        fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folders[folder])
        stack.callback(os.close, fd)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("invalid asset")
        # Keep the verified inode open throughout encoding, including if the library file changes.
        link = temp / ("input-" + str(index) + Path(name).suffix.lower())
        link.symlink_to(f"/proc/{os.getpid()}/fd/{fd}")
        result[name] = link
    return result


def prepare_voice(wav, seconds, index, temp):
    source = temp / f"speech-{index}.wav"
    source.write_bytes(base64.b64decode(wav, validate=True))
    with wave.open(str(source)) as stream:
        ratio = stream.getnframes() / stream.getframerate() / seconds
    if ratio > 1.7:
        raise ValueError("VOICE_TOO_LONG:" + str(index + 1))
    target = temp / f"timed-{index}.wav"
    subprocess.run(ffmpeg("-i", source, "-af", f"atempo={max(1, ratio):.6f},apad",
                          "-t", seconds, "-ar", 48000, "-ac", 2, target), check=True)
    return str(target)


def mix_tracks(clips, inputs, total, temp):
    args, chains, labels = [], [], []
    for index, clip in enumerate(clips):
        length = clip["outPoint"] - clip["inPoint"]
        args.extend(["-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,mp3,wav,ogg,aac,flac",
                     "-ss", clip["inPoint"], "-t", length, "-i", inputs[clip["path"]]])
        delay = round(clip["start"] * 48000)
        chains.append(f"[{index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                      f"asetpts=PTS-STARTPTS,volume={clip.get('volume', 1)},adelay={delay}S:all=1[a{index}]")
        labels.append(f"[a{index}]")
    chains.append("".join(labels) + f"amix=inputs={len(clips)}:normalize=0,apad[mixed]")
    result = temp / "soundtrack.wav"
    subprocess.run(ffmpeg(*args, "-filter_complex_threads", 1, "-filter_complex", ";".join(chains),
                          "-map", "[mixed]", "-t", total, "-ar", 48000, "-ac", 2, result), check=True)
    return str(result)


def render(job, temp):
    from frames import StudioCanvas
    from video_project import VideoProject

    story = job["story"]
    width, height = {"vertical": (720,1280), "wide": (1280,720), "square": (1280,1280)}[story["aspect"]]
    fps = 25
    clips = story.get("clips", [])
    base_seconds = sum(scene["seconds"] for scene in story["scenes"])
    total = max([base_seconds] + [c["start"] + (c["outPoint"] - c["inPoint"]) for c in clips])
    visuals = {s["media"]: s["media"] for s in story["scenes"] if s["media"]}
    visuals.update({"clip:" + c["id"]: c["path"] for c in clips if c["kind"] == "visual"})
    audio = story["audio"] if not story["muted"] and story["offset"] < total else ""
    takes = {s["speech"]["path"] for s in story["scenes"] if s.get("speech")}
    audio_clips = [c for c in clips if c["kind"] == "audio"]
    if audio:
        audio_clips.append({"path": audio, "start": story["offset"], "inPoint": 0,
                            "outPoint": total-story["offset"], "volume": .18 if takes or any(job["voices"]) else 1})
    manifest = {"project_id": "studio", "settings": {"width": width, "height": height, "fps": fps,
                "bgm_volume": 1}, "scenes": []}
    with ExitStack() as stack:
        inputs = asset_files(job["bot"], set(visuals.values()) | takes | {c["path"] for c in audio_clips}, temp, stack)
        canvas = stack.enter_context(closing(StudioCanvas(temp / "chromium", job["javascript"], story,
                                                width, height, {k: inputs[p] for k,p in visuals.items()})))
        elapsed = 0
        segments = story["scenes"]
        continuous = bool(clips) or any(s.get("technique") for s in segments)
        if continuous:
            # One frame/sample clock for layered edits and animated cuts. Encoding
            # shots separately would accumulate rounding at every fractional cut.
            segments = [{"seconds": total, "text": ""}]
            start = 0
            for index, scene in enumerate(story["scenes"]):
                source = scene.get("speech", {}).get("path")
                if not source and job["voices"][index]:
                    source = "generated:" + str(index)
                    inputs[source] = prepare_voice(job["voices"][index], scene["seconds"], index, temp)
                if source:
                    audio_clips.append({"path": source, "start": start, "inPoint": 0, "outPoint": scene["seconds"]})
                start += scene["seconds"]
        for index, scene in enumerate(segments):
            seconds = scene["seconds"]
            footage = temp / f"shot-{index}.mp4"
            command = ffmpeg("-f", "image2pipe", "-c:v", "mjpeg", "-r", fps, "-i", "pipe:0", "-an",
                             "-c:v", "libx264", "-preset", "ultrafast", "-threads", 2, "-pix_fmt", "yuv420p", footage)
            with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
                try:
                    for frame in range(math.ceil(seconds * fps)):
                        encoder.stdin.write(canvas.frame(elapsed + frame / fps))
                finally:
                    encoder.stdin.close()
                if encoder.wait() != 0:
                    raise ValueError("The studio frames could not be encoded")
            item = {"id": f"shot-{index}", "duration": seconds, "footage": str(footage)}
            if scene.get("speech"):
                target = temp / f"line-{index}.wav"
                subprocess.run(ffmpeg("-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,mp3,wav,ogg,aac,flac",
                                      "-i", inputs[scene["speech"]["path"]], "-af", "apad", "-t", seconds,
                                      "-ar", 48000, "-ac", 2, target), check=True)
                item["audio"] = str(target)
                item["narration"] = scene["speech"]["text"] or scene["speech"]["speaker"]
            elif not continuous and job["voices"][index]:
                item["audio"] = prepare_voice(job["voices"][index], seconds, index, temp)
                item["narration"] = scene["text"]
            manifest["scenes"].append(item)
            elapsed += seconds
        if audio_clips:
            manifest["bgm"] = mix_tracks(audio_clips, inputs, total, temp)
    project = VideoProject(temp / "project")
    revision = project.create_revision(manifest)
    result = project.render(revision["revision_id"])
    output = Path(result["export"]["path"])
    metadata = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams",
                           "-show_format", "-of", "json", str(output)]))
    video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
    actual = float(metadata["format"]["duration"])
    if (video["codec_name"], video["width"], video["height"]) != ("h264", width, height) or abs(actual-total) > .15 + len(manifest["scenes"]) * .045:
        raise ValueError("The exported video differs from the timeline")
    if not any(s["codec_name"] == "aac" for s in metadata["streams"]):
        raise ValueError("The audio stream is missing")
    if output.stat().st_size > 1_000_000_000:
        raise ValueError("VIDEO_TOO_LARGE")
    with output.open("rb") as movie:
        shutil.copyfileobj(movie, sys.stdout.buffer)


if __name__ == "__main__":
    data = json.load(sys.stdin)
    with tempfile.TemporaryDirectory(prefix="sklubot-reel-") as directory:
        temp = Path(directory)
        for filename in ("frames.py", "video_project.py"):
            (temp / filename).write_text(data.pop(filename), encoding="utf-8")
        sys.path.insert(0, directory)
        render(data, temp)
