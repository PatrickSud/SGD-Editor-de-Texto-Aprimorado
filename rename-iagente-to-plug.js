const fs = require('fs')
const path = require('path')

// ================= CONFIGURAÇÃO =================
// Renomeia todas as ocorrências de "IAgente" (nas 3 variações de caixa usadas no
// código) para "PLUG", preservando as chaves do Firebase Realtime Database que
// não devem mudar (config remota e flags por usuário já persistidas em produção).
//
// Ordem de substituição (da mais específica para a mais genérica), sempre
// case-sensitive, para não bagunçar outras palavras do texto:
//   'IAGENTE'  -> 'PLUG'   (constantes, ex.: IAGENTE_WINDOW_STATE)
//   'IAgente'  -> 'PLUG'   (texto visível, nomes de função, ex.: hasIAgenteAccess)
//   'iagente'  -> 'plug'   (variáveis/CSS/IDs em camelCase ou kebab-case)
const SUBSTITUICOES = [
  ['IAGENTE', 'PLUG'],
  ['IAgente', 'PLUG'],
  ['iagente', 'plug']
]

// Termos que contêm "iagente" mas são chaves lidas/gravadas no Firebase RTDB
// (config remota em `${RTDB_BASE_URL}/config.json` e flags por usuário). Renomear
// esses tokens no código sem atualizar o Firebase quebraria a feature em produção,
// então ficam de fora da substituição.
const TERMOS_PROTEGIDOS = [
  'iagenteDisabled',
  'iagenteIA_Enabled',
  'iagente_url_sul',
  'iagente_url_sudeste',
  'iagente_enabled_unidades',
  'iagente_unidade_regiao',
  'iagente_disabled_unidades'
]

// Pastas e arquivos que devem ser ignorados
const IGNORAR = [
  'node_modules',
  '.git',
  '.DS_Store',
  '.vscode',
  '.cursor',
  'rename-iagente-to-plug.js', // Ignora o próprio script
  'rename-project.js'
]

// Extensões de arquivos de texto permitidas (para evitar corromper binários)
const EXTENSOES_PERMITIDAS = ['.js', '.json', '.css', '.md', '.html', '.txt']

// Arquivo a renomear depois de atualizar o conteúdo (mantém o mesmo padrão do
// prefixo interno __iagente_persist__ -> __plug_persist__, feito pela regra 'iagente'->'plug' acima)
const RENOMEAR_ARQUIVOS = [
  ['iagente-bridge.js', 'plug-bridge.js']
]

// Se true, apenas lista os arquivos que seriam modificados, sem alterar nada no disco
const DRY_RUN = process.argv.includes('--dry-run')
// ================================================

function substituirNoArquivo(caminhoArquivo) {
  try {
    let conteudo = fs.readFileSync(caminhoArquivo, 'utf8')
    const original = conteudo

    // 1) Mascara os termos protegidos com placeholders únicos para que não sejam
    //    tocados pelas substituições genéricas abaixo.
    const mapaProtegidos = {}
    TERMOS_PROTEGIDOS.forEach((termo, idx) => {
      if (conteudo.includes(termo)) {
        const placeholder = `@@PROTEGIDO_${idx}@@`
        conteudo = conteudo.split(termo).join(placeholder)
        mapaProtegidos[placeholder] = termo
      }
    })

    // 2) Aplica as substituições IAgente -> PLUG (case-sensitive, na ordem definida)
    SUBSTITUICOES.forEach(([termoAntigo, termoNovo]) => {
      if (conteudo.includes(termoAntigo)) {
        conteudo = conteudo.split(termoAntigo).join(termoNovo)
      }
    })

    // 3) Restaura os termos protegidos
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

    if (IGNORAR.includes(item)) {
      return
    }

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
console.log('🚀 Iniciando a verificação/substituição de "IAgente" por "PLUG"...')
percorrerDiretorio(__dirname)
renomearArquivos()
console.log('🏁 Processo concluído com sucesso!')
