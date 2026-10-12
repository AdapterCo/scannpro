import { useEffect, useState } from 'react';
import { addDoc, collection, doc, onSnapshot, serverTimestamp, Timestamp, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';

// Seção 18 de ADMIN-APP-INSTRUCOES.md: o cliente final controla a sessão paga pelo celular.
// Página pública (sem login): lê controles/{código} em tempo real e cria pedidos em controles/{código}/comandos.

const CODIGO_RE = /^[0-9a-f]{32}$/i;
const PERGUNTA_LIMPAR = 'Apagar os códigos de falha da central do veículo?';

type Acao = 'escanear' | 'limpar' | 'imprimir';

interface Dtc {
  codigo: string;
  pendente: boolean;
  titulo: string;
  gravidade: string;
  descricao: string;
  causas: string[];
}

interface Sensor {
  nome: string;
  valor: number | null;
  unidade: string;
}

interface Controle {
  ativa: boolean;
  expiraEm: Date | null;
  escaneamentosRestantes: number | null;
  impressoesRestantes: number | null;
  sistemaOnline: boolean;
  veiculoConectado: boolean;
  ocupado: boolean;
  mensagem: string;
  podeEscanear: boolean;
  podeLimpar: boolean;
  podeImprimir: boolean;
  statusConfirmados: unknown;
  statusPendentes: unknown;
  statusLimpeza: unknown;
  dtcs: Dtc[];
  sensores: Sensor[];
}

type Estado = { tipo: 'carregando' } | { tipo: 'encerrada' } | { tipo: 'erro' } | { tipo: 'ok'; c: Controle };

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function lerControle(d: DocumentData): Controle {
  const lista = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    ativa: d.ativa === true,
    expiraEm: d.expiraEm instanceof Timestamp ? d.expiraEm.toDate() : null,
    escaneamentosRestantes: numero(d.escaneamentosRestantes),
    impressoesRestantes: numero(d.impressoesRestantes),
    sistemaOnline: d.sistemaOnline === true,
    veiculoConectado: d.veiculoConectado === true,
    ocupado: d.ocupado === true,
    mensagem: texto(d.mensagem),
    podeEscanear: d.podeEscanear === true,
    podeLimpar: d.podeLimpar === true,
    podeImprimir: d.podeImprimir === true,
    statusConfirmados: d.statusConfirmados,
    statusPendentes: d.statusPendentes,
    statusLimpeza: d.statusLimpeza,
    dtcs: lista(d.dtcs).map((x: DocumentData) => ({
      codigo: texto(x?.codigo),
      pendente: x?.pendente === true,
      titulo: texto(x?.titulo),
      gravidade: texto(x?.gravidade),
      descricao: texto(x?.descricao),
      // causas pode vir como lista de textos ou como um texto só
      causas: Array.isArray(x?.causas) ? x.causas.map(texto).filter(Boolean) : x?.causas ? [texto(x.causas)] : [],
    })),
    sensores: lista(d.sensores).map((x: DocumentData) => ({
      nome: texto(x?.nome),
      valor: numero(x?.valor),
      unidade: texto(x?.unidade),
    })),
  };
}

