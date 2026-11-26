# Marca do Buriti

O símbolo desenha a copa em leque do buriti, palmeira das veredas do Cerrado. Cinco frondes
se abrem sobre um tronco curto. Os recortes entre elas deixam a copa legível no favicon,
mesmo a 16 px. No logo horizontal, o nome usa Inter 600 em curvas, com espaçamento de
`−0,015 em` entre letras.

## Arquivos e uso

| Versão | Quando usar | Altura mínima |
|---|---|---|
| [Logo horizontal](../../app/public/marca/buriti-horizontal.svg) | Barra do topo em telas largas, login e manutenção | 24 px |
| [Símbolo](../../app/public/marca/buriti-simbolo.svg) | Barra do topo em telas estreitas, ícones do app e espaços compactos | 16 px |
| [Símbolo monocromático](../../app/public/marca/buriti-simbolo-mono.svg) | Aplicações de uma cor sobre fundo claro | 16 px |
| [Favicon](../../app/public/favicon.svg) | Aba do navegador, com PNG de 32 px como alternativa | 16 px |

Na barra do topo, use 24 px nas duas versões. No login, use 40 px no logo horizontal.
Deixe um quarto da altura do símbolo livre em cada lado da marca, medido da borda do
arquivo ao texto, ícone ou margem mais próximos. A 24 px, reserve 6 px.

O símbolo colorido usa `--cor-acento` (`#2E7D3B`). O nome e a versão monocromática usam
`--cor-texto` (`#1D1F1C`). Use as versões sobre fundos claros como `--cor-superficie`
(`#FFFFFF`) e `--cor-fundo` (`#F5F5F2`).

Preserve a proporção, o espaçamento e as cores dos arquivos. Evite sombras, brilhos,
gradientes e aplicação sobre fotos.

## Regenerar os PNGs

Na raiz do repositório, rode:

```sh
node app/scripts/gerar-icones.mjs
```

O script usa Playwright e, no Windows, inicia o Edge instalado. Ele procura primeiro o
Playwright disponível no ambiente do Codex e também aceita `PLAYWRIGHT_PATH` com o
caminho de uma instalação existente. Para usar outro Chromium instalado, informe o
executável em `NAVEGADOR_CHROMIUM`.

Os cinco PNGs são gravados em `app/public/`. O favicon de 32 px vem de `favicon.svg` e
tem fundo transparente. Os ícones de 180, 192 e 512 px usam o símbolo sobre
`--cor-superficie`. A versão maskable mantém o desenho dentro do círculo central de
diâmetro igual a 80% do ícone. Regere os PNGs quando o desenho ou o fundo mudar e inclua
os arquivos resultantes no commit. O build usa os PNGs versionados.
