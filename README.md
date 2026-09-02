# 🗺️ Mapa Quiz

**Jogue online:** https://mapaquiz.com.br

Jogo de quiz geográfico no estilo dos quizzes de mapa do HugeQuiz, cobrindo os
5.571 municípios do Brasil. Roda 100% offline no navegador — basta abrir o
`index.html` (duplo clique) — e guarda seus recordes pessoais por configuração
no `localStorage` do navegador.

## Desafio do dia

Todo dia o jogo sorteia **um município secreto, o mesmo para todo mundo**
(entre os de 100 mil+ habitantes), e você o procura como no "Onde estou?":
cada palpite responde com a distância e a direção. Uma jogada por dia; o
resultado vira uma linha de emojis para compartilhar (🟩 até 50 km, 🟨 até
200, 🟧 até 500, 🟥 até 1.000, ⬛ além disso, 💡 por dica, 🎯 no acerto), e
dias seguidos vencidos formam a sequência 🔥. O sorteio é determinístico
(semente = número do dia desde 1º/9/2026), então não depende de servidor.

## Modos de jogo

**1. Círculos por distância** — chute cidades; cada palpite cobre todos os
municípios num raio fixo (configurável, ex.: 100 km). Cubra o máximo do país
(por população, por número de cidades, por área em km² ou por PIB em R$)
antes de acabarem os palpites — ou o tempo. Por padrão vale a regra dura: uma cidade que já caiu dentro de um
círculo não pode mais ser usada como palpite (desligável na configuração).

**2. Círculos por população** — cada cidade chutada vira o centro de um círculo
que cresce até somar a população alvo (ex.: 1 milhão de habitantes) — ou, se
preferir, até somar o PIB alvo (ex.: R$ 50 bilhões). Cidades
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
cidades (100 por padrão), de preferência contra o relógio — com o ranking por
população ou por PIB, à sua escolha. Cada acerto acende
a cidade no mapa com a posição no ranking, e um placar por porte mostra
quantas você já achou em cada faixa de população (ex.: 3/10 entre 500 mil e
1 milhão) — ou de PIB, no ranking por PIB (ex.: 5/9 entre R$ 50 e 100 bi).

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
salvos no navegador: pause e continue quando quiser. O placar acompanha também
a população e o PIB já citados, e a lista lateral traz contadores por porte (1 mi+,
500 mil–1 mi, …) e por UF — cada UF mostra quantas das 10 maiores cidades
você já citou (★), e clicar na linha revela a posição da maior que ainda
falta ("a 3ª do estado"), sem entregar o nome. O último município acertado fica
destacado em rosa no mapa — ponto pulsante com o nome ao lado (e o território,
com ⬡ Formas ligado) — até o próximo acerto, para você ver na hora onde fica
o que acabou de digitar.

**8. Caminho por divisas** — saia de um município e chegue a outro (Chuí →
Oiapoque, por padrão) citando sempre um município que faz **divisa** com o
último citado: uma viagem de carro geográfica, digitada de memória. O jogo
desenha a corrente no mapa e pontua contra o caminho mínimo real (calculado
por busca em largura no grafo de divisas): fez em 5 saltos o que dava em 4,
vale 80%. Ao final (ou na desistência), um traçado pontilhado revela um
caminho ótimo.

**9. Cerco** — o jogo mostra um município (escolhido ou sorteado por porte) e
você nomeia **todos** os que fazem divisa com ele — inclusive os de outra UF.
O mapa já abre com o zoom na vizinhança. Trivial para o Rio de Janeiro (6
vizinhos), brutal para Uberlândia (7) ou São Paulo (21).

**10. Mancha** — comece por qualquer município; depois só vale citar quem faz
divisa com a sua mancha. O território contíguo vai crescendo pelo mapa (com o
botão ⬡ Formas ligado é um espetáculo) e o placar conta municípios e
população anexados. Jogue livre ou contra o relógio.

**11. Ponte** — o jogo sorteia dois municípios e você constrói uma corrente
de divisas que os conecte. Cada palpite precisa encostar no que já está
marcado, então dá para crescer dos dois lados até as pontas se encontrarem.
Cooperativo por natureza, ótimo para começar — e pontua contra a ligação
mínima possível.