function tempoRestante(ate: Date, agora: number): string {
  const s = Math.max(0, Math.floor((ate.getTime() - agora) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const formatarValor = (v: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v);

export function Controle({ codigo }: { codigo: string }) {
  const valido = CODIGO_RE.test(codigo);
  const [estado, setEstado] = useState<Estado>(valido ? { tipo: 'carregando' } : { tipo: 'encerrada' });
  const [agora, setAgora] = useState(() => Date.now());
  const [enviando, setEnviando] = useState<Acao | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    if (!valido) return;
    return onSnapshot(
      doc(db, 'controles', codigo),
      (snap) => setEstado(snap.exists() ? { tipo: 'ok', c: lerControle(snap.data()) } : { tipo: 'encerrada' }),
      () => setEstado({ tipo: 'erro' }),
    );
  }, [codigo, valido]);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Libera os botões quando o totem começa a trabalhar (ocupado) ou depois de alguns segundos.
  const ocupado = estado.tipo === 'ok' && estado.c.ocupado;
  useEffect(() => {
    if (!enviando) return;
    if (ocupado) {
      setEnviando(null);
      return;
    }
    const t = setTimeout(() => setEnviando(null), 5000);
    return () => clearTimeout(t);
  }, [enviando, ocupado]);

  async function pedir(acao: Acao) {
    let confirmado = false;
    if (acao === 'limpar') {
      if (!window.confirm(PERGUNTA_LIMPAR)) return;
      confirmado = true;
    }
    setAviso(null);
    setEnviando(acao);
    try {
      await addDoc(collection(db, 'controles', codigo, 'comandos'), { acao, confirmado, criadoEm: serverTimestamp() });
      setAviso({ ok: true, texto: 'Pedido enviado ao totem.' });
    } catch (e) {
      setEnviando(null);
      setAviso({
        ok: false,
        texto:
          (e as { code?: string }).code === 'permission-denied'
            ? 'A sessão terminou ou expirou. Não é possível enviar pedidos.'
            : 'Não foi possível enviar. Verifique a internet do celular e tente de novo.',
      });
    }
  }

  if (estado.tipo === 'carregando') {
    return (
      <div className="ctl">
        <div className="ctl-centro">
          <span className="spinner" aria-hidden /> Conectando ao totem…
        </div>
      </div>
    );
  }
  if (estado.tipo === 'encerrada' || estado.tipo === 'erro') {
    return (
      <div className="ctl">
        <div className="ctl-centro">
          <h1>{estado.tipo === 'erro' ? 'Não foi possível abrir a sessão' : 'Sessão encerrada ou link inválido'}</h1>
          <p className="texto-fraco">
            {estado.tipo === 'erro'
              ? 'Verifique a internet do celular e abra o link de novo.'
              : 'Para usar de novo, faça um novo pagamento no totem e leia o QR que aparece.'}
          </p>
        </div>
      </div>
    );
  }

  const c = estado.c;
  const expirou = c.expiraEm !== null && c.expiraEm.getTime() <= agora;
  const disponivel = c.ativa && !expirou;
  const travado = !disponivel || c.ocupado || enviando !== null;
  const status = [
    ['Confirmadas', c.statusConfirmados],
    ['Pendentes', c.statusPendentes],
    ['Limpeza', c.statusLimpeza],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  return (
    <div className="ctl">
      <header className="ctl-topo">
        <div className="ctl-marca">
          ScannPro <span>Sessão</span>
        </div>
        <div className="ctl-tempo" aria-live="polite">
          {disponivel && c.expiraEm ? (
            <>
              <small>Tempo restante</small>
              <strong>{tempoRestante(c.expiraEm, agora)}</strong>
            </>
          ) : (
            <strong>Sessão encerrada</strong>
          )}
        </div>
      </header>

      <main className="ctl-conteudo">
        <section className="ctl-cartoes">
          <div className="cartao ctl-numero">
            <strong>{c.escaneamentosRestantes ?? '—'}</strong>
            <small>escaneamentos restantes</small>
          </div>
          <div className="cartao ctl-numero">
            <strong>{c.impressoesRestantes ?? '—'}</strong>
            <small>impressões restantes</small>
          </div>
        </section>

        <section className="cartao ctl-situacao">
          <span className={c.sistemaOnline ? 'ctl-ok' : 'ctl-ruim'}>{c.sistemaOnline ? '● Totem online' : '● Totem offline'}</span>
          <span className={c.veiculoConectado ? 'ctl-ok' : 'ctl-ruim'}>
            {c.veiculoConectado ? '● Veículo conectado' : '● Veículo desconectado'}
          </span>
          {c.ocupado && <span className="ctl-ocupado">Totem trabalhando…</span>}
          {c.mensagem && <p className="ctl-mensagem">{c.mensagem}</p>}
        </section>

        <section className="ctl-botoes">
          <button type="button" className="botao" disabled={travado || !c.podeEscanear} onClick={() => void pedir('escanear')}>
            {enviando === 'escanear' ? 'Enviando…' : 'Escanear'}
          </button>
          <button type="button" className="botao botao-perigo" disabled={travado || !c.podeLimpar} onClick={() => void pedir('limpar')}>
            {enviando === 'limpar' ? 'Enviando…' : 'Limpar falhas'}
          </button>
          <button type="button" className="botao botao-secundario" disabled={travado || !c.podeImprimir} onClick={() => void pedir('imprimir')}>
            {enviando === 'imprimir' ? 'Enviando…' : 'Imprimir no totem'}
          </button>
          {aviso && <p className={aviso.ok ? 'msg msg-ok' : 'msg msg-erro'}>{aviso.texto}</p>}
        </section>

        {status.length > 0 && (
          <section className="cartao ctl-status">
            {status.map(([rotulo, v]) => (
              <div key={String(rotulo)}>
                <small>{String(rotulo)}</small>
                <strong>{texto(v)}</strong>
              </div>
            ))}
          </section>
        )}

        <section className="cartao">
          <h2>Falhas {c.dtcs.length > 0 && <span className="texto-fraco">({c.dtcs.length})</span>}</h2>
          {c.dtcs.length === 0 ? (
            <p className="texto-fraco">Nenhuma falha encontrada.</p>
          ) : (
            <ul className="ctl-lista">
              {c.dtcs.map((f, i) => (
                <li key={`${f.codigo}-${i}`} className="ctl-dtc">
                  <div className="ctl-dtc-topo">
                    <span className="mono">{f.codigo}</span>
                    {f.gravidade && <span className="selo-alerta">{f.gravidade}</span>}
                    {f.pendente && <span className="ctl-pendente">pendente</span>}
                  </div>
                  {f.titulo && <strong>{f.titulo}</strong>}
                  {f.descricao && <p>{f.descricao}</p>}
                  {f.causas.length > 0 && (
                    <>
                      <small className="texto-fraco">Causas prováveis</small>
                      <ul>
                        {f.causas.map((causa, j) => (
                          <li key={j}>{causa}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cartao">
          <h2>Sensores</h2>
          {c.sensores.length === 0 ? (
            <p className="texto-fraco">Sem leituras de sensores.</p>
          ) : (
            <ul className="ctl-sensores">
              {c.sensores.map((s, i) => (
                <li key={`${s.nome}-${i}`}>
                  <span>{s.nome}</span>
                  <strong>{s.valor === null ? '—' : `${formatarValor(s.valor)}${s.unidade ? ` ${s.unidade}` : ''}`}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
