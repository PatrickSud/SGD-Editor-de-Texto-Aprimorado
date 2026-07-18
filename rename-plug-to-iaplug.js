const fs = require('fs')
const path = require('path')

// ================= CONFIGURAÇÃO =================
// Segunda rodada de rename: PLUG -> IAplug (nome definitivo informado por Patrick).
// Mesmo padrão do rename-iagente-to-plug.js, com duas diferenças:
//
// 1) "PLUG" (maiúsculo) tem dois destinos possíveis, decididos pelo contexto:
//    - Se está colado a "_" (convenção SCREAMING_SNAKE_CASE de constante, ex.:
//      PLUG_URL, PLUG_BOUNDS_KEY, TOGGLE_USER_PLUG) -> vira "IAPLUG".
//    - Caso contrário (texto visível, nomes de função/variável em camelCase,
//      ex.: hasPLUGAccess, "🤖 PLUG") -> vira "IAplug" (a grafia exata do nome
//      pedida por Patrick).
// 2) "plug" (minúsculo) vira "iaplug" — mas antes disso protegemos as palavras
//    que contêm "plug" por coincidência e NADA têm a ver com o recurso:
//    o domínio "plugsocial" (tria.plugsocial.online) e a palavra "plugin"
//    (comentário sobre o Sugestor SS). Sem essa proteção, o domínio seria
//    corrompido para "iaplugsocial.online" e quebraria a extensão.
const TERMOS_FALSOS_POSITIVOS = ['plugsocial', 'plugin']

// Termos ligados ao Firebase RTDB que continuam fora do rename (decisão já
// tomada na rodada anterior — ver rename-iagente-to-plug.js). Não contêm
// "plug" então não seriam tocados mesmo sem isso, mas ficam documentados aqui.
const TERMOS_FIREBASE_PROTEGIDOS = [
  'iagenteDisabled',
  'iagenteIA_Enabled',
  'iagente_url_sul',
  'iagente_url_sudeste',
  'iagente_enabled_unidades',
  'iagente_unidade_regiao',
  'iagente_disabled_unidades'
]

const IGNORAR = [
  'node_modules',
  '.git',
  '.DS_Store',
  '.vscode',
  '.cursor',
  'rename-plug-to-iaplug.js',
  'rename-iagente-to-plug.js',
  'rename-project.js'
]

const EXTENSOES_PERMITIDAS = ['.js', '.json', '.css', '.md', '.html', '.txt']

// Arquivo a renomear (mantém o padrão do prefixo interno __plug_persist__ ->
// __iaplug_persist__, feito pela regra 'plug' -> 'iaplug' abaixo)
const RENOMEAR_ARQUIVOS = [
  ['plug-bridge.js', 'iaplug-bridge.js']
]

const DRY_RUN = process.argv.includes('--dry-run')
// ================================================

function substituirTermoPLUG(conteudo) {
  // "PLUG" -> "IAPLUG" (colado a "_") ou "IAplug" (caso contrário)
  return conteudo.replace(/PLUG/g, (match, offset, str) => {
    const anterior = str[offset - 1] || ''
    const posterior = str[offset + match.length] || ''
    const contextoDeConstante = anterior === '_' || posterior === '_'
    return contextoDeConstante ? 'IAPLUG' : 'IAplug'
  })
}

