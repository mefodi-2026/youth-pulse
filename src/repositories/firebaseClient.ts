import { getApp, getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth'
import { getDatabase } from 'firebase/database'
import { getFunctions } from 'firebase/functions'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseReady = Boolean(config.apiKey && config.databaseURL && config.projectId)
const app = firebaseReady ? (getApps().length ? getApp() : initializeApp(config)) : null
export const firebaseAuth = app ? getAuth(app) : null
export const firebaseDb = app ? getDatabase(app) : null
export const firebaseFunctions = app ? getFunctions(app, 'europe-west1') : null
export const firebaseAuthPersistence = firebaseAuth ? setPersistence(firebaseAuth, browserLocalPersistence) : Promise.resolve()
