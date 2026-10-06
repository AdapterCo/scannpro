// Espelho de presença (substitui a função espelharPresenca da seção 6):
// presenca/{idmaq} no Realtime Database → online/ultimoSinal em dispositivos/{idmaq} no Firestore.
// idmaq não cadastrado é ignorado (nunca cria documento).
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { IDMAQ_RE } from './pagamentos.js';

export function iniciarEspelhoPresenca({ rtdb, db, log = console }) {
  // Uma fila por idmaq: mudanças rápidas (liga/desliga) são aplicadas na ordem em que chegaram.
  const filas = new Map();
  const enfileirar = (idmaq, tarefa) => {
    const anterior = filas.get(idmaq) ?? Promise.resolve();
    const atual = anterior.then(tarefa, tarefa).finally(() => {
      if (filas.get(idmaq) === atual) filas.delete(idmaq);
    });
    filas.set(idmaq, atual);
    return atual;
  };

  function aplicar(idmaq, valor, { soSeDiferente = null } = {}) {
    if (!IDMAQ_RE.test(idmaq)) return Promise.resolve();
    const online = valor?.online === true;
    if (soSeDiferente && soSeDiferente.online === online && soSeDiferente.temOnline) return Promise.resolve();
    const ultimoSinal = typeof valor?.ts === 'number' ? Timestamp.fromMillis(valor.ts) : FieldValue.serverTimestamp();
    return enfileirar(idmaq, async () => {
      try {
        await db.doc(`dispositivos/${idmaq}`).update({ online, ultimoSinal });
      } catch (e) {
        if (e.code === 5 || e.code === 'not-found') return; // não cadastrado: ignora
        log.error(`[presenca] ${idmaq}: ${e.message}`);
      }
    });
  }

  const ref = rtdb.ref('presenca');
  const aoMudar = (snap) => void aplicar(snap.key, snap.val());
  const aoRemover = (snap) => void aplicar(snap.key, { online: false });
  ref.on('child_added', aoMudar);
  ref.on('child_changed', aoMudar);
  ref.on('child_removed', aoRemover);

  // Dispositivo cadastrado depois que o equipamento já estava conectado: busca a presença atual.
  const pararFirestore = db.collection('dispositivos').onSnapshot(
    (qs) => {
      for (const c of qs.docChanges()) {
        if (c.type !== 'added') continue;
        const idmaq = c.doc.id;
        const dados = c.doc.data();
        rtdb
          .ref(`presenca/${idmaq}`)
          .get()
          .then((s) => aplicar(idmaq, s.val() ?? { online: false }, { soSeDiferente: { online: dados.online === true, temOnline: 'online' in dados } }))
          .catch((e) => log.error(`[presenca] leitura de ${idmaq}: ${e.message}`));
      }
    },
    (e) => log.error(`[presenca] escuta de dispositivos: ${e.message}`),
  );

  return {
    /** Espera as gravações em andamento (usado nos testes e no desligamento). */
    async ocioso() {
      while (filas.size) await Promise.allSettled([...filas.values()]);
    },
    parar() {
      ref.off('child_added', aoMudar);
      ref.off('child_changed', aoMudar);
      ref.off('child_removed', aoRemover);
      pararFirestore();
    },
  };
}
