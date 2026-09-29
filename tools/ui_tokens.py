"""Map legacy stylesheet color literals and tiny font sizes onto STRATUM design tokens.

The legacy stylesheets carried ~3,200 raw color literals (hundreds of near-identical
tints) and 1,100+ font sizes of 5-10px. This tool rewrites them in place:

* Colors in UI properties (color, background, border, outline, shadow, ...) snap to the
  nearest token of the same hue family in OKLab space and become ``var(--token)``.
  Alpha is kept via ``color-mix``. SVG ``fill``/``stroke`` values, ``url(...)`` payloads and
  token definitions are left alone so illustrations, charts and material colors keep
  their meaning.
* ``font-size`` / ``font`` sizes below the readable floor are raised: 11px for mono or
  uppercase labels, 12px for everything else. Rules that style SVG text keep their
  user-unit sizes because they scale with a viewBox.

Usage:  python tools/ui_tokens.py [--check] file.css ...
Re-running is idempotent: already-tokenized values are not literals any more.
"""
import argparse
import math
import re
import sys
from pathlib import Path

# Token palette — keep in sync with stratum-tokens.css.
FAMILIES = {
    'neutral': {
        'n-0': '#ffffff', 'n-25': '#fbfbf9', 'n-50': '#f5f5f1', 'n-100': '#ecebe6', 'n-150': '#e3e2dc',
        'n-200': '#d6d6d0', 'n-300': '#babdbf', 'n-400': '#8e949c', 'n-500': '#646c78', 'n-600': '#4a5260',
        'n-700': '#343b47', 'n-800': '#232934', 'n-850': '#1a1f28', 'n-900': '#13171e', 'n-950': '#0c0f14',
    },
    'accent': {
        'a-50': '#eef2ff', 'a-100': '#dfe6ff', 'a-200': '#c0cdff', 'a-300': '#93a8ff', 'a-400': '#6682fb',
        'a-500': '#375cf6', 'a-600': '#2448df', 'a-700': '#1d39b1', 'a-800': '#1a2f84', 'a-900': '#15224f',
    },
    'signal': {'s-100': '#f1fad0', 's-300': '#e2f59a', 's-400': '#d3ee65', 's-600': '#8ba523', 's-800': '#4d5c12'},
    'success': {'g-50': '#ecf8f0', 'g-200': '#b7e3c5', 'g-400': '#4cc07c', 'g-500': '#1f9a55', 'g-700': '#16703f'},
    'warning': {'w-50': '#fff6e6', 'w-200': '#fbd9a0', 'w-400': '#efb76b', 'w-600': '#b86e12', 'w-800': '#6f430b'},
    'danger': {'d-50': '#fff0ee', 'd-200': '#ffc5b9', 'd-400': '#f07a64', 'd-500': '#dc4530', 'd-700': '#a3291a'},
}

UI_PROPERTIES = re.compile(
    r'^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-start|-end)?)?(-color)?'
    r'|outline(-color)?|box-shadow|text-shadow|text-decoration(-color)?|caret-color|accent-color'
    r'|column-rule(-color)?|--[\w-]+)$')
COLOR = re.compile(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b'
                   r'|rgba?\(\s*[\d.]+%?[\s,]+[\d.]+%?[\s,]+[\d.]+%?(?:\s*[,/]\s*[\d.]+%?)?\s*\)')
RULE = re.compile(r'([^{}]*)\{([^{}]*)\}')
SVG_SELECTOR = re.compile(r'(^|[\s>+~,(])(svg|text|tspan|canvas)\b|\.webgl|foreignObject')


def parse(literal):
    s = literal.strip()
    if s.startswith('#'):
        h = s[1:]
        if len(h) in (3, 4):
            h = ''.join(c * 2 for c in h)
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return r, g, b, a
    parts = re.findall(r'[\d.]+%?', s)
    def channel(v):
        return float(v[:-1]) * 2.55 if v.endswith('%') else float(v)
    r, g, b = (channel(v) for v in parts[:3])
    a = 1.0
    if len(parts) > 3:
        a = float(parts[3][:-1]) / 100 if parts[3].endswith('%') else float(parts[3])
    return r, g, b, a


