// Cria no Firestore os índices compostos de firestore.indexes.json ao iniciar o serviço,
// para ninguém precisar publicar índice à mão. Índice que já existe é ignorado.
// API: Firestore Admin v1 — POST projects/{p}/databases/(default)/collectionGroups/{g}/indexes
import { readFileSync } from 'node:fs';

export async function garantirIndices({ credencial, projectId, arquivo, log = console, fetch = globalThis.fetch }) {
  let definicoes;
  try {
    definicoes = JSON.parse(readFileSync(arquivo, 'utf8')).indexes ?? [];
  } catch (e) {
    log.warn(`[indices] não foi possível ler ${arquivo}: ${e.message}`);
    return [];
  }
  const { access_token: token } = await credencial.getAccessToken();
  const resultados = [];
  for (const d of definicoes) {
    const nome = `${d.collectionGroup}(${d.fields.map((f) => `${f.fieldPath} ${f.order === 'DESCENDING' ? 'desc' : 'asc'}`).join(', ')})`;
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${d.collectionGroup}/indexes`;
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryScope: d.queryScope ?? 'COLLECTION', fields: d.fields }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      log.warn(`[indices] ${nome}: falha de rede (${e.message})`);
      resultados.push([nome, 'erro']);
      continue;
    }
    if (r.ok) {
      log.info?.(`[indices] ${nome}: criação iniciada (fica pronto em alguns minutos)`);
      resultados.push([nome, 'criando']);
    } else if (r.status === 409) {
      resultados.push([nome, 'ja-existe']);
    } else {
      const texto = (await r.text()).slice(0, 200);
      log.warn(`[indices] ${nome}: o Firestore recusou (HTTP ${r.status}) ${texto}`);
      resultados.push([nome, `erro-${r.status}`]);
    }
  }
  const prontos = resultados.filter(([, s]) => s === 'ja-existe').length;
  log.info?.(`[indices] ${prontos}/${resultados.length} já existiam`);
  return resultados;
}
