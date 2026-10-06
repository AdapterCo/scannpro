import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from './firebase';

export type EstadoAuth =
  | { tipo: 'carregando' }
  | { tipo: 'deslogado' }
  /** conta que não é de cliente (ex.: login anônimo do equipamento) */
  | { tipo: 'semPermissao'; usuario: User }
  | { tipo: 'cliente'; usuario: User };

interface ValorAuth {
  estado: EstadoAuth;
  sair: () => Promise<void>;
}

const Contexto = createContext<ValorAuth | null>(null);

/**
 * Cada conta de e-mail e senha é um cliente (as contas são criadas pelo dono no console).
 * Não há admin: as regras do Firestore só entregam os dados com dono == uid.
 */
export function ProvedorAuth({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoAuth>({ tipo: 'carregando' });

  useEffect(
    () =>
      onAuthStateChanged(auth, (usuario) => {
        if (!usuario) setEstado({ tipo: 'deslogado' });
        else if (usuario.isAnonymous || !usuario.providerData.some((p) => p.providerId === 'password'))
          setEstado({ tipo: 'semPermissao', usuario });
        else setEstado({ tipo: 'cliente', usuario });
      }),
    [],
  );

  const sair = useCallback(() => signOut(auth), []);
  return <Contexto.Provider value={{ estado, sair }}>{children}</Contexto.Provider>;
}

export function useAuth(): ValorAuth {
  const v = useContext(Contexto);
  if (!v) throw new Error('useAuth fora do ProvedorAuth');
  return v;
}

/** Usuário logado; só usar dentro das telas protegidas. */
export function useUsuario(): User {
  const { estado } = useAuth();
  if (estado.tipo !== 'cliente') throw new Error('useUsuario sem cliente logado');
  return estado.usuario;
}

/** Mensagens em português para os erros mais comuns do Firebase Auth. */
export function mensagemErroAuth(code: string | undefined): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'E-mail ou senha incorretos.';
    case 'auth/user-disabled':
      return 'Este usuário está desativado.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
    case 'auth/network-request-failed':
      return 'Sem conexão com a internet.';
    default:
      return 'Não foi possível entrar. Tente de novo.';
  }
}
