import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
process.loadEnvFile(new URL("../.env.local",import.meta.url))
const base="https://showcase.zamdevai.com"
for(const route of ["/","/auth/login/","/showcase/audit/","/showcase/calculator/","/showcase/demo/","/showcase/demo/member/","/showcase/for/agencies/","/showcase/for/ecommerce/","/showcase/for/training/","/showcase/privacy/","/showcase/resources/workflow-map/","/showcase/resources/worksheet.txt"]) {
  const r=await fetch(base+route,{signal:AbortSignal.timeout(20000)})
  assert.equal(r.status,200,route)
  assert.ok(r.headers.get("x-content-type-options"),`security header: ${route}`)
  console.log(`HTTP 200 ${route}`)
}
const wrongOrigin=await fetch(base+"/api/funnel/leads",{method:"POST",headers:{origin:"https://untrusted.example","content-type":"application/json"},body:"{}"})
assert.equal(wrongOrigin.status,403)
const invalid=await fetch(base+"/api/funnel/leads",{method:"POST",headers:{origin:base,"content-type":"application/json"},body:"{}"})
assert.equal(invalid.status,400)
const email=`zamadshakil+hierarchia-qa-${randomBytes(4).toString("hex")}@gmail.com`
const contactUrl="https://api.brevo.com/v3/contacts/"+encodeURIComponent(email)
const headers={"api-key":process.env.BREVO_API_KEY,"content-type":"application/json"}
const before=await fetch(contactUrl,{headers})
assert.equal(before.status,404,"Do not overwrite an existing contact")
let created=false
try {
  const r=await fetch(base+"/api/funnel/leads",{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({name:"Internal funnel verification",email,company:"ZamDev AI",segment:"agencies",teamSize:30,weeklySubmissions:80,workflow:"Internal QA only. No appointment or sales follow-up requested.",privacyAccepted:true,marketingConsent:false,website:"",source:"internal_qa",medium:"test",campaign:"prelaunch_verification"})})
  assert.equal(r.status,200,await r.text());created=true
  const saved=await fetch(contactUrl,{headers});assert.equal(saved.status,200)
  const contact=await saved.json()
  assert.ok(contact.listIds.includes(17))
  assert.equal(contact.listIds.includes(18),false)
  assert.equal(contact.attributes.HIER_MARKETING_REQUESTED,false)
  assert.equal(contact.attributes.HIER_SOURCE,"internal_qa")
  assert.equal(contact.attributes.HIER_SCORE,100)
  console.log("Live intake persisted to Brevo; attributes and opt-out verified; no emails sent.")
} finally {
  if(created){const removed=await fetch(contactUrl,{method:"DELETE",headers});assert.equal(removed.status,204);console.log("Removed the single QA contact created by this verification.")}
}
