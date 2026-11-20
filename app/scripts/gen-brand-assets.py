"""Regenerate the KlapChat brand assets from the source lockup.
Usage: python scripts/gen-brand-assets.py <klapchat-logo-source.png> [android-res-out-dir]
Writes app/assets/{icon,adaptive-foreground,logo-icon,logo-lockup}.png; with an out dir it also writes
the legacy mipmap-*/ic_launcher(_round).png set for a hand-patched android/ folder (expo prebuild makes these itself)."""
import os, sys
from PIL import Image, ImageDraw, ImageFilter

src = Image.open(sys.argv[1]).convert('RGB')
here = os.path.dirname(os.path.abspath(__file__))
assets = os.path.join(here, '..', 'assets')
os.makedirs(assets, exist_ok=True)

# rounded-square icon artwork is roughly x 245-755, y 165-675 (navy background around it)
sq = src.crop((225, 145, 775, 695)).resize((1024, 1024), Image.LANCZOS)
sq.save(os.path.join(assets, 'icon.png'))

# adaptive foreground: gold bubble with transparent surround, centred in the inner ~66% safe zone
bub = src.crop((315, 240, 690, 620))
r = bub.split()[0]
gold = r.point(lambda v: 255 if v > 90 else 0)
outside = gold.copy().point(lambda v: 255 - v)
ImageDraw.floodfill(outside, (0, 0), 128)            # outside region connected to the corner
alpha = outside.point(lambda v: 0 if v == 128 else 255)  # everything else (bubble + enclosed K) is opaque
alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))
bub.putalpha(alpha)
box = bub.getbbox()
bub = bub.crop(box)
s = 590 / max(bub.size)
bub = bub.resize((round(bub.width * s), round(bub.height * s)), Image.LANCZOS)
fg = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
fg.paste(bub, ((1024 - bub.width) // 2, (1024 - bub.height) // 2), bub)
fg.save(os.path.join(assets, 'adaptive-foreground.png'))

# in-app logos (login screen)
sq.resize((512, 512), Image.LANCZOS).save(os.path.join(assets, 'logo-icon.png'))
src.crop((120, 720, 880, 950)).save(os.path.join(assets, 'logo-lockup.png'))

if len(sys.argv) > 2:
    out = sys.argv[2]
    for d, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        os.makedirs(os.path.join(out, 'mipmap-' + d), exist_ok=True)
        im = sq.resize((px, px), Image.LANCZOS)
        im.save(os.path.join(out, 'mipmap-' + d, 'ic_launcher.png'))
        m = Image.new('L', (px * 4, px * 4), 0)
        ImageDraw.Draw(m).ellipse((0, 0, px * 4 - 1, px * 4 - 1), fill=255)
        rd = im.convert('RGBA'); rd.putalpha(m.resize((px, px), Image.LANCZOS))
        rd.save(os.path.join(out, 'mipmap-' + d, 'ic_launcher_round.png'))
        fpx = round(px * 108 / 48)
        fg.resize((fpx, fpx), Image.LANCZOS).save(os.path.join(out, 'mipmap-' + d, 'ic_launcher_foreground.png'))
