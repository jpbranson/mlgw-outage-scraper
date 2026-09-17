"""Optional independent pixel check: Python 3, Pillow and NumPy; never downloads.

Node is the only requirement for normal weather validation. This separate decoder
checks all native subset values/pixels against the retained provider originals.
"""
import base64
import gzip
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image

cache = Path('data/weather/cache')
report = json.loads(Path('reports/weather-validation.json').read_text())
results = []
for sample in report['samples']:
    for product in ('radar', 'rainfall'):
        item = sample['products'][product]
        if item['availability'] != 'available':
            continue
        manifest = json.loads((cache / 'manifests' / (item['manifestId'] + '.json')).read_text())
        original = (cache / 'objects' / (manifest['body']['sha256'] + '.raw')).read_bytes()
        subset = json.loads((cache / item['derived']['key']).read_text())
        grid = subset['grid']
        if product == 'radar':
            source = np.asarray(Image.open(io.BytesIO(original)).convert('RGBA'))
            actual = np.asarray(Image.open(io.BytesIO(base64.b64decode(subset['pngBase64']))))
            expected = source[grid['top']:grid['top']+grid['height'], grid['left']:grid['left']+grid['width']]
            np.testing.assert_array_equal(actual, expected)
        else:
            message = gzip.decompress(original)
            sections = {}
            offset = 16
            while offset < len(message)-4:
                size = struct.unpack_from('>I', message, offset)[0]
                sections[message[offset+4]] = message[offset:offset+size]
                offset += size
            s5 = sections[5]
            def signed(value):
                return -(value & 32767) if value & 32768 else value
            reference = struct.unpack_from('>f', s5, 11)[0]
            binary, decimal = (signed(x) for x in struct.unpack_from('>HH', s5, 15))
            image = np.asarray(Image.open(io.BytesIO(sections[7][5:]))).astype(float)
            expected = (reference + image * 2.0**binary) * 10.0**(-decimal)
            expected = expected[grid['top']:grid['top']+grid['height'], grid['left']:grid['left']+grid['width']].ravel()
            expected[(expected == -1) | (expected == -3)] = np.nan
            actual = np.array([np.nan if x is None else x for x in subset['values']])
            np.testing.assert_allclose(actual, expected, atol=1e-6, rtol=0, equal_nan=True)
        results.append({'case': sample['name'], 'product': product, 'cells': grid['width']*grid['height'], 'passed': True})
Path('reports/weather-pixel-verification.json').write_text(json.dumps({'decoder': 'Pillow + NumPy', 'checks': results}, indent=2))
print(json.dumps(results, indent=2))
