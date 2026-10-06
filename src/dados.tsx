import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, doc, onSnapshot, orderBy, query, where, Timestamp, type DocumentData } from 'firebase/firestore';
import { db } from './firebase';
import { useUsuario } from './auth';
import { intervaloDoPeriodo, resumirPorMaquina, diaParaISO, diaSP, type Resumo } from './lib/formato';
import type { Cliente, Dispositivo } from './tipos';

function paraData(v: unknown): Date | null {
  return v instanceof Timestamp ? v.toDate() : null;
}

export function lerDispositivo(id: string, d: DocumentData): Dispositivo {
  return {
    idmaq: typeof d.idmaq === 'string' ? d.idmaq : id,
    dono: typeof d.dono === 'string' ? d.dono : '',
    nome: typeof d.nome === 'string' ? d.nome : '',
    valor: typeof d.valor === 'number' ? d.valor : 0,
    ativo: d.ativo === true,
    online: d.online === true,
    ultimoSinal: paraData(d.ultimoSinal),
    criadoEm: paraData(d.criadoEm),
  };
}

/** Relógio que avança a cada 30 s: atualiza "há X min" e a virada do dia. */
export function useAgora(intervaloMs = 30_000): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return agora;
}

interface ValorDados {
  uid: string;
  dispositivos: Dispositivo[];
  carregando: boolean;
  erro: string | null;
  /** null enquanto carrega */
  cliente: Cliente | null;
  vendasHoje: Map<string, Resumo>;
  erroVendasHoje: string | null;
}

const Contexto = createContext<ValorDados | null>(null);

/**
 * Escutas em tempo real dos dados do cliente logado, compartilhadas por todas as telas.
 * Toda consulta de lista filtra dono == uid (sem isso o Firestore recusa).
 */
export function ProvedorDados({ children }: { children: ReactNode }) {
  const usuario = useUsuario();
  const uid = usuario.uid;
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [vendasHoje, setVendasHoje] = useState<Map<string, Resumo>>(new Map());
  const [erroVendasHoje, setErroVendasHoje] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'dispositivos'), where('dono', '==', uid)),
        (snap) => {
          const lista = snap.docs.map((d) => lerDispositivo(d.id, d.data()));
          lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.idmaq.localeCompare(b.idmaq));
          setDispositivos(lista);
          setCarregando(false);
          setErro(null);
        },
        (e) => {
          setCarregando(false);
          setErro(e.code === 'permission-denied' ? 'Sem permissão para ler os dispositivos.' : 'Erro de conexão ao carregar os dispositivos.');
        },
      ),
    [uid],
  );

  // clientes/{uid} pode ainda não existir (cliente novo, sem token salvo).
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'clientes', uid),
        (snap) => {
          const d = snap.data() ?? {};
          setCliente({
            email: typeof d.email === 'string' ? d.email : (usuario.email ?? ''),
            nome: typeof d.nome === 'string' ? d.nome : '',
            tokenMPFinal: typeof d.tokenMPFinal === 'string' && d.tokenMPFinal ? d.tokenMPFinal : null,
          });
        },
        () => setCliente({ email: usuario.email ?? '', nome: '', tokenMPFinal: null }),
      ),
    [uid, usuario.email],
  );

  // A escuta das vendas de hoje é refeita quando o dia muda em São Paulo.
  const agora = useAgora(60_000);
  const hojeISO = diaParaISO(diaSP(agora));
  useEffect(() => {
    const { inicio, fim } = intervaloDoPeriodo('hoje', new Date())!;
    const q = query(
      collection(db, 'vendas'),
      where('dono', '==', uid),
      where('data', '>=', Timestamp.fromDate(inicio)),
      where('data', '<', Timestamp.fromDate(fim)),
      orderBy('data', 'desc'),
    );
    return onSnapshot(
      q,
      (snap) => {
        const vendas = snap.docs.map((d) => ({ idmaq: String(d.get('idmaq')), valor: Number(d.get('valor')) || 0 }));
        setVendasHoje(resumirPorMaquina(vendas));
        setErroVendasHoje(null);
      },
      () => setErroVendasHoje('Não foi possível carregar as vendas de hoje.'),
    );
  }, [uid, hojeISO]);

  const valor = useMemo(
    () => ({ uid, dispositivos, carregando, erro, cliente, vendasHoje, erroVendasHoje }),
    [uid, dispositivos, carregando, erro, cliente, vendasHoje, erroVendasHoje],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useDados(): ValorDados {
  const v = useContext(Contexto);
  if (!v) throw new Error('useDados fora do ProvedorDados');
  return v;
}

export interface Contadores {
  cadastrados: number;
  ativos: number;
  online: number;
  offline: number;
}

/** Definições da seção 5: Offline = Cadastrados − Online. */
export function contar(lista: readonly Dispositivo[]): Contadores {
  const cadastrados = lista.length;
  const ativos = lista.filter((d) => d.ativo).length;
  const online = lista.filter((d) => d.online).length;
  return { cadastrados, ativos, online, offline: cadastrados - online };
}
