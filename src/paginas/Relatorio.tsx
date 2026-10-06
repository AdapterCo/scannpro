import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDados } from '../dados';
import { buscarVendas } from '../operacoes';
import { Carregando, Erro, Vazio } from '../componentes/Estados';
import {
  centavosParaTexto,
  diaParaISO,
  diaSP,
  formatarDataHora,
  formatarReais,
  gerarCSV,
  intervaloDoPeriodo,
  resumir,
  resumirPorMaquina,
  type Periodo,
} from '../lib/formato';
import type { Venda } from '../tipos';

const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: '7dias', rotulo: 'Últimos 7 dias' },
  { valor: '30dias', rotulo: 'Últimos 30 dias' },
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'livre', rotulo: 'Intervalo' },
];

type Resultado = { tipo: 'carregando' } | { tipo: 'erro'; mensagem: string; link?: string } | { tipo: 'ok'; vendas: Venda[] };

function baixar(nomeArquivo: string, conteudo: string) {
  // BOM para o Excel abrir acentos corretamente
  const url = URL.createObjectURL(new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

export function Relatorio() {
  const { uid, dispositivos } = useDados();
  const [params, setParams] = useSearchParams();
  const maquina = params.get('maquina') ?? '';
  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  const hojeISO = diaParaISO(diaSP(new Date()));
  const [de, setDe] = useState(hojeISO);
  const [ate, setAte] = useState(hojeISO);
  const [tentativa, setTentativa] = useState(0);
  const [resultado, setResultado] = useState<Resultado>({ tipo: 'carregando' });

  const intervalo = useMemo(() => intervaloDoPeriodo(periodo, new Date(), de, ate), [periodo, de, ate, tentativa]);
  const nomes = useMemo(() => new Map(dispositivos.map((d) => [d.idmaq, d.nome])), [dispositivos]);
  const nomeDe = (id: string) => (nomes.has(id) ? nomes.get(id) || id : `${id} (excluído)`);

  useEffect(() => {
    if (!intervalo) return;
    let cancelado = false;
    setResultado({ tipo: 'carregando' });
    buscarVendas(uid, intervalo, maquina || undefined)
      .then((vendas) => !cancelado && setResultado({ tipo: 'ok', vendas }))
      .catch((e: { code?: string; message?: string }) => {
        if (cancelado) return;
        if (e.code === 'failed-precondition') {
          // O serviço cria o índice ao iniciar; o Firestore leva alguns minutos para deixá-lo pronto.
          setResultado({
            tipo: 'erro',
            mensagem: 'O índice das vendas está sendo preparado pelo Firestore (leva alguns minutos). Tente de novo em instantes.',
          });
        } else {
          setResultado({ tipo: 'erro', mensagem: 'Não foi possível carregar as vendas. Verifique a conexão.' });
        }
      });
    return () => {
      cancelado = true;
    };
  }, [uid, intervalo, maquina]);

  const vendas = resultado.tipo === 'ok' ? resultado.vendas : [];
  const resumo = resumir(vendas);
  const porMaquina = [...resumirPorMaquina(vendas)].sort((a, b) => b[1].total - a[1].total);
  const sufixo = intervalo ? `${diaParaISO(diaSP(intervalo.inicio))}_a_${diaParaISO(diaSP(new Date(intervalo.fim.getTime() - 1)))}` : '';

  function exportarVendas() {
    const csv = gerarCSV(
      ['data', 'idmaq', 'dispositivo', 'valor', 'idPagamento'],
      vendas.map((v) => [formatarDataHora(v.data), v.idmaq, nomeDe(v.idmaq), centavosParaTexto(v.valor), v.idPagamento]),
    );
    baixar(`vendas_${maquina || 'todas'}_${sufixo}.csv`, csv);
  }

  function exportarResumo() {
    const csv = gerarCSV(
      ['idmaq', 'dispositivo', 'quantidade', 'total'],
      [
        ...porMaquina.map(([id, r]) => [id, nomeDe(id), r.quantidade, centavosParaTexto(r.total)]),
        ['', 'TOTAL GERAL', resumo.quantidade, centavosParaTexto(resumo.total)],
      ],
    );
    baixar(`resumo_por_dispositivo_${sufixo}.csv`, csv);
  }

  return (
    <>
      <h1 className="titulo">Relatório de vendas</h1>

      <div className="cartao filtros-relatorio">
        <label>
          Dispositivo
          <select value={maquina} onChange={(e) => setParams(e.target.value ? { maquina: e.target.value } : {})}>
            <option value="">Todos os meus dispositivos</option>
            {dispositivos.map((d) => (
              <option key={d.idmaq} value={d.idmaq}>
                {d.nome || d.idmaq} ({d.idmaq})
              </option>
            ))}
          </select>
        </label>
        <label>
          Período
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
            {PERIODOS.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </label>
        {periodo === 'livre' && (
          <>
            <label>
              De
              <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
            </label>
            <label>
              Até
              <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
            </label>
          </>
        )}
        <button type="button" className="botao botao-secundario" onClick={() => setTentativa((n) => n + 1)}>
          Atualizar
        </button>
      </div>

      {!intervalo ? (
        <Erro>Escolha um intervalo válido (a data inicial não pode ser depois da final).</Erro>
      ) : resultado.tipo === 'carregando' ? (
        <Carregando texto="Carregando vendas…" />
      ) : resultado.tipo === 'erro' ? (
        <Erro onTentar={() => setTentativa((n) => n + 1)}>
          {resultado.mensagem}{' '}
          {resultado.link && (
            <a href={resultado.link} target="_blank" rel="noreferrer">
              criar índice
            </a>
          )}
        </Erro>
      ) : (
        <>
          <p className="texto-fraco">
            {formatarDataHora(intervalo.inicio)} a {formatarDataHora(new Date(intervalo.fim.getTime() - 60_000))} (horário de Brasília)
          </p>
          <div className="cartoes">
            <div className="cartao contador">
              <span className="contador-num">{formatarReais(resumo.total)}</span>
              <span className="contador-rotulo">Total vendido</span>
            </div>
            <div className="cartao contador">
              <span className="contador-num">{resumo.quantidade}</span>
              <span className="contador-rotulo">Vendas</span>
            </div>
            <div className="cartao contador">
              <span className="contador-num">{formatarReais(resumo.ticketMedio)}</span>
              <span className="contador-rotulo">Ticket médio</span>
            </div>
          </div>

          {vendas.length === 0 ? (
            <Vazio>Nenhuma venda neste período.</Vazio>
          ) : (
            <>
              {!maquina && (
                <section className="cartao tabela-rolagem">
                  <div className="titulo-linha">
                    <h2>Por dispositivo</h2>
                    <button type="button" className="botao botao-secundario" onClick={exportarResumo}>
                      Exportar resumo (CSV)
                    </button>
                  </div>
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Dispositivo</th>
                        <th>ID</th>
                        <th className="num">Vendas</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {porMaquina.map(([id, r]) => (
                        <tr key={id}>
                          <td>
                            <button type="button" className="botao-link" onClick={() => setParams({ maquina: id })}>
                              {nomeDe(id)}
                            </button>
                          </td>
                          <td className="mono">{id}</td>
                          <td className="num">{r.quantidade}</td>
                          <td className="num">{formatarReais(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={2}>Total geral</th>
                        <th className="num">{resumo.quantidade}</th>
                        <th className="num">{formatarReais(resumo.total)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </section>
              )}

              <section className="cartao tabela-rolagem">
                <div className="titulo-linha">
                  <h2>Vendas</h2>
                  <button type="button" className="botao botao-secundario" onClick={exportarVendas}>
                    Exportar vendas (CSV)
                  </button>
                </div>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Data</th>
                      {!maquina && <th>Dispositivo</th>}
                      <th className="num">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendas.map((v) => (
                      <tr key={v.idPagamento}>
                        <td>{formatarDataHora(v.data)}</td>
                        {!maquina && <td>{nomeDe(v.idmaq)}</td>}
                        <td className="num">{formatarReais(v.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={maquina ? 1 : 2}>Total ({resumo.quantidade})</th>
                      <th className="num">{formatarReais(resumo.total)}</th>
                    </tr>
                  </tfoot>
                </table>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
