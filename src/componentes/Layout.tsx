import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { useDados } from '../dados';
import { usandoEmulador } from '../firebase';

export function Layout() {
  const { estado, sair } = useAuth();
  const { cliente } = useDados();
  const email = estado.tipo === 'cliente' ? estado.usuario.email : '';

  return (
    <div className="app">
      <header className="topo">
        <div className="topo-marca">
          ScannPro <span>Painel</span>
          {usandoEmulador && <span className="selo-emulador">emulador</span>}
        </div>
        <nav className="topo-nav">
          <NavLink to="/" end>
            Painel
          </NavLink>
          <NavLink to="/dispositivos">Dispositivos</NavLink>
          <NavLink to="/relatorio">Relatório</NavLink>
          <NavLink to="/conta">Conta</NavLink>
        </nav>
        <div className="topo-usuario">
          <span className="topo-email">{cliente?.nome || email}</span>
          <button type="button" className="botao botao-link" onClick={() => void sair()}>
            Sair
          </button>
        </div>
      </header>
      <main className="conteudo">
        <Outlet />
      </main>
    </div>
  );
}
