const fs = require('fs');
const path = require('path');

function getFiles(dir, files_) {
    files_ = files_ || [];
    const files = fs.readdirSync(dir);
    for (const i in files) {
        const name = dir + '/' + files[i];
        if (fs.statSync(name).isDirectory()) {
            if (!name.includes('node_modules') && !name.includes('.next')) {
                getFiles(name, files_);
            }
        } else if (name.endsWith('.tsx') || name.endsWith('.ts')) {
            files_.push(name);
        }
    }
    return files_;
}

const allFiles = getFiles('./app');
let finalContent = '';

allFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    finalContent += `\n--- ARQUIVO: ${file} ---\n${content}\n`;
});

fs.writeFileSync('projeto_completo_aaakn.txt', finalContent);
console.log('Aí sim! O Tubarão aprovou o arquivo único! 🦈');