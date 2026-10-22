'use strict';

const filterGroups = {
  decision: ['pending', 'approved', 'rejected'],
  classification: ['unapplied', 'applied'],
  analysis: ['undetected', 'mapped', 'unmapped', 'error']
};

function matchesFilters(row, selected) {
  const analysis = row.errors.length || row.applyError ? 'error'
    : !(row.tags.character || []).length ? 'undetected'
    : row.analysisSucceeded ? 'mapped' : 'unmapped';
  return selected.decision.includes(row.decision) &&
    selected.classification.includes(row.applied ? 'applied' : 'unapplied') &&
    selected.analysis.includes(analysis);
}

module.exports = { filterGroups, matchesFilters };
