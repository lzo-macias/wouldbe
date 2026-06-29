const express = require("express");

const { listRulesVersions } = require("../../DB/elections/rulesVersions");

const router = express.Router();

// GET /api/rules-versions?state_code=&jurisdiction_id=&currentOnly=&limit=
// Campaign-finance regulations (contribution limits + advancement rules) per
// jurisdiction. Public read (display data). currentOnly=true by default.
router.get("/rules-versions", async (req, res, next) => {
    try {
        const rows = await listRulesVersions({
            state_code: req.query.state_code,
            jurisdiction_id: req.query.jurisdiction_id,
            currentOnly: req.query.currentOnly !== "false",
            limit: req.query.limit,
        });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
