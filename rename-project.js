const fs = require('fs');
const path = require('path');

// ================= CONFIGURAÇÃO =================
// Adicione aqui todas as variações do nome antigo que você quer substituir
const TERMOS_ANTIGOS = [
    'SGD - Editor de Texto Aprimorado',
    'SGD-Editor-de-Texto-Aprimorado',
    'SGD Editor',
    'Editor de Texto Aprimorado',
    'sgd-editor-de-texto'
];

const TERMO_NOVO = 'SGD - PowerTools';

// Pastas e arquivos que devem ser ignorados
const IGNORAR = [
    'node_modules',
    '.git',
    '.DS_Store',
    'rename-project.js' // Ignora o próprio script
];
// ================================================

function substituirNoArquivo(caminhoArquivo) {
    try {
        let conteudo = fs.readFileSync(caminhoArquivo, 'utf8');
        let arquivoModificado = false;

        // Passa por cada termo antigo da lista e faz a substituição
        TERMOS_ANTIGOS.forEach(termo => {
            if (conteudo.includes(termo)) {
                conteudo = conteudo.split(termo).join(TERMO_NOVO);
                arquivoModificado = true;
            }
        });

        // Só reescreve o arquivo se alguma alteração real tiver acontecido
        if (arquivoModificado) {
            fs.writeFileSync(caminhoArquivo, conteudo, 'utf8');
            console.log(`✅ Atualizado: ${caminhoArquivo}`);
        }
    } catch (erro) {
        console.error(`❌ Erro ao processar o arquivo ${caminhoArquivo}:`, erro.message);
    }
}

function percorrerDiretorio(diretorioAtual) {
    const itens = fs.readdirSync(diretorioAtual);

    itens.forEach(item => {
        const caminhoCompleto = path.join(diretorioAtual, item);
        const estatisticas = fs.statSync(caminhoCompleto);

        if (IGNORAR.includes(item)) {
            return;
        }

        if (estatisticas.isDirectory()) {
            percorrerDiretorio(caminhoCompleto);
        } else if (estatisticas.isFile()) {
            substituirNoArquivo(caminhoCompleto);
        }
    });
}

console.log(`🚀 Iniciando a substituição dos termos antigos por "${TERMO_NOVO}"...`);
percorrerDiretorio(__dirname);
console.log('🏁 Processo concluído com sucesso!');