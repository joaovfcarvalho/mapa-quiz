#!/usr/bin/env python3
"""Gera data/rios.js — os rios nomeados do Brasil para o quiz de rios.

Fonte: ANA (Agência Nacional de Águas e Saneamento Básico), base hidrográfica
ottocodificada do SNIRH, serviços "Hidrografia nível 1" e "Hidrografia nível 2":
  https://www.snirh.gov.br/arcgis/rest/services/DADOSABERTOS/Hidrografia_nível_N/MapServer/0

Cada trecho vem com NORIOCOMP (nome completo, ex.: "Rio Iguaçu") e COCURSODAG
(código ottocodificado do curso d'água — identifica o rio inteiro, mesmo quando
o nome se repete pelo país, como os vários Rio Verde). O script:

  1. baixa os trechos dos níveis 1 e 2, já generalizados pelo servidor
     (maxAllowableOffset) para a escala do mapa;
  2. junta os trechos de cada curso d'água (por COCURSODAG) em polilinhas
     contínuas, emendando pontas coincidentes;
  3. recorta ao território brasileiro usando o contorno das UFs já gerado em
     data/brasil_uf.js — com uma folga de alguns km, para não picotar os rios
     que correm exatamente sobre a fronteira (Paraguai, Uruguai, Oiapoque...);
  4. descarta o que não é rio (baías, lagoas, canais, paranás) e o que sobrou
     quase todo fora do Brasil (Beni, Marañon, Putumayo...);
  5. calcula a extensão em km de cada rio (dentro do recorte) e emite
     data/rios.js ordenado por extensão decrescente.

Uso:
  python3 build_rios.py                    # baixa da internet
  python3 build_rios.py --cache ./cache    # guarda/reusa as respostas baixadas
"""
import argparse
import json
import math
import os
import re
import sys
import urllib.request

URL_BASE = ("https://www.snirh.gov.br/arcgis/rest/services/DADOSABERTOS/"
            "Hidrografia_n%%C3%%ADvel_%d/MapServer/0/query")
NIVEIS = [1, 2]
PAGINA = 1000            # maxRecordCount do serviço
OFFSET_GEOM = 0.005      # maxAllowableOffset em graus (~550 m) — generalização
FOLGA_FRONTEIRA = 0.09   # graus (~10 km): ponto fora do polígono mas perto da
                         # fronteira ainda conta como Brasil (rios de divisa)
MIN_KM = 30              # rio com menos que isso dentro do Brasil sai do jogo
                         # (também derruba as lascas de rios estrangeiros que
                         # só encostam na fronteira, como o Beni)
MIN_FRACAO = 0.2         # ...ou com menos que isso do seu curso no Brasil —
                         # rios de divisa (Paraguai, Javari, Guaporé) passam
                         # folgados porque correm colados na fronteira


def baixar(url, cache_dir, chave):
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        arq = os.path.join(cache_dir, chave + ".json")
        if os.path.exists(arq):
            with open(arq, encoding="utf-8") as f:
                return json.load(f)
    with urllib.request.urlopen(url, timeout=180) as r:
        dados = json.loads(r.read().decode("utf-8"))
    if "error" in dados:
        raise RuntimeError(f"erro do servidor em {url}: {dados['error']}")
    if cache_dir:
        with open(arq, "w", encoding="utf-8") as f:
            json.dump(dados, f)
    return dados


def baixar_nivel(nivel, cache_dir):
    feats = []
    offset = 0
    while True:
        url = (URL_BASE % nivel) + (
            "?where=1%3D1&outFields=NORIOCOMP,COCURSODAG"
            f"&maxAllowableOffset={OFFSET_GEOM}&geometryPrecision=3"
            f"&orderByFields=OBJECTID&resultOffset={offset}"
            f"&resultRecordCount={PAGINA}&f=json"
        )
        d = baixar(url, cache_dir, f"nivel{nivel}_off{offset}")
        pagina = d.get("features", [])
        feats.extend(pagina)
        print(f"  nível {nivel}: +{len(pagina)} trechos (total {len(feats)})",
              file=sys.stderr)
        if not d.get("exceededTransferLimit") and len(pagina) < PAGINA:
            break
        offset += PAGINA
    return feats


