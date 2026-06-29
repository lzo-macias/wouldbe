const express = require("express")

const {
    createComment,
    getCommentsForPost,
    updateComment,
    softDeleteComment,
} = require("../../DB/content/comments")

const { client } = require("../../DB/index");

const router = express.Router();

const {
    requireAuth,
    requireAdmin,
    recordAdminAction,
    requireCriteriaAck,
    captureRequestContext,
} = require("../../middleware");

router.post("/posts/:id/comments", 
    requireAuth,
    async (req, res, next) => {
        try{
            const comment = await createComment({
              post_id: req.params.id,
              author_user_id: req.user.id,
              body: req.body?.body,
              parent_comment_id: req.body?.parent_comment_id ?? null,
            });
            return res.status(201).json(comment)
        }catch(err){
            next(err)
        }
    }
)

router.get("/posts/:id/comments",
    async (req, res, next) => {
        try{
            return res.json(await getCommentsForPost({post_id: req.params.id}))
        }catch(err){
            next(err)
        }
    }
)

router.patch("/comments/:id",
    requireAuth,
    async (req, res, next) => {
        try{
           const comment = await updateComment({
                id: req.params.id,
                author_user_id: req.user.id,
                body: req.body?.body,
           });
           return res.json(comment);
        }catch(err){
            next(err)
        }
    }
)

 router.delete("/comments/:id", 
    requireAuth, async (req, res, next) => {
      try {
          return res.json(await softDeleteComment({
              id: req.params.id,
              author_user_id: req.user.id,        // owner-scoped → only your own
              removed_reason: req.body?.removed_reason ?? null,
          }));
      } catch (err) {
          next(err);
      }
  });


  router.delete("/admin/comments/:id",
      requireAuth,
      requireAdmin(),                              // note the ()
      recordAdminAction("remove_comment", { resourceType: "comments" }),
      async (req, res, next) => {
          try {
              return res.json(await softDeleteComment({
                  id: req.params.id,
                  // no author_user_id → admin removes ANYONE's comment
                  removed_reason: req.body?.removed_reason ?? null,
              }));
          } catch (err) {
              next(err);
          }
      }
  );



module.exports = { router };

