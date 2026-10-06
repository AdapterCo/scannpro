import { useAuth } from '../auth';

/** Conta que não é de cliente (ex.: login anônimo): não carrega nenhum dado. */
export function SemPermissao() {
  const { sair } = useAuth();
  return (
    <div className="login">
      <div className="cartao login-cartao">
        <h1>Sem permissão</h1>
        <p>Entre com o e-mail e a senha da sua conta de cliente.</p>
        <button type="button" className="botao" onClick={() => void sair()}>
          Sair
        </button>
      </div>
    </div>
  );
}