**12. Modo estudo** — o atlas para aprender antes de competir: sem pontuação
e sem relógio, o mapa da região abre todo revelado. Busque qualquer município
(ou clique nele no mapa) e veja a ficha completa — população, PIB, área,
posição nos rankings do Brasil e da UF, PIB per capita, densidade e com quem
faz divisa (os vizinhos são links para a ficha deles). A lista lateral traz o
ranking da região ordenável por população, PIB ou área, e o placar mostra os
totais da região. Funciona com o Brasil inteiro ou com uma UF só.

**Região do jogo** — qualquer modo pode ser jogado com o Brasil inteiro ou só
com uma UF (o mapa aproxima o estado e municípios de fora somem). Raio de
30 km em Minas é outro jogo. No Cerco a região vale só para o sorteio do
alvo: os vizinhos contam mesmo quando ficam do outro lado da divisa estadual.

**Dicas** — nos modos de alvos nomeados (faixas, Top N, Onde estou?,
maratona, e os quatro modos de divisas), o botão 💡 dá pistas do maior alvo
que falta (primeira letra, população, onde). Nos modos com recorde cada dica
tem custo: −1 acerto no resultado (faixas/Top N/Cerco/Mancha), +1 palpite no
placar (Onde estou?) ou +1 salto/município (Caminho/Ponte); na maratona é de
graça. No Caminho e na Ponte a dica aponta o próximo passo de um caminho
mínimo.

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

## Tutorial

Na primeira visita um tutorial guiado (holofote sobre cada parte da tela)
apresenta o Desafio do dia, os modos, os três botões do mapa (🛰️ Satélite,
● Pontos, ⬡ Formas), o zoom, a digitação e os recordes. Ele volta pelo botão
❔ Como jogar, no topo.
## Quiz dos rios do Brasil

A página `rios.html` (botão 🌊 Rios no topo) é um segundo quiz, agora de
hidrografia: digite o nome de um rio (`rio amazonas`, `sao francisco`,
`paraibadosul` — as mesmas regras frouxas de digitação do quiz principal) e o
traçado inteiro dele acende no mapa, da nascente à foz. O placar conta os
quilômetros de rio acesos; a espessura de cada traço acompanha a extensão, e
os rios ainda não descobertos aparecem como um relevo esmaecido no papel
(desligável no botão 🌊 Traços) — dá para caçar um meandro intrigante e tentar
adivinhar quem ele é.

Dois conjuntos: **grandes rios** (nível 1 da hidrografia da ANA, 79 alvos) ou
**todos com afluentes** (níveis 1 + 2, 412 alvos e ~116 mil km). Rios
homônimos acendem juntos e contam uma vez — há cinco Rio Verde e seis Rio
Branco. Nomes com alternativa oficial ("Rio São Manuel ou Teles Pires")
valem pelas duas. Jogue livre ou **contra o relógio** (minutos à escolha):
o tempo esgotado encerra a partida sozinho. Dica 💡 aponta o maior que falta;
encerrar revela os esquecidos em pontilhado vermelho e registra o recorde no
navegador — cada combinação de conjunto e duração tem o seu, como nos outros
modos.

## Seus pontos cegos

A página `estatisticas.html` (botão 📊 Pontos cegos no topo) guarda, só no
seu navegador, cada município que você já citou em qualquer partida — e
desenha o mapa do que falta: as regiões que nunca aparecem nos seus palpites,
as maiores cidades que você nunca citou e a cobertura por UF. Cada cidade
conta no máximo uma vez por partida, então a cor mostra em quantas partidas
diferentes ela apareceu.

## Mapa de densidade de municípios

Fora do jogo (sem link na navegação), a página `densidade.html` mostra um
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
- Passe o mouse sobre uma cidade já revelada/coberta para ver nome, população,
  área e PIB. Com o botão ⬡ Formas ligado, o território inteiro do município
  responde ao mouse — não é preciso acertar o pontinho da sede.

## Recordes e backup

