import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDados } from '../dados';
import { cadastrarDispositivo, editarDispositivo, ErroDeValidacao, excluirDispositivo, MSG_JA_CADASTRADO } from '../operacoes';
import { BolinhaEstado, Carregando, Erro } from '../componentes/Estados';
import { centavosParaTexto, formatarDataHora, idmaqValido, normalizarIdmaq, reaisParaCentavos } from '../lib/formato';

const VALOR_MAXIMO = 100_000_00; // R$ 100.000,00

export function DispositivoForm() {
  const { idmaq: idmaqRota } = useParams();
  const novo = idmaqRota === undefined;
  const navegar = useNavigate();
  const { uid, dispositivos, carregando, erro } = useDados();
  const existente = novo ? undefined : dispositivos.find((d) => d.idmaq === idmaqRota);

  const [idmaq, setIdmaq] = useState('');
  const [nome, setNome] = useState('');
  const [valor, setValor] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [preenchido, setPreenchido] = useState(novo);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Preenche o formulário uma vez; atualizações em tempo real depois disso não apagam o que o cliente digitou.
  useEffect(() => {
    if (!preenchido && existente) {
      setIdmaq(existente.idmaq);
      setNome(existente.nome);
      setValor(centavosParaTexto(existente.valor));
      setAtivo(existente.ativo);
      setPreenchido(true);
    }
  }, [existente, preenchido]);

  if (carregando) return <Carregando />;
  if (erro) return <Erro onTentar={() => location.reload()}>{erro}</Erro>;
  if (!novo && !existente && salvando) return <Carregando texto="Excluindo…" />;
  if (!novo && !existente) {
    return (
      <Erro>
        Dispositivo {idmaqRota} não encontrado. <Link to="/dispositivos">Voltar para a lista</Link>
      </Erro>
    );
  }

  /** Formato e duplicidade entre os dispositivos do próprio cliente; o de outro cliente só as regras detectam. */
  function erroDoIdmaq(id: string): string | undefined {
    if (!id) return 'Informe o ID mostrado na tela do equipamento.';
    if (!idmaqValido(id)) return 'Formato inválido. Use XXXX-XXXX (0-9 e A-F), como aparece no equipamento.';
    if (dispositivos.some((d) => d.idmaq === id)) return 'Este dispositivo já está na sua lista.';
    return undefined;
  }

  function validar() {
    const e: Record<string, string> = {};
    if (novo) {
      const msg = erroDoIdmaq(idmaq);
      if (msg) e.idmaq = msg;
    }
    if (!nome.trim()) e.nome = 'Informe um nome para identificar o dispositivo.';
    else if (nome.trim().length > 60) e.nome = 'Use no máximo 60 caracteres.';
    const centavos = reaisParaCentavos(valor);
    if (centavos === null) e.valor = 'Valor inválido. Exemplo: 20,00';
    else if (centavos <= 0) e.valor = 'O valor precisa ser maior que zero.';
    else if (centavos > VALOR_MAXIMO) e.valor = 'Valor alto demais.';
    return { e, centavos };
  }

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    setErroGeral(null);
    const { e, centavos } = validar();
    setErros(e);
    if (Object.keys(e).length > 0 || centavos === null) return;
    setSalvando(true);
    const dados = { nome: nome.trim(), valor: centavos, ativo };
    try {
      if (novo) await cadastrarDispositivo(uid, idmaq, dados);
      else await editarDispositivo(idmaqRota!, dados);
      navegar('/dispositivos');
    } catch (err) {
      setSalvando(false);
      if (err instanceof ErroDeValidacao) {
        if (err.message === MSG_JA_CADASTRADO) setErros({ idmaq: `${MSG_JA_CADASTRADO}.` });
        else setErroGeral(err.message);
      } else if ((err as { code?: string }).code === 'permission-denied') setErroGeral('Sem permissão para salvar.');
      else if ((err as { code?: string }).code === 'not-found') setErroGeral('Este dispositivo foi excluído.');
      else setErroGeral('Não foi possível salvar. Verifique a conexão e tente de novo.');
    }
  }

  async function excluir() {
    if (!existente) return;
    const ok = window.confirm(
      `Excluir o dispositivo "${existente.nome || existente.idmaq}" (${existente.idmaq})?\n\n` +
        'O equipamento volta para "Aguardando ativação" e o ID fica livre para ser cadastrado de novo. As vendas continuam no relatório.',
    );
    if (!ok) return;
    setSalvando(true);
    try {
      await excluirDispositivo(existente.idmaq);
      navegar('/dispositivos');
    } catch {
      setSalvando(false);
      setErroGeral('Não foi possível excluir. Tente de novo.');
    }
  }

  return (
    <>
      <p>
        <Link to="/dispositivos">← Dispositivos</Link>
      </p>
      <h1 className="titulo">{novo ? 'Cadastrar dispositivo' : existente!.nome || existente!.idmaq}</h1>

      {existente && (
        <p className="texto-fraco">
          <BolinhaEstado online={existente.online} /> {existente.online ? 'Online' : 'Offline'}
          {existente.ultimoSinal && ` · último sinal ${formatarDataHora(existente.ultimoSinal)}`}
          {existente.criadoEm && ` · cadastrado em ${formatarDataHora(existente.criadoEm)}`}
        </p>
      )}

      <form className="cartao formulario" onSubmit={salvar} noValidate>
        <label>
          ID do dispositivo (idmaq)
          <input
            className="mono"
            value={idmaq}
            disabled={!novo}
            placeholder="3F9A-12C0"
            maxLength={9}
            autoComplete="off"
            onChange={(e) => setIdmaq(normalizarIdmaq(e.target.value))}
            onBlur={() => novo && idmaq && setErros((x) => ({ ...x, idmaq: erroDoIdmaq(idmaq) ?? '' }))}
            aria-invalid={!!erros.idmaq}
          />
          {novo && <small>Aparece na tela do equipamento como "ID deste equipamento". Quem cadastrar primeiro fica com ele.</small>}
          {erros.idmaq && <span className="msg msg-erro">{erros.idmaq}</span>}
        </label>

        <label>
          Nome
          <input value={nome} maxLength={60} placeholder="Totem entrada" onChange={(e) => setNome(e.target.value)} aria-invalid={!!erros.nome} />
          {erros.nome && <span className="msg msg-erro">{erros.nome}</span>}
        </label>

        <label>
          Valor da sessão (R$)
          <input inputMode="decimal" value={valor} placeholder="20,00" onChange={(e) => setValor(e.target.value)} aria-invalid={!!erros.valor} />
          {erros.valor && <span className="msg msg-erro">{erros.valor}</span>}
        </label>

        <label className="linha-interruptor">
          <span className="interruptor">
            <input type="checkbox" role="switch" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            <span />
          </span>
          Ativo (o equipamento sai de "Aguardando ativação" e passa a cobrar)
        </label>

        {erroGeral && (
          <p className="msg msg-erro" role="alert">
            {erroGeral}
          </p>
        )}

        <div className="acoes">
          <button type="submit" className="botao" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          <Link to="/dispositivos" className="botao botao-secundario">
            Cancelar
          </Link>
          {!novo && (
            <button type="button" className="botao botao-perigo empurra-direita" disabled={salvando} onClick={() => void excluir()}>
              Excluir dispositivo
            </button>
          )}
        </div>
      </form>
    </>
  );
}
