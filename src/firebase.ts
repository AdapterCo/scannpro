import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

// Projeto adapterdb-aba6f (ADMIN-APP-INSTRUCOES.md, seção 8).
// A apiKey identifica o projeto e não é segredo: quem protege os dados são as regras.
const config = {
  apiKey: 'AIzaSyBYeBJCc-P7RXjNT_AjJcZpbchU1tWS8RQ',
  authDomain: 'adapterdb-aba6f.firebaseapp.com',
  projectId: 'adapterdb-aba6f',
  storageBucket: 'adapterdb-aba6f.appspot.com',
  messagingSenderId: '1007908134102',
  appId: '1:1007908134102:web:8a6d7d06beb781f3067d77',
};

export const usandoEmulador = import.meta.env.VITE_EMULADOR === '1';

// No emulador o projeto é "demo-scannpro": o SDK nunca toca o projeto real.
const app = initializeApp(usandoEmulador ? { ...config, projectId: 'demo-scannpro' } : config);

export const auth = getAuth(app);
auth.languageCode = 'pt-BR';
export const db = getFirestore(app);

if (usandoEmulador) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
