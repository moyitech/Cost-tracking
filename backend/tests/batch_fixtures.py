"""Synthetic overlapping shopping screenshots, no personal data."""

import io

from PIL import Image, ImageDraw, ImageFont


def shopping_screenshots():
    orders = [
        [
            "ORDER SYN-A  |  COMPLETED",
            "Test Camera",
            "Model: TEST-A",
            "Quantity: 1",
            "Paid per unit: CNY 1080.00",
            "Purchase date: 2026-10-01",
        ],
        [
            "ORDER SYN-B  |  COMPLETED",
            "Test Keyboard",
            "Model: TEST-B",
            "Quantity: 1",
            "Paid per unit: CNY 99.00",
            "Purchase date: 2026-10-02",
        ],
        [
            "ORDER SYN-C  |  COMPLETED",
            "Test Camera",
            "Model: TEST-A",
            "Quantity: 1",
            "Paid per unit: CNY 1250.00",
            "Purchase date: 2026-10-03",
        ],
        [
            "ORDER SYN-D  |  CANCELED",
            "Test Camera",
            "Quantity: 1",
            "Price: CNY 1080.00",
            "Free gift: Camera Bag (Quantity: 1)",
            "Entire order including gift is CANCELED",
        ],
    ]
    blobs = []
    for group in ([0, 1], [1, 2], [0, 1], [3]):
        image = Image.new("RGB", (1100, 900), "#f1f3f5")
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=27)
        draw.text((30, 18), "SYNTHETIC SHOPPING HISTORY - TEST DATA ONLY", fill="black", font=font)
        for slot, order in enumerate(group):
            top = 80 + slot * 390
            draw.rectangle((20, top, 1080, top + 365), fill="white", outline="#cccccc", width=2)
            for row, value in enumerate(orders[order]):
                draw.text((40, top + 20 + row * 55), value, fill="black", font=font)
        output = io.BytesIO()
        image.save(output, format="PNG")
        blobs.append(output.getvalue())
    return blobs
