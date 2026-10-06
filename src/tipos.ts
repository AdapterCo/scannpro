// Documentos do Firestore (ADMIN-APP-INSTRUCOES.md, seção 3). Valores sempre em centavos.

/** clientes/{uid}: o token fica em segredos/{uid}; aqui só os 4 últimos caracteres. */
export interface Cliente {
  email: string;
  nome: string;
  /** "…ab12" ou null quando o cliente ainda não configurou o token */
  tokenMPFinal: string | null;
}

export interface Dispositivo {
  idmaq: string;
  /** uid do cliente dono */
  dono: string;
  nome: string;
  valor: number;
  ativo: boolean;
  /** mantido pelo serviço de confiança a partir da presença; o painel só lê */
  online: boolean;
  ultimoSinal: Date | null;
  criadoEm: Date | null;
}

export interface Venda {
  idPagamento: string;
  idmaq: string;
  dono: string;
  valor: number;
  data: Date;
}
