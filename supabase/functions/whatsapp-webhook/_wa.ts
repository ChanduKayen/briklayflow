// WhatsApp Cloud API helpers + message logging

const WA_ACCESS_TOKEN    = Deno.env.get('WA_ACCESS_TOKEN')!
const WA_PHONE_NUMBER_ID = Deno.env.get('WA_PHONE_NUMBER_ID')!

/** Send a WhatsApp text message via Meta Cloud API. */
export async function sendWA(to: string, text: string): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v18.0/${WA_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    },
  )
  // Always log the send response so a silent send (or a 200 that Meta rejects
  // downstream) is never invisible again. Read the body once, then branch.
  const body = await res.json().catch(() => ({}))
  console.log('[wa-send]', res.status, JSON.stringify(body))
  if (!res.ok) {
    console.error('[wa] send error:', body)
  }
}

/** Insert a row into wa_message_log. */
export async function logMessage(
  supabase: any,
  log: {
    phone_number: string
    direction: 'IN' | 'OUT'
    message_type: string
    content: string | null
    media_url: string | null
    wa_message_id?: string | null
    rough_entry_id?: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('wa_message_log').insert(log)
  if (error) console.error('[wa] log error:', error)
}

/**
 * Download WhatsApp media bytes from Meta.
 * Step 1: resolve media URL (requires auth). Step 2: download image (requires auth).
 */
export async function downloadWAMedia(mediaId: string): Promise<ArrayBuffer> {
  const metaRes = await fetch(
    `https://graph.facebook.com/v18.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` } },
  )
  if (!metaRes.ok) throw new Error(`Meta media lookup failed: ${metaRes.status}`)

  const { url } = await metaRes.json()
  const imgRes = await fetch(url, {
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
  })
  if (!imgRes.ok) throw new Error(`Media download failed: ${imgRes.status}`)

  return imgRes.arrayBuffer()
}

/**
 * Download a WhatsApp image and store it in Supabase Storage (rough-entry-media bucket).
 * Returns the public URL, a base64 string (for AI vision), and the MIME type.
 */
export async function downloadAndStoreImage(
  mediaId: string,
  from: string,
  supabase: any,
): Promise<{ publicUrl: string; base64: string; contentType: string }> {
  // STEP 1: Get media URL + mime type from Meta
  const metaRes = await fetch(
    `https://graph.facebook.com/v18.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` } },
  )
  if (!metaRes.ok) throw new Error(`Meta media URL fetch failed: ${metaRes.status}`)

  const metaData = await metaRes.json()
  const mediaUrl: string = metaData.url
  const contentType: string = metaData.mime_type || 'image/jpeg'

  // STEP 2: Download actual image bytes
  const imgRes = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
  })
  if (!imgRes.ok) throw new Error(`Image download failed: ${imgRes.status}`)

  const buffer = await imgRes.arrayBuffer()
  const uint8 = new Uint8Array(buffer)

  // STEP 3: Convert to base64 for AI vision
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < uint8.length; i += CHUNK) {
    binary += String.fromCharCode(...uint8.slice(i, i + CHUNK))
  }
  const base64 = btoa(binary)

  // STEP 4: Upload to Supabase Storage
  const ext = contentType.includes('png') ? 'png' : 'jpg'
  const fileName = `wa_${from}_${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('rough-entry-media')
    .upload(fileName, uint8, { contentType, upsert: false })

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

  // STEP 5: Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('rough-entry-media')
    .getPublicUrl(fileName)

  console.log('Image stored:', { fileName, publicUrl, contentType, sizeBytes: uint8.length })

  return { publicUrl, base64, contentType }
}
