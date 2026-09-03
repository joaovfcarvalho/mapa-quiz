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
  // nunca durante a partida. Os slots são os IDs dos blocos criados no painel
  // do AdSense (vazio = bloco automático).
  adsense: {
    cliente: "ca-pub-3843329468867244",
    slots: { resultado: "", modos: "" },
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

  // Placar geral (ranking público por configuração, sem login): URL e chave
  // pública (anon/publishable) de um projeto Supabase com o esquema de
  // tools/placar.sql aplicado. Vazio = o bloco "Placar geral" não aparece e
  // nada sai do navegador.
  placar: {
    url: "",   // ex.: "https://abcdefghijkl.supabase.co"
    chave: "", // ex.: "sb_publishable_..." ou a anon key (eyJ...)
  },

  // e-mail de contato exibido na política de privacidade
  contatoEmail: "",
};
