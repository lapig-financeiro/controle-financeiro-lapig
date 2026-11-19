import { describe, expect, it } from 'vitest';
import { docxSintetico } from './helpers/plano-sintetico.js';
import { temCpf } from '../tools/rastreabilidade/cpf.mjs';
import {
  detectarFormato,
  lerDocx,
  linhasDoHtmlDocx,
  sha256,
} from '../tools/rastreabilidade/documento.mjs';

describe('documento — formato pelos primeiros bytes', () => {
  const pdf = Buffer.from('%PDF-1.4\n...', 'latin1');
  const docx = Buffer.from('PK\x03\x04...', 'latin1');

  it('aceita PDF e DOCX quando extensão e conteúdo casam', () => {
    expect(detectarFormato('a/balancete.pdf', pdf, 'balancete')).toBe('pdf');
    expect(detectarFormato('a/plano.docx', docx, 'plano')).toBe('docx');
    expect(detectarFormato('a/plano.pdf', pdf, 'plano')).toBe('pdf');
  });

  it('sem extensão, os bytes decidem', () => {
    expect(detectarFormato('a/arquivo', pdf, 'plano')).toBe('pdf');
    expect(detectarFormato('a/arquivo', docx, 'plano')).toBe('docx');
  });

  it('recusa extensão que mente sobre o conteúdo', () => {
    expect(() => detectarFormato('a/plano.docx', pdf, 'plano')).toThrow(/divergem/);
    expect(() => detectarFormato('a/balancete.pdf', docx, 'balancete')).toThrow(/divergem/);
  });

  it('balancete só aceita PDF; arquivo desconhecido fica de fora', () => {
    expect(() => detectarFormato('a/balancete.pdf', docx, 'balancete')).toThrow();
    expect(() => detectarFormato('a/plano.docx', Buffer.from('GIF89a'), 'plano')).toThrow(/não começa/);
  });

  it('sha256 é determinístico e em hex minúsculo', () => {
    expect(sha256(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('documento — DOCX (mammoth + linkedom)', () => {
  it('cada <tr> é uma linha e <p> dentro de <tr> não repete a célula', () => {
    const html = '<p>Primeiro</p><table><tr><td><p>Bolsas</p></td><td>800,00</td></tr></table><p>Último</p>';
    expect(linhasDoHtmlDocx(html)).toEqual(['Primeiro', 'Bolsas 800,00', 'Último']);
  });

  it('desescapa o texto do mammoth', () => {
    expect(linhasDoHtmlDocx('<p>P&amp;D e &lt;teste&gt;</p>')).toEqual(['P&D e <teste>']);
  });

  it('lê o DOCX sintético e deixa a linha da equipe (com CPF) fora dos alvos', async () => {
    const linhas = (await lerDocx(docxSintetico())).paginas[0];
    expect(linhas.some((linha) => linha.includes('Bolsas') && linha.includes('800,00'))).toBe(true);
    expect(linhas.some((linha) => linha.includes('Plano de Aplicação dos Recursos Financeiros'))).toBe(true);

    const linhaEquipe = linhas.find((linha) => linha.includes('Equipe'));
    expect(linhaEquipe).toBeTruthy();
    expect(temCpf(linhaEquipe)).toBe(true);
  }, 20000);
});
