/*
================================================================================
 CoolPeople v3 / Would Be — staged-pledge link + ballot_designation/challenge
================================================================================
 1) deadline_type gains 'ballot_designation' (final declaration of candidacy) and
    'challenge_deadline' (opponents challenge petitions) so they can be DISTINCT
    stages with their own fundraising sub-goal (was folding into filing/cert).
 2) pledges.plan_timeline_component_id — a pledge is submitted AT a stage; attribute
    it to the plan_timeline_components stage that was open at pledge time. Nullable
    (pledges before staging exists, or to a WouldBe with no timeline, stay NULL).
    This is what lets a failed gate (didn't make the ballot / dropped out) scope
    out the pledges tied to later stages without touching earlier ones.
================================================================================
*/

exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE election_deadlines DROP CONSTRAINT IF EXISTS election_deadlines_deadline_type_check;
        ALTER TABLE election_deadlines ADD CONSTRAINT election_deadlines_deadline_type_check CHECK (
            deadline_type IN (
                'filing_open','filing_close','petition_circulation_start','petition_filing_deadline',
                'ballot_designation','challenge_deadline','ballot_certification',
                'voter_registration_close','mail_in_ballot_request_close','mail_in_ballot_return',
                'early_voting_open','early_voting_close','primary_date','runoff_date','general_date',
                'fec_quarterly_q1','fec_quarterly_q2','fec_quarterly_q3','fec_year_end',
                'fec_pre_primary_report','fec_pre_general_report','fec_post_general_report',
                'state_pre_primary_disclosure','state_pre_general_disclosure','state_post_election_disclosure'
            )
        );
    `);

    pgm.addColumns('pledges', {
        // the stage open when this pledge was made (null = pre-staging / no timeline)
        plan_timeline_component_id: { type: 'uuid', references: 'plan_timeline_components(id)' },
    });
    pgm.createIndex('pledges', 'plan_timeline_component_id', {
        name: 'idx_pledges_stage',
        where: 'plan_timeline_component_id IS NOT NULL',
    });
};

exports.down = (pgm) => {
    pgm.dropIndex('pledges', 'plan_timeline_component_id', { name: 'idx_pledges_stage' });
    pgm.dropColumns('pledges', ['plan_timeline_component_id']);
    pgm.sql(`
        ALTER TABLE election_deadlines DROP CONSTRAINT IF EXISTS election_deadlines_deadline_type_check;
        ALTER TABLE election_deadlines ADD CONSTRAINT election_deadlines_deadline_type_check CHECK (
            deadline_type IN (
                'filing_open','filing_close','petition_circulation_start','petition_filing_deadline',
                'ballot_certification','voter_registration_close','mail_in_ballot_request_close',
                'mail_in_ballot_return','early_voting_open','early_voting_close','primary_date',
                'runoff_date','general_date','fec_quarterly_q1','fec_quarterly_q2','fec_quarterly_q3',
                'fec_year_end','fec_pre_primary_report','fec_pre_general_report','fec_post_general_report',
                'state_pre_primary_disclosure','state_pre_general_disclosure','state_post_election_disclosure'
            )
        );
    `);
};
