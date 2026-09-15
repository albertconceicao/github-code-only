#!/usr/bin/env python3
"""Generate simple PNG icons without third-party deps."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path


def png(width: int, height: int, pixels: list[tuple[int, int, int, int]]) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b""
    for y in range(height):
        raw += b"\x00"
        for x in range(width):
            raw += bytes(pixels[y * width + x])

    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        ]
    )


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def draw(size: int) -> bytes:
    pixels: list[tuple[int, int, int, int]] = []
    radius = size * 0.22
    for y in range(size):
        for x in range(size):
            nx = (x + 0.5) / size
            ny = (y + 0.5) / size
            dx = min(x, size - 1 - x)
            dy = min(y, size - 1 - y)
            inside = dx >= radius or dy >= radius or (dx - radius) ** 2 + (dy - radius) ** 2 <= radius**2
            if not inside:
                pixels.append((0, 0, 0, 0))
                continue

            bg = (lerp(13, 33, ny), lerp(17, 48, ny), lerp(23, 64, ny), 255)
            color = bg

            def set_if(cond: bool, rgba: tuple[int, int, int, int]) -> None:
                nonlocal color
                if cond:
                    color = rgba

            # Funnel
            funnel = (
                0.28 <= nx <= 0.72
                and 0.18 <= ny <= 0.42
                and abs(nx - 0.5) <= 0.22 - (ny - 0.18) * 0.55
            )
            stem = 0.46 <= nx <= 0.54 and 0.40 <= ny <= 0.62
            set_if(funnel or stem, (88, 166, 255, 255))

            # Code braces
            brace_left = (0.18 <= nx <= 0.28 and 0.58 <= ny <= 0.84) or (0.18 <= nx <= 0.34 and 0.68 <= ny <= 0.74)
            brace_right = (0.72 <= nx <= 0.82 and 0.58 <= ny <= 0.84) or (0.66 <= nx <= 0.82 and 0.68 <= ny <= 0.74)
            set_if(brace_left or brace_right, (63, 185, 80, 255))

            pixels.append(color)
    return png(size, size, pixels)


def main() -> None:
    out = Path(__file__).resolve().parent
    for size in (16, 48, 128):
        (out / f"icon{size}.png").write_bytes(draw(size))


if __name__ == "__main__":
    main()
