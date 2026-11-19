let pdfjsPromessa = null;
let mammothPromessa = null;

/**
 * Carrega `pdfjs-dist` e o asset do worker sob demanda para não entrar no bundle inicial.
 */
export async function carregarPdfJs() {
  if (!pdfjsPromessa) {
    pdfjsPromessa = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
      .then(([pdfjs, workerMod]) => {
        const lib = pdfjs?.getDocument ? pdfjs : pdfjs?.default;
        if (!lib || typeof lib.getDocument !== 'function') {
          throw new Error('Leitor de PDF indisponível.');
        }
        const workerUrl = workerMod?.default || workerMod;
        if (lib.GlobalWorkerOptions && typeof workerUrl === 'string' && workerUrl) {
          lib.GlobalWorkerOptions.workerSrc = workerUrl;
        }
        return lib;
      })
      .catch((err) => {
        pdfjsPromessa = null;
        throw err;
      });
  }
  return pdfjsPromessa;
}

/**
 * Carrega o leitor de DOCX (`mammoth`) sob demanda.
 */
export async function carregarMammoth() {
  if (!mammothPromessa) {
    mammothPromessa = import('mammoth/mammoth.browser.min.js')
      .then((mod) => {
        const lib =
          (mod && typeof mod.convertToHtml === 'function' && mod) ||
          (mod?.default && typeof mod.default.convertToHtml === 'function' && mod.default) ||
          (typeof window !== 'undefined' && window.mammoth) ||
          null;
        if (!lib || typeof lib.convertToHtml !== 'function') {
          throw new Error('Leitor de DOCX indisponível.');
        }
        return lib;
      })
      .catch((err) => {
        mammothPromessa = null;
        throw err;
      });
  }
  return mammothPromessa;
}
