from PIL import Image, ImageDraw, ImageFont
import os
base = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(base, "icons")
os.makedirs(out, exist_ok=True)
BG, Y = (11, 11, 12, 255), (255, 212, 0, 255)

def font(size):
    for p in [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def draw(size, rounded=True, pad=0.0):
    S = size * 4
    img = Image.new("RGBA", (S, S), BG if not rounded else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=BG)
    m = S * (0.16 + pad)
    w = S * 0.055
    d.ellipse([m, m, S - m, S - m], outline=(60, 60, 66, 255), width=int(w))
    d.arc([m, m, S - m, S - m], start=-90, end=200, fill=Y, width=int(w))
    # stopwatch crown
    cx = S / 2
    d.rounded_rectangle([cx - S * 0.06, m - S * 0.11, cx + S * 0.06, m - S * 0.05], radius=S * 0.02, fill=Y)
    f = font(int(S * (0.25 - pad * 0.6)))
    txt = "1km"
    bb = d.textbbox((0, 0), txt, font=f)
    d.text((cx - (bb[2] - bb[0]) / 2 - bb[0], S / 2 - (bb[3] - bb[1]) / 2 - bb[1]), txt, font=f, fill=(245, 245, 242, 255))
    return img.resize((size, size), Image.LANCZOS)

draw(192).save(os.path.join(out, "icon-192.png"))
draw(512).save(os.path.join(out, "icon-512.png"))
draw(512, rounded=False, pad=0.06).save(os.path.join(out, "icon-512-maskable.png"))
draw(180, rounded=False).convert("RGB").save(os.path.join(out, "apple-touch-icon.png"))
print("icons ok")
