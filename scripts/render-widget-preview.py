"""Render the actual script's simulated layout using Pillow and Windows fonts.

This is a geometry preview with demo data, not an iOS screenshot. Run through
`node scripts/preview-widgets.mjs` so the model always comes from UsageWidget.js.
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SCALE = 3
FONT_DIR = Path('C:/Windows/Fonts')


def font_for(text, points, medium=False):
    name = 'msyh.ttc' if any(ord(char) >= 0x2E80 for char in text) else ('seguisb.ttf' if medium else 'segoeui.ttf')
    return ImageFont.truetype(str(FONT_DIR / name), max(1, round(points * SCALE)))


def draw_text(draw, text, box, points, color, minimum=1, medium=False):
    x, y, width, height = [value * SCALE for value in box]
    font = font_for(text, points, medium)
    measured = draw.textlength(text, font=font)
    if measured > width:
        factor = width / measured
        if factor < minimum - 0.02:
            raise ValueError(f'Text exceeds layout budget: {text} ({measured / SCALE:.1f} > {width / SCALE:.1f}pt)')
        font = font_for(text, points * factor, medium)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text((x - left, y + (height - (bottom - top)) / 2 - top), text, font=font, fill=color)


def main():
    panels = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    margin, gap, column, caption = 24, 24, 364, 28
    row_heights = [max(panel['dimensions']['height'] for panel in panels[index:index + 2]) + caption for index in range(0, len(panels), 2)]
    width = 2 * margin + 2 * column + gap
    height = 2 * margin + 30 + sum(row_heights) + gap * (len(row_heights) - 1)
    sheet = Image.new('RGB', (width * SCALE, height * SCALE), '#eeeeeb')
    draw = ImageDraw.Draw(sheet)
    draw_text(draw, '版式模拟 · 演示数据 · 字体以 iPhone 实际显示为准', (margin, margin - 8, width - 2 * margin, 18), 10, '#646862')
    row_y = margin + 30
    for index, panel in enumerate(panels):
        if index and index % 2 == 0:
            row_y += row_heights[index // 2 - 1] + gap
        x = margin + (index % 2) * (column + gap)
        bounds = panel['dimensions']
        title = f"{panel['title']}  {bounds['width']}×{bounds['height']}pt"
        draw_text(draw, title, (x, row_y, column, 16), 10, '#555a53')
        widget_y = row_y + caption
        draw.rounded_rectangle((x * SCALE, widget_y * SCALE, (x + bounds['width']) * SCALE, (widget_y + bounds['height']) * SCALE),
                               radius=24 * SCALE, fill=panel['background'])
        for item in panel['items']:
            node = item['node']
            box = (x + item['x'], widget_y + item['y'], item['width'], item['height'])
            if node['kind'] == 'text':
                value = node['value']
                draw_text(draw, value, box, node['font'], node['textColor']['value'], node.get('minimumScaleFactor', 1),
                          medium=value == 'usage.' or value.endswith('%') and node['font'] >= 18)
            else:
                for rect in node['image']['rects']:
                    left = (box[0] + rect['x']) * SCALE
                    top = (box[1] + rect['y']) * SCALE
                    draw.rectangle((left, top, left + rect['width'] * SCALE, top + rect['height'] * SCALE - 1), fill=rect['color'])
    sheet.save(sys.argv[2])
    print(f'Preview saved: {Path(sys.argv[2]).name}; {len(panels)} layouts; no clipped labels.')


if __name__ == '__main__':
    main()
