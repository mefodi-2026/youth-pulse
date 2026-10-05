// Local diagnostics only. The normal Vite build and deployments never load it.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react(), {
    name: 'audit-emulator-client', enforce: 'pre',
    transform(code,id) {
      if(!id.endsWith('/src/repositories/firebaseClient.ts'))return
      return code.replace("import { browserLocalPersistence", "import { connectAuthEmulator, browserLocalPersistence")
        .replace("import { getDatabase }", "import { connectDatabaseEmulator, getDatabase }")
        .replace("import { getFunctions }", "import { connectFunctionsEmulator, getFunctions }")
        .replace('export const firebaseAuthPersistence', "if (firebaseAuth && firebaseDb && firebaseFunctions) { connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', { disableWarnings: true }); connectDatabaseEmulator(firebaseDb, '127.0.0.1', 9000); connectFunctionsEmulator(firebaseFunctions, '127.0.0.1', 5002); }\nexport const firebaseAuthPersistence")
    },
  }],
  base: '/',
  define: {
    'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify('audit-emulator-key'),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify('demo-youth-pulse-audit'),
    'import.meta.env.VITE_FIREBASE_DATABASE_URL': JSON.stringify('https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify('demo-youth-pulse-audit.firebaseapp.com'),
  },
  server: {host:'127.0.0.1',port:Number(process.env.AUDIT_CLIENT_PORT||4173),strictPort:true},
})