# ---------------------------------------------------------------------------
# Recorte ao Brasil: ponto-no-polígono par/ímpar sobre todos os anéis das UFs
# (as UFs ladrilham o país, então "dentro de um número ímpar de anéis" equivale
# a "dentro do Brasil") + grade espacial dos vértices da fronteira para a folga.

def carregar_brasil_uf(caminho):
    with open(caminho, encoding="utf-8") as f:
        texto = f.read()
    ini = texto.index("[", texto.index("var BRASIL_UF"))
    fim = texto.rindex("]")
    return json.loads(texto[ini:fim + 1])


def criar_teste_brasil(aneis):
    passo = FOLGA_FRONTEIRA
    grade = set()  # células (ix,iy) a até ~FOLGA da fronteira → vale a folga

    def celula(lng, lat):
        return (int(math.floor(lng / passo)), int(math.floor(lat / passo)))

    for anel in aneis:
        for lng, lat in anel:
            cx, cy = celula(lng, lat)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    grade.add((cx + dx, cy + dy))

    # Ray casting com as arestas indexadas por faixa de latitude (0.1°): cada
    # consulta só examina as arestas que cruzam a sua latitude — sem isso o
    # teste seria 52 mil arestas × centenas de milhares de pontos de rio.
    faixa = 0.1
    faixas = {}
    for anel in aneis:
        j = len(anel) - 1
        for i in range(len(anel)):
            xi, yi = anel[i]
            xj, yj = anel[j]
            j = i
            if yi == yj:
                continue
            lo = int(math.floor(min(yi, yj) / faixa))
            hi = int(math.floor(max(yi, yj) / faixa))
            for b in range(lo, hi + 1):
                faixas.setdefault(b, []).append((xi, yi, xj, yj))

    def dentro(lng, lat):
        n = 0
        for xi, yi, xj, yj in faixas.get(int(math.floor(lat / faixa)), ()):
            if (yi > lat) != (yj > lat) and \
               lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                n += 1
        return n % 2 == 1

    cache = {}  # a precisão de 3 casas repete muitos pontos entre trechos

    def teste(lng, lat):
        k = (lng, lat)
        v = cache.get(k)
        if v is None:
            v = cache[k] = (celula(lng, lat) in grade) or dentro(lng, lat)
        return v

    return teste


def haversine_km(lat1, lng1, lat2, lng2):
    rad = math.pi / 180
    a = (math.sin((lat2 - lat1) * rad / 2) ** 2 +
         math.cos(lat1 * rad) * math.cos(lat2 * rad) *
         math.sin((lng2 - lng1) * rad / 2) ** 2)
    return 2 * 6371.0088 * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Emenda dos trechos de um mesmo curso d'água em polilinhas contínuas.

def emendar(linhas):
    pontas = {}  # ponto -> lista de linhas que começam/terminam nele
    linhas = [list(l) for l in linhas if len(l) >= 2]
    mudou = True
    while mudou:
        mudou = False
        pontas.clear()
        for i, l in enumerate(linhas):
            if l is None:
                continue
            for p in (tuple(l[0]), tuple(l[-1])):
                pontas.setdefault(p, []).append(i)
        for p, idxs in pontas.items():
            vivos = [i for i in idxs if linhas[i] is not None]
            if len(vivos) != 2 or vivos[0] == vivos[1]:
                continue
            a, b = vivos
            la, lb = linhas[a], linhas[b]
            if tuple(la[-1]) == p and tuple(lb[0]) == p:
                linhas[a] = la + lb[1:]
            elif tuple(lb[-1]) == p and tuple(la[0]) == p:
                linhas[a] = lb + la[1:]
            elif tuple(la[0]) == p and tuple(lb[0]) == p:
                linhas[a] = la[::-1] + lb[1:]
            elif tuple(la[-1]) == p and tuple(lb[-1]) == p:
                linhas[a] = la + lb[::-1][1:]
            else:
                continue
            linhas[b] = None
            mudou = True
            break
    return [l for l in linhas if l is not None]


