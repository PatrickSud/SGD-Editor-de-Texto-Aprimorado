// form-filler.js — Injetado no formulário de cadastro de SS

function aguardarFormulario(callback, tentativas = 30) {
  const form = document.getElementById('cadSsForm');
  if (form) {
    callback(form);
  } else if (tentativas > 0) {
    setTimeout(() => aguardarFormulario(callback, tentativas - 1), 300);
  } else {
    console.error('[Sugestor SS] Formulário não encontrado.');
  }
}

function preencherCampo(id, valor) {
  if (!valor || !valor.trim()) return;
  const el = document.getElementById(id);
  if (el) {
    el.value = valor.trim();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    console.log(`[Sugestor SS] ✅ "${id}" preenchido.`);
  } else {
    console.warn(`[Sugestor SS] ⚠️ Campo "${id}" não encontrado.`);
  }
}

// ─────────────────────────────────────────
// MAPEAMENTO REAL DOS CAMPOS (confirmado no HTML do formulário)
//
// Título da IA                                        → ID no formulário
// ─────────────────────────────────────────────────────────────────────
// "Assunto:"                                          → cadSsForm:assunto
// "Descreva de forma detalhada..."                    → cadSsForm:descricao
// "Detalhe todas as consultas, testes..."             → cadSsForm:pesquisas
// "Situação ocorre apenas no Banco de Dados..."       → IGNORADO (é <select>, usuário preenche)
// "Passos para reproduzir a situação:"               → cadSsForm:testeAnaliseBancoCliente (ID real no HTML!)
// "Qual a sua dúvida neste suporte:"                 → cadSsForm:duvida
// "Informações do Banco de Dados:"                   → cadSsForm:informacaoBancoDados
// ─────────────────────────────────────────────────────────────────────

const TITULOS = [
  {
    regex: /^Assunto:\s*/im,
    campo: 'cadSsForm:assunto',
    linhaUnica: true
  },
  {
    regex: /^Descreva de forma detalhada a situa[çc][aã]o\/problema que deseja tratar:\s*/im,
    campo: 'cadSsForm:descricao',
    linhaUnica: false
  },
  {
    regex: /^Detalhe todas as consultas,\s*testes e an[aá]lises realizadas:\s*/im,
    campo: 'cadSsForm:pesquisas',
    linhaUnica: false
  },
  {
    regex: /^Situa[çc][aã]o ocorre apenas no Banco de Dados do Cliente:\s*/im,
    campo: null,   // IGNORADO — é <select>, usuário marca manualmente
    linhaUnica: false
  },
  {
    regex: /^Passos para reproduzir a situa[çc][aã]o:\s*/im,
    campo: 'cadSsForm:testeAnaliseBancoCliente',  // ID real confirmado no HTML
    linhaUnica: false
  },
  {
    regex: /^Qual a sua d[uú]vida neste suporte:\s*/im,
    campo: 'cadSsForm:duvida',
    linhaUnica: false
  },
  {
    regex: /^Informa[çc][oõ]es do Banco de Dados:\s*/im,
    campo: 'cadSsForm:informacaoBancoDados',
    linhaUnica: false
  }
];

// ─────────────────────────────────────────
// PARSE POR TÍTULOS
// ─────────────────────────────────────────

function parsearPorTitulos(texto) {
  if (!texto) return {};

  const posicoes = [];
  for (const item of TITULOS) {
    const match = texto.match(item.regex);
    if (match) {
      const index = texto.search(item.regex);
      posicoes.push({
        index,
        tituloLen: match[0].length,
        campo: item.campo,
        linhaUnica: item.linhaUnica
      });
    }
  }

  if (posicoes.length === 0) {
    console.warn('[Sugestor SS] Nenhum título encontrado. Tentando JSON...');
    return parsearJSON(texto);
  }

  posicoes.sort((a, b) => a.index - b.index);

  const campos = {};

  for (let i = 0; i < posicoes.length; i++) {
    const atual = posicoes[i];
    const proximo = posicoes[i + 1];

    const inicio = atual.index + atual.tituloLen;
    const fim = proximo ? proximo.index : texto.length;

    let conteudo = texto.slice(inicio, fim);
    conteudo = conteudo.replace(/^\n+/, '').replace(/\n+$/, '').trimEnd();

    if (atual.linhaUnica) {
      conteudo = conteudo.split('\n')[0].trim();
    }

    if (!atual.campo || !conteudo) continue;

    campos[atual.campo] = conteudo;
  }

  console.log('[Sugestor SS] Campos extraídos:', Object.keys(campos));
  return campos;
}

