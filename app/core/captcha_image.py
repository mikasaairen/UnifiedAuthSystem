"""
生成带干扰的 PNG 验证码图片（Pillow）。

字符集排除易混淆字符，长度 4；使用 SystemRandom 取随机。
"""
import io
import random
from typing import Tuple

from PIL import Image, ImageDraw, ImageFont

# 不含 0,O,1,I,L 等易混淆字符
_ALPHABET = "3456789ABCDEFGHJKMNPQRSTUVWXYZ"
_W, _H = 160, 56


def _font():
    for path in (
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "arial.ttf",
    ):
        try:
            return ImageFont.truetype(path, 32)
        except OSError:
            continue
    return ImageFont.load_default()


def render_captcha_png() -> Tuple[bytes, str]:
    rng = random.SystemRandom()
    code = "".join(rng.choice(_ALPHABET) for _ in range(4))

    img = Image.new("RGB", (_W, _H), color=(245, 246, 250))
    draw = ImageDraw.Draw(img)
    font = _font()

    # 干扰线
    for _ in range(6):
        x1, y1 = rng.randint(0, _W // 2), rng.randint(0, _H)
        x2, y2 = rng.randint(_W // 2, _W), rng.randint(0, _H)
        draw.line([(x1, y1), (x2, y2)], fill=(rng.randint(100, 180),) * 3, width=1)

    # 字符位置微扭曲：逐字绘制并轻微旋转通过偏移模拟
    x = 18
    for ch in code:
        y = rng.randint(8, 16)
        color = (rng.randint(20, 90), rng.randint(20, 90), rng.randint(20, 90))
        # 轻微错位叠加增强可读难度
        draw.text((x + rng.randint(-2, 2), y + rng.randint(-2, 2)), ch, font=font, fill=color)
        x += 34

    # 噪点
    for _ in range(120):
        px, py = rng.randint(0, _W - 1), rng.randint(0, _H - 1)
        img.putpixel((px, py), (rng.randint(150, 220),) * 3)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), code