def oklab(r, g, b):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = lin(r), lin(g), lin(b)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


PALETTE = {family: {name: oklab(*parse(hex_)[:3]) for name, hex_ in tokens.items()}
           for family, tokens in FAMILIES.items()}


def family_of(lab):
    L, a, b = lab
    chroma = math.hypot(a, b)
    if chroma < 0.04:
        return 'neutral'
    hue = math.degrees(math.atan2(b, a)) % 360
    if hue < 45 or hue >= 330:
        return 'danger'
    if hue < 100:
        return 'warning'
    if hue < 132:
        return 'signal'
    if hue < 165:
        return 'success'
    return 'accent'


def nearest(literal):
    r, g, b, alpha = parse(literal)
    lab = oklab(r, g, b)
    family = family_of(lab)
    weight = (1.0, 0.25, 0.25) if family == 'neutral' else (1.0, 1.0, 1.0)
    token = min(PALETTE[family], key=lambda name: sum(w * (p - q) ** 2 for w, p, q in
                                                        zip(weight, lab, PALETTE[family][name])))
    if alpha >= 0.995:
        return f'var(--{token})'
    if alpha <= 0.005:
        return 'transparent'
    return f'color-mix(in srgb, var(--{token}) {round(alpha * 100)}%, transparent)'


def outside_urls(value, replace):
    """Apply replace() to value text that is not inside url(...) or a quoted string."""
    out, i = [], 0
    for match in re.finditer(r'url\([^)]*\)|"[^"]*"|\'[^\']*\'', value):
        out.append(replace(value[i:match.start()]))
        out.append(match.group(0))
        i = match.end()
    out.append(replace(value[i:]))
    return ''.join(out)


def floor_font(selector, body, stats):
    if SVG_SELECTOR.search(selector) or re.search(r'(^|;)\s*(fill|stroke)\s*:', body):
        return body
    label = bool(re.search(r'mono|monospace|uppercase|letter-spacing', body))
    floor = 11 if label else 12

    def bump(match):
        size = float(match.group(2))
        if size >= floor or size < 4:
            return match.group(0)
        stats['fonts'] += 1
        return f'{match.group(1)}{floor}px'
    body = re.sub(r'(font-size\s*:\s*)([\d.]+)px', bump, body)
    return re.sub(r'((?:^|;)\s*font\s*:\s*(?:[a-z-]+\s+|\d{3}\s+)*)([\d.]+)px', bump, body)


def transform(css, stats):
    def rule(match):
        selector, body = match.group(1), match.group(2)
        if selector.strip().startswith(('@font-face', ':root')) and 'stratum-tokens' in selector:
            return match.group(0)
        declarations = []
        for declaration in re.split(r'(;)', body):
            name, sep, value = declaration.partition(':')
            prop = name.strip().lower()
            if sep and UI_PROPERTIES.match(prop) and not prop.startswith('--n-'):
                def swap(text):
                    def one(color):
                        stats['colors'] += 1
                        return nearest(color.group(0))
                    return COLOR.sub(one, text)
                value = outside_urls(value, swap)
            declarations.append(name + sep + value)
        body = floor_font(selector, ''.join(declarations), stats)
        return selector + '{' + body + '}'
    # Innermost rules only: @media / @supports wrappers keep their structure.
    return RULE.sub(rule, css)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('files', nargs='+', type=Path)
    parser.add_argument('--check', action='store_true', help='report without writing')
    args = parser.parse_args()
    total = {'colors': 0, 'fonts': 0}
    for path in args.files:
        if path.name == 'stratum-tokens.css':
            continue
        css = path.read_text(encoding='utf-8')
        stats = {'colors': 0, 'fonts': 0}
        result = transform(css, stats)
        print(f'{path.name:24} colors={stats["colors"]:5} font-sizes={stats["fonts"]:4}')
        for key in total:
            total[key] += stats[key]
        if not args.check and result != css:
            path.write_text(result, encoding='utf-8', newline='\n')
    print(f'{"total":24} colors={total["colors"]:5} font-sizes={total["fonts"]:4}')


if __name__ == '__main__':
    sys.exit(main())
