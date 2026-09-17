"""Independent offline numeric replay with Pillow/NumPy and rasterized area QA.

Requires Python, Pillow and NumPy only. No downloads or production data changes.
Polygon rasterization is an approximate independent check, not the production
intersection algorithm or a claim of ellipsoidal/geodetic accuracy.
"""
import gzip
import hashlib
import io
import json
import math
import struct
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

cache = Path('data/weather/cache')
report = json.loads(Path('reports/rainfall-window-validation.json').read_text())
def verified(path, digest):
    content = path.read_bytes()
    assert hashlib.sha256(content).hexdigest() == digest, path
    return content

arrays = []
for item in report['inputs']:
    manifest = json.loads((cache / 'manifests' / (item['manifestId'] + '.json')).read_text())
    original = verified(cache / 'objects' / (item['sourceSha256'] + '.raw'), item['sourceSha256'])
    data = json.loads(verified(cache / item['derived']['key'], item['derived']['sha256']))
    assert data['sourceSha256'] == manifest['body']['sha256'] == item['sourceSha256']
    message = gzip.decompress(original)
    sections, offset = {}, 16
    while offset < len(message) - 4:
        size = struct.unpack_from('>I', message, offset)[0]
        sections[message[offset + 4]] = message[offset:offset + size]
        offset += size
    s5 = sections[5]
    def signed(value):
        return -(value & 32767) if value & 32768 else value
    reference = struct.unpack_from('>f', s5, 11)[0]
    binary, decimal = (signed(x) for x in struct.unpack_from('>HH', s5, 15))
    g = data['grid']
    crop = (g['left'], g['top'], g['left'] + g['width'], g['top'] + g['height'])
    image = np.asarray(Image.open(io.BytesIO(sections[7][5:])).crop(crop)).astype(float)
    expected = (reference + image * 2.0**binary) * 10.0**(-decimal)
    expected[(expected == -1) | (expected == -3)] = np.nan
    actual = np.array([np.nan if x is None else x for x in data['values']]).reshape(expected.shape)
    np.testing.assert_allclose(actual, expected, atol=1e-6, rtol=0, equal_nan=True)
    arrays.append(expected)

stack = np.stack(arrays)
checks = []
for window in report['windows']:
    saved = json.loads(verified(cache / window['derived']['key'], window['derived']['sha256']))
    totals = np.sum(stack[-window['hours']:], axis=0)
    actual = np.array([np.nan if x is None else x for x in saved['accumulation']['values']]).reshape(totals.shape)
    np.testing.assert_allclose(actual, totals, atol=1e-6, rtol=0, equal_nan=True)
    # Analytic spherical cell area, independently of polygon clipping.
    north = g['y0'] + (np.arange(g['height']) - .5) * g['dy']
    row_area = np.sin(np.deg2rad(north)) - np.sin(np.deg2rad(north + g['dy']))
    expected_mean = np.sum(totals * row_area[:, None]) / (np.sum(row_area) * g['width'])
    np.testing.assert_allclose(saved['areas']['bbox']['meanMm'], expected_mean, atol=1e-6, rtol=0)
    checks.append({'hours': window['hours'], 'cells': totals.size, 'bboxMeanMm': float(expected_mean), 'passed': True})

reference = json.loads(gzip.decompress(verified(Path(report['reference']['file']), report['reference']['sha256'])))
features = {f['id']: f for f in reference['features']}
areas = sorted(saved['areas']['blockGroups'], key=lambda a: a['areaKm2'])
samples = {a['id']: a for a in [areas[0], areas[len(areas)//2], areas[-1]] + [a for a in areas if a['spatialCoverage'] < 1 - 1e-8 or a['id'] == '471579803001']}
spatial = []
for identifier, target in samples.items():
    geometry = features[identifier]['geometry']
    polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    rings = [[[(math.radians(x), math.sin(math.radians(y))) for x, y in ring] for ring in poly] for poly in polygons]
    coords = [point for poly in rings for ring in poly for point in ring]
    west, south = map(min, zip(*coords))
    east, north = map(max, zip(*coords))
    size = 1600
    dx, dy = (east-west)/size, (north-south)/size
    mask = Image.new('1', (size, size))
    draw = ImageDraw.Draw(mask)
    for poly in rings:
        for j, ring in enumerate(poly):
            draw.polygon([((x-west)/dx-.5, (north-y)/dy-.5) for x, y in ring], fill=1 if j == 0 else 0)
    selected = np.asarray(mask)
    lng = np.rad2deg(west + (np.arange(size)+.5)*dx)
    lat = np.rad2deg(np.arcsin(north - (np.arange(size)+.5)*dy))
    ix = np.floor((lng-g['x0'])/g['dx']+.5).astype(int)
    iy = np.floor((lat-g['y0'])/g['dy']+.5).astype(int)
    available = selected & ((ix >= 0) & (ix < g['width']))[None, :] & ((iy >= 0) & (iy < g['height']))[:, None]
    sampled = totals[np.clip(iy, 0, g['height']-1)[:, None], np.clip(ix, 0, g['width']-1)[None, :]]
    coverage = float(np.count_nonzero(available)/np.count_nonzero(selected))
    mean = float(np.mean(sampled[available]))
    area_km2 = np.count_nonzero(selected)*dx*dy*6371008.8**2/1e6
    assert abs(coverage-target['spatialCoverage']) < .003, (identifier, coverage, target)
    assert abs(mean-target['meanOverCompleteAreaMm']) < .08, (identifier, mean, target)
    assert abs(area_km2/target['areaKm2']-1) < .005, (identifier, area_km2, target)
    spatial.append({'id': identifier, 'rasterSize': size, 'meanMm': mean, 'exactClipMeanMm': target['meanOverCompleteAreaMm'],
                    'spatialCoverage': coverage, 'areaRelativeError': float(area_km2/target['areaKm2']-1), 'passed': True})

result = {'method': 'Independent Pillow GRIB PNG unpacking and NumPy sums; analytic spherical cell areas; Pillow equal-area polygon rasterization',
          'sourceHours': len(arrays), 'sourceCellsChecked': int(stack.size), 'windows': checks, 'spatialSamples': spatial,
          'spatialTolerances': {'meanMm': .08, 'coverageFraction': .003, 'areaRelative': .005}}
Path('reports/rainfall-window-independent.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
