#!/usr/bin/env python3
"""Gera os dados dos mapas de população do Censo 2022 (data/censo_ap.js e
data/censo_setores_*.js), nos dois recortes:

  * áreas de ponderação (14.406 unidades, 1 arquivo)
  * setores censitários (468.097 unidades, 1 arquivo por UF)

Fontes (todas públicas, IBGE):
  - Malha das áreas de ponderação 2022
    https://geoftp.ibge.gov.br/recortes_para_fins_estatisticos/malha_de_areas_de_ponderacao/censo_demografico_2022/APONDs2022_Geometrias/APONDs2022_Brasil.gpkg
  - De-para setor censitário 2022 x área de ponderação 2022
    https://geoftp.ibge.gov.br/recortes_para_fins_estatisticos/malha_de_areas_de_ponderacao/censo_demografico_2022/DePara_SetorCensit22xAPOND22/CSV/DePara_SetorCensit22xAPOND22_Brasil.csv
  - Malha dos setores censitários 2022
    https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/gpkg/BR/BR_setores_CD2022.gpkg
  - Agregados por setor censitário, tabela "básico" (v0001 = pessoas residentes)
    https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/Agregados_por_Setor_csv/Agregados_por_setores_basico_BR_20260520.zip

Dependências (não são do site, só do build):
  pip install geopandas pyogrio
  npm install -g mapshaper      # simplificação topológica + quantização

Uso:
  python3 tools/build_censo.py                 # tudo (baixa ~1,9 GB na 1ª vez)
  python3 tools/build_censo.py --so ap         # só as áreas de ponderação
  python3 tools/build_censo.py --so setores    # só os setores censitários
  python3 tools/build_censo.py --cache /caminho/para/downloads

O formato de saída é uma topologia no estilo TopoJSON (arcos compartilhados
entre unidades vizinhas, coordenadas quantizadas em inteiros), achatada em
vetores paralelos para o navegador conseguir passá-la direto para typed arrays.
Ver js/censo-topo.js para o decodificador.
"""
import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

GEOFTP = "https://geoftp.ibge.gov.br"
FTP = "https://ftp.ibge.gov.br"

URL_AP_MALHA = (
    GEOFTP + "/recortes_para_fins_estatisticos/malha_de_areas_de_ponderacao"
    "/censo_demografico_2022/APONDs2022_Geometrias/APONDs2022_Brasil.gpkg"
)
URL_AP_DEPARA = (
    GEOFTP + "/recortes_para_fins_estatisticos/malha_de_areas_de_ponderacao"
    "/censo_demografico_2022/DePara_SetorCensit22xAPOND22/CSV"
    "/DePara_SetorCensit22xAPOND22_Brasil.csv"
)
URL_SETORES_MALHA = (
    GEOFTP + "/organizacao_do_territorio/malhas_territoriais"
    "/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022"
    "/setores/gpkg/BR/BR_setores_CD2022.gpkg"
)
URL_BASICO = (
    FTP + "/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios"
    "/Agregados_por_Setor_csv/Agregados_por_setores_basico_BR_20260520.zip"
)

# Quantização das coordenadas: 65.536 passos no maior lado da caixa do recorte.
# No Brasil inteiro isso dá ~70 m; por UF, bem menos. Cada passo vira um inteiro
# pequeno no arquivo, e a diferença some na tela (um pixel do mapa nacional
# cobre vários passos).
QUANT = 65536
# Limiar do Visvalingam, em m². Remove os vértices cujo triângulo é menor que
# isso — na prática, detalhe abaixo de ~15 m de lado.
INTERVALO_AP = 200
INTERVALO_SETOR = 200

