const { client, withTransaction } = require("../index.js");

// ============================================================================
// stage_proofs + stage_gate_transitions — the "prove you cleared this milestone"
// loop. A candidate submits proof for a stage (committee acceptance, candidate
// filing, etc.); an admin/authority verifies it; on verify the gate transitions
// locked→…→cleared and the NEXT stage auto-opens. Append-only gate audit.
//
// Office-agnostic: proof_tier (authority_pull|document_upload|signed_attestation)
// + source (fec_api|state_portal|city_boe|…) cover federal/state/local uniformly.
// ============================================================================

const PROOF_TIERS = ["authority_pull", "document_upload", "signed_attestation"];
// stage_gate_transitions.triggered_by values, keyed by who verified.
const TRIGGER_BY = { system: "system", admin_review: "admin_review", authority: "authority_pull" };

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// Resolve a stage (plan_timeline_component) → its WouldBe, owner, and gate fields.
async function loadComponent(componentId) {
    const { rows } = await client.query(
        `SELECT c.id, c.plan_timeline_id, c.stage_number, c.gate_state,
                c.verify_method, c.milestone_type, p.wouldbe_id, w.user_id AS owner_id
         FROM plan_timeline_components c
         JOIN plan_timeline pt ON pt.id = c.plan_timeline_id
         JOIN plan p ON p.id = pt.plan_id
         JOIN wouldbe w ON w.id = p.wouldbe_id
         WHERE c.id = $1`,
        [componentId]
    );
    return rows[0] || null;
}

