(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResidentadoQuestionParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FULL_TOKEN = /^(?:RM[-\s]*)?(\d{4})\s*[-\s]?([AB])\s*[-\s]?(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/i;
  const DEFAULT_TOKEN = /^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?$/;

  function normalizeId(year, test, number) {
    return `RM-${Number(year)}-${String(test).toUpperCase()}-${String(Number(number)).padStart(3, '0')}`;
  }

  function splitTokens(input) {
    return String(input ?? '')
      .replace(/\r/g, '\n')
      .split(/[;,\n]+/)
      .map(token => token.trim())
      .filter(Boolean);
  }

  function validateYear(year, minYear, maxYear) {
    return Number.isInteger(year) && year >= minYear && year <= maxYear;
  }

  function parseQuestionSpec(input, options = {}) {
    const minYear = Number(options.minYear ?? 2015);
    const maxYear = Number(options.maxYear ?? 2025);
    const maxRange = Number(options.maxRange ?? 500);
    const defaultYear = options.defaultYear == null ? null : Number(options.defaultYear);
    const defaultTest = options.defaultTest == null ? null : String(options.defaultTest).toUpperCase();
    const availableSet = options.availableIds ? new Set(options.availableIds) : null;

    const ids = [];
    const seen = new Set();
    const duplicates = [];
    const invalidTokens = [];
    const notFound = [];
    const warnings = [];

    for (const token of splitTokens(input)) {
      let match = token.match(FULL_TOKEN);
      let year;
      let test;
      let start;
      let end;

      if (match) {
        year = Number(match[1]);
        test = match[2].toUpperCase();
        start = Number(match[3]);
        end = match[4] == null ? start : Number(match[4]);
      } else {
        match = token.match(DEFAULT_TOKEN);
        if (!match || defaultYear == null || !['A', 'B'].includes(defaultTest)) {
          invalidTokens.push({ token, reason: 'Formato no reconocido o falta año/prueba por defecto.' });
          continue;
        }
        year = defaultYear;
        test = defaultTest;
        start = Number(match[1]);
        end = match[2] == null ? start : Number(match[2]);
      }

      if (!validateYear(year, minYear, maxYear)) {
        invalidTokens.push({ token, reason: `Año fuera del rango ${minYear}-${maxYear}.` });
        continue;
      }
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
        invalidTokens.push({ token, reason: 'El número de pregunta debe ser un entero positivo.' });
        continue;
      }
      if (end < start) {
        invalidTokens.push({ token, reason: 'El final del rango es menor que el inicio.' });
        continue;
      }
      if (end - start + 1 > maxRange) {
        invalidTokens.push({ token, reason: `El rango supera el máximo de ${maxRange} preguntas.` });
        continue;
      }

      for (let number = start; number <= end; number += 1) {
        const id = normalizeId(year, test, number);
        if (availableSet && !availableSet.has(id)) {
          notFound.push(id);
          continue;
        }
        if (seen.has(id)) {
          duplicates.push(id);
          continue;
        }
        seen.add(id);
        ids.push(id);
      }
    }

    if (!ids.length && !invalidTokens.length && !notFound.length) {
      warnings.push('No se ingresaron códigos de preguntas.');
    }
    if (duplicates.length) warnings.push('Se retiraron códigos duplicados conservando la primera aparición.');
    if (notFound.length) warnings.push('Algunos códigos válidos no existen en el corpus cargado.');

    return {
      ids,
      invalidTokens,
      notFound: [...new Set(notFound)],
      duplicates: [...new Set(duplicates)],
      warnings,
      expandedCount: ids.length,
      ok: ids.length > 0 && invalidTokens.length === 0 && notFound.length === 0
    };
  }

  return { normalizeId, splitTokens, parseQuestionSpec };
});