// Fallback JSON caso a IA retorne nesse formato
function parsearJSON(texto) {
  const jsonMatch = texto.match(/```json\s*([\s\S]*?)\s*```/) ||
                    texto.match(/```\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : texto.trim();
  try {
    const dados = JSON.parse(jsonStr);
    return {
      'cadSsForm:assunto':                  dados.assunto || '',
      'cadSsForm:descricao':                dados.descricao || '',
      'cadSsForm:pesquisas':                dados.pesquisas || '',
      'cadSsForm:testeAnaliseBancoCliente': dados.passos || '',
      'cadSsForm:duvida':                   dados.duvida || '',
      'cadSsForm:informacaoBancoDados':     dados.informacaoBancoDados || ''
    };
  } catch {
    return { 'cadSsForm:descricao': texto };
  }
}

// ─────────────────────────────────────────
// EXTRAÇÃO DE ANEXOS NECESSÁRIOS
// ─────────────────────────────────────────

/**
 * Extrai a seção ANEXOS_NECESSARIOS do texto bruto retornado pela chain.
 * Remove essa seção do texto antes de passar para o parse de campos —
 * assim ela não aparece em nenhum campo do formulário.
 *
 * Retorna { anexos, textoSemAnexos }:
 * - anexos: array de strings com cada item, ou null se N/A ou não encontrado
 * - textoSemAnexos: texto sem o bloco ANEXOS_NECESSARIOS
 */
function extrairAnexosNecessarios(textoCompleto) {
  // ANEXOS_NECESSARIOS: é sempre a última seção do texto retornado pela chain.
  // Tudo a partir desse cabeçalho até o fim é o bloco de anexos.
  const regex = /^ANEXOS_NECESSARIOS:\s*\n([\s\S]*)$/im;
  const match = textoCompleto.match(regex);

  let anexos = null;
  // Remove o bloco inteiro do texto — do cabeçalho até o fim
  const textoSemAnexos = textoCompleto.replace(/\nANEXOS_NECESSARIOS:[\s\S]*$/im, '').trim();

  if (match) {
    const conteudo = match[1].trim();

    if (conteudo && conteudo !== 'N/A') {
      const itens = conteudo
        .split('\n')
        .map(l => l.replace(/^[-•]\s*/, '').trim())
        .filter(l => l.length > 0 && l !== 'N/A');

      if (itens.length > 0) anexos = itens;
    }
  }

  return { anexos, textoSemAnexos };
}

// ─────────────────────────────────────────
// PAINEL DE ITENS PENDENTES (colchetes)
// ─────────────────────────────────────────

/**
 * Extrai trechos entre colchetes de um texto e retorna:
 * - textoLimpo: texto sem os colchetes e seu conteúdo
 * - pendentes: array de strings com cada trecho extraído
 */
function extrairPendentes(texto) {
  const pendentes = [];
  const textoLimpo = texto.replace(/\[([^\]]+)\]/g, (_, conteudo) => {
    const item = conteudo.trim();
    if (item) pendentes.push(item);
    return '';
  // Remove espaços duplos ou pontuação solta que sobra após remover o colchete
  }).replace(/\s{2,}/g, ' ').replace(/\.\s*\./g, '.').trim();

  return { textoLimpo, pendentes };
}

/**
 * Cria e insere um painel visual de itens pendentes logo abaixo do campo.
 * Cada item tem checkbox + textarea que ao perder foco adiciona o resultado ao campo.
 */
function exibirPainelPendentes(el, pendentes) {
  if (!el || !pendentes.length) return;

  const painel = document.createElement('div');
  painel.className = 'sugestor-painel-pendentes';
  painel.style.cssText = `
    background: #ffebee; border: 1px solid #e53935; border-radius: 8px;
    padding: 10px 14px; margin-top: 6px; font-family: Arial, sans-serif;
    font-size: 12px; color: #333;
  `;

  // Título do painel
  const titulo = document.createElement('div');
  titulo.style.cssText = 'font-weight:bold;color:#b71c1c;margin-bottom:8px;font-size:12px;';
  titulo.textContent = '\u26a0 Estes itens precisam ser feitos ou preenchidos antes de gravar:';
  painel.appendChild(titulo);

  pendentes.forEach((item) => {
    const itemDiv = document.createElement('div');
    itemDiv.style.cssText = 'margin-bottom:8px;';

    // Linha checkbox + label
    const linha = document.createElement('div');
    linha.style.cssText = 'display:flex;align-items:flex-start;gap:6px;';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style.cssText = 'margin-top:2px;cursor:pointer;flex-shrink:0;';

    const label = document.createElement('span');
    label.style.cssText = 'cursor:pointer;line-height:1.5;';
    label.textContent = item;

    // Textarea de resultado — aparece ao marcar
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Descreva o resultado...';
    textarea.style.cssText = `
      display:none; width:100%; margin-top:4px; padding:5px 7px;
      font-size:12px; font-family:Arial,sans-serif; border:1px solid #ddd;
      border-radius:4px; resize:vertical; box-sizing:border-box; min-height:40px;
    `;

    // Ao perder foco no textarea, insere o resultado no campo do formulário
    textarea.addEventListener('blur', () => {
      const resultado = textarea.value.trim();
      if (!resultado) return;
      const textoAtual = el.value;
      const linha = `\n${item}: ${resultado}`;
      if (!textoAtual.includes(linha.trim())) {
        el.value = textoAtual + linha;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    });

    cb.addEventListener('change', () => {
      if (cb.checked) {
        label.style.textDecoration = 'line-through';
        label.style.color = '#aaa';
        textarea.style.display = 'block';
      } else {
        label.style.textDecoration = '';
        label.style.color = '';
        textarea.style.display = 'none';
        textarea.value = '';
      }
    });

    label.addEventListener('click', () => cb.click());

    linha.appendChild(cb);
    linha.appendChild(label);
    itemDiv.appendChild(linha);
    itemDiv.appendChild(textarea);
    painel.appendChild(itemDiv);
  });

  // Insere o painel logo após o campo no DOM
  el.insertAdjacentElement('afterend', painel);
}



function exibirBanner(temCampos) {
  if (document.getElementById('sugestor-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'sugestor-banner';
  banner.style.cssText = `
    background: #e8f5e9; border: 2px solid #4caf50; border-radius: 6px;
    padding: 12px 16px; margin-bottom: 14px; font-family: Arial, sans-serif;
    font-size: 13px; color: #2e7d32; display: flex; align-items: center;
    gap: 8px; z-index: 9999;
  `;
  banner.innerHTML = temCampos
    ? `<span style="font-size:18px">✨</span><span><strong>Sugestão preenchida pela IA.</strong> Revise os campos antes de gravar.</span>`
    : `<span style="font-size:18px">⚠️</span><span><strong>A IA respondeu mas não foi possível identificar os campos.</strong></span>`;

  const form = document.getElementById('cadSsForm');
  if (form) form.insertAdjacentElement('beforebegin', banner);
  else document.body.insertAdjacentElement('afterbegin', banner);
}

// ─────────────────────────────────────────
// AVISO DE ANEXO + INTERCEPTAÇÃO DO GRAVAR
// ─────────────────────────────────────────

/**
 * Exibe aviso vermelho dentro da área de anexo (dropzone).
 * Se a chain retornou lista de anexos, exibe cada item.
 * Senão, exibe mensagem genérica.
 */
function exibirAvisoAnexo(anexos = null) {
  if (document.getElementById('sugestor-aviso-anexo')) return;

  const tdDropzone = document.getElementById('dropzone-container-anexo');
  if (!tdDropzone) return;

  let conteudoHTML = '';
  if (anexos && anexos.length > 0) {
    const itens = anexos.map(item => `<li style="margin-bottom:3px">${item}</li>`).join('');
    conteudoHTML = `
      <span style="font-size:16px;flex-shrink:0">📎</span>
      <div>
        <strong>Anexe os arquivos antes de gravar:</strong>
        <ul style="margin:4px 0 0 0;padding-left:18px;">${itens}</ul>
      </div>
    `;
  } else {
    conteudoHTML = `
      <span style="font-size:16px">📎</span>
      <span><strong>Lembre-se:</strong> anexe todos os arquivos necessários antes de gravar.</span>
    `;
  }

  const aviso = document.createElement('div');
  aviso.id = 'sugestor-aviso-anexo';
  aviso.style.cssText = `
    background: #ffebee;
    border: 2px solid #e53935;
    padding: 10px 16px;
    font-family: Arial, sans-serif;
    font-size: 13px;
    color: #b71c1c;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 10px;
    margin-top: 10px;
  `;
  aviso.innerHTML = conteudoHTML;

  tdDropzone.prepend(aviso);
}

/**
 * Intercepta o clique no botão Gravar.
 * Exibe um confirm perguntando se todos os arquivos foram anexados.
 * Se o usuário clicar "Cancelar" (não), bloqueia o submit.
 */
function interceptarGravar() {
  const btnGravar = document.querySelector('input[type="submit"][value="Gravar"]');
  if (!btnGravar) return;

  btnGravar.addEventListener('click', (e) => {
    // 1. Verifica se há itens pendentes (colchetes) com checkboxes desmarcadas
    const checkboxesPendentes = document.querySelectorAll('.sugestor-painel-pendentes input[type="checkbox"]');
    if (checkboxesPendentes.length > 0) {
      const desmarcadas = Array.from(checkboxesPendentes).filter(cb => !cb.checked);
      if (desmarcadas.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        alert(
          `\u26a0\ufe0f Ainda h\u00e1 ${desmarcadas.length} item(ns) pendente(s) no campo de consultas.\n\n` +
          `Marque todas as checkboxes e preencha os resultados antes de gravar.`
        );
        return;
      }
    }

    // 2. Verifica anexos
    const confirmado = confirm('Todos os arquivos foram anexados?\n\nClique em "OK" para gravar ou "Cancelar" para voltar e anexar.');
    if (!confirmado) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
}

// ─────────────────────────────────────────
// FLUXO PRINCIPAL
// ─────────────────────────────────────────

function preencherFormulario() {
  const params = new URLSearchParams(window.location.search);
  const sscNumero = params.get('ssc');

  if (!sscNumero) {
    console.log('[Sugestor SS] Sem número de SSC na URL.');
    return;
  }

  const chave = `sugestao_${sscNumero}`;

  chrome.storage.local.get(chave, (result) => {
    const sugestaoTexto = result[chave];

    if (!sugestaoTexto) {
      console.log('[Sugestor SS] Nenhuma sugestão no storage para esta SSC.');
      return;
    }

    chrome.storage.local.remove(chave);
    console.log('[Sugestor SS] Texto recebido:\n', sugestaoTexto);

    // 1. Extrai e remove o bloco ANEXOS_NECESSARIOS antes do parse
    //    para que ele não apareça em nenhum campo do formulário
    const { anexos, textoSemAnexos } = extrairAnexosNecessarios(sugestaoTexto);

    // 2. Parseia os campos do texto já sem o bloco de anexos
    const campos = parsearPorTitulos(textoSemAnexos);
    const temCampos = Object.keys(campos).length > 0;

    aguardarFormulario(() => {
      exibirBanner(temCampos);
      exibirAvisoAnexo(anexos);
      interceptarGravar();
      for (const [id, valor] of Object.entries(campos)) {
        preencherCampo(id, valor);

        // Detecta colchetes no campo preenchido e exibe painel de pendências
        const el = document.getElementById(id);
        if (el && el.value) {
          const { textoLimpo, pendentes } = extrairPendentes(el.value);
          if (pendentes.length > 0) {
            // Atualiza o campo com o texto limpo (sem colchetes)
            el.value = textoLimpo;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            // Exibe o painel de pendências abaixo do campo
            exibirPainelPendentes(el, pendentes);
          }
        }
      }
      console.log('[Sugestor SS] ✅ Concluído!');
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', preencherFormulario);
} else {
  preencherFormulario();
}