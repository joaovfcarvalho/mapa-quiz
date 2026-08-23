# 🗺️ Quiz do Mapa do Brasil

**Jogue online:** https://joaovfcarvalho.github.io/mapa-quiz/

Jogo de quiz geográfico no estilo dos quizzes de mapa do HugeQuiz, cobrindo os
5.571 municípios do Brasil. Roda 100% offline no navegador — basta abrir o
`index.html` (duplo clique) — e guarda seus recordes pessoais por configuração
no `localStorage` do navegador.

## Modos de jogo

**1. Círculos por distância** — chute cidades; cada palpite cobre todos os
municípios num raio fixo (configurável, ex.: 100 km). Cubra o máximo do país
(por população, por número de cidades ou por área em km²) antes de acabarem os palpites — ou o
tempo. Por padrão vale a regra dura: uma cidade que já caiu dentro de um
círculo não pode mais ser usada como palpite (desligável na configuração).

**2. Círculos por população** — cada cidade chutada vira o centro de um círculo
que cresce até somar a população alvo (ex.: 1 milhão de habitantes). Cidades
grandes geram círculos pequenos; cidades vazias geram círculos enormes.
Estratégia: onde ancorar os círculos para cobrir o máximo do Brasil? Aqui a
ordem importa ainda mais: com a regra padrão, cidade coberta não vale mais
como palpite — gaste as grandes antes que um círculo vizinho as engula.

**3. Faixas do mapa** — o mapa é dividido em faixas de latitude, longitude,
anéis concêntricos em volta de uma cidade à sua escolha ou uma grade de
quadrados (latitude × longitude). Em cada faixa/célula é preciso nomear as N
maiores cidades; a cor da faixa vai se intensificando conforme você acerta,
até o tom cheio quando ela está 100% respondida. Tudo configurável: largura
em km, quantidade de cidades por faixa e o centro dos anéis.

**4. Top N cidades** — o modo raiz do HugeQuiz: cite de memória as N maiores
cidades (100 por padrão), de preferência contra o relógio. Cada acerto acende
a cidade no mapa com a posição no ranking, e um placar por porte mostra
quantas você já achou em cada faixa de população (ex.: 3/10 entre 500 mil e
1 milhão).

**5. Onde estou?** — o jogo sorteia um município secreto (com o porte mínimo
que você escolher) e cada palpite responde com a distância e a direção até
ele; a cor dos pontos esquenta do azul ao vermelho conforme você se aproxima.
Encontre-o no menor número de palpites: acertar de primeira vale 100%, e cada
palpite (ou dica) extra desconta 4 pontos.

**6. Onde fica? (clique)** — o inverso: o jogo mostra o nome de um município
e você clica no mapa onde acha que ele fica. Até 15 km de erro vale 100% da
rodada; a pontuação cai linearmente até zerar em 500 km. Durante a partida os
pontos dos municípios somem do mapa — só o contorno das UFs fica de guia.

**7. Maratona completa** — cite **todos** os municípios da região (os 5.571
do Brasil, se tiver coragem), no seu ritmo. O progresso e o relógio ficam
salvos no navegador: pause e continue quando quiser, acompanhando contadores
por UF (ou por porte, jogando uma UF só).

**Região do jogo** — qualquer modo pode ser jogado com o Brasil inteiro ou só
com uma UF (o mapa aproxima o estado e municípios de fora somem). Raio de
30 km em Minas é outro jogo.

**Dicas** — nos modos de alvos nomeados (faixas, Top N, Onde estou?,
maratona), o botão 💡 dá pistas do maior alvo que falta (primeira letra,
população, onde). Nos modos com recorde cada dica tem custo: −1 acerto no
resultado (faixas/Top N) ou +1 palpite no placar (Onde estou?); na maratona
é de graça.

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

## Seus pontos cegos

A página `estatisticas.html` (botão 📊 Pontos cegos no topo) guarda, só no
seu navegador, cada município que você já citou em qualquer partida — e
desenha o mapa do que falta: as regiões que nunca aparecem nos seus palpites,
as maiores cidades que você nunca citou e a cobertura por UF. Cada cidade
conta no máximo uma vez por partida, então a cor mostra em quantas partidas
diferentes ela apareceu.

