"""Generate extension/icons/*.png — the toolbar and store-listing icon.

Deliberately not AWS's logo. This icon is the product's identity: it appears in
the store listing, in the toolbar and in everyone's extension list, so using
Amazon's mark there would present Paisa as an AWS-published extension. Both
stores reject that, and it would mislead people even if they did not.

Instead it borrows the family — AWS orange (#FF9900) and squid ink (#232F3E) —
on a plain tile carrying a rupee sign. Reads as "for AWS", never as "by AWS".
The cloud motif lives on the in-page button, where there is room for it; at
16px in a toolbar it collapses into a smudge.

Run: python scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

ORANGE = (255, 153, 0, 255)
INK = (35, 47, 62, 255)
WHITE = (255, 255, 255, 255)
FONTS = [
    "C:/Windows/Fonts/segoeuib.ttf",  # Segoe UI Bold has the rupee glyph
    "C:/Windows/Fonts/seguisb.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

S = 1024  # drawn large, then downsampled, so small sizes stay clean


def load_font(size):
    for path in FONTS:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def build(size):
    """A filled tile in AWS orange with a rupee in squid ink.

    A cloud outline was tried first and failed the only test that matters here:
    at 16px, in a toolbar, it collapsed into an orange smudge. A tile fills the
    square, so the rupee gets the most room possible and stays readable at every
    size the stores ask for.
    """
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Corner radius scaled like the platform's own icons; nearly square at 16px.
    radius = int(S * (0.22 if size >= 48 else 0.18))
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=radius, fill=ORANGE)

    font = load_font(int(S * 0.72))
    left, top, right, bottom = d.textbbox((0, 0), "₹", font=font)
    x = (S - (right - left)) / 2 - left
    y = (S - (bottom - top)) / 2 - top
    d.text((x, y), "₹", font=font, fill=INK)

    return img.resize((size, size), Image.LANCZOS)


def main():
    for size in (16, 32, 48, 128):
        build(size).save(OUT / f"icon{size}.png", optimize=True)
        print(f"  icon{size}.png")
    # A 300x300 tile is what the store listings ask for.
    build(300).save(OUT / "store-icon.png", optimize=True)
    print("  store-icon.png (300x300, for the store listings)")
    print(f"written to {OUT}")


if __name__ == "__main__":
    main()
