#!/usr/bin/env python3
"""Gera os arquivos de dados embutidos do quiz (data/municipios.js,
data/brasil_uf.js, data/malha_municipios.js e data/vizinhos.js — o grafo de
"quem faz divisa com quem", derivado da própria malha municipal).

Fontes:
  - Coordenadas dos municípios: https://github.com/kelvins/municipios-brasileiros (csv/municipios.csv, csv/estados.csv)
  - População: IBGE, Censo 2022 (agregado 4709, variável 93, N6[all])
    https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6[all]
  - Área territorial: IBGE, Censo 2022 (agregado 4714, variável 6318, N6[all])
    https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/6318?localidades=N6[all]
  - PIB municipal: IBGE, PIB dos Municípios (agregado 5938, variável 37 —
    PIB a preços correntes, em R$ mil)
    https://servicodados.ibge.gov.br/api/v3/agregados/5938/periodos/2023/variaveis/37?localidades=N6[all]
  - Contorno das UFs: IBGE malhas
    https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&qualidade=maxima&formato=application/vnd.geo+json
  - Forma dos municípios: IBGE malhas (qualidade mínima, senão o arquivo
    passa de 9 MB — na escala do mapa a diferença não aparece)
    https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=municipio&qualidade=minima&formato=application/vnd.geo+json

Uso:
  python3 build_data.py --municipios municipios.csv --estados estados.csv \
      --pop pop2022.json --area area2022.json --pib pib2023.json \
      --malha br_uf.geojson --malha-municipios br_mun.geojson --out ../data
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
URL_AREA = "https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/6318?localidades=N6[all]"
URL_PIB = "https://servicodados.ibge.gov.br/api/v3/agregados/5938/periodos/2023/variaveis/37?localidades=N6[all]"
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
    return formas


# Grafo de "quem faz divisa com quem", derivado da própria malha: os polígonos
# do IBGE encaixam exatamente ao longo das fronteiras, então dois municípios
# que compartilham 2 ou mais vértices são vizinhos (um vértice só seria apenas
# um toque de canto). Municípios-ilha (Fernando de Noronha, Ilhabela) ficam de
# fora por não terem divisa terrestre com ninguém.
def gerar_vizinhos(formas, out_dir):
    usos = {}  # vértice arredondado -> códigos dos municípios que o usam
    for cod, aneis in formas.items():
        for anel in aneis:
            for p in anel:
                chave = (p[0], p[1])
                s = usos.get(chave)
                if s is None:
                    usos[chave] = s = set()
                s.add(cod)
    contagem = {}  # par (cod_a, cod_b) -> nº de vértices compartilhados
    for cods in usos.values():
        if len(cods) < 2:
            continue
        lista = sorted(cods)
        for i in range(len(lista)):
            for j in range(i + 1, len(lista)):
                par = (lista[i], lista[j])
                contagem[par] = contagem.get(par, 0) + 1
    vizinhos = {}
    arestas = 0
    for (a, b), n in contagem.items():
        if n < 2:
            continue
        arestas += 1
        vizinhos.setdefault(a, []).append(int(b))
        vizinhos.setdefault(b, []).append(int(a))
    out = os.path.join(out_dir, "vizinhos.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("// Gerado por tools/build_data.py — não editar à mão.\n")
        f.write("// Municípios que fazem divisa, por código IBGE — derivado da malha\n")
        f.write("// municipal: são vizinhos os que compartilham 2+ vértices (1 seria\n")
        f.write("// só um toque de canto). Ilhas e municípios fora da malha não entram.\n")
        f.write("var VIZINHOS = {\n")
        for cod in sorted(vizinhos):
            f.write('"%s":%s,\n' % (cod, json.dumps(sorted(vizinhos[cod]), separators=(",", ":"))))
        f.write("};\n")
    graus = [len(v) for v in vizinhos.values()]
    print(f"{out}: {arestas} divisas entre {len(vizinhos)} municípios, "
          f"grau médio {sum(graus) / len(graus):.1f}, máximo {max(graus)}, "
          f"{os.path.getsize(out) // 1024} KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--municipios")
    ap.add_argument("--estados")
    ap.add_argument("--pop")
    ap.add_argument("--area")
    ap.add_argument("--pib")
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

    area_json = json.loads(read_source(args.area, URL_AREA))
    area_por_ibge = {}
    for serie in area_json[0]["resultados"][0]["series"]:
        valor = list(serie["serie"].values())[0]
        if valor not in ("-", "...", "X", None):
            area_por_ibge[serie["localidade"]["id"]] = round(float(valor), 1)

    pib_json = json.loads(read_source(args.pib, URL_PIB))
    pib_por_ibge = {}
    for serie in pib_json[0]["resultados"][0]["series"]:
        valor = list(serie["serie"].values())[0]
        if valor not in ("-", "...", "X", None):
            pib_por_ibge[serie["localidade"]["id"]] = int(valor)

    municipios_csv = read_source(args.municipios, URL_MUNICIPIOS)
    linhas = []
    sem_pop = []
    sem_area = []
    sem_pib = []
    for row in csv.DictReader(io.StringIO(municipios_csv)):
        ibge = row["codigo_ibge"]
        pop = pop_por_ibge.get(ibge)
        if pop is None:
            sem_pop.append(f"{row['nome']} ({ibge})")
            pop = 0
        area = area_por_ibge.get(ibge)
        if area is None:
            sem_area.append(f"{row['nome']} ({ibge})")
            area = 0
        pib = pib_por_ibge.get(ibge)
        if pib is None:
            sem_pib.append(f"{row['nome']} ({ibge})")
            pib = 0
        linhas.append([
            int(ibge),
            row["nome"],
            uf_por_codigo[row["codigo_uf"]],
            round(float(row["latitude"]), 4),
            round(float(row["longitude"]), 4),
            pop,
            int(row["capital"]),
            area,
            pib,
        ])
    linhas.sort(key=lambda l: -l[5])
    if sem_pop:
        print(f"AVISO: {len(sem_pop)} municípios sem população: {sem_pop[:10]}", file=sys.stderr)
    if sem_area:
        print(f"AVISO: {len(sem_area)} municípios sem área: {sem_area[:10]}", file=sys.stderr)
    if sem_pib:
        print(f"AVISO: {len(sem_pib)} municípios sem PIB: {sem_pib[:10]}", file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)
    out_mun = os.path.join(args.out, "municipios.js")
    with open(out_mun, "w", encoding="utf-8") as f:
        f.write("// Gerado por tools/build_data.py — não editar à mão.\n")
        f.write("// Campos: [codigo_ibge, nome, uf, lat, lng, populacao_censo_2022, capital, area_km2_2022, pib_2023_mil_reais]\n")
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
    formas = gerar_malha_municipios(malha_mun, {str(l[0]) for l in linhas}, args.out)
    gerar_vizinhos(formas, args.out)


if __name__ == "__main__":
    main()
