// ============================================================================
// Cloudflare R2 service adapter (SCAFFOLD). R2 is S3-compatible.
// Inert until the R2_* env vars are set — throws 503 "not configured". To go
// live: `npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`, set the env
// vars, build the S3 client against the R2 endpoint, and fill the TODO bodies.
// ============================================================================
require("dotenv").config();

const ENABLED = !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
);
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const s3 = ENABLED ? new S3Client({ region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } }) : null;

const notConfigured = () => {
    const e = new Error("Cloudflare R2 is not configured — set R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET");
    e.status = 503;
    return e;
};

// Presigned PUT — browser uploads straight to R2 (videos, thumbnails, recordings).
const getUploadUrl = async ({ key, contentType, expiresSeconds = 900 } = {}) => {
    if (!ENABLED) throw notConfigured();
    return getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: contentType }), { expiresIn: expiresSeconds });
};

// Presigned GET — time-limited read for private objects.
const getDownloadUrl = async ({ key, expiresSeconds = 900 } = {}) => {
    if (!ENABLED) throw notConfigured();
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }), { expiresIn: expiresSeconds });
};

const deleteObject = async ({ key } = {}) => {
    if (!ENABLED) throw notConfigured();
    return s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
};

module.exports = { ENABLED, getUploadUrl, getDownloadUrl, deleteObject };
