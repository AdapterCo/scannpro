import { useState, type FormEvent } from 'react';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { mensagemErroAuth } from '../auth';

export function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    setEnviando(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), senha);
    } catch (err) {
      setErro(mensagemErroAuth((err as { code?: string }).code));
      setEnviando(false);
    }
  }

  async function esqueci() {
    setErro(null);
    setAviso(null);
    if (!email.trim()) {
      setErro('Digite seu e-mail para receber o link de redefinição.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/network-request-failed' || code === 'auth/too-many-requests') {
        setErro(mensagemErroAuth(code));
        return;
      }
    }
    // Mesma mensagem com ou sem conta: não revela quais e-mails existem.
    setAviso('Se este e-mail tiver acesso, você receberá um link para criar uma nova senha.');
  }

  return (
    <div className="login">
      <form className="cartao login-cartao" onSubmit={entrar}>
        <h1>
          ScannPro <span>Painel</span>
        </h1>
        <label>
          E-mail
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Senha
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
        {erro && (
          <p className="msg msg-erro" role="alert">
            {erro}
          </p>
        )}
        {aviso && <p className="msg msg-ok">{aviso}</p>}
        <button type="submit" className="botao" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        <button type="button" className="botao botao-link" onClick={() => void esqueci()}>
          Esqueci a senha
        </button>
      </form>
    </div>
  );
}
