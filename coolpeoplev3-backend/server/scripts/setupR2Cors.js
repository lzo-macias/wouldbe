require("dotenv").config();
const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require("@aws-sdk/client-s3");

// ============================================================================
// Apply the CORS policy the browser needs to PUT straight to R2.
//
// WHY THIS IS NEEDED: avatar uploads go browser → R2 on a presigned URL, which
// is a cross-origin request. The browser sends a preflight OPTIONS first, and a
// bucket with no CORS policy answers it without Access-Control-Allow-Origin —
// so the PUT never leaves the browser. Nothing in our code can fix that; the
// permission has to live on the bucket.
//
// This is invisible in server-side testing: Node's fetch doesn't enforce CORS,
// so the same upload succeeds from a script and fails from the page.
//
// Run:  node ./server/scripts/setupR2Cors.js
//       node ./server/scripts/setupR2Cors.js --show     (print current policy)
//
// Idempotent: PutBucketCors REPLACES the whole policy, so re-running is safe but
// it will drop rules that aren't listed here. Check --show before running
// against a bucket that already serves other apps.
// ============================================================================

// Origins allowed to upload. Keep this tight — it is the list of sites that may
// spend your presigned URLs from a browser. Add production via R2_CORS_ORIGINS
// (comma-separated) rather than editing this file.
const DEFAULT_ORIGINS = [
    "http://localhost:5173",   // vite dev
    "http://localhost:4173",   // vite preview
];

const origins = (process.env.R2_CORS_ORIGINS
    ? process.env.R2_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ORIGINS);

const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}`);
    process.exit(1);
}

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const Bucket = process.env.R2_BUCKET;

const CORSRules = [
    {
        AllowedOrigins: origins,
        // PUT for the upload itself; GET/HEAD so the browser can read objects
        // back from the same bucket if they're ever fetched via script.
        AllowedMethods: ["PUT", "GET", "HEAD"],
        // The presigned URL carries its auth in the query string, so the only
        // header the browser actually sends is Content-Type. Listing it exactly
        // (rather than "*") keeps the preflight honest.
        AllowedHeaders: ["Content-Type"],
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3600,
    },
];

(async () => {
    if (process.argv.includes("--show")) {
        try {
            const cur = await s3.send(new GetBucketCorsCommand({ Bucket }));
            console.log(JSON.stringify(cur.CORSRules, null, 2));
        } catch (err) {
            if (err.name === "NoSuchCORSConfiguration") console.log("No CORS policy set on this bucket.");
            else throw err;
        }
        return;
    }

    await s3.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules } }));
    console.log(`CORS applied to bucket "${Bucket}" for origins:`);
    origins.forEach((o) => console.log(`  ${o}`));
    console.log("\nCloudflare can take up to ~30s to propagate. Hard-refresh the page after.");
})().catch((err) => {
    console.error("Failed to set CORS:", err.name, err.message);
    process.exit(1);
});
