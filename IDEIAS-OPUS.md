# Avaliação do repositório e ideias — sessão Opus

> Documento gerado a partir de uma sessão de análise do repositório `mapa-quiz`.
> Nada aqui foi implementado — é um levantamento de problemas encontrados e de
> propostas, para servir de base de decisão.
>
> Todos os números citados foram medidos diretamente nos arquivos do repositório
> (ver "Apêndice: medições" no fim).

---

## Sumário

- [Parte 1 — Avaliação técnica](#parte-1--avaliação-técnica)
- [Parte 2 — O jogo em si: o que fazer a seguir](#parte-2--o-jogo-em-si-o-que-fazer-a-seguir)
- [Apêndice: medições](#apêndice-medições)

---

## Impressão geral

O projeto é bem construído. Os motores em `js/modos.js` estão limpamente
separados da renderização, os comentários explicam o *porquê* em vez do *o quê*,
e detalhes difíceis estão tratados corretamente:

- o desvio do clique causado pelo letterbox do `preserveAspectRatio`
  (`medidaMapa()` / `pontoDoMapa()`);
- círculos geodésicos desenhados como polígonos, para continuarem corretos em
  qualquer projeção;
- carregamento preguiçoso da malha de 2,4 MB só quando o botão ⬡ é ligado;
- o padrão IIFE + variáveis globais, que preserva a propriedade de abrir por
  `file://` com duplo clique.

Os pontos abaixo são sobre as lacunas, não sobre os alicerces.

---

# Parte 1 — Avaliação técnica

## 1. Mobile é o maior buraco

Não existe um único `touchstart`, `pointerdown` ou `touch-action` no código.
Zoom/pan é só `mousedown`/`mousemove`/`wheel`, e **o modo "Onde fica?" é
completamente injogável no celular** — a resposta dele vem de
`svg.addEventListener("mouseup")` (`js/app.js:1727`), que nunca dispara de forma
utilizável num toque.

O que fazer:

- Trocar os handlers de mouse em `js/app.js:1717-1745` por **Pointer Events**
  (`pointerdown`/`pointermove`/`pointerup` + `setPointerCapture`). Um único
  caminho de código passa a cobrir mouse, toque e caneta, e a matemática de
  `pontoDoMapa()` continua valendo sem mudança.
- Adicionar pinça de dois dedos para zoom. `zoomEm(fator, fx, fy)` já existe —
  a pinça só precisa alimentá-la com uma razão e um ponto médio.
- Adicionar `touch-action: none` no `#mapa`.
- O tooltip de hover não tem equivalente no toque — precisa de "tocar para
  inspecionar".
- Layout: em telas ≤860px o painel ocupa 55vh e o mapa 45vh
  (`css/style.css:499`). Com o teclado virtual aberto para digitar uma cidade, o
  mapa some na prática. Um painel recolhível (ou uma alavanca de "mapa em tela
  cheia") resolve.

É a mudança com maior alcance de público — um link compartilhado no WhatsApp cai
num celular.

## 2. Metadados de compartilhamento (mudança minúscula, alavancagem alta)

O `index.html` **não tem favicon, não tem `<meta name="description">` e não tem
nenhuma tag Open Graph** (verificado: zero ocorrências). O botão 🔗 Desafiar
existe exatamente para as pessoas colarem links no WhatsApp/Twitter — e esses
links hoje aparecem como uma URL crua.

Um título OG, uma descrição e uma imagem de preview 1200×630 fariam o laço
social principal do jogo finalmente parecer alguma coisa.

## 3. O link de desafio não reproduz o desafio

Nos modos "Onde estou?" e "Onde fica?", `JogoOndeEstou`/`JogoClique` sorteiam com
`Math.random()` (`js/modos.js:445` e `js/modos.js:492`), enquanto a chave do
desafio é só `ondestou|pool=100000` — ou seja, a *configuração*, não a partida.

Consequência: **duas pessoas que abrem o mesmo link recebem municípios secretos
diferentes**, e a "marca a bater" em porcentagem está comparando rodadas que não
têm relação nenhuma entre si.

Correção: colocar uma semente na chave (`|seed=...`) e um PRNG com semente em
`modos.js`. Isso torna os desafios desses dois modos genuinamente comparáveis.

E destrava de graça o **desafio diário**: semear a partir da data, todo mundo
recebe a mesma rodada, resultado compartilhável em grade de emoji. É o laço do
Wordle, e a máquina de desafio existente já é 80% dele.

## 4. O contorno das UFs tem ~40× mais precisão do que um pixel

`data/brasil_uf.js` tem **98 anéis / 51.970 pontos / 876 KB crus (234 KB
gzipados)**, com precisão de 3 casas decimais (~110 m), vindo do
`qualidade=maxima` do IBGE. O mapa tem 1000 px de largura cobrindo ~40° de
longitude — 1 px ≈ 4,4 km. Ou seja: está sendo carregado ~40× mais vértice do que
jamais poderá ser desenhado.

Rodar Douglas–Peucker com tolerância de ~0,01° no `tools/build_data.py` cortaria
isso em algo entre 5× e 10× **sem diferença visível**, encolhendo o primeiro
carregamento e acelerando tanto os 98 paths SVG quanto a máscara de canvas do
`densidade.js`, que rasteriza exatamente esses mesmos polígonos.

O mesmo argumento vale, de forma mais branda, para a malha municipal.

**Relacionado:** `data/satelite.jpg` são **8 MB commitados no git**. Cada
regeneração acrescenta outro blob permanente de 8 MB ao histórico, para sempre.
Vale gerar na hora do deploy, ou pelo menos reduzir a resolução — a imagem só é
exibida na escala do mapa.

## 5. Uma correção barata de renderização

`aplicarViewBox()` roda a **cada `mousemove` de arrasto** e faz
incondicionalmente `svg.style.setProperty("--zoom", ...)`. Arrastar não muda o
zoom, então ele está escrevendo o mesmo valor — mas cada escrita invalida o
estilo dos 5.570 `<circle>`, cujo `r` é `calc(1.2px * var(--zoom))`
(`css/style.css:363`).

Correções:

- Proteger com uma verificação de "só escreve se a string mudou".
- Envolver o pan em `requestAnimationFrame` em vez de atualizar a cada evento
  de `mousemove`.

Diff pequeno, ganho perceptível na suavidade do arrasto.

Também: com o ⬡ Formas ligado e uma partida grande, milhares de `<path>` são
criados; a médio prazo vale considerar uma camada de canvas para a malha.

## 6. Nenhum teste, nenhum CI

Não existe `.github/` nenhum, e há bastante lógica pura, sem DOM, que valeria
proteger:

- `GEO.haversineKm` / `rumo` / `destino`;
- a normalização de `DADOS.buscar` (os casos `"riodejaneiro"`, `"bom jesus rs"`);
- todas as funções de pontuação: `pct()`, o −4% por palpite do "Onde estou?", a
  queda de 15 km → 500 km do "Onde fica?", o particionamento das faixas.

Uma dúzia de casos com `node:test` (zero dependências) mais uma GitHub Action
cobre tudo isso.

**Adicionar também um teste de sanidade dos dados.** Rodei as verificações e elas
passam hoje:

- 5.571 municípios;
- ids únicos;
- **ordenados por população decrescente** — coisa da qual `modos.js` depende
  silenciosamente para todo cálculo de "as N maiores de cada faixa";
- exatamente um registro com área e população zero (o documentado Boa Esperança
  do Norte).

As quatro são invariantes que sustentam o jogo e que uma regeneração de dados
poderia quebrar em silêncio. Nada hoje as verifica.

**Vale notar:** *uma mudança de pontuação invalida silenciosamente os recordes
existentes* — a chave codifica a configuração, mas não a versão das regras.
Guardar uma `versaoRegras` por recorde permitiria sinalizar os antigos em vez de
comparar coisas incomparáveis.

## 7. UX de digitação

São 5.571 nomes digitados no escuro, com um "Não encontrei nenhum município com
esse nome" seco em qualquer erro. Duas adições:

- **Sugestão de quase-acerto**: no `nao_encontrado`, uma passada de
  Levenshtein ≤1 sobre as ~5,5 mil chaves normalizadas é rápida o bastante para
  rodar inline, resultando em "Você quis dizer *Florianópolis*?". Isso resgata os
  becos sem saída de acento e grafia, que hoje são simplesmente uma parede.
- **Autocomplete** é mais delicado — em Top N e Maratona ele trivializaria o
  jogo. Eu faria disso uma opção explícita por partida (desligada por padrão nos
  modos com recorde), em vez de um comportamento global.

## 8. Acessibilidade

Todo o estado do jogo vive num SVG rotulado apenas como
`role="img" aria-label="Mapa do Brasil"`. Mas os modos textuais — Top N, Faixas,
Maratona — são perfeitamente jogáveis sem enxergar o mapa.

- A vitória mais barata e mais relevante: `aria-live="polite"` em `#feedback` e
  `#placar-linhas`, para que o resultado de cada palpite seja anunciado.
- O modal de recordes não prende o foco nem fecha com Escape.
- Os chips de achado/faltante se distinguem **só pela cor** verde/vermelho —
  acrescentar ✓/✗ resolve para quem tem daltonismo.
- O `#dica-zoom` diz "roda do mouse" e não menciona teclado nem toque.

## 9. Tornar a promessa de offline real (PWA)

A manchete do README é "roda 100% offline", mas a versão hospedada não é
instalável e rebaixa tudo de novo a cada visita. Um `manifest.json` mais um
service worker cache-first são talvez 60 linhas, e transformam isso num app
offline de verdade no celular — perfeitamente alinhado com a filosofia que o
projeto já tem.

## 10. O backup cobre só um terço dos dados

São três chaves de localStorage, com nomes inconsistentes entre si
(`mapaquiz_recordes_v1` com underscore, `mapaquiz.citadas.v1` e
`mapaquiz.maratona.v1` com ponto), e o exportar/importar cobre **apenas os
recordes**.

O progresso da maratona — potencialmente centenas de horas, e a coisa que o
usuário mais lamentaria perder — e o tally de pontos cegos **não podem ser
salvos de jeito nenhum**. Um "backup completo" cobrindo as três chaves resolve.

## 11. Estrutura, se a ideia for acrescentar um oitavo modo

`js/app.js` tem 1.906 linhas cuidando de: renderização do mapa, interface dos
sete modos, modal de recordes, links de desafio, zoom/pan e toda a fiação de DOM.
Os motores estão bem separados; a interface não está. Duas coisas concretas:

- As cinco funções `palpitar*` repetem quase literalmente os mesmos quatro ramos
  de erro (`nao_encontrado` / `fora_regiao` / `repetido` / `nao_alvo`) — cerca de
  80 linhas duplicadas que um único helper `tratarErroPalpite(r)` colapsaria.
- `JogoFaixas` escreve `m._distCentro` nos objetos compartilhados de
  `DADOS.municipios` (`js/modos.js:280`) — um motor de jogo mutando dado global.
  Inofensivo hoje, porque é recalculado a cada partida, mas é exatamente o tipo
  de armadilha de estado compartilhado que morde depois. Um `Map` local é mais
  limpo.

Eu **manteria** o padrão de IIFE + globais em vez de migrar para módulos ES:
`type="module"` quebra o carregamento por `file://`, o que mataria a propriedade
de abrir com duplo clique. Vale uma frase no README deixando claro que a escolha
é deliberada, para não parecer descuido.

## 12. Outros pontos menores levantados

- `RECORDES.registrar` lê e reescreve o blob inteiro a cada fim de partida.
  Irrelevante no tamanho atual, mas bom saber.
- `registrarCitadas` conta como "citado" também o município que o jogador
  digitou **errado** (nos ramos `nao_alvo`), o que infla levemente o mapa de
  pontos cegos. O README diz "cada município que você já citou", então
  provavelmente é intencional — vale deixar explícito na própria página.
- A regra CSS `.municipio.fora { display: none }` é efetivamente código morto:
  `sincronizarForma` só sincroniza polígonos de pontos marcados, e
  `limparCamadasDeJogo` reseta as formas para `"municipio"`.
- `aplicarRegiao` só é chamada dentro de `iniciar()`. Trocar a UF no seletor sem
  começar partida deixa pontos escondidos da partida anterior — cosmético.
- `aplicarDesafioDaURL` roda também no `hashchange`; se houver partida em
  andamento, ela é abandonada em silêncio.

## Ordem sugerida (parte técnica)

1. **Pointer events** + **tags OG** — maior alcance pelo menor código.
2. **Desafios com semente / diário** — a feature com mais potencial de retorno.
3. **Simplificação da malha** + **a proteção do `--zoom`** — passada rápida de
   performance.

---

# Parte 2 — O jogo em si: o que fazer a seguir

## Primeiro, o que eu **não** faria

### Mais países

Esse é o instinto a resistir. "Países do mundo" é a categoria mais saturada que
existe em quiz de mapa — Seterra, HugeQuiz, JetPunk, Worldle já dominam, e você
entraria como o 500º concorrente. Enquanto isso, **ninguém** faz um jogo sério de
municípios brasileiros. Seus 5.571 municípios com população, área, coordenadas e
polígonos são um ativo genuinamente raro.

Cada país acrescentado custa: um novo pipeline de dados, um novo modelo de
geografia administrativa (departamentos? comunas? counties?), novas regras de
normalização de nome (seu `normalizar()` é afinado para o português) — e dilui a
única coisa que torna este projeto distinto. Ir para os lados trocaria um nicho
defensável por uma commodity indefensável.

### Google Maps

Esse eu rejeitaria com mais força ainda. Ele quebra as quatro propriedades que
fazem o projeto ser bom: roda offline, abre de `file://` com duplo clique, tem
zero dependências, e não precisa de chave de API nem de conta de cobrança.

O Google Maps custa as quatro em troca de… imagens de satélite que você já tem do
NASA Blue Marble, e Street View — que é o jogo do GeoGuessr, numa escala que não
dá para financiar. **O mapa SVG desenhado à mão *é* a estética.** Não vale trocar
isso pelos tiles de outra pessoa.

## O problema real: não existe rampa de entrada

Foi o que mais chamou atenção lendo os sete modos. Cada um deles, sem exceção, é
**evocação a partir de uma página em branco**. Digite o nome de uma cidade.
Digite outra. Até o modo "mais fácil" pede que você produza nomes do nada. A
Maratona pede 5.571 deles.

Isso faz deste um jogo excelente *para quem já sabe geografia brasileira*. Para
quem não sabe, não existe o primeiro degrau da escada: a pessoa digita três
cidades, seca, e vai embora.

Isso, mais do que qualquer feature faltando, é o que limita o público.

Daí as três apostas, nesta ordem:

---

## Aposta 1 — Modos de reconhecimento (a rampa de entrada)

Reconhecimento é muito mais fácil que evocação — e é assim que a pessoa de fato
*aprende* os nomes que mais tarde vai conseguir evocar. Três modos baratos, todos
usando dados que já são carregados:

### Maior ou menor?

Duas cartas de cidade, toque na mais populosa. Infinito, instantâneo, perfeito no
celular (dois alvos grandes de toque, sem teclado), e um formato já provado.

É a maior razão de engajamento por linha de código desta lista inteira — talvez
150 linhas em cima do array `MUNICIPIOS` que já existe.

### Ordene

Cinco cidades, arraste para ordenar de norte a sul, ou por população, ou por
área. Testa raciocínio espacial em vez de vocabulário.

### Que forma é essa?

Você já distribui 5.570 polígonos municipais e hoje os usa apenas como uma
sobreposição decorativa. Mostre **uma forma sozinha**, sem rótulo, sem contexto —
de que estado ela é? Qual destas quatro é ela?

"Adivinhe a forma" é um formato muito querido, e o dado já está em
`malha_municipios.js` sem fazer quase nada.

**Bônus:** esses três modos consertam o problema de mobile de graça — são
baseados em toque, então funcionam no celular sem precisar resolver pan/zoom
antes.

---

## Aposta 2 — O grafo de adjacência (o fosso criativo)

Essa foi a que eu verifiquei empiricamente. Sua malha municipal é
**topologicamente consistente**: 95,3% dos vértices são compartilhados por dois ou
mais municípios, ou seja, os polígonos do IBGE encaixam exatamente ao longo das
fronteiras comuns.

Logo, dá para **derivar o grafo completo de "quem faz divisa com quem" offline**,
dentro do `build_data.py`, sem nenhuma fonte de dados nova:

```
15.958 arestas · 5.568 nós · grau médio 5,7 · grau máximo 21
377 KB crus → 91 KB gzipados
```

(O grau médio de 5,7 fica logo abaixo do teto teórico de 6 para uma subdivisão
planar, o que é um bom sinal de que o grafo está limpo. São Paulo capital sai com
21 vizinhos, o que bate com a realidade.)

Esses 91 KB destravam uma família de modos que **nenhum concorrente consegue
copiar sem fazer o mesmo trabalho**:

### Caminho

Vá do Chuí (RS) ao Oiapoque (AP) nomeando apenas municípios que fazem divisa com
o último citado. Uma viagem de carro geográfica, digitada de memória.

Dá para pontuar contra o caminho mínimo real (BFS no grafo) e dizer ao jogador:
"você fez em 94 saltos; o mínimo é 71."

### Cerco

Nomeie todos os municípios que fazem divisa com um dado município. Trivial para o
Rio, brutal para algum lugar no interior de Minas.

### Mancha

Nomeie qualquer município; depois, apenas municípios adjacentes ao que você já
nomeou. Veja seu território crescer pelo mapa.

Isso é lindo de assistir preenchendo, e é uma mecânica genuinamente nova.

### Ponte

Dois municípios; ache qualquer cadeia que os conecte. Tem cara de cooperativo,
baixa pressão, ótimo para iniciantes.

**Caminho** e **Mancha** em particular são o tipo de coisa que as pessoas gravam
e postam. São espetaculares visualmente num mapa que se preenche progressivamente
— que é justamente o que o seu renderizador já faz bem.

---

## Aposta 3 — Transformar o `citadas` num modelo de conhecimento

Você já registra, por jogador, cada município que ele já nomeou e em quantas
partidas (`mapaquiz.citadas.v1`). Hoje isso alimenta um único mapa estático de
pontos cegos. **É o ativo mais subaproveitado do repositório.**

Acrescente "quais ele errou ou não conseguiu produzir", e você tem um modelo, por
jogador, do que aquela pessoa sabe. Então:

**Um treino diário de 10 municípios**, escolhidos por repetição espaçada,
mirando exatamente as suas regiões fracas. Acertou um, ele volta em 4 dias;
errou, volta amanhã.

Essa é a diferença entre um jogo que as pessoas jogam duas vezes e uma ferramenta
que as pessoas abrem toda manhã. Também transforma o mapa de pontos cegos de
curiosidade em barra de progresso que visivelmente enche ao longo de meses.

Ninguém no espaço de quiz de mapa faz dificuldade adaptativa direito.

---

## "Mais conteúdo" sem mais países: vá mais fundo no Brasil

Se a coceira for por *mais conteúdo*, a resposta é vertical, não horizontal — e
cada item abaixo reaproveita o motor inteiro:

### Novas camadas geográficas, mesmo país

Mesorregiões e microrregiões (a um código do IBGE de distância), biomas, bacias
hidrográficas, os ~5.000 distritos, bairros de São Paulo e do Rio, rodovias
federais, aeroportos por código ICAO, terras indígenas.

### Novos atributos sobre os mesmos municípios

A mesma API de agregados do IBGE que o `build_data.py` já consulta também serve
PIB municipal e outros indicadores.

"Qual tem maior PIB per capita?" é um jogo *absurdamente* contraintuitivo no
Brasil — cidadezinhas de royalties de petróleo e de mineração ganham de capitais
— e essa surpresa é exatamente a graça.

### Tempo

Datas de criação dos municípios. "Qual já existia em 1950?" Ou animar o mapa de
1872 a 2022 enquanto os municípios se multiplicam de ~600 para 5.571 — é uma
coisa linda de assistir, e é dado puro do IBGE.

### E se quiser que outros países existam sem você mantê-los

Refatore o formato de dados num contrato documentado e deixe as pessoas forkarem.
Os 308 concelhos de Portugal, os departamentos da Argentina, os municípios do
México. Você mantém o motor; cada um mantém a sua geografia.

---

## Recomendação final

**Se eu tivesse um fim de semana:** *Maior ou menor?* — é pequeno, é nativo de
celular, e é o primeiro degrau que está faltando.

**Se eu tivesse um mês:** o grafo de adjacência e a *Mancha*. É a coisa mais
original desta lista inteira, é totalmente offline, custa 91 KB, e é a única
ideia aqui que ninguém consegue lançar sem antes fazer a mesma lição de casa.

---

# Apêndice: medições

Todos os valores abaixo foram medidos diretamente nos arquivos deste repositório
durante a análise.

## Dados dos municípios (`data/municipios.js`)

| Métrica | Valor |
|---|---|
| Municípios | 5.571 |
| IDs únicos | 5.571 (sem duplicata) |
| Ordenados por população decrescente | sim |
| Com área zero | 1 (Boa Esperança do Norte, documentado) |
| Com população zero | 1 (o mesmo) |

## Tamanho dos arquivos

| Arquivo | Cru | Gzipado |
|---|---|---|
| `data/municipios.js` | 340 KB | 140 KB |
| `data/brasil_uf.js` | 876 KB | 234 KB |
| `data/malha_municipios.js` | 2,4 MB | 622 KB |
| `data/satelite.jpg` | 8,0 MB | — |
| `js/app.js` | 80 KB | 21 KB |

## Contorno das UFs (`data/brasil_uf.js`)

| Métrica | Valor |
|---|---|
| Anéis | 98 |
| Pontos totais | 51.970 |
| Precisão | 3 casas decimais (~110 m) |
| Largura do mapa | 1000 px sobre ~40° de longitude → 1 px ≈ 4,4 km |

## Malha municipal (`data/malha_municipios.js`)

| Métrica | Valor |
|---|---|
| Municípios na malha | 5.570 |
| Pontos totais | 133.937 |
| Vértices únicos | 63.098 |
| Vértices compartilhados por 2+ municípios | 60.117 (**95,3%**) |

## Grafo de adjacência derivado da malha

Critério: dois municípios são vizinhos quando compartilham **2 ou mais** vértices
(um vértice só seria apenas um toque de canto).

| Métrica | Valor |
|---|---|
| Arestas | 15.958 |
| Nós | 5.568 |
| Grau médio | 5,7 (teto teórico planar: 6) |
| Grau máximo | 21 |
| Vizinhos de São Paulo capital | 21 |
| Tamanho como JSON | 377 KB |
| Tamanho gzipado | **91 KB** |

## Ausências verificadas

| Verificação | Resultado |
|---|---|
| Handlers de toque (`touch*`, `pointer*`) | nenhum |
| Diretório `.github/` (CI) | não existe |
| Favicon / `meta description` / tags OG no `index.html` | nenhum |
| Atributos `aria-` | 1 em `index.html`, 0 em `densidade.html`, 0 em `estatisticas.html` |