// submitStageProof — candidate attaches evidence to a stage (status 'pending').
const submitStageProof = async ({
    componentId, submitterUserId, proof_tier, source,
    milestone_type, verify_method, uploaded_document_url,
    extracted_fields, attestation_statement, authority_payload,
}) => {
    if (!PROOF_TIERS.includes(proof_tier)) {
        throw httpError(400, `proof_tier must be one of: ${PROOF_TIERS.join(", ")}`);
    }
    const comp = await loadComponent(componentId);
    if (!comp) throw httpError(404, "stage (plan_timeline_component) not found");

    if (proof_tier === "document_upload" && !uploaded_document_url) {
        throw httpError(400, "uploaded_document_url is required for a document_upload proof");
    }
    if (proof_tier === "signed_attestation" && !attestation_statement) {
        throw httpError(400, "attestation_statement is required for a signed_attestation proof");
    }

    const src = source
        || (proof_tier === "signed_attestation" ? "attestation" : "candidate_upload");
    try {
        const { rows } = await client.query(
            `INSERT INTO stage_proofs
               (plan_timeline_component_id, wouldbe_id, proof_tier, verify_method, milestone_type,
                status, source, authority_payload, uploaded_document_url, extracted_fields,
                attestation_user_id, attestation_statement)
             VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
                componentId, comp.wouldbe_id, proof_tier,
                verify_method || comp.verify_method,
                milestone_type || comp.milestone_type || "other",
                src,
                authority_payload ? JSON.stringify(authority_payload) : null,
                uploaded_document_url || null,
                extracted_fields ? JSON.stringify(extracted_fields) : null,
                proof_tier === "signed_attestation" ? submitterUserId : null,
                attestation_statement || null,
            ]
        );
        // a stage that was 'tbd' now has a real attempt pending
        await client.query(
            `UPDATE plan_timeline_components SET proof_status = 'pending' WHERE id = $1 AND proof_status = 'tbd'`,
            [componentId]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "invalid source/proof_tier value");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// verifyStageProof — admin/authority decision. 'verified' clears the gate and
// auto-opens the next stage (atomic: proof + gate transition + advance commit
// together). 'rejected' marks the stage's proof_status, gate unchanged.
const verifyStageProof = async ({ proofId, decision, verified_by = "admin_review", notes = null, cross_check_result = null }) => {
    if (!["verified", "rejected"].includes(decision)) {
        throw httpError(400, "decision must be 'verified' or 'rejected'");
    }
    try {
        return await withTransaction(async (tx) => {
            const pr = await tx.query(`SELECT * FROM stage_proofs WHERE id = $1 FOR UPDATE`, [proofId]);
            const proof = pr.rows[0];
            if (!proof) throw httpError(404, "stage proof not found");
            const comp = await loadComponent(proof.plan_timeline_component_id);

            await tx.query(
                `UPDATE stage_proofs SET status = $2, verified_at = now(), verified_by = $3,
                    cross_check_result = COALESCE($4, cross_check_result)
                 WHERE id = $1`,
                [proofId, decision, verified_by, cross_check_result]
            );

            if (decision === "rejected") {
                await tx.query(`UPDATE plan_timeline_components SET proof_status = 'rejected' WHERE id = $1`, [comp.id]);
                return { component_id: comp.id, gate_state: comp.gate_state, proof_status: "rejected" };
            }

            // verified → clear this gate (append-only transition)
            const trig = TRIGGER_BY[verified_by] || "admin_review";
            await tx.query(
                `INSERT INTO stage_gate_transitions
                   (plan_timeline_component_id, wouldbe_id, from_state, to_state, triggered_by, source, stage_proof_id, notes)
                 VALUES ($1,$2,$3,'cleared',$4,$5,$6,$7)`,
                [comp.id, comp.wouldbe_id, comp.gate_state, trig, proof.verify_method || proof.source, proofId, notes]
            );
            await tx.query(
                `UPDATE plan_timeline_components SET gate_state = 'cleared', proof_status = 'verified' WHERE id = $1`,
                [comp.id]
            );

            // auto-open the next stage if it's locked
            const next = await tx.query(
                `SELECT id, gate_state FROM plan_timeline_components
                 WHERE plan_timeline_id = $1 AND stage_number = $2`,
                [comp.plan_timeline_id, comp.stage_number + 1]
            );
            let opened_next = null;
            if (next.rows[0] && next.rows[0].gate_state === "locked") {
                await tx.query(`UPDATE plan_timeline_components SET gate_state = 'open' WHERE id = $1`, [next.rows[0].id]);
                await tx.query(
                    `INSERT INTO stage_gate_transitions
                       (plan_timeline_component_id, wouldbe_id, from_state, to_state, triggered_by, source, stage_proof_id, notes)
                     VALUES ($1,$2,'locked','open','system',$3,$4,$5)`,
                    [next.rows[0].id, comp.wouldbe_id, "gate_advance", proofId, `auto-opened after stage ${comp.stage_number} cleared`]
                );
                opened_next = next.rows[0].id;
            }

            return { component_id: comp.id, gate_state: "cleared", proof_status: "verified", opened_next };
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "22P02") throw httpError(400, "proofId must be a valid uuid");
        console.error(err);
        throw err;
    }
};

// reads
const getProofsForComponent = async (componentId) => {
    const { rows } = await client.query(
        `SELECT * FROM stage_proofs WHERE plan_timeline_component_id = $1 ORDER BY submitted_at DESC`,
        [componentId]
    );
    return rows;
};
const listPendingProofs = async ({ wouldbe_id = null, limit = 100 } = {}) => {
    const { rows } = await client.query(
        `SELECT sp.*, c.stage_number, c.milestone_type AS stage_milestone
         FROM stage_proofs sp JOIN plan_timeline_components c ON c.id = sp.plan_timeline_component_id
         WHERE sp.status = 'pending' AND ($1::uuid IS NULL OR sp.wouldbe_id = $1)
         ORDER BY sp.submitted_at ASC LIMIT $2`,
        [wouldbe_id ?? null, Math.min(Number(limit) || 100, 500)]
    );
    return rows;
};

module.exports = { submitStageProof, verifyStageProof, getProofsForComponent, listPendingProofs };
