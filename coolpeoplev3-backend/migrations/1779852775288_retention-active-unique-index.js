/*
================================================================================
 CoolPeople v3 / Would Be — One active retention policy per category
================================================================================
 Enforces the invariant that getActivePolicyForCategory() relies on: at most
 one *active* (open-ended) policy per data_category. The partial unique index
 only constrains rows where active_until IS NULL (the current policy), so any
 number of historical/closed rows per category are still allowed.
================================================================================
*/

exports.up = (pgm) => {
    pgm.createIndex('data_retention_policies', 'data_category', {
        name: 'idx_retention_active_one_per_category',
        unique: true,
        where: 'active_until IS NULL',
    });
};

exports.down = (pgm) => {
    pgm.dropIndex('data_retention_policies', 'data_category', {
        name: 'idx_retention_active_one_per_category',
    });
};
