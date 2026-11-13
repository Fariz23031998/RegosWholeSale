import base64
import io


def barcode_png_data_uri(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    try:
        from barcode import Code128, EAN13
        from barcode.writer import ImageWriter
    except ImportError:
        return ""

    buffer = io.BytesIO()
    # Wide aspect so CSS height + object-fit:contain can fill sticker width.
    options = {"write_text": False, "module_height": 4.5, "quiet_zone": 1.0, "module_width": 0.28}
    digits = text
    if len(digits) == 13 and digits.isdigit():
        try:
            EAN13(digits, writer=ImageWriter()).write(buffer, options=options)
            return _png_data_uri(buffer.getvalue())
        except Exception:
            buffer = io.BytesIO()
    try:
        Code128(text, writer=ImageWriter()).write(buffer, options=options)
    except Exception:
        return ""
    return _png_data_uri(buffer.getvalue())


def qr_png_data_uri(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    try:
        import segno
    except ImportError:
        return ""
    buffer = io.BytesIO()
    segno.make(text, error="m").save(buffer, kind="png", scale=4, border=1)
    return _png_data_uri(buffer.getvalue())


def _png_data_uri(payload: bytes) -> str:
    if not payload:
        return ""
    encoded = base64.b64encode(payload).decode("ascii")
    return f"data:image/png;base64,{encoded}"
