import type { ReactNode } from 'react';

export function Carregando({ tela = false, texto = 'Carregando…' }: { tela?: boolean; texto?: string }) {
  return (
    <div className={tela ? 'estado estado-tela' : 'estado'} role="status">
      <span className="spinner" aria-hidden /> {texto}
    </div>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="estado estado-vazio">{children}</div>;
}

export function Erro({ children, onTentar }: { children: ReactNode; onTentar?: () => void }) {
  return (
    <div className="estado estado-erro" role="alert">
      <span>{children}</span>
      {onTentar && (
        <button type="button" className="botao botao-secundario" onClick={onTentar}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function BolinhaEstado({ online }: { online: boolean }) {
  return (
    <span className={online ? 'bolinha bolinha-on' : 'bolinha bolinha-off'} title={online ? 'Online' : 'Offline'}>
      <span className="sr">{online ? 'Online' : 'Offline'}</span>
    </span>
  );
}