function substituirNoArquivo(caminhoArquivo) {
  try {
    let conteudo = fs.readFileSync(caminhoArquivo, 'utf8')
    const original = conteudo

    // 1) Mascara os falsos positivos ("plugsocial", "plugin") com placeholders
    const mapaProtegidos = {}
    TERMOS_FALSOS_POSITIVOS.forEach((termo, idx) => {
      if (conteudo.includes(termo)) {
        const placeholder = `@@FALSOPOSITIVO_${idx}@@`
        conteudo = conteudo.split(termo).join(placeholder)
        mapaProtegidos[placeholder] = termo
      }
    })

    // 2) "PLUG" -> "IAPLUG"/"IAplug" (sensível ao contexto, ver função acima)
    conteudo = substituirTermoPLUG(conteudo)

    // 2.1) IMPORTANTE: "IAplug"/"IAPLUG" (resultado do passo 2) contêm "plug"
    //      em minúsculo dentro de si (ex.: "IAplug" = IA + "plug"). Se o passo 3
    //      rodasse agora, reprocessaria esse "plug" e geraria "IAiaplug"
    //      (bug encontrado e corrigido nesta versão). Por isso mascaramos os
    //      resultados do passo 2 antes de seguir, com placeholders que não
    //      contêm "plug"/"PLUG"/"IAPLUG" dentro de si mesmos (senão colidiriam
    //      um com o outro do mesmo jeito).
    // (placeholders sem "plug"/"PLUG"/"IAPLUG" dentro de si, para não colidirem
    // entre si nem serem re-processados por engano)
    conteudo = conteudo.split('IAplug').join('ZZMISTOZZ')
    conteudo = conteudo.split('IAPLUG').join('ZZMAIUSCULOZZ')

    // 3) "plug" -> "iaplug" (agora seguro, pois os falsos positivos E os
    //    resultados do passo 2 estão mascarados)
    if (conteudo.includes('plug')) {
      conteudo = conteudo.split('plug').join('iaplug')
    }

    // 3.1) Restaura os resultados do passo 2
    conteudo = conteudo.split('ZZMISTOZZ').join('IAplug')
    conteudo = conteudo.split('ZZMAIUSCULOZZ').join('IAPLUG')

    // 4) Restaura os falsos positivos
    Object.entries(mapaProtegidos).forEach(([placeholder, termo]) => {
      conteudo = conteudo.split(placeholder).join(termo)
    })

    if (conteudo !== original) {
      if (DRY_RUN) {
        console.log(`🔍 [DRY RUN] Seria atualizado: ${caminhoArquivo}`)
      } else {
        fs.writeFileSync(caminhoArquivo, conteudo, 'utf8')
        console.log(`✅ Atualizado: ${caminhoArquivo}`)
      }
    }
  } catch (erro) {
    console.error(`❌ Erro ao processar o arquivo ${caminhoArquivo}:`, erro.message)
  }
}

function percorrerDiretorio(diretorioAtual) {
  const itens = fs.readdirSync(diretorioAtual)

  itens.forEach(item => {
    const caminhoCompleto = path.join(diretorioAtual, item)
    const estatisticas = fs.statSync(caminhoCompleto)

    if (IGNORAR.includes(item)) return

    if (estatisticas.isDirectory()) {
      percorrerDiretorio(caminhoCompleto)
    } else if (estatisticas.isFile()) {
      const ext = path.extname(item).toLowerCase()
      if (EXTENSOES_PERMITIDAS.includes(ext)) {
        substituirNoArquivo(caminhoCompleto)
      }
    }
  })
}

function renomearArquivos() {
  RENOMEAR_ARQUIVOS.forEach(([nomeAntigo, nomeNovo]) => {
    const caminhoAntigo = path.join(__dirname, nomeAntigo)
    const caminhoNovo = path.join(__dirname, nomeNovo)
    if (fs.existsSync(caminhoAntigo)) {
      if (DRY_RUN) {
        console.log(`🔍 [DRY RUN] Renomearia arquivo: ${nomeAntigo} -> ${nomeNovo}`)
      } else {
        fs.renameSync(caminhoAntigo, caminhoNovo)
        console.log(`✅ Arquivo renomeado: ${nomeAntigo} -> ${nomeNovo}`)
      }
    }
  })
}

if (DRY_RUN) {
  console.log('🔍 MODO SIMULAÇÃO (DRY RUN) ATIVO. Nenhum arquivo será modificado.')
}
console.log('🚀 Iniciando a verificação/substituição de "PLUG" por "IAplug"...')
percorrerDiretorio(__dirname)
renomearArquivos()
console.log('🏁 Processo concluído com sucesso!')
