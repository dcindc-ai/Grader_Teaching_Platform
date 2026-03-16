#!/usr/bin/env python3
"""
annotate_pdf.py
Takes a PDF and a JSON list of annotations from Claude, places them on the pages.
Usage: python3 annotate_pdf.py <input_pdf> <annotations_json> <output_pdf>

Annotation JSON format (array):
[
  {
    "page": 1,           // 1-indexed
    "x_pct": 0.05,       // 0.0-1.0 fraction of page width
    "y_pct": 0.20,       // 0.0-1.0 fraction of page height (0=top, 1=bottom)
    "color": "red",      // red | green | orange | blue
    "style": "sticky",   // sticky | box
    "text": "Comment text here"
  }
]
"""

import sys
import json
import fitz  # PyMuPDF

COLOR_MAP = {
    'red':    (0.85, 0.1,  0.1),
    'green':  (0.1,  0.6,  0.1),
    'orange': (0.9,  0.5,  0.0),
    'blue':   (0.1,  0.3,  0.8),
}

FILL_MAP = {
    'red':    (1.0,  0.93, 0.93),
    'green':  (0.93, 1.0,  0.93),
    'orange': (1.0,  0.97, 0.88),
    'blue':   (0.90, 0.93, 1.0),
}

def apply_annotations(input_path, annotations, output_path):
    doc = fitz.open(input_path)
    page_count = len(doc)

    for ann in annotations:
        page_num = int(ann.get('page', 1)) - 1  # convert to 0-indexed
        if page_num < 0 or page_num >= page_count:
            page_num = 0  # clamp to valid range

        page = doc[page_num]
        pw = page.rect.width
        ph = page.rect.height

        x_pct = float(ann.get('x_pct', 0.05))
        y_pct = float(ann.get('y_pct', 0.1))
        color_key = ann.get('color', 'red')
        style = ann.get('style', 'sticky')
        text = ann.get('text', '')

        stroke = COLOR_MAP.get(color_key, COLOR_MAP['red'])
        fill   = FILL_MAP.get(color_key, FILL_MAP['red'])

        # Convert percentages to absolute coordinates
        # PyMuPDF y=0 is TOP of page
        ax = pw * x_pct
        ay = ph * y_pct

        if style == 'box':
            # Floating text box — wider, used for score summaries
            box_w = pw * 0.30
            box_h = 80
            rect = fitz.Rect(ax, ay, ax + box_w, ay + box_h)
            annot = page.add_freetext_annot(
                rect, text,
                fontsize=8,
                fontname='Helv',
                text_color=stroke,
                fill_color=fill,
                border_color=stroke,
            )
            annot.set_info(title='Dave Cook')
            annot.update()
        else:
            # Sticky note — default for inline comments
            point = fitz.Point(ax, ay)
            icon = 'Note' if color_key in ('green', 'blue') else 'Comment'
            annot = page.add_text_annot(point, text, icon=icon)
            annot.set_colors(stroke=stroke)
            annot.set_info(title='Dave Cook', content=text)
            annot.update()

    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    print(f'Saved annotated PDF: {output_path}')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        print('Usage: annotate_pdf.py <input_pdf> <annotations_json_str_or_file> <output_pdf>', file=sys.stderr)
        sys.exit(1)

    input_pdf  = sys.argv[1]
    ann_arg    = sys.argv[2]
    output_pdf = sys.argv[3]

    # ann_arg can be a JSON string or a path to a .json file
    if ann_arg.strip().startswith('[') or ann_arg.strip().startswith('{'):
        annotations = json.loads(ann_arg)
    else:
        with open(ann_arg) as f:
            annotations = json.load(f)

    if isinstance(annotations, dict) and 'annotations' in annotations:
        annotations = annotations['annotations']

    apply_annotations(input_pdf, annotations, output_pdf)
