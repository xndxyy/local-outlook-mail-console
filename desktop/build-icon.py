from pathlib import Path
from shutil import copyfile

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
PUBLIC = ROOT / "public"
SCALE = 4

CHARCOAL = "#202A32"
WHITE = "#F7FAFC"
TEAL = "#21B8A6"
SEAM = "#BAC6CD"
ICON_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def scaled(values):
    return tuple(int(value * SCALE) for value in values)


def build_master():
    image = Image.new("RGBA", (256 * SCALE, 256 * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(scaled((12, 12, 244, 244)), radius=52 * SCALE, fill=CHARCOAL)
    draw.rounded_rectangle(scaled((40, 68, 216, 182)), radius=18 * SCALE, fill=WHITE)
    draw.line(
        [scaled((48, 82)), scaled((128, 137)), scaled((208, 82))],
        fill=SEAM,
        width=8 * SCALE,
        joint="curve",
    )

    draw.arc(scaled((102, 104, 154, 164)), 180, 360, fill=TEAL, width=16 * SCALE)
    draw.line([scaled((102, 134)), scaled((102, 153))], fill=TEAL, width=16 * SCALE)
    draw.line([scaled((154, 134)), scaled((154, 153))], fill=TEAL, width=16 * SCALE)
    draw.rounded_rectangle(scaled((90, 139, 166, 210)), radius=14 * SCALE, fill=TEAL)
    draw.ellipse(scaled((119, 160, 137, 178)), fill=CHARCOAL)
    draw.rounded_rectangle(scaled((124, 173, 132, 191)), radius=4 * SCALE, fill=CHARCOAL)

    return image


def write_svg():
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect x="12" y="12" width="232" height="232" rx="52" fill="#202A32"/>
  <rect x="40" y="68" width="176" height="114" rx="18" fill="#F7FAFC"/>
  <path d="M48 82 128 137 208 82" fill="none" stroke="#BAC6CD" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M102 153v-23a26 26 0 0 1 52 0v23" fill="none" stroke="#21B8A6" stroke-width="16" stroke-linecap="round"/>
  <rect x="90" y="139" width="76" height="71" rx="14" fill="#21B8A6"/>
  <circle cx="128" cy="169" r="9" fill="#202A32"/>
  <rect x="124" y="173" width="8" height="18" rx="4" fill="#202A32"/>
</svg>
"""
    (DESKTOP / "local-outlook-mail-icon.svg").write_text(svg, encoding="utf-8")


def main():
    master = build_master()
    png = master.resize((256, 256), Image.Resampling.LANCZOS)
    png.save(PUBLIC / "local-outlook-mail-icon.png", optimize=True)

    ico_path = DESKTOP / "local-outlook-mail.ico"
    master.save(ico_path, format="ICO", sizes=ICON_SIZES)
    copyfile(ico_path, PUBLIC / "favicon.ico")
    write_svg()


if __name__ == "__main__":
    main()