Cada combinação exata de modo + parâmetros tem seu próprio recorde (maior %;
em caso de empate, menor tempo), salvo no navegador. O botão 🏆 Recordes lista
todos, com opção de apagar individualmente ou tudo — e de exportar/importar um
**backup completo** em JSON: recordes, progresso da maratona, municípios já
citados (pontos cegos) e histórico do Desafio do dia. A importação só mescla
(melhor recorde de cada configuração, união dos municípios da maratona, maior
contador dos pontos cegos, união dos dias), nunca apaga nada. É o jeito de
levar o progresso de um navegador ou aparelho para outro. Backups antigos
(só recordes) continuam válidos.

O botão 📣 no fim de cada partida compartilha o resultado (menu nativo no
celular; copia o texto no desktop) com o link de desafio da mesma
configuração. No Desafio do dia o link é `mapaquiz.com.br/#diario`, que
abre direto o desafio da data em que for aberto, sem passar pela tela
inicial.

## Dados

| Dado | Fonte |
|---|---|
| População por município | IBGE, Censo Demográfico 2022 (agregado 4709, variável 93) |
| Área territorial por município | IBGE, Censo Demográfico 2022 (agregado 4714, variável 6318) |
| PIB por município (a preços correntes) | IBGE, PIB dos Municípios 2023 (agregado 5938, variável 37) |
| Coordenadas (sede municipal) | [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) |
| Contorno das UFs | IBGE, API de malhas (qualidade máxima) |
| Forma dos municípios (botão ⬡) | IBGE, API de malhas (qualidade mínima) |
| Grafo de divisas (modos Caminho/Cerco/Mancha/Ponte) | derivado da malha municipal pelo `build_data.py` |
| Fundo de satélite (botão 🛰️) | NASA Blue Marble Next Generation, 500 m/pixel (domínio público) |
| Traçado e nome dos rios (quiz dos rios) | ANA/SNIRH, base hidrográfica ottocodificada, camadas "Hidrografia nível 1 e 2" |

O grafo de "quem faz divisa com quem" não vem de nenhuma fonte extra: como os
polígonos do IBGE encaixam exatamente ao longo das fronteiras, o
`build_data.py` considera vizinhos dois municípios que compartilham 2 ou mais
vértices da malha (um só seria apenas um toque de canto). O resultado —
15.958 divisas entre 5.568 municípios, grau médio 5,7, máximo 21 (São Paulo)
— fica em `data/vizinhos.js` (~320 KB).

Os dados ficam embutidos em `data/municipios.js`, `data/brasil_uf.js`,
`data/malha_municipios.js` e `data/vizinhos.js` para o jogo funcionar offline
(inclusive aberto via `file://`) — a malha só é carregada se o botão ⬡
Formas for ligado, e o grafo de divisas só ao entrar num dos modos que o
usam. Para regenerar a partir das fontes:

```bash
cd tools
python3 build_data.py          # baixa tudo da internet
python3 build_satelite.py      # recorta o fundo de satélite dos tiles da NASA
python3 build_rios.py          # baixa a hidrografia da ANA e gera data/rios.js
```

No `build_rios.py`, os trechos da ANA chegam já generalizados pelo servidor
(`maxAllowableOffset`) para a escala do mapa, são emendados por curso d'água
(o mesmo curso ottocodificado troca de nome ao longo do caminho:
Guaporé→Mamoré→Madeira é um código só) e recortados ao contorno das UFs com
uma folga de ~10 km, para não picotar os rios que correm exatamente sobre a
fronteira (Paraguai, Uruguai, Javari…). Rios estrangeiros que só encostam na
fronteira (Beni, Marañon) ficam de fora. O resultado, `data/rios.js`
(~770 KB, 229 KB gzipado), só é carregado pela página do quiz de rios.

Observações: as distâncias usam o centroide (sede) de cada município, não o
polígono; no objetivo "cobrir área", município coberto conta o território
inteiro (a sede caiu no círculo → a área toda soma); Boa Esperança do Norte
(MT), criado em 2023, consta com população, área e PIB 0 por não existir no
Censo 2022 nem no PIB dos Municípios — e, por não existir na malha municipal do IBGE, é o único município
sem forma no botão ⬡ (fica só o ponto) e fora do grafo de divisas. Ilhabela
(SP) e Fernando de Noronha (PE) são ilhas: não fazem divisa com ninguém, e
por isso não servem de origem/destino/semente nos modos de divisas — todos
os outros 5.568 municípios formam um único bloco conexo.

