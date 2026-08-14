const { Client } = require("pg");
const jwt = require("jsonwebtoken");
const U = "b7de2129-8a17-4323-9fb9-cfd14abac5d3";
const B = "http://localhost:3000";
const token = jwt.sign({ id: U, username: "x" }, process.env.JWT_SECRET, { expiresIn: "5m" });
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  console.log("1. bad type (docx)");
  const bad = await j(await fetch(`${B}/api/committees/receipt-upload-url`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }) }));
  console.log("  ", bad.status, bad.body.error);

  console.log("\n2. PDF presign");
  const up = await j(await fetch(`${B}/api/committees/receipt-upload-url`, {
    method: "POST", headers: auth, body: JSON.stringify({ contentType: "application/pdf" }) }));
  console.log("  ", up.status, "| key:", up.body.objectKey);
  console.log("   publicUrl present?", "publicUrl" in up.body, "(should be false)");

  // upload a tiny real PDF so the presigned GET has something to serve
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  const put = await fetch(up.body.uploadUrl, { method: "PUT", body: pdf, headers: { "Content-Type": "application/pdf" } });
  console.log("   PUT to R2 ->", put.status);

  console.log("\n3. create committee with the receipt key");
  const jur = (await db.query(`SELECT jurisdiction_id FROM user_jurisdictions WHERE user_id=$1 LIMIT 1`, [U])).rows[0];
  const c = await j(await fetch(`${B}/api/committees`, { method: "POST", headers: auth,
    body: JSON.stringify({
      jurisdiction_id: jur.jurisdiction_id, committee_name: "Macias for Assembly",
      committee_type: "principal", office_sought: "NY State Representative District 74",
      cycle_year: 2026, filing_receipt_object_key: up.body.objectKey }) }));
  console.log("  ", c.status, "| registration_status:", c.body.registration_status);
  console.log("   (uploaded receipt alone should give provisional_on_receipt)");

  console.log("\n4. owner fetches a view link");
  const v = await j(await fetch(`${B}/api/committees/${c.body.id}/receipt-url`, { headers: auth }));
  console.log("  ", v.status, "| expires_in:", v.body.expires_in_seconds);
  const head = await fetch(v.body.url, { method: "GET" });
  console.log("   presigned GET ->", head.status, `${(await head.arrayBuffer()).byteLength}b`);

  console.log("\n5. a DIFFERENT user tries to view it");
  const other = jwt.sign({ id: "285e1635-a048-4136-8184-0161711c6ea1", username: "y" }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const f = await j(await fetch(`${B}/api/committees/${c.body.id}/receipt-url`, { headers: { Authorization: `Bearer ${other}` } }));
  console.log("  ", f.status, f.body.error);

  console.log("\n6. does it satisfy the launch gate?");
  const wb = (await db.query(`SELECT id FROM wouldbe WHERE user_id=$1 LIMIT 1`, [U])).rows[0];
  const chk = await j(await fetch(`${B}/api/wouldbes/${wb.id}/checklist`, { headers: auth }));
  console.log("   committee_ok:", chk.body.committee_ok, "| blockers:", chk.body.blockers);

  await db.end();
})().catch(e => console.error("ERR", e.message));
