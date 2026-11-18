"""Install a pinned public source tree on the bot's Linux desktop."""
import fcntl
import os
from pathlib import Path
import subprocess
import sys
import tempfile

bot, repo, revision, entry = sys.argv[1:]
root = Path.home() / ".local/share/sklubot/video-workflows" / bot
root.mkdir(parents=True, exist_ok=True)
target = root / (repo.split("/")[1] + "-" + revision[:12])
env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_CONFIG_NOSYSTEM="1",
           GIT_CONFIG_GLOBAL="/dev/null", GIT_LFS_SKIP_SMUDGE="1")

def git(cwd, *args):
    return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", *args],
                                   cwd=cwd, env=env, text=True).strip()

with (root / (revision + ".lock")).open("a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    if not target.exists():
        with tempfile.TemporaryDirectory(dir=root) as temp:
            tree = Path(temp) / "source"
            tree.mkdir()
            git(tree, "init", "-q")
            git(tree, "fetch", "-q", "--depth=1", "--no-tags",
                "https://github.com/" + repo + ".git", revision)
            git(tree, "checkout", "-q", "--detach", "FETCH_HEAD")
            if git(tree, "rev-parse", "HEAD") != revision or not (tree / entry).is_file():
                raise RuntimeError("Unexpected video workflow checkout")
            tree.rename(target)
    if git(target, "rev-parse", "HEAD") != revision or not (target / entry).is_file():
        raise RuntimeError("The installed source differs from the selected version")
print(target / entry)