## Estrutura

```
mapa-quiz/
├── index.html          # página única do jogo
├── privacidade.html    # política de privacidade (LGPD, Analytics, AdSense)
├── rios.html           # quiz dos rios do Brasil
├── estatisticas.html   # mapa dos seus pontos cegos
├── densidade.html      # mapa de densidade de municípios (fora da navegação)
├── CNAME, robots.txt, sitemap.xml, manifest.webmanifest
├── css/style.css
├── fonts/              # Sora (OFL), hospedada localmente
├── img/                # ícone, silhueta do Brasil e imagem de compartilhamento
├── js/
│   ├── config.js       # IDs de serviços (GA4, AdSense, Pix) — o único a editar
│   ├── site.js         # aviso de privacidade, analytics, anúncios, apoio, compartilhar
│   ├── geo.js          # haversine, rumo, círculos geodésicos, projeção
│   ├── dados.js        # índice de municípios + busca/normalização de nomes
│   ├── modos.js        # motores dos 11 modos de jogo + grafo de divisas
│   ├── recordes.js     # recordes no localStorage
│   ├── rios.js         # quiz dos rios: busca, placar e mapa próprio
│   ├── densidade.js    # cálculo e desenho do mapa de densidade
│   ├── estatisticas.js # mapa e listas dos pontos cegos
│   ├── tutorial.js     # tutorial guiado
│   └── app.js          # interface, mapa SVG, zoom/pan, Desafio do dia, backup
├── data/               # dados embutidos (gerados)
└── tools/              # build_data.py, build_satelite.py, build_rios.py, build_marca.py, og.html
```

## Publicação e domínio

O site é servido pelo GitHub Pages a partir da branch `gh-pages`, no domínio
**mapaquiz.com.br** (arquivo `CNAME` na raiz). Para publicar uma atualização,
envie o conteúdo da `main` para lá:

```bash
git push origin main:gh-pages
```

DNS no registro.br (uma vez só), na zona de `mapaquiz.com.br`:

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `joaovfcarvalho.github.io.` |

Depois, em *Settings → Pages* do repositório, confirme o domínio
`mapaquiz.com.br` e marque *Enforce HTTPS* (o certificado sai sozinho após a
verificação do DNS, que pode levar até um dia).

## Serviços externos (analytics, anúncios, apoio)

Tudo fica desligado até preencher `js/config.js` — sem os IDs o jogo não
carrega nada de terceiros e nem mostra o aviso de privacidade:

- **`ga4`** — ID do Google Analytics 4 (`G-…`). Só é carregado após o
  jogador aceitar o aviso; envia eventos como `partida_iniciada`,
  `partida_encerrada`, `diario_jogado`, `compartilhou`, `tutorial_abriu`,
  `apoio_abriu`.
- **`adsense.cliente`** — ID do editor (`ca-pub-…`) e, opcionalmente, os
  `slots` dos blocos. Os anúncios aparecem só na tela de resultado e no fim da
  lista de modos, nunca durante a partida, e só após o consentimento. Para o
  AdSense aprovar o site é preciso também um `ads.txt` na raiz com a linha
  `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0` (o ID sem o
  prefixo `ca-`) — o painel do AdSense mostra a linha exata.
- **`pix`** — chave, nome e cidade do recebedor. Liga o botão ☕ Apoiar, que
  copia a chave ou o código "Pix copia e cola" (BR Code gerado no navegador,
  com CRC). `apoioLinks` acrescenta links (apoia.se, Ko-fi…).
- **`contatoEmail`** — aparece na política de privacidade.

A imagem de compartilhamento (`img/og.png`, 1200×630) e os ícones são
renderizados de `tools/og.html` e `img/icone.svg`; a silhueta do Brasil e o
ícone vêm de `tools/build_marca.py`.
