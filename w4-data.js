(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResidentadoW4Data = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function timestamp(value) {
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function maxUpdatedAt(rows = [], fields = ['updated_at', 'answered_at', 'completed_at', 'created_at']) {
    let best = null;
    let bestTime = 0;
    for (const row of rows || []) {
      for (const field of fields) {
        const value = row?.[field];
        const time = timestamp(value);
        if (time > bestTime) {
          bestTime = time;
          best = value;
        }
      }
    }
    return best;
  }

  function mergeRows(existing = [], incoming = [], keyFn = row => row?.id, updatedFields = ['updated_at', 'answered_at', 'completed_at', 'created_at']) {
    const byKey = new Map();
    for (const row of existing || []) {
      const key = keyFn(row);
      if (key != null && key !== '') byKey.set(String(key), row);
    }
    for (const row of incoming || []) {
      const key = keyFn(row);
      if (key == null || key === '') continue;
      const normalizedKey = String(key);
      const current = byKey.get(normalizedKey);
      if (!current) {
        byKey.set(normalizedKey, row);
        continue;
      }
      const currentTime = Math.max(...updatedFields.map(field => timestamp(current?.[field])));
      const incomingTime = Math.max(...updatedFields.map(field => timestamp(row?.[field])));
      if (incomingTime >= currentTime) byKey.set(normalizedKey, { ...current, ...row });
    }
    return [...byKey.values()];
  }

  function attemptKey(row = {}) { return row.client_attempt_id || row.id || null; }

  function manifestMatches(cached = {}, remote = {}, cachedCount = null) {
    if (!cached || !remote) return false;
    const cachedRevision = cached.dataset_revision || cached.datasetRevision || cached.revision || null;
    const remoteRevision = remote.dataset_revision || remote.datasetRevision || remote.revision || null;
    if (!cachedRevision || !remoteRevision || String(cachedRevision) !== String(remoteRevision)) return false;
    const expected = Number(remote.row_count ?? remote.rowCount ?? cachedCount);
    const actual = Number(cachedCount);
    if (Number.isFinite(expected) && expected >= 0 && Number.isFinite(actual)) return expected === actual;
    return true;
  }

  function topicsFromQuestions(questions = []) {
    const groups = new Map();
    for (const question of questions || []) {
      const id = question?.rentability_topic_id || question?.topic_id || null;
      if (!id) continue;
      if (!groups.has(id)) {
        groups.set(id, {
          id,
          label: question.rentability_topic_label || question.topic || id,
          canonical_area: question.canonical_area || question.area || null,
          main_specialty: question.canonical_specialty || question.specialty || null,
          rentability_tier: question.rentability_tier || null,
          exam_rentability_score: question.exam_rentability_score == null ? null : Number(question.exam_rentability_score),
          n_questions: 0,
        });
      }
      groups.get(id).n_questions += 1;
    }
    return [...groups.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), 'es'));
  }

  function normalizeCatalog(raw = {}) {
    const topics = Array.isArray(raw?.topics) ? raw.topics : [];
    return {
      catalogVersion: String(raw?.catalogVersion || 'unknown'),
      generatedAt: raw?.generatedAt || null,
      taxonomyVersion: raw?.taxonomyVersion || null,
      topics: topics.map(item => ({
        topicId: String(item?.topicId || ''),
        topicLabel: String(item?.topicLabel || item?.topicId || ''),
        rentabilityTier: item?.rentabilityTier || null,
        status: ['PENDING', 'PARTIAL', 'COMPLETE'].includes(item?.status) ? item.status : 'PENDING',
        primaryCode: item?.primaryCode || null,
        version: item?.version || null,
        updatedAt: item?.updatedAt || null,
        estimatedMinutes: item?.estimatedMinutes == null ? null : Number(item.estimatedMinutes),
        parts: Array.isArray(item?.parts) ? item.parts.map(part => ({
          code: String(part?.code || ''),
          title: String(part?.title || part?.code || ''),
          file: String(part?.file || ''),
          estimatedMinutes: part?.estimatedMinutes == null ? null : Number(part.estimatedMinutes),
          coverage: Array.isArray(part?.coverage) ? part.coverage.map(String) : [],
        })) : [],
        missingCoverage: Array.isArray(item?.missingCoverage) ? item.missingCoverage.map(String) : [],
      })).filter(item => item.topicId),
    };
  }

  function catalogMap(catalog = {}) {
    return new Map(normalizeCatalog(catalog).topics.map(item => [item.topicId, item]));
  }

  function catalogStatusLabel(item = null) {
    if (!item || item.status === 'PENDING') return 'Pendiente';
    if (item.status === 'PARTIAL') return `Parcial${item.parts?.length ? ` · ${item.parts.length} parte${item.parts.length === 1 ? '' : 's'}` : ''}`;
    return `Completa${item.parts?.length ? ` · ${item.parts.length} parte${item.parts.length === 1 ? '' : 's'}` : ''}`;
  }

  function ttsRequestForTopic(topic = {}, catalogItem = null, weakness = null) {
    const topicLabel = topic.label || topic.topic || topic.topicLabel || 'Tema no especificado';
    const area = topic.area || topic.canonical_area || 'Sin área';
    const specialty = topic.specialty || topic.main_specialty || 'Sin especialidad';
    const hasReading = catalogItem && catalogItem.status !== 'PENDING';
    const weaknessReason = weakness?.reasonText || weakness?.level || weakness?.score != null
      ? `Prioridad actual: ${weakness?.reasonText || `${weakness?.level || 'adaptativa'} (${weakness?.score ?? 's/d'}/100)`}.`
      : '';
    const parts = catalogItem?.parts?.length
      ? `Partes existentes: ${catalogItem.parts.map(part => part.code).join(', ')}.`
      : '';
    const missing = catalogItem?.missingCoverage?.length
      ? `Cobertura faltante declarada: ${catalogItem.missingCoverage.join(', ')}.`
      : '';

    if (hasReading) {
      return [
        'Necesito un suplemento TTS dirigido al Residentado Médico Perú.',
        `Tema canónico: ${topicLabel}.`,
        `Área: ${area}. Especialidad: ${specialty}.`,
        `La lectura principal ya existe con estado ${catalogItem.status === 'COMPLETE' ? 'completo' : 'parcial'}.`,
        parts,
        missing,
        weaknessReason,
        'No repitas la lectura completa. Identifica el vacío específico que explique mis errores, dudas, lentitud o repasos vencidos y crea un suplemento breve, trazable y compatible con la guía TTS acumulativa vigente.',
        'Incluye puntos de corte, valores normales, elevados o disminuidos cuando correspondan, con su categoría exacta y fuente.',
      ].filter(Boolean).join('\n');
    }

    return [
      'Necesito crear la lectura TTS canónica para el Residentado Médico Perú.',
      `Tema canónico: ${topicLabel}.`,
      `Área: ${area}. Especialidad: ${specialty}.`,
      weaknessReason,
      'Sigue íntegramente la guía TTS acumulativa vigente: definición, epidemiología útil, etiología, fisiopatología esencial, manifestaciones, diagnóstico, diagnóstico diferencial, manejo, complicaciones, prevención y seguimiento según aplicabilidad.',
      'Incluye explícitamente valores normales, puntos de corte y criterios de disminución o elevación cuando sean examinables.',
      'Conserva la jerarquía de fuentes y separa la clave histórica del criterio vigente.',
    ].filter(Boolean).join('\n');
  }

  function pageRange(page = 0, pageSize = 50) {
    const safePage = Math.max(0, Number(page) || 0);
    const safeSize = Math.min(500, Math.max(1, Number(pageSize) || 50));
    return { from: safePage * safeSize, to: safePage * safeSize + safeSize - 1, page: safePage, pageSize: safeSize };
  }

  return {
    timestamp,
    maxUpdatedAt,
    mergeRows,
    attemptKey,
    manifestMatches,
    topicsFromQuestions,
    normalizeCatalog,
    catalogMap,
    catalogStatusLabel,
    ttsRequestForTopic,
    pageRange,
  };
});
