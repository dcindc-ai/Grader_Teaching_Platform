#!/usr/bin/env python3
"""
normalize_to_pdf.py
Converts any student submission format to a PDF for annotation.
Supports: PDF (passthrough), PNG, JPG/JPEG, DOCX, PPTX
Usage: python3 normalize_to_pdf.py <input_path> <output_path>
"""

import sys
import os
import subprocess
import shutil

def normalize(input_path, output_path):
    ext = os.path.splitext(input_path)[1].lower()

    if ext == '.pdf':
        # Passthrough — already PDF
        shutil.copy2(input_path, output_path)
        return True

    elif ext in ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'):
        # Embed image into a PDF page using PyMuPDF
        import fitz
        img = fitz.open(input_path)
        pdf_bytes = img.convert_to_pdf()
        with open(output_path, 'wb') as f:
            f.write(pdf_bytes)
        return True

    elif ext in ('.docx', '.pptx', '.doc', '.ppt', '.odt', '.odp'):
        # Use LibreOffice headless to convert to PDF
        out_dir = os.path.dirname(output_path)
        result = subprocess.run(
            ['soffice', '--headless', '--convert-to', 'pdf', '--outdir', out_dir, input_path],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            print(f'LibreOffice error: {result.stderr}', file=sys.stderr)
            return False

        # LibreOffice names the output after the input filename
        base = os.path.splitext(os.path.basename(input_path))[0]
        lo_output = os.path.join(out_dir, base + '.pdf')
        if os.path.exists(lo_output) and lo_output != output_path:
            os.rename(lo_output, output_path)
        return os.path.exists(output_path)

    else:
        print(f'Unsupported format: {ext}', file=sys.stderr)
        return False


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: normalize_to_pdf.py <input> <output>', file=sys.stderr)
        sys.exit(1)

    success = normalize(sys.argv[1], sys.argv[2])
    sys.exit(0 if success else 1)