UFS = [
    ("11", "RO", "Rondônia"), ("12", "AC", "Acre"), ("13", "AM", "Amazonas"),
    ("14", "RR", "Roraima"), ("15", "PA", "Pará"), ("16", "AP", "Amapá"),
    ("17", "TO", "Tocantins"), ("21", "MA", "Maranhão"), ("22", "PI", "Piauí"),
    ("23", "CE", "Ceará"), ("24", "RN", "Rio Grande do Norte"),
    ("25", "PB", "Paraíba"), ("26", "PE", "Pernambuco"), ("27", "AL", "Alagoas"),
    ("28", "SE", "Sergipe"), ("29", "BA", "Bahia"), ("31", "MG", "Minas Gerais"),
    ("32", "ES", "Espírito Santo"), ("33", "RJ", "Rio de Janeiro"),
    ("35", "SP", "São Paulo"), ("41", "PR", "Paraná"), ("42", "SC", "Santa Catarina"),
    ("43", "RS", "Rio Grande do Sul"), ("50", "MS", "Mato Grosso do Sul"),
    ("51", "MT", "Mato Grosso"), ("52", "GO", "Goiás"), ("53", "DF", "Distrito Federal"),
]
UF_POR_CODIGO = {c: (s, n) for c, s, n in UFS}


# ---------------------------------------------------------------- utilidades

def baixar(url, destino):
    """Baixa url para destino, retomando o que já estiver no disco."""
    if os.path.exists(destino) and os.path.getsize(destino) > 0:
        print("  cache: %s" % os.path.basename(destino))
        return destino
    print("  baixando %s" % os.path.basename(destino))
    tmp = destino + ".parcial"
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    os.replace(tmp, destino)
    return destino


def mapshaper(binario, entrada, saida, intervalo, quant, dissolver=False):
    """Simplifica preservando a topologia e escreve TopoJSON quantizado."""
    cmd = [binario, entrada]
    if dissolver:
        cmd += ["-dissolve", "i"]
    cmd += [
        "-simplify", "visvalingam", "interval=%d" % intervalo, "keep-shapes",
        "-clean",
        "-o", "format=topojson", "quantization=%d" % quant, saida,
    ]
    env = dict(os.environ, NODE_OPTIONS="--max-old-space-size=12000")
    subprocess.run(cmd, check=True, env=env, stdout=subprocess.DEVNULL)


def ler_basico(caminho_zip):
    """{CD_SETOR: (pop, area_km2, cd_sit, nome_local)} da tabela básico.

    `nome_local` é o bairro quando o município tem malha de bairros e, quando
    não tem, o distrito — em São Paulo, por exemplo, três em cada quatro
    setores não têm bairro, mas todos têm distrito ("Bela Vista", "Sé").
    """
    dados = {}
    with zipfile.ZipFile(caminho_zip) as z:
        nome = [n for n in z.namelist() if n.lower().endswith(".csv")][0]
        with z.open(nome) as bruto:
            linhas = (linha.decode("latin-1") for linha in bruto)
            for linha in csv.DictReader(linhas, delimiter=";"):
                try:
                    pop = int(linha["v0001"] or 0)
                except ValueError:
                    pop = 0
                try:
                    area = float((linha["AREA_KM2"] or "0").replace(",", "."))
                except ValueError:
                    area = 0.0
                local = (linha.get("NM_BAIRRO") or "").strip()
                if not local:
                    local = (linha.get("NM_DIST") or "").strip()
                dados[linha["CD_SETOR"]] = (pop, area, linha.get("CD_SIT", ""), local)
    return dados


def texto(v):
    """Campo de texto do GeoPandas -> str (valores ausentes viram NaN)."""
    if v is None or v != v:
        return ""
    return str(v).strip()


def ler_depara(caminho):
    """{CD_SETOR: cd_apond}."""
    with open(caminho, encoding="utf-8-sig") as f:
        leitor = csv.reader(f, delimiter=";")
        next(leitor)
        return {l[0]: l[1] for l in leitor if len(l) >= 2}


# ------------------------------------------------- topojson -> formato do site

