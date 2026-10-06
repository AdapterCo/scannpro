// Funções puras (sem Firebase) usadas pelas telas e pelos testes.

export const FUSO = 'America/Sao_Paulo';
export const IDMAQ_RE = /^[0-9A-F]{4}-[0-9A-F]{4}$/;

/** Normaliza o que o admin digitou: maiúsculas, sem espaços, hífen no meio se faltar. */
export function normalizarIdmaq(texto: string): string {
  const limpo = texto.trim().toUpperCase().replace(/\s+/g, '');
  if (/^[0-9A-F]{8}$/.test(limpo)) return `${limpo.slice(0, 4)}-${limpo.slice(4)}`;
  return limpo;
}

export function idmaqValido(idmaq: string): boolean {
  return IDMAQ_RE.test(idmaq);
}

/**
 * "20" | "20,5" | "20,50" | "1.234,56" | "R$ 20,00" → centavos inteiros.
 * Devolve null se o texto não for um valor em reais válido.
 */
export function reaisParaCentavos(texto: string): number | null {
  const t = texto.replace(/R\$/i, '').replace(/\s/g, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ''] = t.replace(/\./g, '').split(',');
  const centavos = Number(inteiro) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** 2000 → "20,00" (para preencher o campo de edição). */
export function centavosParaTexto(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',');
}

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** 2000 → "R$ 20,00" */
export function formatarReais(centavos: number): string {
  return moeda.format(centavos / 100);
}

/** Últimos 4 caracteres do token, para o admin saber qual está configurado. */
export function finalDoToken(token: string): string {
  return `…${token.slice(-4)}`;
}

// ---------- Datas no fuso de São Paulo ----------

export interface DiaCivil {
  ano: number;
  mes: number; // 1-12
  dia: number;
}

const partesFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function partesSP(d: Date) {
  const p: Record<string, number> = {};
  for (const { type, value } of partesFmt.formatToParts(d)) {
    if (type !== 'literal') p[type] = Number(value);
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Diferença (ms) entre o relógio de São Paulo e o UTC no instante d. */
function deslocamentoSP(d: Date): number {
  const p = partesSP(d);
  const comoUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return comoUTC - Math.floor(d.getTime() / 1000) * 1000;
}

/** Dia civil em São Paulo do instante d. */
export function diaSP(d: Date): DiaCivil {
  const p = partesSP(d);
  return { ano: p.year, mes: p.month, dia: p.day };
}

/** Soma n dias a um dia civil (n pode ser negativo). */
export function somarDias(dia: DiaCivil, n: number): DiaCivil {
  const d = new Date(Date.UTC(dia.ano, dia.mes - 1, dia.dia + n));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

/** Instante de 00:00 do dia civil em São Paulo. */
export function inicioDoDiaSP(dia: DiaCivil): Date {
  const palpite = Date.UTC(dia.ano, dia.mes - 1, dia.dia);
  let t = palpite - deslocamentoSP(new Date(palpite));
  t = palpite - deslocamentoSP(new Date(t)); // corrige se o deslocamento mudar no caminho
  return new Date(t);
}

export function diaParaISO(dia: DiaCivil): string {
  const dd = (n: number) => String(n).padStart(2, '0');
  return `${dia.ano}-${dd(dia.mes)}-${dd(dia.dia)}`;
}

export function isoParaDia(iso: string): DiaCivil | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const dia = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
  return diaParaISO(somarDias(dia, 0)) === iso ? dia : null;
}

export type Periodo = 'hoje' | '7dias' | '30dias' | 'mes' | 'livre';

export interface Intervalo {
  /** inclusivo */
  inicio: Date;
  /** exclusivo (00:00 do dia seguinte ao último dia) */
  fim: Date;
}

/** Intervalo do período no fuso de São Paulo. "livre" usa de/até (AAAA-MM-DD, inclusivos). */
export function intervaloDoPeriodo(periodo: Periodo, agora: Date, de?: string, ate?: string): Intervalo | null {
  const hoje = diaSP(agora);
  const amanha = inicioDoDiaSP(somarDias(hoje, 1));
  switch (periodo) {
    case 'hoje':
      return { inicio: inicioDoDiaSP(hoje), fim: amanha };
    case '7dias':
      return { inicio: inicioDoDiaSP(somarDias(hoje, -6)), fim: amanha };
    case '30dias':
      return { inicio: inicioDoDiaSP(somarDias(hoje, -29)), fim: amanha };
    case 'mes': {
      const proximoMes = hoje.mes === 12 ? { ano: hoje.ano + 1, mes: 1, dia: 1 } : { ano: hoje.ano, mes: hoje.mes + 1, dia: 1 };
      return { inicio: inicioDoDiaSP({ ano: hoje.ano, mes: hoje.mes, dia: 1 }), fim: inicioDoDiaSP(proximoMes) };
    }
    case 'livre': {
      const d1 = de ? isoParaDia(de) : null;
      const d2 = ate ? isoParaDia(ate) : null;
      if (!d1 || !d2 || diaParaISO(d1) > diaParaISO(d2)) return null;
      return { inicio: inicioDoDiaSP(d1), fim: inicioDoDiaSP(somarDias(d2, 1)) };
    }
  }
}

const dataHoraFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
/** "05/10/2026 14:32" no horário de São Paulo */
export function formatarDataHora(d: Date): string {
  return dataHoraFmt.format(d).replace(',', '');
}

/** "há 5 min", "há 2 h", "há 3 dias" */
export function tempoDesde(d: Date, agora: Date): string {
  const min = Math.max(0, Math.floor((agora.getTime() - d.getTime()) / 60000));
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

// ---------- Vendas ----------

export interface VendaBase {
  idmaq: string;
  valor: number;
}

export interface Resumo {
  total: number;
  quantidade: number;
  ticketMedio: number;
}

export function resumir(vendas: readonly VendaBase[]): Resumo {
  const total = vendas.reduce((s, v) => s + v.valor, 0);
  const quantidade = vendas.length;
  return { total, quantidade, ticketMedio: quantidade ? Math.round(total / quantidade) : 0 };
}

export function resumirPorMaquina(vendas: readonly VendaBase[]): Map<string, Resumo> {
  const grupos = new Map<string, VendaBase[]>();
  for (const v of vendas) {
    const lista = grupos.get(v.idmaq) ?? [];
    lista.push(v);
    grupos.set(v.idmaq, lista);
  }
  return new Map([...grupos].map(([id, lista]) => [id, resumir(lista)]));
}

// ---------- CSV ----------

/** CSV com ";" (padrão do Excel em português). */
export function gerarCSV(cabecalho: readonly string[], linhas: readonly (readonly (string | number)[])[]): string {
  const campo = (v: string | number) => {
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cabecalho, ...linhas].map((l) => l.map(campo).join(';')).join('\r\n');
}
