// sugestor-ss.js
// Injetado APENAS na página ssc.html pelo manifest do SGD Editor.
//
// DIFERENÇA em relação ao content.js original do Sugestor SS:
//   - criarBotao() foi REMOVIDO — o botão agora fica na toolbar do SGD Editor (main.js)
//   - iniciarSugestao() foi exposta como window.iniciarSugestao para que o main.js
//     consiga chamá-la ao clicar no botão da toolbar (ambos rodam na mesma página)
//   - criarOverlayLoading() ainda é chamada na inicialização — o overlay de loading
//     precisa existir no DOM para o fluxo funcionar

// ─────────────────────────────────────────
// 1. EXTRAÇÃO DO CONTEÚDO DA SSC
// ─────────────────────────────────────────

function getText(selector) {
  const el = document.querySelector(selector);
  return el ? el.textContent.trim() : 'N/A';
}
function getInnerHtml(selector) {
  const el = document.querySelector(selector);
  return el ? el.innerHTML : '';
}
function extractDate(text) {
  if (!text) return 'N/A';
  const match = text.match(/\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}/);
  return match ? match[0] : text.trim();
}
function htmlToText(html) {
  if (!html) return '';
  let text = html;
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/?b>|<\/?strong>/gi, '**');
  text = text.replace(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<[^>]+>/g, '');
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value.trim();
}

function extrairCabecalho() {
  const clienteLink = document.querySelector('#td\\:cliente a');
  const clienteNome = clienteLink ? clienteLink.textContent.trim() : 'N/A';
  const clienteUrl = clienteLink ? clienteLink.href : '';
  const clienteId = clienteUrl ? new URLSearchParams(clienteUrl.split('?')[1]).get('clienteID') : 'N/A';
  const temBackupNuvem = !!document.querySelector('#acao option[value="21"]');
  return {
    numero: getText('#td\\:numero'),
    dataEntrada: extractDate(getText('#td\\:entrada')),
    unidade: getText('#td\\:revenda_nome'),
    sistema: getText('#td\\:sistema_nome a'),
    modulo: getText('#td\\:modulo_nome a'),
    topico: getText('#sscForm\\:topico option:checked'),
    subtopico: getText('#td\\:subtopico a'),
    cliente: `${clienteId} - ${clienteNome}`,
    assunto: getText('#td\\:assunto'),
    classificacao: getText('#sscForm\\:classificacao option:checked'),
    descricao: htmlToText(getInnerHtml('#td\\:descricao > div')),
    backupNuvem: temBackupNuvem
  };
}

function extrairTramites() {
  const tabelas = document.querySelectorAll('table[id^="id_tramite_"]');
  if (!tabelas.length) return [];
  return Array.from(tabelas).map(tabela => {
    const cells = Array.from(tabela.querySelectorAll('td'));
    const getValorAposLabel = (label) => {
      const labelCell = cells.find(td => td.textContent.trim().startsWith(label));
      return labelCell?.nextElementSibling?.textContent.trim() || 'N/A';
    };
    const descCell = cells.find(td => td.textContent.trim() === 'Descrição:');
    const descHtml = descCell?.nextElementSibling?.innerHTML || '';
    const situacao = tabela.querySelector('img[title]')?.title || 'N/A';
    return {
      numero: getValorAposLabel('Número:'),
      data: extractDate(getValorAposLabel('Entrada:')),
      situacao,
      responsavel: getValorAposLabel('Usuário:'),
      descricao: htmlToText(descHtml)
    };
  });
}

// ─────────────────────────────────────────
// 2. ANEXOS DO CHAT (sscpre*.txt)
// ─────────────────────────────────────────

async function extrairAnexosChat() {
  const links = document.querySelectorAll('#td\\:anexo a');
  if (!links.length) return [];

  const anexosChatLinks = Array.from(links).filter(a => {
    const nome = a.textContent.trim();
    return nome.startsWith('sscpre') && nome.endsWith('.txt');
  });

  if (!anexosChatLinks.length) return [];

  const conteudos = await Promise.all(
    anexosChatLinks.map(async (a) => {
      try {
        const resp = await fetch(a.href);
        if (!resp.ok) return null;
        return await resp.text();
      } catch {
        return null;
      }
    })
  );

  return conteudos.filter(c => c !== null);
}

// ─────────────────────────────────────────
// 3. MONTAGEM DO PROMPT
// ─────────────────────────────────────────

