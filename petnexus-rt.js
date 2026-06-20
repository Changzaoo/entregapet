/* ============================================================
   PetNexus - helper de tempo real (Supabase Realtime Broadcast)
   Usado IGUAL nos dois lados (app do cliente e pagina do
   entregador) para garantir o mesmo protocolo.

   Protocolo:
     - canal:  'petnexus-entrega-<codigo>'  (broadcast publico)
     - evento: 'pos'
     - payload: { lat, lng, heading, speed, status, ts }

   Sem tabela, sem RLS: e pub/sub efemero via WebSocket.
   Se o Supabase nao estiver configurado, available() -> false
   e quem chama deve cair no modo de simulacao.
   ============================================================ */
;(function () {
  var CH_PREFIX = 'petnexus-entrega-';
  var client = null;

  function cfg() { return window.PETNEXUS_SUPABASE || null; }

  function available() {
    var c = cfg();
    return !!(window.supabase && window.supabase.createClient && c && c.url && c.key);
  }

  function getClient() {
    if (!available()) return null;
    if (!client) {
      client = window.supabase.createClient(cfg().url, cfg().key, {
        realtime: { params: { eventsPerSecond: 10 } }
      });
    }
    return client;
  }

  function join(channelId, role) {
    var sb = getClient();
    if (!sb) return null;
    var code = (channelId || (cfg() && cfg().channel) || 'demo');
    var ch = sb.channel(CH_PREFIX + code, {
      config: {
        broadcast: { self: false },
        presence: { key: role || ('u' + Math.floor((window.performance && performance.now ? performance.now() : 1) * 1000)) }
      }
    });
    var api = {
      _ch: ch, _sb: sb, code: code,
      onPos: function (cb) {
        ch.on('broadcast', { event: 'pos' }, function (m) { try { cb(m.payload); } catch (e) {} });
        return api;
      },
      onPresence: function (cb) {
        ch.on('presence', { event: 'sync' }, function () { try { cb(ch.presenceState()); } catch (e) {} });
        return api;
      },
      sendPos: function (p) { try { ch.send({ type: 'broadcast', event: 'pos', payload: p }); } catch (e) {} return api; },
      track: function (meta) { try { ch.track(meta || { online: true }); } catch (e) {} return api; },
      subscribe: function (cb) { ch.subscribe(function (status) { if (cb) cb(status); }); return api; },
      leave: function () { try { sb.removeChannel(ch); } catch (e) {} }
    };
    return api;
  }

  window.PetNexusRT = { available: available, join: join, channelPrefix: CH_PREFIX };
})();
