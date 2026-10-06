import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDados } from '../dados';
import { definirAtivo } from '../operacoes';
import { BolinhaEstado, Carregando, Erro, Vazio } from '../componentes/Estados';
import { AvisoToken } from '../componentes/AvisoToken';
import { formatarReais } from '../lib/formato';
import type { Dispositivo } from '../tipos';

const FILTROS = {
  todos: { rotulo: 'Cadastrados', teste: () => true },
  ativos: { rotulo: 'Ativos', teste: (d: Dispositivo) => d.ativo },
  online: { rotulo: 'Online', teste: (d: Dispositivo) => d.online },
  offline: { rotulo: 'Offline', teste: (d: Dispositivo) => !d.online },
} as const;
type Filtro = keyof typeof FILTROS;

export function Dispositivos() {
  const { dispositivos, carregando, erro, vendasHoje, erroVendasHoje } = useDados();
  const [params, setParams] = useSearchParams();
  const filtro: Filtro = (params.get('filtro') as Filtro) in FILTROS ? (params.get('filtro') as Filtro) : 'todos';
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState<Set<string>>(new Set());
  const [erros, setErros] = useState<Record<string, string>>({});

  async function alternar(d: Dispositivo) {
    setSalvando((s) => new Set(s).add(d.idmaq));
    setErros(({ [d.idmaq]: _, ...resto }) => resto);
    try {
      await definirAtivo(d.idmaq, !d.ativo);
    } catch {
      setErros((e) => ({ ...e, [d.idmaq]: 'Não foi possível salvar. Tente de novo.' }));
    } finally {
      setSalvando((s) => {
        const n = new Set(s);
        n.delete(d.idmaq);
        return n;
      });
    }
  }

  if (carregando) return <Carregando />;
  if (erro) return <Erro onTentar={() => location.reload()}>{erro}</Erro>;

  const termo = busca.trim().toLowerCase();
  const lista = dispositivos.filter(
    (d) => FILTROS[filtro].teste(d) && (!termo || d.nome.toLowerCase().includes(termo) || d.idmaq.toLowerCase().includes(termo)),
  );

  return (
    <>
      <div className="titulo-linha">
        <h1 className="titulo">Dispositivos</h1>
        <Link to="/dispositivos/novo" className="botao">
          + Cadastrar dispositivo
        </Link>
      </div>
      <AvisoToken />

      <div className="filtros">
        {(Object.keys(FILTROS) as Filtro[]).map((f) => (
          <button
            key={f}
            type="button"
            className={f === filtro ? 'chip chip-ativo' : 'chip'}
            onClick={() => setParams(f === 'todos' ? {} : { filtro: f })}
          >
            {FILTROS[f].rotulo} ({dispositivos.filter(FILTROS[f].teste).length})
          </button>
        ))}
        <input className="busca" type="search" placeholder="Buscar por nome ou ID" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {erroVendasHoje && <p className="msg msg-erro">{erroVendasHoje}</p>}

      {dispositivos.length === 0 ? (
        <Vazio>
          Nenhum dispositivo cadastrado. <Link to="/dispositivos/novo">Cadastrar o primeiro</Link>
        </Vazio>
      ) : lista.length === 0 ? (
        <Vazio>Nenhum dispositivo neste filtro.</Vazio>
      ) : (
        <div className="cartao tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Estado</th>
                <th>Nome</th>
                <th>ID</th>
                <th className="num">Valor</th>
                <th className="num">Vendas hoje</th>
                <th>Ativo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => {
                const hoje = vendasHoje.get(d.idmaq);
                return (
                  <tr key={d.idmaq}>
                    <td>
                      <BolinhaEstado online={d.online} /> <span className="texto-fraco">{d.online ? 'Online' : 'Offline'}</span>
                    </td>
                    <td>{d.nome || <span className="texto-fraco">(sem nome)</span>}</td>
                    <td className="mono">{d.idmaq}</td>
                    <td className="num">{formatarReais(d.valor)}</td>
                    <td className="num">
                      {hoje ? (
                        <>
                          {formatarReais(hoje.total)} <span className="texto-fraco">({hoje.quantidade})</span>
                        </>
                      ) : (
                        <span className="texto-fraco">—</span>
                      )}
                    </td>
                    <td>
                      <label className="interruptor" title={d.ativo ? 'Desligar' : 'Ligar'}>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={d.ativo}
                          disabled={salvando.has(d.idmaq)}
                          onChange={() => void alternar(d)}
                          aria-label={`Ativo: ${d.nome || d.idmaq}`}
                        />
                        <span />
                      </label>
                      {erros[d.idmaq] && <div className="msg msg-erro">{erros[d.idmaq]}</div>}
                    </td>
                    <td>
                      <Link to={`/dispositivos/${d.idmaq}`}>Editar</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