def achatar_topologia(topo):
    """TopoJSON do mapshaper -> vetores paralelos prontos para typed arrays.

    Devolve (cabecalho, ordem), em que `ordem` são os índices `i` que cada
    geometria carrega (a ordem das feições no TopoJSON não é a da entrada).
    """
    arcos_planos = []
    arcos_ini = [0]
    for arco in topo["arcs"]:
        for x, y in arco:
            arcos_planos.append(x)
            arcos_planos.append(y)
        arcos_ini.append(len(arcos_planos) // 2)

    (objeto,) = topo["objects"].values()
    geometrias = objeto["geometries"]

    # geom: para cada unidade, os anéis achatados em um vetor só, com um vetor
    # de tamanhos por anel — de novo, para virar typed array sem laço aninhado.
    anel_ids = []
    anel_tam = []
    unidade_nanel = []
    ordem = []
    for g in geometrias:
        ordem.append(g["properties"]["i"])
        aneis = []
        if g.get("type") == "Polygon":
            aneis = g["arcs"]
        elif g.get("type") == "MultiPolygon":
            for poligono in g["arcs"]:
                aneis.extend(poligono)
        unidade_nanel.append(len(aneis))
        for anel in aneis:
            anel_tam.append(len(anel))
            anel_ids.extend(anel)

    t = topo["transform"]
    return {
        "escala": t["scale"],
        "translada": t["translate"],
        "arcos": arcos_planos,
        "arcosIni": arcos_ini,
        "unidadeNAnel": unidade_nanel,
        "anelTam": anel_tam,
        "anelIds": anel_ids,
    }, ordem


def escrever_js(caminho, variavel, cabecalho, comentario):
    """Escreve `var VAR = {...};` com os vetores numéricos em uma linha cada."""
    partes = []
    for chave, valor in cabecalho.items():
        partes.append("%s:%s" % (json.dumps(chave), json.dumps(
            valor, separators=(",", ":"), ensure_ascii=False
        )))
    with open(caminho, "w", encoding="utf-8") as f:
        f.write("// Gerado por tools/build_censo.py — não editar à mão.\n")
        for linha in comentario.strip().splitlines():
            f.write("// %s\n" % linha.strip())
        f.write("var %s = {\n" % variavel)
        f.write(",\n".join(partes))
        f.write("\n};\n")
    return os.path.getsize(caminho)


def avisar_descarte(cod, pop, ordem, recuo="  "):
    """Avisa se a limpeza do mapshaper deixou alguma unidade sem geometria."""
    if len(ordem) == len(cod):
        return
    perdidos = set(range(len(cod))) - set(ordem)
    print("%saviso: %d unidades sem geometria após a limpeza (%s habitantes)" % (
        recuo, len(perdidos), "{:,}".format(sum(pop[i] for i in perdidos)).replace(",", ".")))


def mib(n):
    return "%.1f MB" % (n / 1048576.0)


# ------------------------------------------------------ áreas de ponderação

def construir_ap(args, basico):
    import geopandas as gpd

    print("Áreas de ponderação")
    malha = baixar(URL_AP_MALHA, os.path.join(args.cache, "APONDs2022_Brasil.gpkg"))
    depara = baixar(URL_AP_DEPARA, os.path.join(args.cache, "DePara_Brasil.csv"))

    print("  somando a população dos setores por área de ponderação")
    setor_ap = ler_depara(depara)
    pop_ap, area_ap = {}, {}
    for setor, (pop, area, _sit, _bairro) in basico.items():
        ap = setor_ap.get(setor)
        if ap is None:
            continue
        pop_ap[ap] = pop_ap.get(ap, 0) + pop
        area_ap[ap] = area_ap.get(ap, 0.0) + area

    print("  lendo a malha")
    gdf = gpd.read_file(malha, columns=[
        "cd_apond", "nm_apond", "AREA_KM2", "Qt_SetCensit", "CD_MUN", "NM_MUN", "CD_UF",
    ])
    gdf = gdf.reset_index(drop=True)

    muns, mun_idx = [], {}
    cod, nome, pop, area, nsetores, mun = [], [], [], [], [], []
    for pos, linha in enumerate(gdf.itertuples(index=False)):
        c = str(linha.cd_apond)
        cod.append(c)
        nome.append(texto(linha.nm_apond))
        pop.append(pop_ap.get(c, 0))
        # A área da malha é a oficial da unidade; a soma dos setores confere,
        # mas arredonda pior. Guardamos em km², com 4 casas.
        area.append(int(round(float(linha.AREA_KM2 or area_ap.get(c, 0.0)) * 1e6)))
        nsetores.append(int(linha.Qt_SetCensit or 0))
        cm = str(linha.CD_MUN)
        if cm not in mun_idx:
            mun_idx[cm] = len(muns)
            sigla = UF_POR_CODIGO.get(str(linha.CD_UF), ("", ""))[0]
            muns.append([cm, texto(linha.NM_MUN), sigla])
        mun.append(mun_idx[cm])

    geojson = os.path.join(args.cache, "ap_bruto.json")
    topo = os.path.join(args.cache, "ap_topo.json")
    print("  exportando GeoJSON")
    gdf[["geometry"]].assign(i=range(len(gdf))).to_file(
        geojson, driver="GeoJSON", engine="pyogrio"
    )
    print("  simplificando (interval=%d, quantization=%d)" % (INTERVALO_AP, QUANT))
    mapshaper(args.mapshaper, geojson, topo, INTERVALO_AP, QUANT)

    with open(topo, encoding="utf-8") as f:
        cabecalho, ordem = achatar_topologia(json.load(f))

    cabecalho["cod"] = [cod[i] for i in ordem]
    cabecalho["nome"] = [nome[i] for i in ordem]
    cabecalho["pop"] = [pop[i] for i in ordem]
    cabecalho["aream2"] = [area[i] for i in ordem]
    cabecalho["nsetores"] = [nsetores[i] for i in ordem]
    cabecalho["mun"] = [mun[i] for i in ordem]
    cabecalho["muns"] = muns
    avisar_descarte(cod, pop, ordem)
    print("  %d áreas, %s habitantes" % (
        len(ordem), "{:,}".format(sum(cabecalho["pop"])).replace(",", ".")))

    destino = os.path.join(args.out, "censo_ap.js")
    tam = escrever_js(destino, "CENSO_AP", cabecalho, """
        Áreas de ponderação do Censo 2022 (IBGE) com a população residente
        somada a partir dos setores censitários que compõem cada uma.
    """)
    print("  %s -> %s" % (destino, mib(tam)))


# ------------------------------------------------------- setores censitários

def construir_setores(args, basico):
    import geopandas as gpd
    import pyogrio

    print("Setores censitários")
    malha = baixar(URL_SETORES_MALHA, os.path.join(args.cache, "BR_setores_CD2022.gpkg"))
    (camada,) = [c[0] for c in pyogrio.list_layers(malha)]

    indice = []
    for cd_uf, sigla, nome_uf in UFS:
        if args.uf and sigla != args.uf:
            continue
        print("  %s" % sigla)
        gdf = gpd.read_file(
            malha, layer=camada, columns=["CD_SETOR", "CD_MUN", "NM_MUN", "CD_UF"],
            where="CD_UF = '%s'" % cd_uf,
        ).reset_index(drop=True)

        # Um setor com partes separadas (uma ilha, um trecho do outro lado do
        # rio) vem como várias linhas com o mesmo CD_SETOR. Todas recebem o
        # mesmo `i` e o mapshaper as junta num MultiPolygon só — senão a mesma
        # população seria contada uma vez por parte.
        muns, mun_idx = [], {}
        locais, local_idx = [""], {"": 0}
        cod, pop, area, sit, local, mun = [], [], [], [], [], []
        setor_idx = {}
        i_da_linha = []
        sem_dados = 0
        for linha in gdf.itertuples(index=False):
            c = str(linha.CD_SETOR)
            if c in setor_idx:
                i_da_linha.append(setor_idx[c])
                continue
            setor_idx[c] = len(cod)
            i_da_linha.append(setor_idx[c])
            if c not in basico:
                sem_dados += 1
            p, a, s, nl = basico.get(c, (0, 0.0, "", ""))
            # o código do setor começa com o do município; guardamos só o resto
            cod.append(int(c[7:]))  # zeros à esquerda voltam na exibição
            pop.append(p)
            area.append(int(round(a * 1e6)))
            sit.append(1 if s in ("1", "2", "3") else 0)  # 1 = urbano
            if nl not in local_idx:
                local_idx[nl] = len(locais)
                locais.append(nl)
            local.append(local_idx[nl])
            cm = str(linha.CD_MUN)
            if cm not in mun_idx:
                mun_idx[cm] = len(muns)
                muns.append([cm, texto(linha.NM_MUN)])
            mun.append(mun_idx[cm])
        if sem_dados:
            print("    aviso: %d setores sem linha na tabela básico" % sem_dados)

        geojson = os.path.join(args.cache, "setores_%s_bruto.json" % sigla)
        topo = os.path.join(args.cache, "setores_%s_topo.json" % sigla)
        gdf[["geometry"]].assign(i=i_da_linha).to_file(
            geojson, driver="GeoJSON", engine="pyogrio"
        )
        mapshaper(args.mapshaper, geojson, topo, INTERVALO_SETOR, QUANT,
                  dissolver=len(i_da_linha) != len(cod))
        with open(topo, encoding="utf-8") as f:
            cabecalho, ordem = achatar_topologia(json.load(f))
        os.remove(geojson)
        os.remove(topo)

        cabecalho["uf"] = sigla
        cabecalho["cod"] = [cod[i] for i in ordem]
        cabecalho["pop"] = [pop[i] for i in ordem]
        cabecalho["aream2"] = [area[i] for i in ordem]
        cabecalho["sit"] = [sit[i] for i in ordem]
        cabecalho["local"] = [local[i] for i in ordem]
        cabecalho["locais"] = locais
        cabecalho["mun"] = [mun[i] for i in ordem]
        cabecalho["muns"] = muns
        avisar_descarte(cod, pop, ordem, recuo="    ")

        destino = os.path.join(args.out, "censo_setores_%s.js" % sigla.lower())
        tam = escrever_js(destino, "CENSO_SETORES_%s" % sigla, cabecalho, """
            Setores censitários do Censo 2022 (IBGE) de %s, com a população
            residente (v0001) da tabela básico dos agregados por setor.
        """ % nome_uf)
        print("    %d setores, %s habitantes, %s" % (
            len(ordem), "{:,}".format(sum(cabecalho["pop"])).replace(",", "."), mib(tam)))
        indice.append({
            "uf": sigla, "nome": nome_uf, "cd": cd_uf,
            "n": len(ordem), "pop": sum(cabecalho["pop"]),
            "arquivo": "data/censo_setores_%s.js" % sigla.lower(),
            "variavel": "CENSO_SETORES_%s" % sigla,
        })

    if not args.uf:
        destino = os.path.join(args.out, "censo_setores_indice.js")
        escrever_js(destino, "CENSO_SETORES_INDICE", {"ufs": indice}, """
            Índice dos arquivos por UF dos setores censitários.
        """)
        print("  %s" % destino)


def main():
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cache", default=os.path.join(raiz, ".cache-censo"),
                   help="pasta dos downloads (padrão: .cache-censo na raiz)")
    p.add_argument("--out", default=os.path.join(raiz, "data"))
    p.add_argument("--mapshaper", default="mapshaper")
    p.add_argument("--so", choices=["ap", "setores"], help="gerar só um recorte")
    p.add_argument("--uf", help="só uma UF dos setores (para testar)")
    args = p.parse_args()

    os.makedirs(args.cache, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)
    if shutil.which(args.mapshaper) is None and not os.path.exists(args.mapshaper):
        sys.exit("mapshaper não encontrado (npm install -g mapshaper)")

    print("Tabela básico dos agregados por setor")
    basico = ler_basico(baixar(URL_BASICO, os.path.join(args.cache, "basico.zip")))
    print("  %d setores" % len(basico))

    if args.so != "setores":
        construir_ap(args, basico)
    if args.so != "ap":
        construir_setores(args, basico)


if __name__ == "__main__":
    main()
