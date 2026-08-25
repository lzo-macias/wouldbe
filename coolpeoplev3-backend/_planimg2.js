const { Client } = require("pg");
const S = "/private/tmp/claude-501/-Users-papasito-coolpeoplev3/22557abf-b616-489c-9d48-13a1a381e24f/scratchpad";
const { token } = require(`${S}/signup.json`);
const B = "http://localhost:3000";
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  for (const t of ["age_18", "us_citizen"]) {
    await fetch(`${B}/api/attestations`, { method: "POST", headers: auth,
      body: JSON.stringify({ attestation_type: t, attested_value: true, attestation_version: "1.0", context: "test" }) });
  }

  const up = await j(await fetch(`${B}/api/plan-components/image-upload-url`, {
    method: "POST", headers: auth, body: JSON.stringify({ contentType: "image/webp" }) }));

  const office = (await db.query(
    `SELECT o.id FROM office o JOIN jurisdiction j ON j.id=o.jurisdiction_id
      WHERE j.state_code='NY' AND j.type='state_leg_lower' LIMIT 1`)).rows[0];
  const race = (await db.query(`SELECT id FROM races LIMIT 1`)).rows[0];

  const wb = await j(await fetch(`${B}/api/wouldbes`, { method: "POST", headers: auth,
    body: JSON.stringify({ title: "Plan image test", description: "test", office_id: office.id,
      race_id: race.id, goal_cents: 500000, deadline: "2026-10-01" }) }));
  console.log("3. wouldbe           ", wb.status);
  if (!wb.body.id) { console.log(wb.body); await db.end(); return; }

  const plan = await j(await fetch(`${B}/api/wouldbes/${wb.body.id}/plan`, { method: "POST", headers: auth }));
  console.log("4. plan              ", plan.status);

  const comp = await j(await fetch(`${B}/api/plans/${plan.body.id}/components`, { method: "POST", headers: auth,
    body: JSON.stringify({ category_key: "housing", title: "Housing", description: "Build more homes",
      image_object_key: up.body.objectKey, image_mime_type: "image/webp", image_file_size_bytes: 24680 }) }));
  console.log("5. component+image   ", comp.status, "| image moderation_status:", comp.body.image?.moderation_status);
  if (!comp.body.id) { console.log(comp.body); await db.end(); return; }

  const before = (await db.query(`SELECT image_url FROM plan_components WHERE id=$1`, [comp.body.id])).rows[0];
  console.log("   image_url BEFORE verdict:", before.image_url);

  const dec = await j(await fetch(`${B}/api/content-items/${comp.body.image.id}/auto-decision`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_API_SECRET },
    body: JSON.stringify({ provider: "nudenet", result: "clean", confidence_score: 0.01 }) }));
  console.log("6. auto-decision     ", dec.status, dec.body.applied_status, "| visibility:", dec.body.content_item?.visibility);

  const after = (await db.query(`SELECT image_url FROM plan_components WHERE id=$1`, [comp.body.id])).rows[0];
  console.log("   image_url AFTER approval:", after.image_url);

  // reject a second image -> must not publish
  const up2 = await j(await fetch(`${B}/api/plan-components/image-upload-url`, {
    method: "POST", headers: auth, body: JSON.stringify({ contentType: "image/jpeg" }) }));
  const comp2 = await j(await fetch(`${B}/api/plans/${plan.body.id}/components`, { method: "POST", headers: auth,
    body: JSON.stringify({ category_key: "education", title: "Ed", description: "Fund schools",
      image_object_key: up2.body.objectKey, image_mime_type: "image/jpeg" }) }));
  await fetch(`${B}/api/content-items/${comp2.body.image.id}/auto-decision`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_API_SECRET },
    body: JSON.stringify({ provider: "nudenet", result: "rejected", confidence_score: 0.97 }) });
  const rej = (await db.query(`SELECT image_url FROM plan_components WHERE id=$1`, [comp2.body.id])).rows[0];
  console.log("7. REJECTED image    | image_url:", rej.image_url, "(must be null)");

  // someone else's object key
  const foreign = await j(await fetch(`${B}/api/plans/${plan.body.id}/components`, { method: "POST", headers: auth,
    body: JSON.stringify({ category_key: "healthcare", title: "H", description: "x",
      image_object_key: "plan-components/00000000-0000-0000-0000-000000000000/x.webp", image_mime_type: "image/webp" }) }));
  console.log("8. foreign key       ", foreign.status, "| image:", foreign.body.image, "| err:", foreign.body.image_error);

  // GET the plan back — does image_url surface?
  const got = await j(await fetch(`${B}/api/wouldbes/${wb.body.id}/plan`, { headers: auth }));
  console.log("9. GET plan components:");
  console.table((got.body.components ?? []).map(c => ({ title: c.title, image_url: c.image_url ? "SET" : null })));
  await db.end();
})().catch(e => console.error("ERR", e.message));