## Mapa de densidade de municípios

Além do quiz, a página `densidade.html` (botão 📍 Densidade no topo) mostra um
mapa de calor do Brasil: cada ponto do território é colorido pela quantidade
de municípios (sedes municipais) existentes num raio de X km dele — raio
ajustável de 20 a 500 km. Passe o mouse para ler o valor em qualquer ponto e
clique para fixar um círculo e listar os municípios dentro dele. O painel
mostra ainda o pico de densidade do país para o raio escolhido (com 100 km, o
recorde fica no oeste catarinense, na fronteira dos minifúndios de SC e RS).

## Como jogar

- Digite o nome da cidade e aperte Enter. Acentos, maiúsculas, hífens e até
  espaços são ignorados (`sao jose dos campos` e `riodejaneiro` funcionam).
- Se houver mais de um município com o mesmo nome, especifique a UF:
  `Bom Jesus, RS` (ou `bom jesus rs`).
- Zoom pelos botões +/− no canto do mapa ou pela roda do mouse; arrastar
  move, duplo clique (ou ⌂) restaura.
- Os pontos descobertos são coloridos pela população do município — do
  amarelo (cidade pequena) ao vinho (São Paulo); a legenda fica no canto do
  mapa.
- O botão ● Pontos escolhe se os municípios ainda não descobertos aparecem
  esmaecidos (padrão) ou ficam ocultos até você acertá-los.
- O botão ⬡ Formas pinta também o território dos municípios marcados, não só
  o ponto da sede — acertou Rio de Janeiro, acende o polígono inteiro do
  município. A malha dos 5.570 municípios (~2,4 MB) só é carregada na
  primeira vez que o botão é ligado; quem não usa não paga nada.
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
| Área territorial por município | IBGE, Censo Demográfico 2022 (agregado 4714, variável 6318) |
| Coordenadas (sede municipal) | [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) |
| Contorno das UFs | IBGE, API de malhas (qualidade máxima) |
| Forma dos municípios (botão ⬡) | IBGE, API de malhas (qualidade mínima) |
| Fundo de satélite (botão 🛰️) | NASA Blue Marble Next Generation, 500 m/pixel (domínio público) |

Os dados ficam embutidos em `data/municipios.js`, `data/brasil_uf.js` e
`data/malha_municipios.js` para o jogo funcionar offline (inclusive aberto
via `file://`) — o último só é carregado se o botão ⬡ Formas for ligado.
Para regenerar a partir das fontes:

```bash
cd tools
python3 build_data.py          # baixa tudo da internet
python3 build_satelite.py      # recorta o fundo de satélite dos tiles da NASA
```

Observações: as distâncias usam o centroide (sede) de cada município, não o
polígono; no objetivo "cobrir área", município coberto conta o território
inteiro (a sede caiu no círculo → a área toda soma); Boa Esperança do Norte
(MT), criado em 2023, consta com população e área 0 por não existir no Censo
2022 — e, por não existir na malha municipal do IBGE, é o único município
sem forma no botão ⬡ (fica só o ponto).

## Estrutura

```
mapa-quiz/
├── index.html          # página única do jogo
├── densidade.html      # mapa de densidade de municípios
├── estatisticas.html   # mapa dos seus pontos cegos
├── css/style.css
├── js/
│   ├── geo.js          # haversine, rumo, círculos geodésicos, projeção
│   ├── dados.js        # índice de municípios + busca/normalização de nomes
│   ├── modos.js        # motores dos 7 modos de jogo
│   ├── recordes.js     # recordes no localStorage
│   ├── densidade.js    # cálculo e desenho do mapa de densidade
│   ├── estatisticas.js # mapa e listas dos pontos cegos
│   └── app.js          # interface, mapa SVG, zoom/pan
├── data/               # dados embutidos (gerados)
└── tools/              # build_data.py e build_satelite.py (regeram os dados)
```

## Publicação

O site é servido pelo GitHub Pages a partir da branch `gh-pages`. Para publicar
uma atualização, envie o conteúdo da `main` para lá:

```bash
git push origin main:gh-pages
```
