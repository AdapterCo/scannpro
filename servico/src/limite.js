// Limite de frequência em memória por chave (aqui, por idmaq): intervalo mínimo entre chamadas
// e máximo por janela. Suficiente para um único processo na VPS.

export function criarLimitador({ intervaloMinMs = 5_000, maxPorJanela = 30, janelaMs = 3_600_000, agora = () => Date.now() } = {}) {
  const registros = new Map();
  return {
    /** true se a chamada pode seguir (e a registra); false se passou do limite. */
    permitir(chave) {
      const t = agora();
      const lista = (registros.get(chave) ?? []).filter((x) => t - x < janelaMs);
      if (lista.length && t - lista[lista.length - 1] < intervaloMinMs) return false;
      if (lista.length >= maxPorJanela) return false;
      lista.push(t);
      registros.set(chave, lista);
      if (registros.size > 10_000) for (const [k, v] of registros) if (!v.length || t - v[v.length - 1] > janelaMs) registros.delete(k);
      return true;
    },
  };
}
