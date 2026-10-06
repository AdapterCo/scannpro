import { Link } from 'react-router-dom';
import { contar, useAgora, useDados } from '../dados';
import { Carregando, Erro, Vazio } from '../componentes/Estados';
import { AvisoToken } from '../componentes/AvisoToken';
import { formatarDataHora, formatarReais, tempoDesde } from '../lib/formato';

export function Painel() {
  const { dispositivos, carregando, erro, vendasHoje } = useDados();
  const agora = useAgora();

  if (carregando) return <Carregando />;
  if (erro) return <Erro onTentar={() => location.reload()}>{erro}</Erro>;

  const c = contar(dispositivos);
  const foraDoAr = dispositivos
    .filter((d) => d.ativo && !d.online)
    .sort((a, b) => (a.ultimoSinal?.getTime() ?? 0) - (b.ultimoSinal?.getTime() ?? 0));
  const totalHoje = [...vendasHoje.values()].reduce((s, r) => s + r.total, 0);
  const qtdHoje = [...vendasHoje.values()].reduce((s, r) => s + r.quantidade, 0);

  return (
    <>
      <h1 className="titulo">Painel</h1>
      <AvisoToken />
      <div className="cartoes">
        <Link to="/dispositivos" className="cartao contador">
          <span className="contador-num">{c.cadastrados}</span>
          <span className="contador-rotulo">Cadastrados</span>
        </Link>
        <Link to="/dispositivos?filtro=ativos" className="cartao contador contador-ativas">
          <span className="contador-num">{c.ativos}</span>
          <span className="contador-rotulo">Ativos</span>
        </Link>
        <Link to="/dispositivos?filtro=online" className="cartao contador contador-online">
          <span className="contador-num">{c.online}</span>
          <span className="contador-rotulo">Online</span>
        </Link>
        <Link to="/dispositivos?filtro=offline" className="cartao contador contador-offline">
          <span className="contador-num">{c.offline}</span>
          <span className="contador-rotulo">Offline</span>
        </Link>
      </div>

      <p className="texto-fraco">
        Vendas de hoje: <strong>{formatarReais(totalHoje)}</strong> em {qtdHoje} {qtdHoje === 1 ? 'venda' : 'vendas'} ·{' '}
        <Link to="/relatorio">ver relatório</Link>
      </p>

      <section className="cartao">
        <h2>Ativos fora do ar</h2>
        {c.cadastrados === 0 ? (
          <Vazio>
            Nenhum dispositivo cadastrado. <Link to="/dispositivos/novo">Cadastrar o primeiro</Link>
          </Vazio>
        ) : foraDoAr.length === 0 ? (
          <Vazio>Todos os dispositivos ativos estão online.</Vazio>
        ) : (
          <ul className="lista-simples">
            {foraDoAr.map((d) => (
              <li key={d.idmaq}>
                <Link to={`/dispositivos/${d.idmaq}`}>
                  <span className="bolinha bolinha-off" aria-hidden /> <strong>{d.nome || d.idmaq}</strong>{' '}
                  <span className="mono texto-fraco">{d.idmaq}</span>
                </Link>
                <span className="texto-fraco">
                  {d.ultimoSinal
                    ? `offline desde ${formatarDataHora(d.ultimoSinal)} (${tempoDesde(d.ultimoSinal, agora)})`
                    : 'nunca se conectou'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
