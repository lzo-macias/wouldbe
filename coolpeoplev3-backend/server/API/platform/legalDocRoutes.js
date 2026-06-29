const express = require("express");

const {
    listLegalDocs,
    getLegalDocById,
    getCurrentLegalDoc,
    publishNewLegalDocV2
} = require("../../DB/platform/legalDocs")

const router = express.Router();

//get request dont carry a body so its req.query not req.body
router.get("/legal-docs", async (req, res, next) => {
    const { docType, currentOnly } = req.query;
    try{
        const legaldocs = await listLegalDocs({ docType, currentOnly })
        return res.json(legaldocs)
    }catch(err){
        console.error(err)
        next(err)
    }
})

router.get("/legal-docs/:id", async (req, res, next) => {
    const { id } = req.params
    try {
        const legaldoc = await getLegalDocById({ id });
        return res.json(legaldoc)
    }catch(err){
        console.error(err)
        next(err)
    }
})

router.get("/legal-docs/current/:docType", async (req, res, next) => {
    const { docType } = req.params;
    const { jurisdiction } = req.query;

    try {
        const legaldoc = await getCurrentLegalDoc({ docType, jurisdiction });
        return res.json(legaldoc)
    }catch(err){
        console.error(err)
        next(err)
    }
})


router.post("/legal-docs", async (req, res, next)  => {
    const {    
        doc_type,
        version,
        effective_date,
        body_hash,
        body_storage_url,
        jurisdiction_scope
    } = req.body

    try{
        const legaldocs = await publishNewLegalDocV2({ doc_type, version, effective_date, body_hash, body_storage_url, jurisdiction_scope })

        return res.json(legaldocs)
    }catch(err){
        console.error(err)
        next(err)
    }
})

module.exports = { router };
