/* ============================================================
   PetNexus - autenticacao Firebase  ->  Supabase (Third-Party Auth)
   - Login/cadastro: e-mail+senha, Google, Apple (Firebase Auth).
   - O PAPEL (cliente/entregador/staff/admin) e decidido NO SERVIDOR
     pela funcao petnexus.claim_profile (allowlist manda; o app so
     pode pedir 'cliente' ou 'entregador').
   - Cada app define qual papel ele cadastra via:
        window.PETNEXUS_APP_ROLE = 'cliente' | 'entregador' | 'staff'
     (CRM usa 'staff' so para sinalizar; quem libera e a allowlist.)

   Requer carregar antes (em cada app):
     firebase-app-compat.js + firebase-auth-compat.js
     @supabase/supabase-js
     petnexus-config.js     (URL + chave publicavel do Supabase)
     petnexus-firebase.js   (config Web do Firebase)
   ============================================================ */
;(function () {
  var sbClient = null, listeners = [], current = null, profileCache = null;
  function appRole() { return window.PETNEXUS_APP_ROLE || 'cliente'; }
  function fbReady() {
    var c = window.PETNEXUS_FIREBASE;
    return !!(window.firebase && window.firebase.auth && c && c.apiKey && c.apiKey.indexOf('PREENCHA') !== 0);
  }

  function initFirebase() {
    if (!fbReady()) return false;
    try { if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(window.PETNEXUS_FIREBASE); return true; }
    catch (e) { console.warn('[PetNexusAuth] Firebase init falhou:', e); return false; }
  }

  // Cliente Supabase que injeta o ID token do Firebase em cada request.
  function supabase() {
    if (sbClient) return sbClient;
    if (!window.supabase || !window.PETNEXUS_SUPABASE) return null;
    sbClient = window.supabase.createClient(
      window.PETNEXUS_SUPABASE.url, window.PETNEXUS_SUPABASE.key,
      {
        accessToken: async function () {
          try { var u = firebase.auth().currentUser; return u ? await u.getIdToken(false) : null; }
          catch (e) { return null; }
        },
        realtime: { params: { eventsPerSecond: 10 } }
      }
    );
    return sbClient;
  }
  function pn() { var sb = supabase(); return sb ? sb.schema('petnexus') : null; }

  function notify(u) { listeners.forEach(function (cb) { try { cb(u, profileCache); } catch (e) {} }); }

  // cria/atualiza o profile via RPC segura (papel decidido no servidor)
  async function claimProfile(nome, tel) {
    var db = pn(); if (!db) return null;
    try {
      var r = await db.rpc('claim_profile', { p_role: appRole(), p_nome: nome || null, p_tel: tel || null });
      profileCache = (r && r.data) ? (Array.isArray(r.data) ? r.data[0] : r.data) : null;
      return profileCache;
    } catch (e) { console.warn('[PetNexusAuth] claim_profile:', e); return null; }
  }

  function start() {
    if (!initFirebase()) { console.warn('[PetNexusAuth] Firebase nao configurado (preencha petnexus-firebase.js).'); notify(null); return; }
    firebase.auth().onAuthStateChanged(async function (u) {
      current = u || null;
      if (u) { await claimProfile(u.displayName, u.phoneNumber); } else { profileCache = null; }
      notify(current);
    });
  }

  function appleProvider() { var p = new firebase.auth.OAuthProvider('apple.com'); p.addScope('email'); p.addScope('name'); return p; }

  window.PetNexusAuth = {
    available: function () { return fbReady(); },
    appRole: appRole,
    user: function () { return current; },
    profile: function () { return profileCache; },
    role: function () { return profileCache ? profileCache.role : null; },
    isStaff: function () { return profileCache && (profileCache.role === 'staff' || profileCache.role === 'admin'); },
    isAdmin: function () { return profileCache && profileCache.role === 'admin'; },
    supabase: supabase,         // cliente Supabase autenticado (schema().from()/rpc())
    db: pn,                     // atalho .schema('petnexus')
    onUser: function (cb) { listeners.push(cb); return cb; },

    // ---- entrar ----
    login: function (email, pass) { return firebase.auth().signInWithEmailAndPassword(email, pass); },
    loginGoogle: function () { return firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider()); },
    loginApple: function () { return firebase.auth().signInWithPopup(appleProvider()); },

    // ---- cadastrar (papel = o do app; allowlist pode promover) ----
    signup: async function (email, pass, extra) {
      extra = extra || {};
      var cred = await firebase.auth().createUserWithEmailAndPassword(email, pass);
      if (extra.nome) { try { await cred.user.updateProfile({ displayName: extra.nome }); } catch (e) {} }
      await claimProfile(extra.nome, extra.tel);
      return cred;
    },

    // ---- gate do CRM: e-mail precisa estar autorizado pela administracao ----
    emailAllowedRole: async function (email) {
      var db = pn(); if (!db) return null;
      try { var r = await db.rpc('email_allowed_role', { p_email: email }); return (r && r.data) || null; }
      catch (e) { return null; }
    },

    // ---- trocar/redefinir senha (todos os apps) ----
    resetByEmail: function (email) { return firebase.auth().sendPasswordResetEmail(email); },
    reauthenticate: function (currentPass) {
      var u = firebase.auth().currentUser; if (!u || !u.email) return Promise.reject(new Error('sem sessao'));
      var cred = firebase.auth.EmailAuthProvider.credential(u.email, currentPass);
      return u.reauthenticateWithCredential(cred);
    },
    updatePassword: async function (currentPass, newPass) {
      var u = firebase.auth().currentUser; if (!u) throw new Error('sem sessao');
      try { await u.updatePassword(newPass); }
      catch (e) {
        if (e && e.code === 'auth/requires-recent-login' && currentPass) {
          await this.reauthenticate(currentPass); await u.updatePassword(newPass);
        } else { throw e; }
      }
      return true;
    },

    logout: function () { profileCache = null; return firebase.auth().signOut(); }
  };

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
