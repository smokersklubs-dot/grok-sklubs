package app.sklubot.live

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * What the background connection needs when the app's JavaScript is not running (after a reboot): the user's choice,
 * the server's address and the session. The session is encrypted with an AES-256-GCM key that never leaves the
 * Android Keystore (https://developer.android.com/privacy-and-security/keystore); only the ciphertext is in the app's
 * private preferences (no backup: allowBackup is false). Cleared when the user turns the option off or signs out.
 */
class LiveStore(context: Context) {
    private val p = context.applicationContext.getSharedPreferences("sklubot-live", Context.MODE_PRIVATE)
    private val alias = "sklubot-live-session"

    var enabled: Boolean
        get() = p.getBoolean("enabled", false)
        set(v) { p.edit().putBoolean("enabled", v).apply() }
    var onBoot: Boolean
        get() = p.getBoolean("boot", false)
        set(v) { p.edit().putBoolean("boot", v).apply() }
    val origin: String? get() = p.getString("origin", null)

    /** The chat on screen while the app is in front: nothing to notify, the app shows it. */
    @Volatile var appInFront = false

    fun session(): String? = p.getString("session", null)?.let { decrypt(it) }

    fun save(origin: String, session: String) {
        p.edit().putString("origin", origin).putString("session", encrypt(session)).commit()
    }

    fun clear() { p.edit().clear().commit() }

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
        return Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(c.doFinal(plain.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String? = try {
        val (iv, data) = stored.split(":", limit = 2)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        String(c.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
    } catch (e: Exception) { null }

    companion object {
        @Volatile private var instance: LiveStore? = null
        fun of(c: Context) = instance ?: LiveStore(c).also { instance = it }
    }
}