def recortar(linhas, teste_brasil):
    """Mantém só os pedaços dentro do Brasil (com a folga da fronteira)."""
    saida = []
    for linha in linhas:
        atual = []
        for lng, lat in linha:
            if teste_brasil(lng, lat):
                atual.append([lng, lat])
            else:
                if len(atual) >= 2:
                    saida.append(atual)
                atual = []
        if len(atual) >= 2:
            saida.append(atual)
    return saida


def extensao_km(linhas):
    km = 0.0
    for l in linhas:
        for i in range(1, len(l)):
            km += haversine_km(l[i - 1][1], l[i - 1][0], l[i][1], l[i][0])
    return km


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="diretório para guardar/reusar os downloads")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    ap.add_argument("--brasil-uf", default=os.path.join(
        os.path.dirname(__file__), "..", "data", "brasil_uf.js"))
    args = ap.parse_args()

    print("Carregando contorno do Brasil…", file=sys.stderr)
    teste_brasil = criar_teste_brasil(carregar_brasil_uf(args.brasil_uf))

    cursos = {}  # cocursodag -> {nome, nivel, linhas}
    for nivel in NIVEIS:
        print(f"Baixando hidrografia nível {nivel}…", file=sys.stderr)
        for f in baixar_nivel(nivel, args.cache):
            attrs = f.get("attributes", {})
            nome = (attrs.get("NORIOCOMP") or "").strip()
            cod = str(attrs.get("COCURSODAG") or "").strip()
            geom = f.get("geometry") or {}
            if not nome or not cod or not geom.get("paths"):
                continue
            # só rios: fora baías, lagoas, canais, corixos, paranás (braços)
            # e "Riozinho" — exigir o espaço evita esse último
            if not nome.startswith("Rio "):
                continue
            # o mesmo curso ottocodificado troca de nome ao longo do caminho
            # (Guaporé→Mamoré→Madeira; Solimões→Amazonas), então a chave é
            # (código, nome): cada trecho nomeado vira um rio jogável
            c = cursos.setdefault((cod, nome), {"nome": nome, "nivel": nivel, "linhas": []})
            c["linhas"].extend(geom["paths"])

    print(f"{len(cursos)} cursos d'água nomeados; emendando e recortando…",
          file=sys.stderr)
    rios = []
    for chave, c in cursos.items():
        inteiras = emendar(c["linhas"])
        linhas = recortar(inteiras, teste_brasil)
        if not linhas:
            continue
        km = extensao_km(linhas)
        if km < MIN_KM or km < MIN_FRACAO * extensao_km(inteiras):
            continue
        rios.append({
            "nome": c["nome"],
            "nivel": c["nivel"],
            "km": round(km),
            "linhas": [[[p[0], p[1]] for p in l] for l in linhas],
        })

    rios.sort(key=lambda r: -r["km"])
    total_pontos = sum(len(l) for r in rios for l in r["linhas"])
    print(f"{len(rios)} rios no jogo, {total_pontos} vértices, "
          f"{sum(r['km'] for r in rios)} km somados", file=sys.stderr)

    out = os.path.join(args.out, "rios.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("// Gerado por tools/build_rios.py — não editar à mão.\n")
        f.write("// Rios nomeados do Brasil (ANA/SNIRH, hidrografia ottocodificada,\n")
        f.write("// níveis 1 e 2), recortados ao território brasileiro.\n")
        f.write("// Formato: [nome, nivel, km, [[[lng,lat],...], ...]] — ordenado por km desc.\n")
        f.write("var RIOS = [\n")
        for r in rios:
            f.write(json.dumps(
                [r["nome"], r["nivel"], r["km"], r["linhas"]],
                separators=(",", ":"), ensure_ascii=False) + ",\n")
        f.write("];\n")
    print(f"{out}: {len(rios)} rios, {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main()
