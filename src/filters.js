'use strict';

const filterGroups = {
  decision: ['pending', 'approved', 'rejected'],
  analysis: ['undetected', 'mapped', 'unmapped', 'error']
};

function matchesFilters(row, selected) {
  if (row.applied) return false;
  const analysis = row.errors.length || row.applyError ? 'error'
    : !(row.tags.character || []).length ? 'undetected'
    : row.analysisSucceeded ? 'mapped' : 'unmapped';
  return selected.decision.includes(row.decision) &&
    selected.analysis.includes(analysis);
}

module.exports = { filterGroups, matchesFilters };
