"""Create a new project in this desktop's active bot library. Input comes from the server's renderer."""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from uuid import uuid4


def create(library, project):
    folder = Path(tempfile.mkdtemp(prefix=".preparing-", dir=library))
    try:
        (folder / "inputs").mkdir()
        (folder / project["directory"]).mkdir()
        for name, text in project["files"].items():
            target = folder / name
            if not target.resolve().is_relative_to(folder):
                raise ValueError("Invalid project file path")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
        name = "openman-" + uuid4().hex
        folder.rename(library / name)
        return name
    finally:
        if folder.exists():
            shutil.rmtree(folder)


if __name__ == "__main__":
    print(create(Path("/root/files").resolve(strict=True), json.load(sys.stdin)))
