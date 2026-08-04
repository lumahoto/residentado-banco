(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResidentadoW3Tools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TIER_ORDER = { MUY_ALTA: 0, ALTA: 1, MEDIA: 2, BAJA: 3, SIN_CLASIFICAR: 4 };

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeTier(value) {
    const text = clean(value).toUpperCase().replace(/[\s-]+/g, '_');
    if (['MUY_ALTA', 'ALTA', 'MEDIA', 'BAJA'].includes(text)) return text;
    return 'SIN_CLASIFICAR';
  }

  function topicIdentity(question = {}) {
    const id = clean(question.rentability_topic_id);
    const label = clean(question.rentability_topic_label || question.topic || question.subtopic || 'Sin clasificar');
    const area = clean(question.canonical_area || question.area || 'Sin área');
    const specialty = clean(question.canonical_specialty || question.specialty || 'Sin especialidad');
    const key = id || [area, specialty, label].join('|||');
    const score = Number(question.exam_rentability_score ?? question.rentability_score);
    return {
      key,
      id: id || null,
      label,
      area,
      specialty,
      tier: normalizeTier(question.rentability_tier || question.rentability_status),
      score: Number.isFinite(score) ? score : null,
    };
  }

  function buildCoverageSnapshot(questions = [], attempts = [], memoryStates = [], now = new Date()) {
    const questionById = new Map((questions || []).map(q => [q.id, q]));
    const seenIds = new Set();
    const correctEverIds = new Set();
    const attemptMap = new Map();
    const memoryByQuestion = new Map((memoryStates || []).map(row => [row.question_id, row]));

    for (const attempt of attempts || []) {
      if (!questionById.has(attempt.question_id)) continue;
      seenIds.add(attempt.question_id);
      if (attempt.is_correct) correctEverIds.add(attempt.question_id);
      if (!attemptMap.has(attempt.question_id)) attemptMap.set(attempt.question_id, []);
      attemptMap.get(attempt.question_id).push(attempt);
    }

    const topicsByKey = new Map();
    for (const q of questions || []) {
      const identity = topicIdentity(q);
      if (!topicsByKey.has(identity.key)) {
        topicsByKey.set(identity.key, {
          ...identity,
          total: 0,
          seen: 0,
          correctEver: 0,
          attempts: 0,
          correctAttempts: 0,
          wrongAttempts: 0,
          uncertainAttempts: 0,
          overdue: 0,
          latestAttemptAt: null,
          questionIds: [],
        });
      }
      const topic = topicsByKey.get(identity.key);
      topic.total += 1;
      topic.questionIds.push(q.id);
      if (seenIds.has(q.id)) topic.seen += 1;
      if (correctEverIds.has(q.id)) topic.correctEver += 1;

      const rows = attemptMap.get(q.id) || [];
      topic.attempts += rows.length;
      topic.correctAttempts += rows.filter(row => row.is_correct).length;
      topic.wrongAttempts += rows.filter(row => !row.is_correct).length;
      topic.uncertainAttempts += rows.filter(row => Boolean(row.was_uncertain) || clean(row.uncertainty_note)).length;
      for (const row of rows) {
        const date = new Date(row.answered_at || row.updated_at || 0);
        if (!Number.isNaN(date.valueOf()) && (!topic.latestAttemptAt || date > new Date(topic.latestAttemptAt))) {
          topic.latestAttemptAt = date.toISOString();
        }
      }
      const memory = memoryByQuestion.get(q.id);
      if (memory?.due_at && new Date(memory.due_at) <= now) topic.overdue += 1;
      if (identity.score != null && (topic.score == null || identity.score > topic.score)) topic.score = identity.score;
      if (TIER_ORDER[identity.tier] < TIER_ORDER[topic.tier]) topic.tier = identity.tier;
    }

    const topics = [...topicsByKey.values()].map(topic => {
      const coverage = topic.total ? topic.seen / topic.total : 0;
      const accuracy = topic.attempts ? topic.correctAttempts / topic.attempts : null;
      const weaknessScore = topic.wrongAttempts * 3 + topic.uncertainAttempts * 2 + topic.overdue * 2 + Math.max(0, topic.total - topic.seen) * 0.25;
      return { ...topic, coverage, accuracy, weaknessScore };
    });

    topics.sort((a, b) => {
      const tierDelta = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
      if (tierDelta) return tierDelta;
      const scoreDelta = (b.score ?? -1) - (a.score ?? -1);
      if (scoreDelta) return scoreDelta;
      return a.label.localeCompare(b.label, 'es');
    });

    return {
      totalQuestions: questions.length,
      seenQuestions: seenIds.size,
      correctEverQuestions: correctEverIds.size,
      totalTopics: topics.length,
      touchedTopics: topics.filter(topic => topic.seen > 0).length,
      completeTopics: topics.filter(topic => topic.total > 0 && topic.seen === topic.total).length,
      topics,
      seenIds,
      correctEverIds,
    };
  }

  function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.valueOf())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function buildTimeSummary(attempts = [], completedSessions = [], totalQuestions = 0, now = new Date()) {
    const today = localDateKey(now);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const validAttempts = (attempts || []).filter(row => row?.answered_at && !Number.isNaN(new Date(row.answered_at).valueOf()));
    const todayAttempts = validAttempts.filter(row => localDateKey(row.answered_at) === today);
    const recentAttempts = validAttempts.filter(row => new Date(row.answered_at) >= sevenDaysAgo && new Date(row.answered_at) <= now);
    const seenIds = new Set(validAttempts.map(row => row.question_id).filter(Boolean));
    const activeMsToday = todayAttempts.reduce((sum, row) => sum + Math.max(0, Number(row.response_time_ms || 0)), 0);
    const pacePerDay = recentAttempts.length / 7;
    const unseen = Math.max(0, Number(totalQuestions || 0) - seenIds.size);
    const projectedDays = pacePerDay > 0 ? Math.ceil(unseen / pacePerDay) : null;
    const sessionsToday = (completedSessions || []).filter(row => localDateKey(row.completed_at || row.updated_at) === today).length;

    return {
      todayQuestions: todayAttempts.length,
      activeMsToday,
      sessionsToday,
      recentQuestions: recentAttempts.length,
      pacePerDay,
      unseenQuestions: unseen,
      projectedDays,
    };
  }

  function sortTopics(topics = [], mode = 'rentability') {
    const list = [...topics];
    if (mode === 'coverage') {
      return list.sort((a, b) => a.coverage - b.coverage || TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (b.score ?? -1) - (a.score ?? -1) || a.label.localeCompare(b.label, 'es'));
    }
    if (mode === 'weakness') {
      return list.sort((a, b) => b.weaknessScore - a.weaknessScore || a.coverage - b.coverage || TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.label.localeCompare(b.label, 'es'));
    }
    if (mode === 'alphabetical') return list.sort((a, b) => a.label.localeCompare(b.label, 'es'));
    return list.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (b.score ?? -1) - (a.score ?? -1) || a.label.localeCompare(b.label, 'es'));
  }

  return { TIER_ORDER, normalizeTier, topicIdentity, buildCoverageSnapshot, buildTimeSummary, sortTopics, localDateKey };
});
