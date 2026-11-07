#!/usr/bin/env python3
"""Собирает .mcaddon из исходников в src/.

Запуск:  python3 build.py
Результат: Mana_Machines_v<версия BP>.mcaddon в корне репозитория.
"""
import io
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")


def pack_dir(src_dir):
    """Упаковывает содержимое папки (без самой папки) в zip-байты."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for base, _dirs, files in os.walk(src_dir):
            for name in sorted(files):
                full = os.path.join(base, name)
                rel = os.path.relpath(full, src_dir).replace(os.sep, "/")
                z.write(full, rel)
    return buf.getvalue()


def main():
    bp_dir = os.path.join(SRC, "Mana_Machines_BP")
    rp_dir = os.path.join(SRC, "Mana_Machines_RP")

    with open(os.path.join(bp_dir, "manifest.json"), encoding="utf-8") as f:
        version = ".".join(str(x) for x in json.load(f)["header"]["version"])

    bp_bytes = pack_dir(bp_dir)
    rp_bytes = pack_dir(rp_dir)

    out = os.path.join(ROOT, f"Mana_Machines_v{version}.mcaddon")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"Mana_Machines_BP_v{version}.mcpack", bp_bytes)
        z.writestr("Mana_Machines_RP.mcpack", rp_bytes)

    print(f"OK: {out} ({os.path.getsize(out)} bytes)")


if __name__ == "__main__":
    main()
