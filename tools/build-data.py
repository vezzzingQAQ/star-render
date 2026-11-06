"""
把 HYG 星表 CSV 转成前端使用的紧凑数据文件 data/stars.js

二进制记录（16 字节，按视星等从亮到暗排序）：
    float32 x, y, z   —— 世界坐标 (pc)，赤道直角坐标转 Y 轴朝北
    int16   mag × 100
    int16   (B−V) × 1000

用法：
    python tools/build-data.py [csv 路径]
"""

import base64
import csv
import json
import math
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else r"e:\Projects\teach-gen-art\data\hyg_v38.csv"
DST = os.path.join(ROOT, "data", "stars.js")


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build():
    stars = []
    excluded = 0

    with open(SRC, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            dist = number(row["dist"])
            x, y, z = number(row["x"]), number(row["y"]), number(row["z"])
            mag = number(row["mag"])
            if None in (dist, x, y, z, mag) or dist <= 1e-9 or dist >= 99999:
                # 太阳本身，或视差未知（HYG 用 100000 pc 作为占位）
                excluded += 1
                continue

            ci = number(row["ci"])
            ci = 0.65 if ci is None else max(-0.4, min(2.0, ci))

            stars.append({
                "x": x, "y": z, "z": -y,
                "mag": mag,
                "ci": ci,
                "proper": row["proper"].strip(),
                "spect": row["spect"].strip(),
                "con": row["con"].strip(),
                "bayer": row["bayer"].strip(),
                "flam": row["flam"].strip(),
                "hip": row["hip"].strip(),
                "absmag": number(row["absmag"]),
            })

    stars.sort(key=lambda s: s["mag"])

    blob = bytearray()
    meta = []
    for index, star in enumerate(stars):
        blob += struct.pack(
            "<fffhh",
            star["x"], star["y"], star["z"],
            int(round(star["mag"] * 100)),
            int(round(star["ci"] * 1000)),
        )
        if star["mag"] <= 6.5 or star["proper"]:
            meta.append([
                index,
                star["proper"],
                star["spect"],
                star["con"],
                star["bayer"],
                star["flam"],
                star["hip"],
                round(star["absmag"], 2) if star["absmag"] is not None else None,
            ])

    payload = {
        "b64": base64.b64encode(bytes(blob)).decode("ascii"),
        "meta": meta,
    }

    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as fh:
        fh.write("/* 由 tools/build-data.py 生成，请勿手动修改 */\n")
        fh.write("window.HYG_STARS = ")
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")

    print("stars=%d excluded=%d meta=%d size=%.2f MB"
          % (len(stars), excluded, len(meta), os.path.getsize(DST) / 1048576))


if __name__ == "__main__":
    build()
