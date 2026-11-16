package app.sklubot.android.relay

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The relay's local settings. Only the user changes them, in the app: no message from the server reaches them.
 * Kept in the app's private SharedPreferences (excluded from backups: allowBackup="false" in the manifest).
 */
class RelayPrefs(context: Context) : PermStore {
    private val p: SharedPreferences = context.getSharedPreferences("sklubot-relay", Context.MODE_PRIVATE)
    private val app = context.applicationContext

    /** The server address of the app itself (MainActivity's first-run screen). */
    val server: String? get() = app.getSharedPreferences("sklubot", Context.MODE_PRIVATE).getString("server", null)

    var enabled: Boolean
        get() = p.getBoolean("enabled", false)
        set(v) = p.edit().putBoolean("enabled", v).apply()

    /**
     * The accessibility service has been on at least once since pairing: when it is off now while the relay is on and
     * paired, something turned it off (a force stop, some phones' update process) and the app offers to turn it back on.
     */
    var accessibilityWasOn: Boolean
        get() = p.getBoolean("a11yWasOn", false)
        set(v) = p.edit().putBoolean("a11yWasOn", v).apply()

    override fun alwaysAllowed(botId: String) = p.getStringSet("always", emptySet())!!.contains(botId)
    override fun setAlwaysAllowed(bot: Bot) {
        p.edit().putStringSet("always", p.getStringSet("always", emptySet())!! + bot.id)
            .putString("botName.${bot.id}", bot.name).apply()
    }
    /** Bots allowed "always", with their names, for the list where the user takes it back. */
    fun alwaysBots(): List<Bot> = p.getStringSet("always", emptySet())!!.map { Bot(it, p.getString("botName.$it", it) ?: it) }.sortedBy { it.name.lowercase() }
    fun revokeAlways(botId: String) { p.edit().putStringSet("always", p.getStringSet("always", emptySet())!! - botId).apply() }

    override fun isLocked() = p.getBoolean("locked", false)
    override fun setLocked(v: Boolean) { p.edit().putBoolean("locked", v).commit() }

    /** "Bloquer les applis de paiement et banque que je choisis": on by default, the list starts empty. */
    var blockEnabled: Boolean
        get() = p.getBoolean("blockEnabled", true)
        set(v) = p.edit().putBoolean("blockEnabled", v).apply()
    var blockList: Set<String>
        get() = p.getStringSet("blockList", emptySet())!!
        set(v) = p.edit().putStringSet("blockList", v).apply()
    override fun blockedPackages(): Set<String> = if (blockEnabled) blockList else emptySet()

    /** "Oublier ce serveur": the token, the bots allowed always, the lock. The block list stays (it is about the phone). */
    fun forget() {
        val keepBlock = blockList
        val keepOn = blockEnabled
        p.edit().clear().putStringSet("blockList", keepBlock).putBoolean("blockEnabled", keepOn).commit()
    }
}

/**
 * The device token, encrypted with an AES-256-GCM key that never leaves the Android Keystore
 * (https://developer.android.com/privacy-and-security/keystore). Only the ciphertext is in SharedPreferences.
 */
class TokenStore(context: Context) : AuthStore {
    private val p = context.getSharedPreferences("sklubot-relay-token", Context.MODE_PRIVATE)
    private val alias = "sklubot-relay-token"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val iv = Base64.encodeToString(c.iv, Base64.NO_WRAP)
        return iv + ":" + Base64.encodeToString(c.doFinal(plain.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String? = try {
        val (iv, data) = stored.split(":", limit = 2)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        String(c.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
    } catch (e: Exception) { null }

    @Synchronized override fun get(): Pair<String, String>? {
        val id = p.getString("deviceId", null) ?: return null
        val token = p.getString("token", null)?.let { decrypt(it) } ?: return null
        return id to token
    }

    @Synchronized override fun save(deviceId: String, token: String, serverName: String) {
        // commit(): on disk before the acknowledgement goes out (protocol §4, §5).
        p.edit().putString("deviceId", deviceId).putString("token", encrypt(token)).putString("serverName", serverName).commit()
    }

    val serverName: String get() = p.getString("serverName", "") ?: ""

    @Synchronized override fun clear() { p.edit().clear().commit() }
}

/** Local action log: one JSON line per action in files/logs/actions.log, rotated at 1 MB. Never images or tokens. */
class ActionLog(context: Context) {
    private val dir = File(context.filesDir, "logs").apply { mkdirs() }
    private val file = File(dir, "actions.log")

    @Synchronized fun write(entry: JSONObject) {
        try {
            val line = JSONObject(entry.toString()).put("ts", isoTime(System.currentTimeMillis())).toString() + "\n"
            if (file.exists() && file.length() + line.length > 1024 * 1024) file.renameTo(File(dir, "actions.1.log"))
            file.appendText(line)
        } catch (_: Exception) { /* logging never breaks the relay */ }
    }

    /** The last lines, newest first, for the screen in the app. */
    @Synchronized fun tail(n: Int): List<JSONObject> = try {
        file.readLines().takeLast(n).reversed().mapNotNull { runCatching { JSONObject(it) }.getOrNull() }
    } catch (_: Exception) { emptyList() }
}
