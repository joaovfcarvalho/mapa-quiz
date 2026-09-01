#!/usr/bin/env python3
"""Gera a silhueta simplificada do Brasil (img/brasil-silhueta.svg) e o ícone
do site (img/icone.svg) a partir da malha das UFs em data/brasil_uf.js.
Sem dependências: Douglas-Peucker puro em Python."""
import json, math, os, re

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

def carregar_ufs():
    txt = open(os.path.join(RAIZ, "data/brasil_uf.js"), encoding="utf-8").read()
    txt = txt[txt.index("= [") + 2:txt.rindex("]") + 1]
    return json.loads(txt)

def dp(pts, tol):
    if len(pts) < 3:
        return pts
    x1, y1 = pts[0]; x2, y2 = pts[-1]
    dx, dy = x2 - x1, y2 - y1
    n = math.hypot(dx, dy) or 1e-12
    imax, dmax = 0, -1
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / n
        if d > dmax:
            imax, dmax = i, d
    if dmax > tol:
        return dp(pts[:imax + 1], tol)[:-1] + dp(pts[imax:], tol)
    return [pts[0], pts[-1]]

def dp_anel(pts, tol):
    # anel fechado (primeiro == último): divide ao meio antes do DP, senão a
    # "reta" entre as pontas tem comprimento zero
    meio = len(pts) // 2
    return dp(pts[:meio + 1], tol)[:-1] + dp(pts[meio:], tol)

def projetar(lng, lat, lat0=-14.0):
    # equiretangular com fator de largura no centro do país (mesma do jogo)
    return lng * math.cos(math.radians(lat0)), -lat

def gerar(tol, largura):
    aneis = carregar_ufs()
    pts = []
    for anel in aneis:
        s = dp_anel(anel, tol)
        if len(s) >= 4:
            pts.append([projetar(*p) for p in s])
    xs = [x for a in pts for x, _ in a]; ys = [y for a in pts for _, y in a]
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    esc = largura / max(xmax - xmin, ymax - ymin)
    alt = (ymax - ymin) * esc
    d = []
    for a in pts:
        d.append("M" + " ".join("%.1f %.1f" % ((x - xmin) * esc, (y - ymin) * esc) for x, y in a) + "Z")
    return "".join(d), largura, alt

if __name__ == "__main__":
    # silhueta detalhada o bastante para a imagem de compartilhamento
    d, w, h = gerar(0.06, 1000)
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.0f %.0f">'
           '<path fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="%s"/></svg>') % (w, h, d)
    open(os.path.join(RAIZ, "img/brasil-silhueta.svg"), "w", encoding="utf-8").write(svg)
    print("silhueta: %d bytes" % len(svg))

    # ícone: silhueta grossa num quadrado escuro com um ponto âmbar (a sede
    # de um município, como no mapa do jogo)
    d2, w2, h2 = gerar(0.5, 72)
    ox, oy = (100 - w2) / 2, (100 - h2) / 2
    icone = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<rect width="100" height="100" rx="22" fill="#0e1b28"/>'
        '<g transform="translate(%.1f %.1f)"><path fill="#f5b942" stroke="#f5b942" stroke-width="1.6" stroke-linejoin="round" d="%s"/></g>'
        '<circle cx="62" cy="58" r="9" fill="#0e1b28"/>'
        '<circle cx="62" cy="58" r="5" fill="#f0287e"/>'
        '</svg>') % (ox, oy, d2)
    open(os.path.join(RAIZ, "img/icone.svg"), "w", encoding="utf-8").write(icone)
    print("icone: %d bytes" % len(icone))
