import { describe, expect, it } from 'vitest';
import {
  finalDoToken,
  formatarDataHora,
  gerarCSV,
  idmaqValido,
  intervaloDoPeriodo,
  normalizarIdmaq,
  reaisParaCentavos,
  resumir,
  resumirPorMaquina,
} from '../../src/lib/formato';

describe('idmaq', () => {
  it('aceita só XXXX-XXXX hexadecimal maiúsculo', () => {
    expect(idmaqValido('3F9A-12C0')).toBe(true);
    expect(idmaqValido('3f9a-12c0')).toBe(false);
    expect(idmaqValido('3F9A12C0')).toBe(false);
    expect(idmaqValido('3F9G-12C0')).toBe(false);
    expect(idmaqValido('3F9A-12C0 ')).toBe(false);
  });
  it('normaliza o que o admin digita', () => {
    expect(normalizarIdmaq(' 3f9a-12c0 ')).toBe('3F9A-12C0');
    expect(normalizarIdmaq('3f9a12c0')).toBe('3F9A-12C0');
    expect(normalizarIdmaq('xyz')).toBe('XYZ');
  });
});

describe('reais → centavos', () => {
  it.each([
    ['20', 2000],
    ['20,5', 2050],
    ['20,50', 2050],
    ['0,01', 1],
    ['1.234,56', 123456],
    ['R$ 20,00', 2000],
  ])('%s → %i', (texto, esperado) => {
    expect(reaisParaCentavos(texto)).toBe(esperado);
  });
  it.each(['', 'abc', '20.5', '20,555', '-5', '1.23,00'])('recusa %j', (texto) => {
    expect(reaisParaCentavos(texto)).toBeNull();
  });
  it('não erra soma como decimais (20,10 + 20,20)', () => {
    expect(reaisParaCentavos('20,10')! + reaisParaCentavos('20,20')!).toBe(4030);
  });
});

describe('token', () => {
  it('mostra só os 4 últimos caracteres', () => {
    expect(finalDoToken('TEST-1234567890ab12')).toBe('…ab12');
  });
});

describe('períodos no fuso de São Paulo', () => {
  // 05/10/2026 23:59:30 em São Paulo (UTC-3) = 06/10/2026 02:59:30 UTC
  const agora = new Date('2026-10-06T02:59:30Z');

  it('hoje vai de 00:00 a 23:59 de São Paulo', () => {
    const i = intervaloDoPeriodo('hoje', agora)!;
    expect(i.inicio.toISOString()).toBe('2026-10-05T03:00:00.000Z');
    expect(i.fim.toISOString()).toBe('2026-10-06T03:00:00.000Z');
  });
  it('venda às 23:59 entra no dia; às 00:00 do dia seguinte não', () => {
    const i = intervaloDoPeriodo('hoje', agora)!;
    const as2359 = new Date('2026-10-06T02:59:59Z');
    const meiaNoite = new Date('2026-10-06T03:00:00Z');
    expect(as2359 >= i.inicio && as2359 < i.fim).toBe(true);
    expect(meiaNoite >= i.inicio && meiaNoite < i.fim).toBe(false);
  });
  it('7 dias inclui hoje e os 6 anteriores', () => {
    const i = intervaloDoPeriodo('7dias', agora)!;
    expect(i.inicio.toISOString()).toBe('2026-09-29T03:00:00.000Z');
  });
  it('30 dias', () => {
    expect(intervaloDoPeriodo('30dias', agora)!.inicio.toISOString()).toBe('2026-09-06T03:00:00.000Z');
  });
  it('mês corrente, inclusive virada de ano', () => {
    const i = intervaloDoPeriodo('mes', agora)!;
    expect(i.inicio.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(i.fim.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    const dez = intervaloDoPeriodo('mes', new Date('2026-12-15T12:00:00Z'))!;
    expect(dez.fim.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });
  it('intervalo livre é inclusivo nos dois dias e recusa datas inválidas', () => {
    const i = intervaloDoPeriodo('livre', agora, '2026-10-01', '2026-10-03')!;
    expect(i.inicio.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(i.fim.toISOString()).toBe('2026-10-04T03:00:00.000Z');
    expect(intervaloDoPeriodo('livre', agora, '2026-10-03', '2026-10-01')).toBeNull();
    expect(intervaloDoPeriodo('livre', agora, '2026-02-30', '2026-03-01')).toBeNull();
    expect(intervaloDoPeriodo('livre', agora)).toBeNull();
  });
  it('formata no horário de São Paulo', () => {
    expect(formatarDataHora(new Date('2026-10-06T02:59:00Z'))).toBe('05/10/2026 23:59');
  });
});

describe('resumo de vendas', () => {
  const vendas = [
    { idmaq: 'AAAA-0001', valor: 2000 },
    { idmaq: 'AAAA-0001', valor: 2000 },
    { idmaq: 'BBBB-0002', valor: 1500 },
  ];
  it('total, quantidade e ticket médio batem com a lista', () => {
    expect(resumir(vendas)).toEqual({ total: 5500, quantidade: 3, ticketMedio: 1833 });
    expect(resumir([])).toEqual({ total: 0, quantidade: 0, ticketMedio: 0 });
  });
  it('agrupa por máquina e a soma das máquinas é o total geral', () => {
    const porMaq = resumirPorMaquina(vendas);
    expect(porMaq.get('AAAA-0001')).toEqual({ total: 4000, quantidade: 2, ticketMedio: 2000 });
    expect([...porMaq.values()].reduce((s, r) => s + r.total, 0)).toBe(resumir(vendas).total);
  });
});

describe('CSV', () => {
  it('usa ; e escapa aspas e separadores', () => {
    expect(gerarCSV(['a', 'b'], [['x;y', 'diz "oi"'], [1, 2]])).toBe('a;b\r\n"x;y";"diz ""oi"""\r\n1;2');
  });
});
