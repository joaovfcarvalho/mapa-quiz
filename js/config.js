"use strict";
// Configuração do site (IDs de serviços externos). Tudo aqui é opcional:
// campo vazio = recurso desligado. Este é o único arquivo que precisa ser
// editado para ligar analytics, anúncios e o apoio via Pix.
window.MAPAQUIZ_CONFIG = {
  // endereço público do jogo (usado nos links de compartilhamento)
  dominio: "https://mapaquiz.com.br",

  // Google Analytics 4 — ID de métrica, ex.: "G-XXXXXXXXXX".
  // Só carrega depois que o jogador aceita o aviso de privacidade.
  ga4: "G-JX91GS2KVY",

  // Google AdSense — ID do editor, ex.: "ca-pub-1234567890123456".
  // Os anúncios aparecem só na tela de resultado e no fim da lista de modos,
  // nunca durante a partida. Os slots são os IDs numéricos dos blocos criados
  // no painel do AdSense (Anúncios → Por bloco de anúncios → Anúncio display,
  // um bloco para cada espaço; o ID é o número em data-ad-slot do código
  // gerado). Sem o slot o AdSense não serve o bloco — o espaço fica oculto.
  adsense: {
    cliente: "ca-pub-3843329468867244",
    slots: { resultado: "9096642809", modos: "7783561130" },
  },

  // Apoio via Pix: chave, nome e cidade do recebedor (os três são exigidos
  // pelo padrão "Pix copia e cola" do Banco Central). Vazio = botão some.
  pix: {
    chave: "",
    nome: "",
    cidade: "",
  },
  // links extras de apoio, ex.: [{ rotulo: "apoia.se", url: "https://apoia.se/..." }]
  apoioLinks: [],

  // e-mail de contato exibido na política de privacidade
  contatoEmail: "",
};
