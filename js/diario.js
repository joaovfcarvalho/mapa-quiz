"use strict";
// Desafio do dia: as contas puras do calendário e do sorteio, sem DOM (a
// interface fica em js/app.js). O dia vira à meia-noite de Brasília para
// todo mundo — não no relógio do aparelho —, e o conjunto de onde sai o
// secreto é fixo: atualizar os dados (um município passar de 100 mil hab.)
// não pode mudar o secreto de hoje nem o dos dias que já passaram.
var DIARIO = (function () {
  var EPOCA = Date.UTC(2026, 8, 1); // desafio #1 = 1º de setembro de 2026
  var FUSO_MS = 3 * 3600e3;         // Brasília: UTC−3 o ano inteiro (sem horário de verão desde 2019)
  var DIA_MS = 86400000;

  // Códigos IBGE dos municípios com 100 mil+ hab. no Censo 2022, em ordem
  // crescente — congelados: é desta lista, nesta ordem, que sai o secreto.
  var POOL_IDS = [
    1100122, 1100205, 1200401, 1301902, 1302504, 1302603, 1400100, 1500107, 1500602, 1500800,
    1501303, 1501402, 1501709, 1501808, 1502103, 1502400, 1503606, 1504208, 1504422, 1505502,
    1505536, 1506807, 1600303, 1600600, 1702109, 1721000, 2100055, 2101202, 2101400, 2103000,
    2103307, 2105302, 2107506, 2111201, 2111300, 2112209, 2207702, 2211001, 2303709, 2304202,
    2304400, 2306405, 2307304, 2307650, 2307700, 2312908, 2403251, 2408003, 2408102, 2412005,
    2504009, 2507507, 2510808, 2513703, 2602902, 2603454, 2604106, 2606002, 2606804, 2607901,
    2609600, 2610707, 2611101, 2611606, 2613701, 2616407, 2700300, 2704302, 2800308, 2802908,
    2803500, 2804805, 2900702, 2903201, 2905701, 2910727, 2910800, 2913606, 2914802, 2918001,
    2918407, 2919207, 2919553, 2924009, 2925303, 2927408, 2928703, 2930709, 2931350, 2933307,
    3103504, 3104007, 3105608, 3106200, 3106705, 3118304, 3118601, 3119401, 3122306, 3127701,
    3129806, 3131307, 3131703, 3134202, 3136702, 3138203, 3143302, 3143906, 3144805, 3145208,
    3147907, 3148004, 3151800, 3152501, 3154606, 3156700, 3157807, 3167202, 3168606, 3169901,
    3170107, 3170206, 3170701, 3171204, 3201209, 3201308, 3201506, 3202405, 3203205, 3204906,
    3205002, 3205200, 3205309, 3300100, 3300209, 3300407, 3300456, 3300704, 3301009, 3301702,
    3301900, 3302007, 3302205, 3302403, 3302502, 3302700, 3302858, 3303203, 3303302, 3303401,
    3303500, 3303906, 3304144, 3304201, 3304524, 3304557, 3304904, 3305109, 3305208, 3305802,
    3306305, 3501608, 3502804, 3503208, 3503307, 3504008, 3504107, 3505500, 3505708, 3506003,
    3506508, 3507506, 3507605, 3509502, 3510500, 3510609, 3511102, 3513009, 3513504, 3513801,
    3515004, 3515707, 3516200, 3516309, 3516408, 3518404, 3518701, 3518800, 3519071, 3520509,
    3522109, 3522208, 3522307, 3522505, 3523107, 3523404, 3523909, 3524402, 3525003, 3525300,
    3525904, 3526902, 3529005, 3529401, 3530607, 3530706, 3534401, 3534708, 3536505, 3538006,
    3538709, 3539806, 3541000, 3541406, 3543303, 3543402, 3543907, 3545209, 3545803, 3547304,
    3547809, 3548500, 3548708, 3548807, 3548906, 3549805, 3549904, 3550308, 3551009, 3551702,
    3552205, 3552403, 3552502, 3552809, 3554003, 3554102, 3556206, 3556503, 3557006, 4100400,
    4101408, 4101507, 4101804, 4103701, 4104204, 4104808, 4105805, 4106902, 4107652, 4108304,
    4109401, 4113700, 4115200, 4118204, 4119152, 4119509, 4119905, 4125506, 4126256, 4127700,
    4128104, 4202008, 4202404, 4202909, 4203204, 4204202, 4204608, 4205407, 4208203, 4208906,
    4209102, 4209300, 4211900, 4216602, 4218707, 4300604, 4301602, 4302105, 4303103, 4304606,
    4305108, 4307005, 4309209, 4313409, 4314100, 4314407, 4314902, 4315602, 4316808, 4316907,
    4318705, 4320008, 4322400, 4323002, 5002704, 5003702, 5008305, 5103403, 5107602, 5107909,
    5107925, 5107958, 5108402, 5200258, 5201108, 5201405, 5205109, 5208004, 5208707, 5211503,
    5211909, 5212501, 5215231, 5217609, 5218805, 5220454, 5221403, 5221858, 5300108,
  ];

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // "Agora" em Brasília: uma Date deslocada cujos getters UTC dão a data e
  // a hora de Brasília (ms = instante real; padrão: agora)
  function agoraBrasilia(ms) {
    return new Date((ms === undefined ? Date.now() : ms) - FUSO_MS);
  }
  // "2026-09-01" (d vem de agoraBrasilia)
  function chaveDia(d) {
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  // número do desafio do dia de d (o #1 é o da EPOCA)
  function numeroDia(d) {
    var meio = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return Math.floor((meio - EPOCA) / DIA_MS) + 1;
  }
  // o dia anterior ao de d (d vem de agoraBrasilia; não é alterada)
  function diaAnterior(d) {
    return new Date(d.getTime() - DIA_MS);
  }
  // "2026-09-01" -> "01/09"
  function ddmm(chave) {
    var p = String(chave).split("-");
    return p[2] + "/" + p[1];
  }
  // segundos que faltam até a meia-noite de Brasília
  function segundosAteAmanha(ms) {
    var d = agoraBrasilia(ms);
    var amanha = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return Math.max(0, Math.floor((amanha - d.getTime()) / 1000));
  }
  // código IBGE do secreto do desafio #n; rngSemente é o gerador com semente
  // de js/modos.js (mulberry32) — a mesma sequência de sempre
  function idSecreto(n, rngSemente) {
    var r = rngSemente(n);
    return POOL_IDS[Math.floor(r() * POOL_IDS.length)];
  }

  return {
    EPOCA: EPOCA,
    POOL_IDS: POOL_IDS,
    pad2: pad2,
    agoraBrasilia: agoraBrasilia,
    chaveDia: chaveDia,
    numeroDia: numeroDia,
    diaAnterior: diaAnterior,
    ddmm: ddmm,
    segundosAteAmanha: segundosAteAmanha,
    idSecreto: idSecreto,
  };
})();
