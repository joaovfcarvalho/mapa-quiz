#!/usr/bin/env python3
"""Gera os arquivos de dados embutidos do quiz (data/municipios.js e data/brasil_uf.js).

Fontes:
  - Coordenadas dos municípios: https://github.com/kelvins/municipios-brasileiros (csv/municipios.csv, csv/estados.csv)
  - População: IBGE, Censo 2022 (agregado 4709, variável 93, N6[all])
    https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6[all]
  - Contorno das UFs: IBGE malhas
    https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&qualidade=maxima&formato=application/vnd.geo+json

Uso:
  python3 build_data.py --municipios municipios.csv --estados estados.csv \
      --pop pop2022.json --malha br_uf.geojson --out ../data
Sem argumentos, baixa as fontes da internet.
"""
import argparse
import csv
import io
import json
import os
import sys
import urllib.request

URL_MUNICIPIOS = "https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv"
URL_ESTADOS = "https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/estados.csv"
URL_POP = "https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6[all]"
URL_MALHA = "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&qualidade=maxima&formato=application/vnd.geo+json"


def read_source(path, url, binary=False):
    if path:
        mode = "rb" if binary else "r"
        with open(path, mode, encoding=None if binary else "utf-8-sig") as f:
            return f.read()
    with urllib.request.urlopen(url) as r:
        data = r.read()
        return data if binary else data.decode("utf-8-sig")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--municipios")
    ap.add_argument("--estados")
    ap.add_argument("--pop")
    ap.add_argument("--malha")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    args = ap.parse_args()

    estados_csv = read_source(args.estados, URL_ESTADOS)
    uf_por_codigo = {}
    for row in csv.DictReader(io.StringIO(estados_csv)):
        uf_por_codigo[row["codigo_uf"]] = row["uf"]

    pop_json = json.loads(read_source(args.pop, URL_POP))
    pop_por_ibge = {}
    for serie in pop_json[0]["resultados"][0]["series"]:
        valor = list(serie["serie"].values())[0]
        if valor not in ("-", "...", "X", None):
            pop_por_ibge[serie["localidade"]["id"]] = int(valor)

    municipios_csv = read_source(args.municipios, URL_MUNICIPIOS)
    linhas = []
    sem_pop = []
    for row in csv.DictReader(io.StringIO(municipios_csv)):
        ibge = row["codigo_ibge"]
        pop = pop_por_ibge.get(ibge)
        if pop is None:
            sem_pop.append(f"{row['nome']} ({ibge})")
            pop = 0
        linhas.append([
            int(ibge),
            row["nome"],
            uf_por_codigo[row["codigo_uf"]],
            round(float(row["latitude"]), 4),
            round(float(row["longitude"]), 4),
            pop,
            int(row["capital"]),
        ])
    linhas.sort(key=lambda l: -l[5])
    if sem_pop:
        print(f"AVISO: {len(sem_pop)} municípios sem população: {sem_pop[:10]}", file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)
    out_mun = os.path.join(args.out, "municipios.js")
    with open(out_mun, "w", encoding="utf-8") as f:
        f.write("// Gerado por tools/build_data.py — não editar à mão.\n")
        f.write("// Campos: [codigo_ibge, nome, uf, lat, lng, populacao_censo_2022, capital]\n")
        f.write("var MUNICIPIOS = [\n")
        for l in linhas:
            f.write(json.dumps(l, ensure_ascii=False, separators=(",", ":")) + ",\n")
        f.write("];\n")
    print(f"{out_mun}: {len(linhas)} municípios, {os.path.getsize(out_mun) // 1024} KB")

    malha = json.loads(read_source(args.malha, URL_MALHA))
    poligonos = []
    for feat in malha["features"]:
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            for anel in poly:
                pts = [[round(x, 3), round(y, 3)] for x, y in anel]
                # remove pontos consecutivos que o arredondamento igualou
                poligonos.append([p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]])
    out_malha = os.path.join(args.out, "brasil_uf.js")
    with open(out_malha, "w", encoding="utf-8") as f:
        f.write("// Gerado por tools/build_data.py — não editar à mão.\n")
        f.write("// Anéis de polígonos das UFs (IBGE, qualidade máxima): [[lng,lat],...]\n")
        f.write("var BRASIL_UF = ")
        f.write(json.dumps(poligonos, separators=(",", ":")))
        f.write(";\n")
    print(f"{out_malha}: {len(poligonos)} anéis, {os.path.getsize(out_malha) // 1024} KB")


if __name__ == "__main__":
    main()
