// TEST ONLY: c56b6d2 client, localhost-only Firebase, explicit fault controls.
// No production build references this configuration.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
const localDatabaseModule = '/@fs/' + resolve('node_modules/.vite/deps/firebase_database.js').replaceAll('\\', '/').replaceAll(' ', '%20')
export default defineConfig({
  root: resolve('.audit-main-source'), base:'/',
  plugins:[react(), {
    name:'isolated-closure-investigation',enforce:'pre',
    transform(code,id) {
      if(id.endsWith('/src/repositories/firebaseClient.ts')) return code
        .replace('import { browserLocalPersistence','import { connectAuthEmulator, browserLocalPersistence')
        .replace('import { getDatabase }','import { connectDatabaseEmulator, getDatabase }')
        .replace('import { getFunctions }','import { connectFunctionsEmulator, getFunctions }')
        .replace('export const firebaseAuthPersistence',`if (firebaseAuth && firebaseDb && firebaseFunctions) { connectAuthEmulator(firebaseAuth,'http://127.0.0.1:9099',{disableWarnings:true}); connectDatabaseEmulator(firebaseDb,'127.0.0.1',9000); connectFunctionsEmulator(firebaseFunctions,'127.0.0.1',5002); }\nexport const firebaseAuthPersistence`)
      if(id.endsWith('/src/lib/firebase.ts')) {
        if (process.env.AUDIT_SERVER_ACTIVITY === '1') {
          const activity = '[`sessions/${roomId}/lastActivityAt`]: Date.now(),'
          if (code.split(activity).length !== 2) throw Error('Pinned diagnostic activity seam changed')
          code = code.replace('query, ref, set, update', 'query, ref, serverTimestamp, set, update').replace(activity, '[`sessions/${roomId}/lastActivityAt`]: serverTimestamp(),')
        }
        const original = 'return onValue(ref(db, roomPath(roomId)), snapshot => callback(snapshot.val()), error => onError?.(error))'
        if (!code.includes(original)) throw Error('Pinned subscription seam changed')
        return code.replace(original, `const auditStop = onValue(ref(db, roomPath(roomId)), snapshot => callback(snapshot.val()), error => onError?.(error));
          const auditFailure = () => { auditStop(); onError?.(Object.assign(new Error('LOCAL_INJECTED_SUBSCRIPTION_FAILURE'),{code:'PERMISSION_DENIED'})) };
          window.addEventListener('audit-host-subscription-failure',auditFailure);
          return () => { auditStop(); window.removeEventListener('audit-host-subscription-failure',auditFailure) }`)
      }
    },
    transformIndexHtml(html) { return html.replace('</body>',`<aside style="position:fixed;bottom:0;left:0;z-index:99999;background:#fff;color:#000;padding:6px;font:12px sans-serif;border:2px solid #c60">
      <b>ТОЛЬКО ЛОКАЛЬНЫЙ ТЕСТ c56b6d2</b>
      <input id="audit-room" aria-label="Локальная тестовая комната" value="AUDIAG" maxlength="6"><button id="audit-attach">Открыть локальную фикстуру</button>
      <button id="audit-offline">Отключить RTDB ведущего</button>
      <button id="audit-online">Восстановить RTDB</button>
      <button id="audit-subscription">Ошибка подписки ведущего</button>
      <button id="audit-clock">Часы гостя −11 минут</button>
      <button id="audit-clock-reset">Вернуть часы</button><output id="audit-status">обычный режим</output>
      </aside><script type="module">
      import {goOffline,goOnline} from '${localDatabaseModule}';
      import {firebaseDb,firebaseAuth} from '/src/repositories/firebaseClient.ts';
      const originalNow = Date.now.bind(Date), status = document.getElementById('audit-status');
      document.getElementById('audit-attach').onclick=()=>{const room=document.getElementById('audit-room').value;if(!/^[A-Z0-9]{6}$/.test(room)||!firebaseAuth.currentUser)throw Error('Local fixture unavailable');localStorage.setItem('atmosphere-host-room-'+firebaseAuth.currentUser.uid,room);location.href='/host?tab=currentRoom&room='+room};
      document.getElementById('audit-offline').onclick=()=>{goOffline(firebaseDb);status.textContent='RTDB offline'};
      document.getElementById('audit-online').onclick=()=>{goOnline(firebaseDb);status.textContent='RTDB online'};
      document.getElementById('audit-subscription').onclick=()=>{window.dispatchEvent(new Event('audit-host-subscription-failure'));status.textContent='subscription error injected'};
      document.getElementById('audit-clock').onclick=()=>{Date.now=()=>originalNow()-11*60*1000;status.textContent='clock offset -11 min'};
      document.getElementById('audit-clock-reset').onclick=()=>{Date.now=originalNow;status.textContent='clock restored'};
      </script></body>`) },
  }],
  define:{
    'import.meta.env.VITE_FIREBASE_API_KEY':JSON.stringify('audit-emulator-key'),
    'import.meta.env.VITE_FIREBASE_PROJECT_ID':JSON.stringify('demo-youth-pulse-audit'),
    'import.meta.env.VITE_FIREBASE_DATABASE_URL':JSON.stringify('https://molodeh-c523e-default-rtdb.europe-west1.firebasedatabase.app'),
    'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN':JSON.stringify('demo-youth-pulse-audit.firebaseapp.com'),
  },
  server:{host:'127.0.0.1',port:Number(process.env.AUDIT_CLIENT_PORT||4180),strictPort:true,fs:{allow:[resolve('.')]}},
})
