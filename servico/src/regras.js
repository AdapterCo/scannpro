// Publica as regras do repositório (firestore.rules e database.rules.json) ao iniciar o serviço,
// para ninguém precisar colar regra no console. Só publica quando o conteúdo é diferente do que está no ar.
// Permissões da conta de serviço: Firestore precisa do papel "Firebase Rules Admin" (roles/firebaserules.admin);
// o Realtime Database já é administrado pela própria conta do Admin SDK.
import { readFileSync } from 'node:fs';

const normalizar = (s) => String(s ?? '').replace(/\r\n/g, '\n').trim();

function jsonIgual(a, b) {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return normalizar(a) === normalizar(b);
  }
}

/**
 * seguranca: getSecurityRules() do firebase-admin; rtdb: getDatabase().
 * Devolve { firestore, database } com 'publicada', 'igual' ou 'erro'.
 */
export async function publicarRegras({ seguranca, rtdb, arquivoFirestore, arquivoDatabase, log = console }) {
  const resultado = {};

  try {
    const fonte = readFileSync(arquivoFirestore, 'utf8');
    let atual = null;
    try {
      atual = (await seguranca.getFirestoreRuleset()).source?.[0]?.content ?? null;
    } catch (e) {
      if (e.code !== 'security-rules/not-found') throw e; // nenhuma regra publicada ainda
    }
    if (atual !== null && normalizar(atual) === normalizar(fonte)) {
      resultado.firestore = 'igual';
    } else {
      await seguranca.releaseFirestoreRulesetFromSource(fonte);
      resultado.firestore = 'publicada';
      log.info?.('[regras] regras do Firestore publicadas');
    }
  } catch (e) {
    resultado.firestore = 'erro';
    log.warn(
      `[regras] não foi possível publicar as regras do Firestore: ${e.message}` +
        (/permission|PERMISSION_DENIED|403/i.test(String(e.message) + String(e.code))
          ? '\n  Dê à conta de serviço o papel "Firebase Rules Admin" no IAM do Google Cloud e reinicie o container.'
          : ''),
    );
  }

  try {
    const fonte = readFileSync(arquivoDatabase, 'utf8');
    const atual = await rtdb.getRules();
    if (jsonIgual(atual, fonte)) {
      resultado.database = 'igual';
    } else {
      await rtdb.setRules(fonte);
      resultado.database = 'publicada';
      log.info?.('[regras] regras do Realtime Database publicadas');
    }
  } catch (e) {
    resultado.database = 'erro';
    log.warn(`[regras] não foi possível publicar as regras do Realtime Database: ${e.message}`);
  }

  log.info?.(`[regras] Firestore: ${resultado.firestore}; Realtime Database: ${resultado.database}`);
  return resultado;
}
