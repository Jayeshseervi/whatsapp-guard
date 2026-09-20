import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  getContentType,
  normalizeMessageContent,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import fs from 'node:fs'
import readline from 'node:readline/promises'

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
const warnings = new Map() // "group:user" -> warning count (resets on restart)
const mutedUsers = new Set() // "group:user" -> messages are deleted (resets on restart)
const adminCache = new Map() // group -> { admins: Set, time }

// Phone number used for the pairing code. It is typed in the terminal (never saved to a file).
let pairingNumber = null

// Ask for the number in the terminal. Digits only, with country code (example: 919876543210).
async function askPhoneNumber() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    while (true) {
      const answer = await rl.question(
        'Enter the WhatsApp number to link, with country code and digits only (example: 919876543210)\n' +
          'Press Enter to skip and use the QR code only: '
      )
      const digits = answer.replace(/\D/g, '')
      if (!digits) return '' // skipped -> QR only
      if (digits.length >= 8 && digits.length <= 15) return digits
      console.log('That does not look like a valid number. Include the country code, for example 919876543210.')
    }
  } finally {
    rl.close()
  }
}

// WhatsApp internal message names -> simple names used in config.json
const TYPE_MAP = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  stickerMessage: 'sticker',
  documentMessage: 'document',
  contactMessage: 'contact',
  contactsArrayMessage: 'contact',
  locationMessage: 'location',
  liveLocationMessage: 'location',
  pollCreationMessage: 'poll',
  pollCreationMessageV3: 'poll',
}

function getText(content) {
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  )
}

function logDeletedMessage({ group, sender, type, text, reason }) {
  const preview = text.trim().replace(/\s+/g, ' ').slice(0, 300) || `[${type} message]`
  console.log(
    `[${new Date().toISOString()}] Deleted message | group: ${group} | sender: ${sender} | reason: ${reason} | content: ${preview}`
  )
}

// http(s):// links, www., and invite links (always treated as links)
const STRICT_LINKS = new RegExp(
  '(?:https?:\\/\\/|www\\.)\\S+|(?:chat\\.whatsapp\\.com|wa\\.me|t\\.me)\\/\\S+',
  'gi'
)
// bare domains like example.com (only checked when blockBareDomains is not false)
const BARE_DOMAINS = new RegExp(
  '\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:com|net|org|io|me|co|in|xyz|info|app|dev|gg|ly|tv|link|site|online|store|shop|click|top|cc)\\b(?:\\/\\S*)?',
  'gi'
)

function hostOf(link) {
  return link.replace(/^[a-z]+:\/\//i, '').split(/[\/?#:]/)[0].replace(/^www\./i, '').toLowerCase()
}

// true if the host (or its parent domain) is in config.allowedDomains
function isAllowed(host) {
  return (config.allowedDomains || []).some((d) => {
    d = d.toLowerCase().replace(/^www\./, '')
    return host === d || host.endsWith('.' + d)
  })
}

function containsLink(content, text) {
  const links = []
  // a WhatsApp link preview always means a real link was sent
  const preview = content.extendedTextMessage?.matchedText || content.extendedTextMessage?.canonicalUrl
  if (preview) links.push(preview)
  links.push(...(text.match(STRICT_LINKS) || []))
  if (config.blockBareDomains !== false) links.push(...(text.match(BARE_DOMAINS) || []))
  return links.some((link) => !isAllowed(hostOf(link)))
}

// ---- abuse / slur filter (keyword based, config.bannedWords) ----
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' }

// lowercase, strip accents / zero-width chars, undo simple leetspeak (b1tch -> bitch)
function normalizeForAbuse(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200b-\u200f\u2060\ufeff]/g, '')
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => LEET[c])
}

