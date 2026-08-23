#!/usr/bin/env python3
"""Gera os arquivos de dados embutidos do quiz (data/municipios.js,
data/brasil_uf.js e data/malha_municipios.js).

Fontes:
  - Coordenadas dos municípios: https://github.com/kelvins/municipios-brasileiros (csv/municipios.csv, csv/estados.csv)
  - População: IBGE, Censo 2022 (agregado 4709, variável 93, N6[all])
    https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6[all]
  - Contorno das UFs: IBGE malhas
    https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&qualidade=maxima&formato=application/vnd.geo+json
  - Forma dos municípios: IBGE malhas (qualidade mínima, senão o arquivo
    passa de 9 MB — na escala do mapa a diferença não aparece)
    https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=municipio&qualidade=minima&formato=application/vnd.geo+json

Uso:
  python3 build_data.py --municipios municipios.csv --estados estados.csv \
      --pop pop2022.json --malha br_uf.geojson \
      --malha-municipios br_mun.geojson --out ../data
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
URL_MALHA_MUN = "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=municipio&qualidade=minima&formato=application/vnd.geo+json"


def read_source(path, url, binary=False):
    if path:
        mode = "rb" if binary else "r"
        with open(path, mode, encoding=None if binary else "utf-8-sig") as f:
            return f.read()
    with urllib.request.urlopen(url) as r:
        data = r.read()
        return data if binary else data.decode("utf-8-sig")


# Anéis de um polígono GeoJSON, arredondados a 3 casas (~110 m) e sem os
# pontos que o arredondamento igualou nem o fecho repetido (o "Z" do path fecha).
def compactar_aneis(geom):
    aneis = []
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for poly in polys:
        for anel in poly:
            pts = [[round(x, 3), round(y, 3)] for x, y in anel]
            pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
            if len(pts) > 1 and pts[0] == pts[-1]:
                pts.pop()
            aneis.append(pts)
    return aneis


def gerar_malha_municipios(malha_mun, codigos_jogo, out_dir):
    formas = {}
    for feat in malha_mun["features"]:
        formas[feat["properties"]["codarea"]] = compactar_aneis(feat["geometry"])
    sem_forma = sorted(codigos_jogo - set(formas))
    if sem_forma:
        print(f"AVISO: {len(sem_forma)} municípios sem forma na malha "
              f"(ficam só com o ponto): {sem_forma}", file=sys.stderr)
    out_formas = os.path.join(out_dir, "malha_municipios.js")
    with open(out_formas, "w", encoding="utf-8") as f:
        f.write("// Gerado por tools/build_data.py — não editar à mão.\n")
        f.write("// Forma dos municípios (IBGE, qualidade mínima), por código IBGE:\n")
        f.write("// lista de anéis [[lng,lat],...]; anéis internos são buracos "
                "(desenhar com fill-rule evenodd).\n")
        f.write("var MALHA_MUNICIPIOS = {\n")
        for cod in sorted(formas):
            f.write('"%s":%s,\n' % (cod, json.dumps(formas[cod], separators=(",", ":"))))
        f.write("};\n")
    print(f"{out_formas}: {len(formas)} municípios, {os.path.getsize(out_formas) // 1024} KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--municipios")
    ap.add_argument("--estados")
    ap.add_argument("--pop")
    ap.add_argument("--malha")
    ap.add_argument("--malha-municipios")
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

    malha_mun = json.loads(read_source(args.malha_municipios, URL_MALHA_MUN))
    gerar_malha_municipios(malha_mun, {str(l[0]) for l in linhas}, args.out)


if __name__ == "__main__":
    main()
