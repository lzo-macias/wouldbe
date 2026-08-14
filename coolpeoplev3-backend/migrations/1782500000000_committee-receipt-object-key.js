/* candidate_committees.filing_receipt_object_key — an UPLOADED filing receipt.
 *
 * Distinct from the existing filing_receipt_url, which holds a link the candidate
 * pastes (a confirmation page on the authority's own site). This holds an R2
 * object key for a file they uploaded to us.
 *
 * A KEY, NOT A URL, and deliberately so. A filing receipt carries the candidate's
 * legal name, committee details and often a home address — it is evidence for
 * admin review, not public content. Avatars and plan images store a permanent
 * public URL because they are meant to be world-readable; a receipt must not be a
 * guessable-forever link. Storing the key means every read goes through a
 * short-lived presigned GET issued to someone we've authorized.
 *
 * Both columns satisfy the launch gate — see hasReceipt in createCandidateCommittee,
 * which this migration's companion change widens to include this column.
 */

exports.up = (pgm) => {
    pgm.addColumns('candidate_committees', {
        filing_receipt_object_key: { type: 'text' },
    });
};

exports.down = (pgm) => {
    pgm.dropColumns('candidate_committees', ['filing_receipt_object_key']);
};
