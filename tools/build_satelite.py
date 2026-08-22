#!/usr/bin/env python3
"""Gera data/satelite.jpg a partir do NASA Blue Marble Next Generation (jul/2004,
com topografia e batimetria) na resolução nativa de 500 m/pixel.

Baixa os tiles B1 e B2 (21600×21600 cada, ~50 MB cada), recorta e costura o
retângulo dos mesmos limites que o app calcula em js/app.js (extremos da malha
das UFs e dos municípios + margem de 0,4°). A projeção do jogo estica a imagem
no viewBox, então o recorte equiretangular alinha com os contornos.

Uso:
  python3 build_satelite.py            # baixa os tiles e gera ../data/satelite.jpg
  python3 build_satelite.py --tiles /tmp  # usa/baixa os tiles nesse diretório

Requer Pillow (pip install pillow).
"""
import argparse
import json
import os
import re
import urllib.request

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

URL_TILE = ("https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/"
            "world.topo.bathy.200407.3x21600x21600.{tile}.jpg")
PPD = 240.0  # 500 m/pixel = 240 pixels por grau; tiles B cobrem lng -90..0
MARGEM = 0.4  # mesma margem de js/app.js


def carregar_js(path, var):
    texto = open(path, encoding="utf-8").read()
    m = re.search(r"var\s+" + var + r"\s*=\s*(\[.*?\])\s*;", texto, re.S)
    corpo = m.group(1)
    corpo = re.sub(r",\s*\]", "]", corpo)  # vírgulas penduradas do municipios.js
    return json.loads(corpo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", default=os.path.dirname(__file__) or ".",
                    help="diretório para baixar/reusar os tiles B1/B2")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "satelite.jpg"))
    args = ap.parse_args()

    dados = os.path.join(os.path.dirname(__file__), "..", "data")
    malha = carregar_js(os.path.join(dados, "brasil_uf.js"), "BRASIL_UF")
    municipios = carregar_js(os.path.join(dados, "municipios.js"), "MUNICIPIOS")

    lats = [p[1] for anel in malha for p in anel] + [m[3] for m in municipios]
    lngs = [p[0] for anel in malha for p in anel] + [m[4] for m in municipios]
    lat_min, lat_max = min(lats) - MARGEM, max(lats) + MARGEM
    lng_min, lng_max = min(lngs) - MARGEM, max(lngs) + MARGEM
    print(f"limites: lat {lat_min:.3f}..{lat_max:.3f}, lng {lng_min:.3f}..{lng_max:.3f}")

    caminhos = {}
    for tile in ("B1", "B2"):
        caminhos[tile] = os.path.join(args.tiles, f"bm_{tile}.jpg")
        if not os.path.exists(caminhos[tile]):
            print(f"baixando tile {tile}…")
            urllib.request.urlretrieve(URL_TILE.format(tile=tile), caminhos[tile])

    # caixa exata (float) em pixels do tile B "empilhado" (B1 sobre B2; y 0 = lat 90)
    fx1, fx2 = (lng_min + 90) * PPD, (lng_max + 90) * PPD
    fy1, fy2 = (90 - lat_max) * PPD, (90 - lat_min) * PPD
    ix1, iy1, ix2, iy2 = int(fx1), int(fy1), int(fx2) + 1, int(fy2) + 1

    canvas = Image.new("RGB", (ix2 - ix1, iy2 - iy1))
    im = Image.open(caminhos["B1"])
    parte = im.crop((ix1, iy1, ix2, 21600))
    canvas.paste(parte, (0, 0))
    altura_b1 = parte.height
    del im, parte
    im = Image.open(caminhos["B2"])
    parte = im.crop((ix1, 0, ix2, iy2 - 21600))
    canvas.paste(parte, (0, altura_b1))
    del im, parte

    # reamostra para a caixa float exata: a imagem alinha 1:1 com os limites do app
    w, h = round(fx2 - fx1), round(fy2 - fy1)
    saida = canvas.resize((w, h), Image.LANCZOS,
                          box=(fx1 - ix1, fy1 - iy1, fx2 - ix1, fy2 - iy1))
    saida.save(args.out, quality=76, optimize=True, progressive=True)
    print(f"{args.out}: {w}×{h}, {os.path.getsize(args.out) // 1024} KB")


if __name__ == "__main__":
    main()
