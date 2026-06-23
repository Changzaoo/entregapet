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

  // ===== Isolamento por dominio de e-mail =====
  // Cada app aceita SOMENTE o seu dominio. admin@pet.com tem acesso a todos
  // (conta de teste). O dominio pode ser sobrescrito por window.PETNEXUS_APP_DOMAIN.
  var DOMAIN_BY_ROLE = { cliente: 'lojapet.com', entregador: 'entregapet.com', staff: 'pet.com', admin: 'pet.com' };
  var APP_BY_DOMAIN  = { 'lojapet.com': 'App do Cliente', 'entregapet.com': 'App do Entregador', 'pet.com': 'CRM / Gestor' };
  var ALLOW_ALL_EMAILS = ['admin@pet.com']; // contas com acesso a todos os apps
  function appDomain() { return String(window.PETNEXUS_APP_DOMAIN || DOMAIN_BY_ROLE[appRole()] || '').toLowerCase(); }
  function emailDom(email) { var s = String(email || '').toLowerCase().trim(); var i = s.lastIndexOf('@'); return i >= 0 ? s.slice(i + 1) : ''; }
  // Conta de DEMONSTRACAO: local-part comeca com "demo" (ex.: demo@lojapet.com,
  // demo-joao@pet.com). O operador cria essas contas no Firebase e elas entram
  // com TODOS os privilegios do modo demo (dados mock, sem tocar no backend).
  // O dominio continua isolando o app (demo@lojapet.com so abre o App do Cliente).
  function emailLocal(email) { var s = String(email || '').toLowerCase().trim(); var i = s.lastIndexOf('@'); return i >= 0 ? s.slice(0, i) : s; }
  function isDemoEmail(email) { return /^demo([._+-]|$)/.test(emailLocal(email)); }
  function emailAllowedHere(email) {
    email = String(email || '').toLowerCase().trim();
    if (ALLOW_ALL_EMAILS.indexOf(email) >= 0) return true;
    var d = appDomain(); if (!d) return true;            // sem restricao configurada
    return emailDom(email) === d;
  }
  function domErr(email) {
    var want = appDomain(), has = emailDom(email), belongs = APP_BY_DOMAIN[has], msg;
    if (belongs && has !== want) msg = 'Esta conta é do ' + belongs + '. Abra o aplicativo correto para entrar.';
    else msg = 'Use um e-mail @' + want + ' para entrar neste aplicativo.';
    var e = new Error(msg); e.code = 'petnexus/wrong-app'; e.friendly = msg; return e;
  }
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
      // Guarda de isolamento: se uma sessao de OUTRO app vazou para este
      // (mesmo projeto Firebase), recusa aqui e desloga — exceto admin@pet.com.
      if (u && !emailAllowedHere(u.email)) {
        try { await firebase.auth().signOut(); } catch (e) {}
        current = null; profileCache = null; notify(null);
        return;
      }
      current = u || null;
      if (u) {
        // So reivindica o papel uma vez por sessao (no primeiro carregamento
        // com sessao ativa). Evita re-upsert de papel a cada refresh de token,
        // troca de aba ou recarga, que poderia reivindicar o papel do app
        // ERRADO para um usuario cuja sessao Firebase vazou entre apps.
        if (!profileCache) { await claimProfile(u.displayName, u.phoneNumber); }
      } else { profileCache = null; }
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

    // ---- helpers de dominio (para a UI validar/avisar) ----
    appDomain: appDomain,
    emailAllowedHere: emailAllowedHere,
    isDemoEmail: isDemoEmail,   // conta demo (prefixo demo@) -> modo demo com dados mock

    // ---- entrar ----
    login: function (email, pass) {
      if (!emailAllowedHere(email)) return Promise.reject(domErr(email));
      return firebase.auth().signInWithEmailAndPassword(email, pass);
    },
    loginGoogle: async function () {
      var cred = await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
      if (cred && cred.user && !emailAllowedHere(cred.user.email)) { try { await firebase.auth().signOut(); } catch (e) {} throw domErr(cred.user.email); }
      return cred;
    },
    loginApple: async function () {
      var cred = await firebase.auth().signInWithPopup(appleProvider());
      if (cred && cred.user && !emailAllowedHere(cred.user.email)) { try { await firebase.auth().signOut(); } catch (e) {} throw domErr(cred.user.email); }
      return cred;
    },

    // ---- cadastrar (papel = o do app; allowlist pode promover) ----
    signup: async function (email, pass, extra) {
      extra = extra || {};
      if (!emailAllowedHere(email)) throw domErr(email);
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
