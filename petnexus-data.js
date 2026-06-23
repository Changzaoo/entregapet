/* ============================================================
   PetNexus - camada de dados (Supabase, schema petnexus)
   API de alto nivel sobre as RPCs SECURITY DEFINER.
   Usa o cliente Supabase autenticado de PetNexusAuth (token Firebase).
   Se nao houver sessao/Supabase, available() -> false e quem chama
   deve cair no modo local (localStorage).
   ============================================================ */
;(function () {
  function db() { var A = window.PetNexusAuth; return (A && A.db) ? A.db() : null; }
  function sb() { var A = window.PetNexusAuth; return (A && A.supabase) ? A.supabase() : null; }

  async function rpc(fn, args) {
    var d = db();
    if (!d) throw new Error('Supabase indisponivel');
    var r = await d.rpc(fn, args || {});
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }

  window.PetNexusData = {
    available: function () {
      var A = window.PetNexusAuth;
      return !!(db() && A && A.user && A.user());
    },

    // ---- catalogo ----
    servicos: function () { return rpc('app_servicos'); },
    profissionais: function () { return rpc('app_profissionais'); },

    // ---- pets ----
    meusPets: function () { return rpc('app_meus_pets'); },
    addPet: function (nome, especie, raca, porte) {
      return rpc('app_add_pet', { p_nome: nome, p_especie: especie || null, p_raca: raca || null, p_porte: porte || null });
    },

    // ---- agendamentos ----
    agendar: function (o) {
      return rpc('app_agendar', {
        p_servico_id: o.servicoId, p_data: o.data, p_hora: o.hora,
        p_pet_id: o.petId || null, p_pet_nome: o.petNome || null,
        p_obs: o.obs || null, p_leva_traz: !!o.levaTraz
      });
    },
    meusAgendamentos: function () { return rpc('app_meus_agendamentos'); },
    cancelarAgendamento: function (id) { return rpc('app_cancelar_agendamento', { p_id: id }); },

    // ---- chat ----
    minhaConversa: function () { return rpc('app_minha_conversa'); },
    enviarMensagem: function (texto) { return rpc('app_enviar_mensagem', { p_texto: texto }); },
    minhasMensagens: function () { return rpc('app_minhas_mensagens'); },
    ouvirMensagens: function (conversaId, cb) {
      var s = sb(); if (!s || !conversaId) return null;
      return s.channel('msg-' + conversaId)
        .on('postgres_changes', { event: 'INSERT', schema: 'petnexus', table: 'mensagens', filter: 'conversa_id=eq.' + conversaId },
          function (p) { try { cb(p.new); } catch (e) {} })
        .subscribe();
    },

    // ==========================================================
    // ENTREGAS / FROTA (estilo iFood)
    // ==========================================================
    // --- entregador ---
    entregadorCadastrar: function (d) {
      return rpc('entregador_cadastrar', {
        p_nome_completo: d.nome, p_nome_mae: d.nomeMae, p_cpf: d.cpf, p_telefone: d.telefone,
        p_tipo_veiculo: d.tipoVeiculo, p_veiculo_modelo: d.modelo, p_veiculo_placa: d.placa, p_cnh: d.cnh
      });
    },
    entregadorMeuStatus: function () { return rpc('entregador_meu_status'); },
    entregadorGarantirAdmin: function () { return rpc('entregador_garantir_admin'); },
    entregadorCorridas: function () { return rpc('entregador_corridas'); },
    entregadorAceitar: function (id) { return rpc('entregador_aceitar', { p_entrega_id: id }); },
    entregadorStatus: function (id, status, lat, lng) {
      return rpc('entregador_status_entrega', { p_entrega_id: id, p_status: status, p_lat: (lat == null ? null : lat), p_lng: (lng == null ? null : lng) });
    },
    entregadorConfirmar: function (id, palavra) { return rpc('entregador_confirmar', { p_entrega_id: id, p_palavra: palavra }); },
    entregadorGanhos: function () { return rpc('entregador_ganhos'); },
    // documentos (fotos em data URL base64): frente/verso do RG/CPF, CNH, selfie, veiculo
    entregadorEnviarDocumentos: function (d) {
      return rpc('entregador_enviar_documentos', {
        p_doc_tipo: d.docTipo || 'cpf', p_doc_numero: d.docNumero || null,
        p_foto_doc_frente: d.frente || null, p_foto_doc_verso: d.verso || null,
        p_foto_cnh: d.cnh || null, p_foto_selfie: d.selfie || null, p_foto_veiculo: d.veiculo || null
      });
    },

    // --- staff (CRM) ---
    staffEntregadores: function (status) { return rpc('staff_entregadores', { p_status: status || null }); },
    staffAprovar: function (id, aprovar, motivo) { return rpc('staff_aprovar_entregador', { p_id: id, p_aprovar: aprovar, p_motivo: motivo || null }); },
    staffEntregadorDocumentos: function (id) { return rpc('staff_entregador_documentos', { p_entregador_id: id }); },
    // ---- staff: agendamentos e chat (CRM) ----
    staffAgendamentos: function () { return rpc('staff_agendamentos'); },
    staffConversas: function () { return rpc('staff_conversas'); },
    staffMensagens: function (conversaId) { return rpc('staff_mensagens', { p_conversa_id: conversaId }); },
    staffResponder: function (conversaId, texto) { return rpc('staff_responder_mensagem', { p_conversa_id: conversaId, p_texto: texto }); },
    staffMarcarLidas: function (conversaId) { return rpc('staff_marcar_lidas', { p_conversa_id: conversaId }); },
    staffDespachar: function (d) {
      return rpc('staff_despachar_entrega', {
        p_cliente_id: d.clienteId || null, p_tipo: d.tipo || 'entrega', p_peso_kg: d.pesoKg || null,
        p_origem: d.origem || null, p_origem_lat: d.origemLat || null, p_origem_lng: d.origemLng || null,
        p_destino: d.destino || null, p_destino_lat: d.destinoLat || null, p_destino_lng: d.destinoLng || null,
        p_pet_nome: d.petNome || null, p_valor: d.valor || null
      });
    },

    // --- cliente ---
    minhasEntregas: function () { return rpc('app_minhas_entregas'); },
    definirCodigo: function (id, palavra) { return rpc('app_definir_codigo', { p_entrega_id: id, p_palavra: palavra }); },
    avaliar: function (id, notaEnt, notaLoja, comentario) {
      return rpc('app_avaliar', { p_entrega_id: id, p_nota_entregador: notaEnt, p_nota_loja: notaLoja, p_comentario: comentario || null });
    },

    // realtime: cliente acompanha a posicao/estado de uma entrega (o entregador atualiza via entregadorStatus)
    ouvirEntrega: function (entregaId, cb) {
      var s = sb(); if (!s || !entregaId) return null;
      return s.channel('entrega-' + entregaId)
        .on('postgres_changes', { event: 'UPDATE', schema: 'petnexus', table: 'entregas', filter: 'id=eq.' + entregaId },
          function (p) { try { cb(p.new); } catch (e) {} })
        .subscribe();
    }
  };
})();
