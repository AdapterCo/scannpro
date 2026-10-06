import { Link } from 'react-router-dom';
import { useDados } from '../dados';

/** Seção 5, item 5: sem token configurado, o painel avisa que os dispositivos não conseguem cobrar. */
export function AvisoToken() {
  const { cliente } = useDados();
  if (!cliente || cliente.tokenMPFinal) return null;
  return (
    <div className="aviso" role="alert">
      <strong>Token do Mercado Pago não configurado.</strong> Sem ele seus dispositivos não conseguem cobrar.{' '}
      <Link to="/conta">Configurar agora</Link>
    </div>
  );
}
