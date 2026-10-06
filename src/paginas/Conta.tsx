import { useEffect, useState, type FormEvent } from 'react';
import { useDados } from '../dados';
import { useUsuario } from '../auth';
import { removerToken, salvarNomeCliente, salvarToken } from '../operacoes';
import { Carregando } from '../componentes/Estados';

/** Seção 5, item 5: dados da conta e token do Mercado Pago (um por cliente). */
export function Conta() {
  const usuario = useUsuario();
  const { uid, cliente } = useDados();
  const email = usuario.email ?? '';

  const [nome, setNome] = useState('');
  const [nomeCarregado, setNomeCarregado] = useState(false);
  const [msgNome, setMsgNome] = useState<{ ok: boolean; texto: string } | null>(null);
  const [token, setToken] = useState('');
  const [erroToken, setErroToken] = useState<string | null>(null);
  const [msgToken, setMsgToken] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (cliente && !nomeCarregado) {
      setNome(cliente.nome);
      setNomeCarregado(true);
    }
  }, [cliente, nomeCarregado]);

  if (!cliente) return <Carregando />;

  async function gravarNome(e: FormEvent) {
    e.preventDefault();
    setMsgNome(null);
    try {
      await salvarNomeCliente(uid, email, nome.trim().slice(0, 80));
      setMsgNome({ ok: true, texto: 'Nome salvo.' });
    } catch {
      setMsgNome({ ok: false, texto: 'Não foi possível salvar. Tente de novo.' });
    }
  }

  async function gravarToken(e: FormEvent) {
    e.preventDefault();
    setMsgToken(null);
    if (!token) return setErroToken('Cole o Access Token do Mercado Pago.');
    if (/\s/.test(token)) return setErroToken('O token não pode ter espaços.');
    if (token.length < 8) return setErroToken('Token curto demais. Cole o Access Token completo.');
    setErroToken(null);
    setSalvando(true);
    try {
      await salvarToken(uid, email, token);
      setToken('');
      setMsgToken({ ok: true, texto: 'Token salvo. Todos os seus dispositivos passam a cobrar nesta conta.' });
    } catch {
      setMsgToken({ ok: false, texto: 'Não foi possível salvar o token. Tente de novo.' });
    } finally {
      setSalvando(false);
    }
  }

  async function apagarToken() {
    if (!window.confirm('Apagar o token do Mercado Pago? Seus dispositivos deixam de conseguir cobrar.')) return;
    setMsgToken(null);
    try {
      await removerToken(uid, email);
      setMsgToken({ ok: true, texto: 'Token apagado.' });
    } catch {
      setMsgToken({ ok: false, texto: 'Não foi possível apagar o token. Tente de novo.' });
    }
  }

  return (
    <>
      <h1 className="titulo">Conta</h1>

      <form className="cartao formulario" onSubmit={gravarNome}>
        <h2>Dados</h2>
        <label>
          E-mail
          <input value={email} disabled />
        </label>
        <label>
          Nome (aparece no topo do painel)
          <input value={nome} maxLength={80} placeholder="Lava-rápido Centro" onChange={(e) => setNome(e.target.value)} />
        </label>
        {msgNome && <p className={msgNome.ok ? 'msg msg-ok' : 'msg msg-erro'}>{msgNome.texto}</p>}
        <div className="acoes">
          <button type="submit" className="botao botao-secundario">
            Salvar nome
          </button>
        </div>
      </form>

      <form className="cartao formulario" onSubmit={gravarToken} noValidate>
        <h2>Token do Mercado Pago</h2>
        <p className="texto-fraco">
          Um token para todos os seus dispositivos: as vendas caem na sua conta do Mercado Pago. Ele é guardado só para escrita e nunca é
          mostrado de novo.
        </p>
        <p>
          Situação:{' '}
          {cliente.tokenMPFinal ? (
            <>
              configurado <span className="mono">({cliente.tokenMPFinal})</span>
            </>
          ) : (
            <span className="selo-alerta">não configurado: seus dispositivos não conseguem cobrar</span>
          )}
        </p>
        <label>
          {cliente.tokenMPFinal ? 'Trocar token (Access Token)' : 'Access Token'}
          <input
            type="password"
            className="mono"
            value={token}
            autoComplete="new-password"
            placeholder="APP_USR-… ou TEST-…"
            onChange={(e) => setToken(e.target.value.trim())}
            aria-invalid={!!erroToken}
          />
          {erroToken && <span className="msg msg-erro">{erroToken}</span>}
        </label>
        {msgToken && <p className={msgToken.ok ? 'msg msg-ok' : 'msg msg-erro'}>{msgToken.texto}</p>}
        <div className="acoes">
          <button type="submit" className="botao" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar token'}
          </button>
          {cliente.tokenMPFinal && (
            <button type="button" className="botao botao-perigo empurra-direita" onClick={() => void apagarToken()}>
              Apagar token
            </button>
          )}
        </div>
      </form>
    </>
  );
}
