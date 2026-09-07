/* eslint-disable camelcase */

/**
 * prompt_brief — what the sponsor wants the questions to be, when they would
 * rather we wrote them.
 *
 * WHY THIS IS ITS OWN COLUMN and not `description`. A debate with sixteen
 * contestants needs eight bracket questions, and most sponsors have a subject
 * rather than eight drafted prompts. The form now offers "tell us what you want
 * and we'll handle it", which produces a brief for whoever writes them — and
 * that is an INTERNAL note. `description` is the public blurb on the debate
 * page, so carrying it there would publish a message addressed to staff.
 *
 * NULL means the sponsor wrote their own. A non-null value is the review
 * queue's signal that this application is waiting on us, which is the whole
 * point of storing it.
 */
exports.up = (pgm) => {
    pgm.addColumn("debates", {
        prompt_brief: { type: "text", notNull: false },
    });
};

exports.down = (pgm) => {
    pgm.dropColumn("debates", "prompt_brief");
};
