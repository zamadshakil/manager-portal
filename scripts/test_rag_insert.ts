import { createClient } from "@supabase/supabase-js"
import { config } from "dotenv"
config({ path: ".env.local" })

async function testInsert() {
  console.log("Testing Supabase Insert...")
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing keys")

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    })
    
    const dummyVector = Array.from({ length: 1536 }, () => Math.random() * 0.1)
    
    console.log("Attempt 1: String format")
    const res2 = await supabase.from("rag_documents").insert({
      source_type: "test",
      source_id: "test2",
      chunk_index: 0,
      content: "test",
      embedding: `[${dummyVector.join(",")}]`
    })
    console.log("String result:", res2.error ? res2.error.message : "Success")

    // Cleanup
    await supabase.from("rag_documents").delete().eq("source_type", "test")
  } catch (err: any) {
    console.error("Fatal error:", err.message)
  }
}

testInsert()
