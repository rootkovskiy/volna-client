// SPDX-License-Identifier: Apache-2.0
package social.volna.matrix.recipienttest

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.matrix.rustcomponents.sdk.*
import java.io.File
import java.util.UUID

class RecipientPolicyTest {
  @Test fun realFfiBindingIsImmutableAndSurvivesEncryptedStoreReopen() = runBlocking {
    initPlatform(TracingConfiguration(LogLevel.WARN, emptyList(), emptyList(), false, null), false)
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val directory = File(context.cacheDir, "recipient-${UUID.randomUUID()}").apply { mkdirs() }
    val key = ByteArray(32) { 37 }
    suspend fun open(): Client {
      val store = SqliteStoreBuilder(File(directory, "data").path, File(directory, "cache").path).key(key)
      val client = ClientBuilder().homeserverUrl("https://example.org").sqliteStore(store).disableAutomaticTokenRefresh().build()
      client.restoreSession(Session("fixture-unused-token", null, "@alice:example.org", "ALICE", "https://example.org", null, SlidingSyncVersion.NONE))
      return client
    }
    suspend fun reject(block: suspend () -> Unit) {
      var rejected = false
      try { block() } catch (_: Exception) { rejected = true }
      assertTrue("Invalid recipient binding must fail", rejected)
    }
    try {
      open().use { client ->
        client.encryption().use { crypto ->
          assertEquals(1u, crypto.roomKeyRecipientPolicyVersion())
          assertEquals(1u, crypto.authenticatedBackupVersion())
          crypto.bindRoomKeyRecipients("!direct:example.org", "@bob:example.org")
          crypto.bindRoomKeyRecipients("!direct:example.org", "@bob:example.org")
          reject { crypto.bindRoomKeyRecipients("!direct:example.org", "@service:example.org") }
          reject { crypto.bindRoomKeyRecipients("!self:example.org", "@alice:example.org") }
        }
      }
      open().use { client ->
        client.encryption().use { crypto ->
          crypto.bindRoomKeyRecipients("!direct:example.org", "@bob:example.org")
          reject { crypto.bindRoomKeyRecipients("!direct:example.org", "@service:example.org") }
        }
      }
    } finally {
      key.fill(0)
      check(directory.parentFile?.canonicalFile == context.cacheDir.canonicalFile)
      directory.deleteRecursively()
    }
  }
}
