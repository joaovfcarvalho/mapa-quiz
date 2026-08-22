# 🗺️ Quiz do Mapa do Brasil

**Jogue online:** https://joaovfcarvalho.github.io/mapa-quiz/

Jogo de quiz geográfico no estilo dos quizzes de mapa do HugeQuiz, cobrindo os
5.571 municípios do Brasil. Roda 100% offline no navegador — basta abrir o
`index.html` (duplo clique) — e guarda seus recordes pessoais por configuração
no `localStorage` do navegador.

## Modos de jogo

**1. Círculos por distância** — chute cidades; cada palpite cobre todos os
municípios num raio fixo (configurável, ex.: 100 km). Cubra o máximo do país
(por população ou por número de cidades) antes de acabarem os palpites — ou o
tempo.

**2. Círculos por população** — cada cidade chutada vira o centro de um círculo
que cresce até somar a população alvo (ex.: 1 milhão de habitantes). Cidades
grandes geram círculos pequenos; cidades vazias geram círculos enormes.
Estratégia: onde ancorar os círculos para cobrir o máximo do Brasil?

**3. Faixas do mapa** — o mapa é dividido em faixas de latitude, longitude ou
anéis concêntricos em volta de uma cidade à sua escolha. Em cada faixa é
preciso nomear as N maiores cidades; faixa 100% respondida muda de cor no
mapa. Tudo configurável: largura da faixa em km, quantidade de cidades por
faixa e o centro dos anéis.

**4. Top N cidades** — o modo raiz do HugeQuiz: cite de memória as N maiores
cidades (100 por padrão), de preferência contra o relógio. Cada acerto acende
a cidade no mapa com a posição no ranking.

**Região do jogo** — qualquer modo pode ser jogado com o Brasil inteiro ou só
com uma UF (o mapa aproxima o estado e municípios de fora somem). Raio de
30 km em Minas é outro jogo.

**Limite da partida** — nos modos de círculos, escolha entre limitar por
número de palpites (ex.: 10 chutes, sem pressa) ou por tempo (ex.: 30 minutos
com palpites ilimitados). Faixas e Top N podem ser jogados livres ou contra o
relógio. Quando o tempo esgota, a partida encerra sozinha e o resultado vale
para o recorde daquela configuração.

**Desafio por link** — o botão 🔗 Desafiar copia um link com a configuração
atual (e seu recorde como marca a bater). Quem abrir o link joga exatamente o
mesmo desafio.

**Relatório pós-partida** — ao final, o jogo mostra o que de maior ficou de
fora: população na mesa e as maiores cidades esquecidas.

## Mapa de densidade de municípios

Além do quiz, a página `densidade.html` (botão 📍 Densidade no topo) mostra um
mapa de calor do Brasil: cada ponto do território é colorido pela quantidade
de municípios (sedes municipais) existentes num raio de X km dele — raio
ajustável de 20 a 500 km. Passe o mouse para ler o valor em qualquer ponto e
clique para fixar um círculo e listar os municípios dentro dele. O painel
mostra ainda o pico de densidade do país para o raio escolhido (com 100 km, o
recorde fica no oeste catarinense, na fronteira dos minifúndios de SC e RS).

## Como jogar

- Digite o nome da cidade e aperte Enter. Acentos, maiúsculas e hífens são
  ignorados (`sao jose dos campos` funciona).
- Se houver mais de um município com o mesmo nome, especifique a UF:
  `Bom Jesus, RS` (ou `bom jesus rs`).
- Roda do mouse dá zoom no mapa, arrastar move, duplo clique restaura.
- Passe o mouse sobre uma cidade já revelada/coberta para ver nome e população.

## Recordes

Cada combinação exata de modo + parâmetros tem seu próprio recorde (maior %;
em caso de empate, menor tempo), salvo no navegador. O botão 🏆 Recordes lista
todos, com opção de apagar individualmente ou tudo — e de exportar/importar um
backup em JSON (a importação mescla, ficando sempre com o melhor recorde de
cada configuração).

## Dados

| Dado | Fonte |
|---|---|
| População por município | IBGE, Censo Demográfico 2022 (agregado 4709, variável 93) |
| Coordenadas (sede municipal) | [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) |
| Contorno das UFs | IBGE, API de malhas (qualidade mínima) |
| Fundo de satélite (botão 🛰️) | NASA Blue Marble Next Generation, via [GIBS](https://earthdata.nasa.gov/gibs) (domínio público) |

Os dados ficam embutidos em `data/municipios.js` e `data/brasil_uf.js` para o
jogo funcionar offline (inclusive aberto via `file://`). Para regenerar a
partir das fontes:

```bash
cd tools
python3 build_data.py          # baixa tudo da internet
```

Observações: as distâncias usam o centroide (sede) de cada município, não o
polígono; Boa Esperança do Norte (MT), criado em 2023, consta com população 0
por não existir no Censo 2022.

## Estrutura

```
mapa-quiz/
├── index.html          # página única do jogo
├── densidade.html      # mapa de densidade de municípios
├── css/style.css
├── js/
│   ├── geo.js          # haversine, círculos geodésicos, projeção
│   ├── dados.js        # índice de municípios + busca/normalização de nomes
│   ├── modos.js        # motores dos 4 modos de jogo
│   ├── recordes.js     # recordes no localStorage
│   ├── densidade.js    # cálculo e desenho do mapa de densidade
│   └── app.js          # interface, mapa SVG, zoom/pan
├── data/               # dados embutidos (gerados)
└── tools/build_data.py # regenera os dados a partir das fontes
```

## Publicação

O site é servido pelo GitHub Pages a partir da branch `gh-pages`. Para publicar
uma atualização, envie o conteúdo da `main` para lá:

```bash
git push origin main:gh-pages
```