// Each letter may repeat (fuuuck), whole words only, common endings allowed (-s, -er, -ing)
const abuseRegex = (() => {
  const words = (config.bannedWords || []).map(normalizeForAbuse).filter(Boolean)
  if (!words.length) return null
  const body = words
    .map((w) =>
      w
        .split(/\s+/)
        .map((part) => [...part].map((ch) => ch.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '+').join(''))
        .join('\\s+')
    )
    .join('|')
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?:s|es|ed|er|ers|ing)?(?![\\p{L}\\p{N}])`, 'iu')
})()

function containsAbuse(text) {
  return abuseRegex ? abuseRegex.test(normalizeForAbuse(text)) : false
}

// Ask Ollama to check text or an image. Videos are checked from their WhatsApp preview image.
async function aiCheck({ text = '', image } = {}) {
  try {
    const isVisualCheck = Boolean(image)
    const res = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: isVisualCheck ? config.ollamaVisionModel : config.ollamaModel,
        stream: false,
        format: 'json',
        messages: [
          {
            role: 'system',
            content:
              `You moderate a WhatsApp group. Group rules: ${config.groupRules} ` +
              'Flag harassment, bullying, threats, hate speech, slurs, nudity or sexual content, graphic violence, and hateful symbols. ' +
              'For images, evaluate only what is clearly visible. Normal disagreement, ordinary photos, and harmless videos are not violations. ' +
              'Reply ONLY with JSON: {"violation": true or false, "reason": "short reason"}',
          },
          {
            role: 'user',
            content: text || 'Check this visual content against the group rules.',
            ...(image ? { images: [image.toString('base64')] } : {}),
          },
        ],
      }),
    })
    const data = await res.json()
    return JSON.parse(data.message.content)
  } catch (e) {
    console.error('AI check failed:', e.message)
    return { violation: false } // if AI is down, do not punish anyone
  }
}

async function imageForModeration(sock, msg, content, type) {
  try {
    if (type === 'video') {
      // WhatsApp includes a still preview for most videos; this avoids downloading large videos.
      return content.videoMessage?.jpegThumbnail || null
    }
    if (type === 'image') return await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage })
  } catch (e) {
    console.error('Media download failed:', e.message)
  }
  return null
}

async function isAdmin(sock, groupJid, userJid) {
  const cached = adminCache.get(groupJid)
  if (cached && Date.now() - cached.time < 60_000) return cached.admins.has(userJid)
  const meta = await sock.groupMetadata(groupJid)
  const admins = new Set(meta.participants.filter((p) => p.admin).map((p) => p.id))
  adminCache.set(groupJid, { admins, time: Date.now() })
  return admins.has(userJid)
}

async function handle(sock, msg) {
  const group = msg.key.remoteJid
  if (!msg.message || msg.key.fromMe || !group?.endsWith('@g.us')) return

  const sender = msg.key.participant
  const content = normalizeMessageContent(msg.message) // unwraps disappearing / view-once
  const type = TYPE_MAP[getContentType(content)] ?? 'other'
  const text = getText(content)

  const senderIsAdmin = await isAdmin(sock, group, sender)
  if (senderIsAdmin) {
    // Admin command: mention a member and write "unban" to let them post again.
    const mentioned = content.extendedTextMessage?.contextInfo?.mentionedJid || []
    if (/\bunban\b/i.test(text) && mentioned.length) {
      for (const user of mentioned) {
        const userKey = `${group}:${user}`
        mutedUsers.delete(userKey)
        warnings.delete(userKey)
      }
      await sock.sendMessage(group, {
        text: `${mentioned.map((user) => `@${user.split('@')[0]}`).join(' ')} can send messages again.`,
        mentions: mentioned,
      })
      console.log(`Unbanned by ${sender}: ${mentioned.join(', ')}`)
    }
    return // admins can post anything
  }

  // WhatsApp cannot mute one person in a group. Instead, keep the person in
  // the group and automatically delete anything they send after the limit.
  const key = `${group}:${sender}`
  if (mutedUsers.has(key)) {
    await sock.sendMessage(group, { delete: msg.key })
    logDeletedMessage({ group, sender, type, text, reason: 'user has reached the warning limit' })
    return
  }

  let reason = null
  if (config.blockedTypes.includes(type)) {
    reason = `${type} messages are not allowed`
  } else if (config.blockLinks && containsLink(content, text)) {
    reason = 'links are not allowed'
  } else if (config.blockAbuse && containsAbuse(text)) {
    reason = 'abusive language or slurs are not allowed'
  } else if (config.aiModeration && (text.length > 3 || type === 'image' || type === 'video')) {
    const image = type === 'image' || type === 'video'
      ? await imageForModeration(sock, msg, content, type)
      : null
    const result = await aiCheck({ text, image })
    if (result.violation) reason = result.reason || 'against group rules'
  }
  if (!reason) return

  // Bot must be a group admin for deletions to work
  await sock.sendMessage(group, { delete: msg.key })
  logDeletedMessage({ group, sender, type, text, reason })

  const count = (warnings.get(key) || 0) + 1
  warnings.set(key, count)

  if (count >= config.maxWarnings) {
    mutedUsers.add(key)
    warnings.delete(key)
    await sock.sendMessage(group, {
      text: `@${sender.split('@')[0]} has reached ${config.maxWarnings} warnings. They will remain in the group, but their future messages will be removed automatically.`,
      mentions: [sender],
    })
    return
  }

  await sock.sendMessage(group, {
    text: `@${sender.split('@')[0]} message removed: ${reason} (warning ${count}/${config.maxWarnings})`,
    mentions: [sender],
  })
}

async function start() {
  // Keep auth_info so the bot stays linked after normal restarts.
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const { version } = await fetchLatestBaileysVersion()

  // Ask for the number only when the bot is not linked yet (first run), and only once.
  if (!state.creds.registered && pairingNumber === null) {
    pairingNumber = await askPhoneNumber()
  }
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }) })
  let pairingCodeRequested = false

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nOption 1: scan this QR code in WhatsApp > Linked devices > Link a device.\n')
      qrcode.generate(qr, { small: true })

      // Option 2: pairing code for the number typed in the terminal (requested once per connection).
      if (pairingNumber && !sock.authState.creds.registered && !pairingCodeRequested) {
        pairingCodeRequested = true
        try {
          const code = await sock.requestPairingCode(pairingNumber)
          const pretty = code.match(/.{1,4}/g)?.join('-') || code
          console.log(`\nOption 2: pairing code for +${pairingNumber}:  ${pretty}`)
          console.log('On the phone: WhatsApp > Linked devices > Link a device > "Link with phone number instead", then type the code.\n')
        } catch (e) {
          console.error('Pairing code failed:', e.message)
        }
      }
    }
    if (connection === 'open') console.log('Bot connected')
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) start()
      else console.log('Logged out. Delete the auth_info folder and scan again.')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      try {
        await handle(sock, msg)
      } catch (e) {
        console.error('Handle error:', e.message)
      }
    }
  })
}

start()