function montarPrompt(cabecalho, tramites, anexosChat = []) {
  let contexto = `# SSC ${cabecalho.numero}\n`;
  contexto += `**Data Entrada**: ${cabecalho.dataEntrada}\n`;
  contexto += `**Unidade**: ${cabecalho.unidade}\n`;
  contexto += `**Sistema**: ${cabecalho.sistema}\n`;
  contexto += `**Módulo**: ${cabecalho.modulo}\n`;
  contexto += `**Tópico**: ${cabecalho.topico}\n`;
  contexto += `**Subtópico**: ${cabecalho.subtopico}\n`;
  contexto += `**Cliente**: ${cabecalho.cliente}\n`;
  contexto += `**Backup em Nuvem**: ${cabecalho.backupNuvem ? 'Sim' : 'Não'}\n`;
  contexto += `**Assunto**: ${cabecalho.assunto}\n`;
  contexto += `**Classificação**: ${cabecalho.classificacao}\n\n`;
  contexto += `## Descrição Original\n${cabecalho.descricao}\n\n`;

  if (tramites.length > 0) {
    contexto += `## Trâmites\n\n`;
    tramites.forEach(t => {
      contexto += `### Trâmite ${t.numero} (${t.data})\n`;
      contexto += `**Responsável**: ${t.responsavel}\n`;
      contexto += `**Situação**: ${t.situacao}\n`;
      if (t.descricao) contexto += `**Descrição**:\n${t.descricao}\n`;
      contexto += `\n`;
    });
  }

  if (anexosChat.length > 0) {
    contexto += `## Logs do Atendimento Chat\n\n`;
    anexosChat.forEach((conteudo, i) => {
      if (anexosChat.length > 1) contexto += `### Arquivo ${i + 1}\n`;
      contexto += conteudo + '\n\n';
    });
  }

  return `Crie um modelo de sugestão de cadastro de SS com base nas informações enviadas abaixo.

Retorne SOMENTE o texto com as seções abaixo, usando exatamente estes títulos e nesta ordem. Não adicione nenhum texto fora das seções.

SUGESTOES_VERIFICACAO:
[Liste aqui os testes e verificações que o N1 deve realizar ANTES de confirmar a abertura da SS. Enumere todos os testes. Se já foram todos realizados, escreva "N/A".]

Assunto: [título objetivo descrevendo o problema, resumindo o máximo que puder. Seja breve.]

Descreva de forma detalhada a situação/problema que deseja tratar:
[descrição completa da situação/problema relatado. Divida em parágrafos, cada parágrafo pode ter no máximo 2 linhas. Ao fazer a divisão por parágrafos, a leitura fica melhor.]

Detalhe todas as consultas, testes e análises realizadas:
[tudo que foi feito pelo N1. Testes que foram indicados em SUGESTOES_VERIFICACAO que ainda precisam ser realizados devem aparecer entre colchetes. Faça a quebra de linha de cada um dos itens, informando um hífen no começo de cada texto de teste realizado.]

Passos para reproduzir a situação:
[passos para reproduzir, ou "N/A - situação ocorre apenas no ambiente do cliente" se não for reproduzível]

Qual a sua dúvida neste suporte:
[dúvida objetiva a ser respondida pelo N2]

Informações do Banco de Dados:
[número de série, caminhos FTP, ou outras informações do banco. Se não houver, escreva "N/A". Informar a senha gerente e demais senhas conforme disponibilizado nos atendimentos, sem indicar em qual trâmite está. Se o campo "Backup em Nuvem" for "Sim", inclua obrigatoriamente a informação "Cliente possui Backup em Nuvem", caso possuir backup em nuvem, não indicar para informar o caminho do ftp. Apenas se não tiver backup em nuvem, assim, solicitar para informar o caminho do ftp.]

ANEXOS_NECESSARIOS:
[Liste cada arquivo que o N1 deve anexar na SS para que o N2 consiga analisar, um por linha com hífen. Se não houver nenhum anexo necessário, escreva apenas "N/A".]

Informações da SSC:

${contexto}`;
}

// ─────────────────────────────────────────
// 4. INTERFACE — LOADING COM BARRA + TEMPO ESTIMADO + CANCELAR
// ─────────────────────────────────────────

let _wsAbortFlag = false;
let _progressInterval = null;
let _timerInterval = null;
let _startTime = null;

