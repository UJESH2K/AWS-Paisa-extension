"""Generates extension/icons/*.png (a rupee sign on a blue tile). Run: python scripts/make_icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
BLUE, DARK = (110, 168, 254, 255), (9, 11, 15, 255)
FONT = "C:/Windows/Fonts/segoeuib.ttf"  # Segoe UI Bold has the rupee glyph

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=BLUE)
font = ImageFont.truetype(FONT, int(S * 0.72))
l, t, r, b = d.textbbox((0, 0), "₹", font=font)
d.text(((S - (r - l)) / 2 - l, (S - (b - t)) / 2 - t), "₹", font=font, fill=DARK)
for size in (16, 32, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(OUT / f"icon{size}.png")
print("icons written to", OUT)
