import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { ProvedorDados } from './dados';
import { Layout } from './componentes/Layout';
import { Carregando } from './componentes/Estados';
import { Login } from './paginas/Login';
import { SemPermissao } from './paginas/SemPermissao';
import { Painel } from './paginas/Painel';
import { Dispositivos } from './paginas/Dispositivos';
import { DispositivoForm } from './paginas/DispositivoForm';
import { Relatorio } from './paginas/Relatorio';
import { Conta } from './paginas/Conta';

export function App() {
  const { estado } = useAuth();

  if (estado.tipo === 'carregando') return <Carregando tela />;
  if (estado.tipo === 'deslogado') return <Login />;
  if (estado.tipo === 'semPermissao') return <SemPermissao />;

  // key: ao trocar de conta, todas as escutas e estados são recriados do zero.
  return (
    <ProvedorDados key={estado.usuario.uid}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Painel />} />
          <Route path="dispositivos" element={<Dispositivos />} />
          <Route path="dispositivos/novo" element={<DispositivoForm />} />
          <Route path="dispositivos/:idmaq" element={<DispositivoForm />} />
          <Route path="relatorio" element={<Relatorio />} />
          <Route path="conta" element={<Conta />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ProvedorDados>
  );
}
