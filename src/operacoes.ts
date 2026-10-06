import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { finalDoToken, idmaqValido, type Intervalo } from './lib/formato';
import type { Venda } from './tipos';

export class ErroDeValidacao extends Error {}

export const MSG_JA_CADASTRADO = 'Este dispositivo já está cadastrado';

export interface DadosDispositivo {
  nome: string;
  valor: number; // centavos, inteiro > 0
  ativo: boolean;
}

/**
 * Cadastra (valida) o dispositivo para o cliente: o primeiro que cadastrar fica com ele.
 * Não dá para ler antes (o documento de outro cliente é invisível), então grava direto:
 * se o ID já existir, a gravação vira "update" e as regras recusam com permission-denied.
 */
export async function cadastrarDispositivo(uid: string, idmaq: string, dados: DadosDispositivo): Promise<void> {
  if (!idmaqValido(idmaq)) throw new ErroDeValidacao('ID fora do formato XXXX-XXXX.');
  try {
    await setDoc(doc(db, 'dispositivos', idmaq), {
      idmaq,
      dono: uid,
      nome: dados.nome,
      valor: dados.valor,
      ativo: dados.ativo,
      criadoEm: serverTimestamp(),
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') throw new ErroDeValidacao(MSG_JA_CADASTRADO);
    throw e;
  }
}

/** Atualiza nome, valor e ativo. Nunca toca dono, idmaq, online ou ultimoSinal. */
export async function editarDispositivo(idmaq: string, dados: DadosDispositivo): Promise<void> {
  await updateDoc(doc(db, 'dispositivos', idmaq), { nome: dados.nome, valor: dados.valor, ativo: dados.ativo });
}

export async function definirAtivo(idmaq: string, ativo: boolean): Promise<void> {
  await updateDoc(doc(db, 'dispositivos', idmaq), { ativo });
}

/** Exclui o dispositivo; o ID fica livre para ser cadastrado de novo. As vendas continuam no histórico. */
export async function excluirDispositivo(idmaq: string): Promise<void> {
  await deleteDoc(doc(db, 'dispositivos', idmaq));
}

/** Nome do cliente em clientes/{uid}. */
export async function salvarNomeCliente(uid: string, email: string, nome: string): Promise<void> {
  await setDoc(doc(db, 'clientes', uid), { email, nome }, { merge: true });
}

/**
 * Token do Mercado Pago do cliente (um para todos os dispositivos dele):
 * segredos/{uid} (somente escrita) e clientes/{uid}.tokenMPFinal no mesmo lote.
 */
export async function salvarToken(uid: string, email: string, token: string): Promise<void> {
  const lote = writeBatch(db);
  lote.set(doc(db, 'segredos', uid), { tokenMP: token });
  lote.set(doc(db, 'clientes', uid), { email, tokenMPFinal: finalDoToken(token) }, { merge: true });
  await lote.commit();
}

/** Apaga o token (segredos não pode ser apagado pelo app, só esvaziado). */
export async function removerToken(uid: string, email: string): Promise<void> {
  const lote = writeBatch(db);
  lote.set(doc(db, 'segredos', uid), { tokenMP: '' });
  lote.set(doc(db, 'clientes', uid), { email, tokenMPFinal: deleteField() }, { merge: true });
  await lote.commit();
}

/**
 * Vendas do cliente no intervalo, mais recentes primeiro. Usa os índices compostos
 * (dono, data desc) e (dono, idmaq, data desc) de firestore.indexes.json.
 */
export async function buscarVendas(uid: string, intervalo: Intervalo, idmaq?: string): Promise<Venda[]> {
  const filtros = [
    where('dono', '==', uid),
    ...(idmaq ? [where('idmaq', '==', idmaq)] : []),
    where('data', '>=', Timestamp.fromDate(intervalo.inicio)),
    where('data', '<', Timestamp.fromDate(intervalo.fim)),
  ];
  const snap = await getDocs(query(collection(db, 'vendas'), ...filtros, orderBy('data', 'desc')));
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      idPagamento: typeof v.idPagamento === 'string' ? v.idPagamento : d.id,
      idmaq: String(v.idmaq ?? ''),
      dono: String(v.dono ?? ''),
      valor: typeof v.valor === 'number' ? v.valor : 0,
      data: v.data instanceof Timestamp ? v.data.toDate() : new Date(0),
    };
  });
}
