const fs = require('fs');
const path = require('path');

// Configurações
const outputFileName = 'PROJETO_COMPLETO.txt';
const targetExtensions = ['.ts', '.tsx', '.js', '.jsx', '.css', '.json']; // O que ler
const ignoredFolders = ['node_modules', '.next', '.git', 'dist', 'build', '.vscode']; // O que pular
const ignoredFiles = ['package-lock.json', 'yarn.lock', 'gerar_dump.js', 'project_dump.txt']; // Arquivos para pular

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    const fullPath = path.join(dirPath, file);
    
    if (fs.statSync(fullPath).isDirectory()) {
      if (!ignoredFolders.includes(file)) {
        arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      const ext = path.extname(file);
      if (targetExtensions.includes(ext) && !ignoredFiles.includes(file)) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

function generateDump() {
  const rootDir = process.cwd();
  console.log('🦈 Tubarão Escaneando o oceano (pastas)...');
  
  const allFiles = getAllFiles(rootDir);
  let outputContent = `DATA DO DUMP: ${new Date().toLocaleString()}\n`;
  outputContent += `TOTAL DE ARQUIVOS: ${allFiles.length}\n\n`;

  allFiles.forEach(filePath => {
    // Pega o caminho relativo para ficar bonito no texto
    const relativePath = path.relative(rootDir, filePath);
    
    console.log(`Lendo: ${relativePath}`);
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      outputContent += `\n================================================================================\n`;
      outputContent += `FILE: ${relativePath}\n`;
      outputContent += `================================================================================\n`;
      outputContent += content + `\n\n`;
    } catch (err) {
      outputContent += `ERRO AO LER ARQUIVO: ${relativePath} - ${err.message}\n`;
    }
  });

  fs.writeFileSync(outputFileName, outputContent);
  console.log(`\n✅ SUCESSO! Todo o código foi salvo em: ${outputFileName}`);
}

generateDump();