const TEMPO_ESTIMADO_S = 20;

function criarOverlayLoading() {
  if (document.getElementById('sugestor-loading-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'sugestor-loading-overlay';
  overlay.innerHTML = `
    <div class="sugestor-loading-box">
      <div class="sugestor-loading-icon">🤖</div>
      <p class="sugestor-loading-title">Gerando sugestão de SS...</p>
      <p id="sugestor-loading-msg">Enviando para a IA...</p>
      <div class="sugestor-progress-wrap">
        <div class="sugestor-progress-bar" id="sugestor-progress-bar"></div>
      </div>
      <p id="sugestor-timer">Tempo estimado: ~${TEMPO_ESTIMADO_S}s</p>
      <button id="btn-cancelar-sugestao">Cancelar</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('btn-cancelar-sugestao').addEventListener('click', cancelarSugestao);
}

function mostrarLoading() {
  _wsAbortFlag = false;
  const overlay = document.getElementById('sugestor-loading-overlay');
  if (overlay) overlay.style.display = 'flex';
  const bar = document.getElementById('sugestor-progress-bar');
  if (bar) bar.style.width = '0%';
  iniciarProgressoETempo();
}

function esconderLoading() {
  const overlay = document.getElementById('sugestor-loading-overlay');
  if (overlay) overlay.style.display = 'none';
  pararAnimacoes();
}

function atualizarMsgLoading(msg) {
  const msgEl = document.getElementById('sugestor-loading-msg');
  if (msgEl) msgEl.textContent = msg;
}

function finalizarProgresso() {
  pararAnimacoes();
  const bar = document.getElementById('sugestor-progress-bar');
  if (bar) bar.style.width = '100%';
  const timer = document.getElementById('sugestor-timer');
  if (timer) timer.textContent = '✅ Pronto!';
}

function cancelarSugestao() {
  _wsAbortFlag = true;
  esconderLoading();
  atualizarMsgLoading('Enviando para a IA...');
  console.log('[Sugestor SS] Cancelado pelo usuário.');
}

function iniciarProgressoETempo() {
  pararAnimacoes();
  _startTime = Date.now();
  const bar = document.getElementById('sugestor-progress-bar');
  const timerEl = document.getElementById('sugestor-timer');

  _progressInterval = setInterval(() => {
    const decorrido = (Date.now() - _startTime) / 1000;
    const restante = Math.max(0, Math.ceil(TEMPO_ESTIMADO_S - decorrido));
    const pct = Math.min((decorrido / TEMPO_ESTIMADO_S) * 90, 90);
    if (bar) bar.style.width = pct + '%';
    if (timerEl) {
      timerEl.textContent = decorrido < TEMPO_ESTIMADO_S
        ? `Tempo estimado: ~${restante}s`
        : 'Processando... quase lá ⏳';
    }
  }, 500);
}

function pararAnimacoes() {
  if (_progressInterval) { clearInterval(_progressInterval); _progressInterval = null; }
  if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
}

// ─────────────────────────────────────────
// 5. FLUXO PRINCIPAL
// ─────────────────────────────────────────

function obterNumeroSSC() {
  const params = new URLSearchParams(window.location.search);
  return params.get('ssc') || '';
}

// Exposta no window para que o SGD Editor (main.js) possa chamá-la
// ao clicar no botão da toolbar. Ambos os scripts rodam na mesma página.
window.iniciarSugestao = async function iniciarSugestao() {
  const cabecalho = extrairCabecalho();
  if (cabecalho.numero === 'N/A') {
    alert('Não foi possível identificar o número da SSC.');
    return;
  }

  mostrarLoading();
  atualizarMsgLoading('Lendo conteúdo da SSC...');

  const tramites = extrairTramites();
  const anexosChat = await extrairAnexosChat();
  const prompt = montarPrompt(cabecalho, tramites, anexosChat);

  atualizarMsgLoading('Enviando para a IA... aguarde ⏳');
  window._sscNumero = new URLSearchParams(window.location.search).get('ssc') || cabecalho.numero;
  chrome.runtime.sendMessage({ action: 'gerarSugestaoSS', markdownSSC: prompt });
};

// ─────────────────────────────────────────
// 6. RECEBIMENTO DE MENSAGENS DO SERVICE WORKER
// ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((request) => {
  switch (request.action) {
    case 'sugestaoCompleta':
      if (_wsAbortFlag) return;
      finalizarProgresso();
      atualizarMsgLoading('Sugestão gerada! Abrindo formulário...');
      setTimeout(() => {
        esconderLoading();

        // Segunda chamada — complemento do campo de consultas
        if (window._aguardandoComplemento) {
          window._aguardandoComplemento = false;
          const textoOriginal = window._textoFormularioOriginal || '';
          window._textoFormularioOriginal = null;

          const novaPesquisa = request.data
            .replace(/Importante:.*?confirme os detalhes importantes\.?/gis, '')
            .trim();

          const tituloRegex = /Detalhe todas as consultas,\s*testes e an[aá]lises realizadas:\s*/im;
          const proximoTituloRegex = /\nPassos para reproduzir|\nQual a sua|\nInforma[çc][oõ]es do Banco/im;

          const tituloMatch = textoOriginal.match(tituloRegex);
          if (!tituloMatch) {
            abrirFormulario(textoOriginal);
            return;
          }

          const inicioTitulo = textoOriginal.search(tituloRegex);
          const inicioCampo = inicioTitulo + tituloMatch[0].length;
          const restante = textoOriginal.slice(inicioCampo);
          const proximoMatch = restante.match(proximoTituloRegex);
          const fimCampo = proximoMatch
            ? inicioCampo + restante.search(proximoTituloRegex)
            : textoOriginal.length;

          const textoAtualizado =
            textoOriginal.slice(0, inicioCampo) +
            novaPesquisa + '\n' +
            textoOriginal.slice(fimCampo);

          abrirFormulario(textoAtualizado);
          return;
        }

        // Primeira chamada — fluxo normal
        abrirFormularioComSugestao(request.data);
      }, 700);
      break;

    case 'sugestaoErro':
      if (_wsAbortFlag) return;
      window._aguardandoComplemento = false;
      window._textoFormularioOriginal = null;
      esconderLoading();
      alert(`Erro ao gerar sugestão:\n\n${request.data}`);
      break;
  }
});

// ─────────────────────────────────────────
// 7. TELA INTERMEDIÁRIA DE SUGESTÕES
// ─────────────────────────────────────────

function extrairSugestoes(textoCompleto) {
  const regex = /^SUGESTOES_VERIFICACAO:[\s\S]*?\n([\s\S]*?)(?=\nAssunto:)/im;
  const match = textoCompleto.match(regex);

  let sugestoes = null;
  let textoSemSugestoes = textoCompleto;

  if (match) {
    const linhasFiltradas = match[1]
      .split('\n')
      .filter(l => /^\s*[-\d]/.test(l))
      .join('\n')
      .trim();

    textoSemSugestoes = textoCompleto
      .replace(/^SUGESTOES_VERIFICACAO:[\s\S]*?(?=\nAssunto:)/im, '')
      .trim();

    if (linhasFiltradas && linhasFiltradas !== 'N/A') {
      sugestoes = linhasFiltradas;
    }
  }

  return { sugestoes, textoSemSugestoes };
}

function mostrarTelaSugestoes(sugestoes, textoFormulario) {
  document.getElementById('sugestor-modal-sugestoes')?.remove();

  const itens = sugestoes
    .split(/[;\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s !== '---' && s !== '\u2013' && s !== '\u2014' && !s.match(/^-+$/));

  const overlay = document.createElement('div');
  overlay.id = 'sugestor-modal-sugestoes';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;';

  const box = document.createElement('div');
  box.style.cssText = 'position:relative;background:#fff;border-radius:12px;padding:32px 36px;max-width:620px;width:92%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.35);';

  const btnFechar = document.createElement('button');
  btnFechar.textContent = '\u00d7';
  btnFechar.style.cssText = 'position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;color:#999;cursor:pointer;line-height:1;padding:0;';
  btnFechar.addEventListener('click', (e) => { e.stopPropagation(); overlay.remove(); });

  const titulo = document.createElement('div');
  titulo.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:6px;';
  const tituloIcone = document.createElement('span');
  tituloIcone.style.fontSize = '26px';
  tituloIcone.textContent = '\u26a0\ufe0f';
  const tituloTexto = document.createElement('h2');
  tituloTexto.style.cssText = 'margin:0;font-size:17px;color:#e65100;';
  tituloTexto.textContent = 'Verifique antes de abrir a SS';
  titulo.appendChild(tituloIcone);
  titulo.appendChild(tituloTexto);

  const sub = document.createElement('p');
  sub.style.cssText = 'margin:0 0 16px;font-size:13px;color:#555;';
  sub.textContent = 'Marque todos os testes indicando se foram realizados e descreva o resultado. Todos devem ser confirmados antes de prosseguir.';

  const ul = document.createElement('ul');
  ul.style.cssText = 'background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:12px 16px;margin:0 0 16px;list-style:none;font-size:13px;color:#333;';

  const itensMarcaveis = itens.filter(i => /^\d+\.|^-/.test(i));
  const estado = { marcados: 0, total: itensMarcaveis.length };

  const contador = document.createElement('p');
  contador.style.cssText = 'font-size:12px;color:#888;margin:0 0 16px;text-align:right;';
  contador.textContent = `0 de ${estado.total} concluído`;

  const atualizarContador = () => {
    contador.textContent = `${estado.marcados} de ${estado.total} concluído`;
    contador.style.color = estado.marcados < estado.total ? '#e53935' : '#4caf50';
  };

  itens.forEach((item) => {
    const li = document.createElement('li');
    li.style.cssText = 'margin-bottom:10px;';

    const temNumero = /^\d+\.|^-/.test(item);

    if (!temNumero) {
      const texto = document.createElement('span');
      texto.style.cssText = 'font-size:13px;color:#555;font-style:italic;';
      texto.textContent = item;
      li.appendChild(texto);
      ul.appendChild(li);
      return;
    }

    const linha = document.createElement('div');
    linha.style.cssText = 'display:flex;align-items:flex-start;gap:8px;';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style.cssText = 'margin-top:2px;cursor:pointer;flex-shrink:0;';

    const label = document.createElement('span');
    label.style.cssText = 'cursor:pointer;line-height:1.5;';
    label.textContent = item;

    const complemento = document.createElement('textarea');
    complemento.placeholder = 'Descreva o resultado do teste...';
    complemento.style.cssText = 'display:none;width:100%;margin-top:6px;padding:6px 8px;font-size:12px;font-family:Arial,sans-serif;border:1px solid #ddd;border-radius:4px;resize:vertical;box-sizing:border-box;min-height:48px;';

    cb.addEventListener('change', () => {
      if (cb.checked) {
        estado.marcados++;
        label.style.textDecoration = 'line-through';
        label.style.color = '#aaa';
        complemento.style.display = 'block';
      } else {
        estado.marcados--;
        label.style.textDecoration = '';
        label.style.color = '';
        complemento.style.display = 'none';
        complemento.value = '';
      }
      atualizarContador();
    });

    label.addEventListener('click', () => { cb.click(); });

    linha.appendChild(cb);
    linha.appendChild(label);
    li.appendChild(linha);
    li.appendChild(complemento);
    ul.appendChild(li);
  });

  const rodape = document.createElement('p');
  rodape.style.cssText = 'font-size:12px;color:#999;margin:0 0 20px;';
  rodape.textContent = 'Marque todos os checkboxes antes de prosseguir. A IA irá atualizar o campo de consultas com os resultados informados.';

  const btnArea = document.createElement('div');
  btnArea.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;align-items:center;';

  const msgCopiado = document.createElement('span');
  msgCopiado.style.cssText = 'font-size:12px;color:#4caf50;display:none;';
  msgCopiado.textContent = '\u2705 Copiado!';

  const btnCopiar = document.createElement('button');
  btnCopiar.style.cssText = 'background:#fff;border:1px solid #1565c0;color:#1565c0;border-radius:6px;padding:9px 18px;font-size:13px;cursor:pointer;font-family:Arial,sans-serif;';
  btnCopiar.textContent = '\ud83d\udccb Copiar sugestões';
  btnCopiar.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(sugestoes).then(() => {
      msgCopiado.style.display = 'inline';
      btnCopiar.textContent = '\u2705 Copiado!';
      setTimeout(() => {
        msgCopiado.style.display = 'none';
        btnCopiar.textContent = '\ud83d\udccb Copiar sugestões';
      }, 2000);
    });
  });

  const btnProsseguir = document.createElement('button');
  btnProsseguir.style.cssText = 'background:#1565c0;border:none;color:#fff;border-radius:6px;padding:9px 22px;font-size:13px;font-weight:bold;cursor:pointer;font-family:Arial,sans-serif;';
  btnProsseguir.textContent = 'Prosseguir e abrir SS \u2192';

  btnProsseguir.addEventListener('click', (e) => {
    e.stopPropagation();

    const checkboxes = ul.querySelectorAll('input[type="checkbox"]');
    const textareas = ul.querySelectorAll('textarea');

    if (itensMarcaveis.length > 0) {
      const desmarcadas = Array.from(checkboxes).filter(cb => !cb.checked);
      if (desmarcadas.length > 0) {
        alert(
          `\u26a0\ufe0f Ainda h\u00e1 ${desmarcadas.length} teste(s) n\u00e3o confirmado(s).\n\n` +
          `Marque todos os checkboxes indicando se o teste foi realizado antes de prosseguir.`
        );
        return;
      }
    }

    overlay.remove();

    const testesMarcados = [];
    checkboxes.forEach((cb, i) => {
      if (cb.checked) {
        const resultado = textareas[i]?.value?.trim() || 'realizado';
        testesMarcados.push(`- ${itensMarcaveis[i]}: ${resultado}`);
      }
    });

    if (testesMarcados.length === 0) {
      abrirFormulario(textoFormulario);
      return;
    }

    const promptComplemento = `Você receberá a sugestão de SS já gerada e os testes que o analista realizou antes de abrir a SS.

Sua tarefa é reescrever APENAS o conteúdo do campo "Detalhe todas as consultas, testes e análises realizadas:", seguindo estas regras:

1. Para cada teste que o analista realizou (listado abaixo), incorpore o resultado dele no texto de forma coesa. Se o item já existia com colchetes (indicando pendente), remova os colchetes e substitua pelo resultado informado pelo analista.
2. Itens que o analista NÃO realizou devem continuar no texto normalmente, em colchetes, indicando o que ele precisa fazer.
3. Não adicione colchetes em nenhum item já realizado — colchetes indicam pendência e os testes realizados já não são mais pendências.
4. Retorne SOMENTE o novo conteúdo desse campo, sem título, sem outras seções, sem explicações.
5. Faça a quebra de linha de cada um dos itens, informando um hífen no começo de cada texto de teste realizado.

Sugestão original:
${textoFormulario}

Testes realizados pelo analista antes de abrir a SS:
${testesMarcados.join('\n')}`;

    window._textoFormularioOriginal = textoFormulario;
    window._aguardandoComplemento = true;

    mostrarLoading();
    atualizarMsgLoading('Atualizando consultas com os testes realizados... ⏳');
    chrome.runtime.sendMessage({ action: 'gerarSugestaoSS', markdownSSC: promptComplemento });
  });

  btnArea.appendChild(msgCopiado);
  btnArea.appendChild(btnCopiar);
  btnArea.appendChild(btnProsseguir);

  box.appendChild(btnFechar);
  box.appendChild(titulo);
  box.appendChild(sub);
  box.appendChild(ul);
  box.appendChild(contador);
  box.appendChild(rodape);
  box.appendChild(btnArea);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function abrirFormularioComSugestao(textoCompleto) {
  const { sugestoes, textoSemSugestoes } = extrairSugestoes(textoCompleto);
  if (sugestoes) {
    mostrarTelaSugestoes(sugestoes, textoSemSugestoes);
  } else {
    abrirFormulario(textoSemSugestoes);
  }
}

function abrirFormulario(textoFormulario) {
  const sscNumero = window._sscNumero || obterNumeroSSC();
  if (!sscNumero) { alert('Não foi possível identificar o número da SSC.'); return; }

  const textoLimpo = textoFormulario
    .replace(/Importante:.*?confirme os detalhes importantes\.?/gis, '')
    .trim();

  const chave = `sugestao_${sscNumero}`;
  chrome.storage.local.set({ [chave]: textoLimpo }, () => {
    const url = `/sgsa/faces/cad-ss.html?ssc=${sscNumero}`;
    window.open(url, 'cadss', 'width=780,height=720,scrollbars=yes,resizable=yes');
  });
}

// ─────────────────────────────────────────
// INICIALIZAÇÃO
// Apenas o overlay de loading é criado aqui.
// O botão de acionamento fica na toolbar do SGD Editor (main.js).
// ─────────────────────────────────────────
criarOverlayLoading();
