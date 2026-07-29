#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_dataset.py — Generador del dataset de imágenes de rayos X (SIM-XR / PSA)

Dos modos de uso:

  1) MODO IA (DALL-E 3, requiere API key de OpenAI):
       set OPENAI_API_KEY=sk-...        (Windows)
       export OPENAI_API_KEY=sk-...     (Linux/Mac)
       pip install openai requests
       python generate_dataset.py --count 100

  2) MODO PROCEDURAL (sin API key, genera imágenes sintéticas de prueba con PIL):
       pip install pillow
       python generate_dataset.py --procedural --count 20

Ambos modos guardan las imágenes en assets/xray_images/ y escriben un
manifest.json que el servidor Node importa automáticamente al iniciar.

IMPORTANTE (modo IA): DALL-E no devuelve coordenadas de los objetos, por lo que
el manifest solo indica si la imagen contiene amenaza y de qué tipo. Las cajas
exactas se dibujan luego en 2 minutos por imagen con el modo ANOTADOR del
sistema (usuario instructor). En modo procedural las cajas SÍ se generan
automáticamente con coordenadas exactas.
"""
import argparse
import json
import math
import os
import random
import sys
import time
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "assets" / "xray_images"

THREAT_TYPES = {
    "arma_fuego":  "a disassembled or assembled handgun silhouette in deep dark blue/black dense metal tones",
    "arma_blanca": "a large combat knife blade silhouette in dark blue dense metal tones",
    "explosivo":   "an improvised explosive device: orange organic block connected by thin blue wires to a small battery and detonator",
    "contrabando": "several dense orange organic rectangular packages tightly wrapped, hidden between clothes",
}

BAG_CONTENTS = [
    "folded clothes, shoes, a hair dryer and toiletry bottles",
    "a laptop, tangled charging cables, headphones and books",
    "a camera, lenses, a tablet and an umbrella",
    "water bottles, food containers, a thermos and cutlery",
    "children's toys, clothes and a small electronic game console",
    "gym equipment, sneakers, a padlock and clothes",
    "documents, folders, a calculator and office supplies",
    "souvenirs, ceramic mugs, clothes and a power bank",
]

PROMPT_TEMPLATE = (
    "Airport security X-ray scanner image of a suitcase on a conveyor belt, "
    "top-down orthographic view, dual-energy pseudo-color rendering: organic materials "
    "in translucent orange, inorganic materials in green, dense metals in dark blue/black, "
    "white background where the beam passes through. The suitcase contains {contents}{threat}. "
    "Semi-transparent overlapping objects, realistic baggage screening monitor aesthetic, "
    "no text, no watermark, flat scientific imaging style."
)


# ----------------------------------------------------------------------
# MODO 1: DALL-E 3
# ----------------------------------------------------------------------
def generate_with_dalle(count: int, threat_ratio: float) -> list:
    try:
        from openai import OpenAI
        import requests
    except ImportError:
        sys.exit("Faltan dependencias: pip install openai requests")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        sys.exit("Defina la variable de entorno OPENAI_API_KEY antes de ejecutar.")

    client = OpenAI(api_key=api_key)
    manifest = []

    for i in range(1, count + 1):
        has_threat = random.random() < threat_ratio
        threat_key = random.choice(list(THREAT_TYPES)) if has_threat else None
        threat_txt = f", and hidden inside, {THREAT_TYPES[threat_key]}" if has_threat else ""
        prompt = PROMPT_TEMPLATE.format(contents=random.choice(BAG_CONTENTS), threat=threat_txt)
        filename = f"xray_{i:03d}_{threat_key or 'limpio'}.png"

        for attempt in range(1, 4):  # reintentos ante errores transitorios
            try:
                print(f"[{i}/{count}] Generando {filename} (intento {attempt})…")
                resp = client.images.generate(
                    model="dall-e-3",
                    prompt=prompt,
                    size="1024x1024",
                    quality="standard",
                    n=1,
                )
                url = resp.data[0].url
                img = requests.get(url, timeout=120)
                img.raise_for_status()
                (OUTPUT_DIR / filename).write_bytes(img.content)
                manifest.append({
                    "filename": filename,
                    "has_threat": has_threat,
                    "threat_type": threat_key,
                    "threats": [],  # cajas exactas: anotar con el modo ANOTADOR del sistema
                })
                break
            except Exception as e:
                print(f"   ⚠ Error: {e}")
                if attempt == 3:
                    print(f"   ✘ Se omite {filename} tras 3 intentos.")
                else:
                    time.sleep(8 * attempt)
        time.sleep(2)  # respeto de rate limits
    return manifest


# ----------------------------------------------------------------------
# MODO 2: Procedural (PIL) — imágenes sintéticas de prueba con cajas exactas
# ----------------------------------------------------------------------
def generate_procedural(count: int, threat_ratio: float) -> list:
    try:
        from PIL import Image, ImageDraw, ImageFilter
    except ImportError:
        sys.exit("Falta dependencia: pip install pillow")

    W, H = 1024, 768
    ORG = (240, 150, 60)   # orgánico
    INO = (90, 180, 120)   # inorgánico
    MET = (40, 70, 160)    # metal
    manifest = []

    def blob(draw, cx, cy, rx, ry, color, alpha):
        draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=color + (alpha,))

    for i in range(1, count + 1):
        has_threat = random.random() < threat_ratio
        threat_key = random.choice(list(THREAT_TYPES)) if has_threat else None
        filename = f"xray_{i:03d}_{threat_key or 'limpio'}.png"

        base = Image.new("RGB", (W, H), (247, 248, 250))
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)

        # Silueta de la valija (orgánico translúcido)
        m = 70
        d.rounded_rectangle([m, m, W - m, H - m], radius=48, fill=ORG + (70,))
        d.rounded_rectangle([m, m, W - m, H - m], radius=48, outline=MET + (160,), width=10)
        d.rectangle([W // 2 - 180, m - 26, W // 2 + 180, m + 8], fill=MET + (190,))  # manija

        # Contenido aleatorio (ropa/orgánicos, electrónicos/inorgánicos, metales chicos)
        for _ in range(random.randint(6, 11)):
            kind = random.random()
            cx, cy = random.randint(m + 90, W - m - 90), random.randint(m + 90, H - m - 90)
            if kind < 0.5:
                blob(d, cx, cy, random.randint(60, 150), random.randint(40, 110), ORG, random.randint(50, 110))
            elif kind < 0.8:
                w2, h2 = random.randint(50, 130), random.randint(35, 90)
                d.rectangle([cx - w2, cy - h2, cx + w2, cy + h2], fill=INO + (random.randint(60, 120),))
            else:
                w2, h2 = random.randint(14, 40), random.randint(10, 26)
                d.rectangle([cx - w2, cy - h2, cx + w2, cy + h2], fill=MET + (random.randint(150, 220),))

        threats = []
        if has_threat:
            tx = random.randint(m + 130, W - m - 320)
            ty = random.randint(m + 110, H - m - 220)
            if threat_key == "arma_fuego":
                # silueta de pistola (metal denso)
                d.rectangle([tx, ty, tx + 200, ty + 55], fill=MET + (235,))
                d.rectangle([tx + 130, ty + 45, tx + 185, ty + 150], fill=MET + (235,))
                d.rectangle([tx + 8, ty + 14, tx + 40, ty + 40], fill=(15, 20, 45, 250))
                bw, bh = 210, 160
            elif threat_key == "arma_blanca":
                d.polygon([(tx, ty + 30), (tx + 230, ty), (tx + 240, ty + 22), (tx + 20, ty + 55)], fill=MET + (230,))
                d.rectangle([tx + 230, ty - 6, tx + 290, ty + 40], fill=ORG + (200,))
                bw, bh = 300, 70
            elif threat_key == "explosivo":
                d.rectangle([tx, ty, tx + 150, ty + 90], fill=(235, 120, 30, 210))     # carga orgánica
                d.rectangle([tx + 175, ty + 20, tx + 235, ty + 70], fill=MET + (230,))  # batería
                for k in range(3):  # cables
                    d.line([tx + 150, ty + 20 + k * 25, tx + 175, ty + 30 + k * 15], fill=MET + (255,), width=5)
                bw, bh = 245, 100
            else:  # contrabando
                for k in range(3):
                    d.rectangle([tx + k * 55, ty + (k % 2) * 30, tx + k * 55 + 70, ty + (k % 2) * 30 + 95],
                                fill=(230, 110, 25, 190))
                bw, bh = 190, 130
            threats.append({
                "x": round((tx - 12) / W, 4), "y": round((ty - 12) / H, 4),
                "w": round((bw + 24) / W, 4), "h": round((bh + 24) / H, 4),
                "tipo": threat_key,
            })

        layer = layer.filter(ImageFilter.GaussianBlur(1.4))
        base.paste(layer, (0, 0), layer)
        base.save(OUTPUT_DIR / filename)
        manifest.append({
            "filename": filename,
            "has_threat": has_threat,
            "threat_type": threat_key,
            "threats": threats,
        })
        print(f"[{i}/{count}] ✔ {filename}" + (f" ({threat_key})" if threat_key else " (limpio)"))
    return manifest


def main():
    ap = argparse.ArgumentParser(description="Generador de dataset SIM-XR")
    ap.add_argument("--count", type=int, default=100, help="Cantidad de imágenes (default 100)")
    ap.add_argument("--threat-ratio", type=float, default=0.5, help="Proporción con amenaza (default 0.5)")
    ap.add_argument("--procedural", action="store_true", help="Modo sin API (PIL, imágenes sintéticas de prueba)")
    args = ap.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = (generate_procedural if args.procedural else generate_with_dalle)(args.count, args.threat_ratio)

    manifest_path = OUTPUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n✔ Dataset listo: {len(manifest)} imágenes en {OUTPUT_DIR}")
    print(f"✔ Manifest escrito en {manifest_path} (el servidor lo importa al iniciar).")
    if not args.procedural:
        print("→ Recuerde dibujar las cajas exactas de cada amenaza con el modo ANOTADOR (usuario instructor).")


if __name__ == "__main__":
    main()
